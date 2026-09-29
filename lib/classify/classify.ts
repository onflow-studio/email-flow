import { and, eq, isNull, lt, ne, or } from "drizzle-orm";

import type { LanguageModel } from "ai";

import { generateStructured } from "@/lib/ai";
import type { Db } from "@/lib/db";
import { classifications, senders, threads, type Bucket, type Job } from "@/lib/db/schema";
import { enqueueSummary, enqueueWriteback, type JobContext } from "@/lib/sync/jobs";

import { confirmed, jevConfirmer, needsConfirmation, type Confirmer, type SecondOpinion } from "./confirm";
import { loadContext } from "./context";
import { applyParticipation } from "./participation";
import {
  answerSchema,
  buildClassifierRequest,
  parseAnswer,
  type ClassifierAnswer,
  type ClassifierRequest,
} from "./prompt";
import { wantsSummary } from "./summary";
import { evaluateRules, modelConfirms, ruleDecision } from "./rules";
import { decide, needsScreening } from "./thresholds";
import type { ClassifyContext, Decision, ModelResult } from "./types";

export type Evaluator = (
  request: ClassifierRequest,
) => Promise<{ output: ClassifierAnswer; modelId: string; raw: unknown }>;

// Claude Haiku by default; tests pass a mock model.
export function claudeEvaluator(model?: LanguageModel): Evaluator {
  return (request) => generateStructured({ ...request, schema: answerSchema, name: "classification" }, { model });
}

const defaultEvaluator: Evaluator = (request) => claudeEvaluator()(request);

export type ClassifierRun = {
  decision: Decision;
  // Null when the model was not called: sender kept out, or a literal rule decided.
  model: { id: string; raw: unknown; result: ModelResult } | null;
};

export async function runClassifier(
  ctx: ClassifyContext,
  evaluate: Evaluator = defaultEvaluator,
  confirm: Confirmer = jevConfirmer,
): Promise<ClassifierRun> {
  const { decision: screened } = ctx.sender;
  if (screened === "out_spam" || screened === "out_not_now") {
    return { decision: decide(null, ctx.sender), model: null };
  }

  const rules = evaluateRules(ctx.rules, ctx.thread, {
    senderCorrectedAt: ctx.senderCorrectedAt ?? null,
    screening: needsScreening(ctx.sender),
  });
  if (rules.direct) {
    return { decision: ruleDecision(rules.direct.bucket, ctx.sender), model: null };
  }

  const { result, response } = await callModel(ctx, rules.hints, evaluate);
  const decision =
    rules.conditional && modelConfirms(rules.conditional, result)
      ? ruleDecision(rules.conditional.bucket, ctx.sender)
      : decide(result, ctx.sender);
  const opinion = needsConfirmation(decision) ? await secondOpinion(ctx, confirm) : null;
  const raw = opinion ? { ...(response.raw as object), secondOpinion: opinion } : response.raw;
  return {
    decision: confirmed(decision, opinion) ? { ...decision, suggested: false } : decision,
    model: { id: response.modelId, raw, result },
  };
}

// Best effort: without a second opinion the suggestion stays a suggestion, the job still succeeds.
async function secondOpinion(ctx: ClassifyContext, confirm: Confirmer): Promise<SecondOpinion | null> {
  try {
    return await confirm(ctx);
  } catch (error) {
    console.error("second opinion failed", error);
    return null;
  }
}

async function callModel(ctx: ClassifyContext, hints: ClassifyContext["rules"], evaluate: Evaluator) {
  const response = await evaluate(buildClassifierRequest({ ...ctx, rules: hints }));
  return { response, result: parseAnswer(response.output, needsScreening(ctx.sender)) };
}

type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];

function recordModel(tx: Tx, threadId: string, model: NonNullable<ClassifierRun["model"]>) {
  return tx.insert(classifications).values({
    threadId,
    model: model.id,
    rawResponse: model.raw,
    bucket: model.result.bucket,
    bucketProbabilities: model.result.bucketProbabilities,
    urgency: model.result.urgency,
    humanWritten: model.result.humanWritten >= 0.5,
    legitNewSender: model.result.legitNewSender === null ? null : model.result.legitNewSender >= 0.5,
  });
}

// Only moves forward: a slower call must not overwrite a summary of a newer message.
function storeSummary(tx: Tx, threadId: string, summary: string | null, upTo: Date) {
  return tx
    .update(threads)
    .set({ summary, summaryMessageAt: upTo })
    .where(and(eq(threads.id, threadId), or(isNull(threads.summaryMessageAt), lt(threads.summaryMessageAt, upTo))));
}

// Classify one thread and apply the decision. Skips threads the user already placed. With `only`, the
// decision is applied just when it lands in that bucket, for backfilling a new bucket without
// reshuffling the rest.
export async function classifyThread(
  db: Db,
  threadId: string,
  evaluate: Evaluator = defaultEvaluator,
  opts: { only?: Bucket; confirm?: Confirmer } = {},
): Promise<Decision | null> {
  const loaded = await loadContext(db, threadId);
  if (!loaded || loaded.thread.bucketSource === "user") return null;

  const { decision, model } = await runClassifier(loaded.ctx, evaluate, opts.confirm);
  const { thread, senderId } = loaded;

  await db.transaction(async (tx) => {
    if (model) {
      await recordModel(tx, threadId, model);
      await storeSummary(tx, threadId, model.result.summary, thread.lastMessageAt);
    } else if (wantsSummary(decision.bucket) && (!opts.only || decision.bucket === opts.only)) {
      // A rule or the screener decided without the model; ask it for the summary alone.
      await enqueueSummary(tx, thread);
    }

    if (opts.only && decision.bucket !== opts.only) return;

    // Re-check inside the transaction: a user move may have landed during the model call.
    const updated = await tx
      .update(threads)
      .set({
        bucket: decision.bucket,
        bucketSource: decision.source,
        bucketConfidence: decision.confidence,
        bucketSuggested: decision.suggested,
      })
      .where(and(eq(threads.id, threadId), notUserPlaced()))
      .returning({ id: threads.id });
    if (updated.length === 0) return;

    if (decision.screener === "allow" && senderId) {
      await tx
        .update(senders)
        .set({ screenerDecision: "allowed", decidedBy: "ai", decidedAt: new Date() })
        .where(and(eq(senders.id, senderId), eq(senders.screenerDecision, "none")));
    }

    if (thread.bucketSource === null || thread.bucket !== decision.bucket) {
      await enqueueWriteback(tx, thread);
    }

    // The user may have written in the thread while the model ran; that beats a triage call.
    if (decision.bucket === "triage") await applyParticipation(tx, threadId);
  });

  return decision;
}

export type SummaryRun = { summary: string | null; raw: unknown } | null;

// Refresh the list summary without touching the bucket: new messages, and threads imported before
// summaries existed. Same call as classification, so the answer is also kept in classifications.
// Null when skipped: nothing inbound, a bucket that keeps its snippet, or already up to date.
export async function summarizeThread(
  db: Db,
  threadId: string,
  evaluate: Evaluator = defaultEvaluator,
): Promise<SummaryRun> {
  const loaded = await loadContext(db, threadId);
  if (!loaded) return null;
  const { thread, ctx } = loaded;
  if (!wantsSummary(thread.bucket)) return null;
  if (thread.summaryMessageAt && thread.summaryMessageAt >= thread.lastMessageAt) return null;

  const rules = evaluateRules(ctx.rules, ctx.thread, {
    senderCorrectedAt: ctx.senderCorrectedAt ?? null,
    screening: needsScreening(ctx.sender),
  });
  const { response, result } = await callModel(ctx, rules.hints, evaluate);
  await db.transaction(async (tx) => {
    await recordModel(tx, threadId, { id: response.modelId, raw: response.raw, result });
    await storeSummary(tx, threadId, result.summary, thread.lastMessageAt);
  });
  return { summary: result.summary, raw: response.raw };
}

// bucket_source is null until first placement; `<> 'user'` alone would drop nulls.
function notUserPlaced() {
  return or(isNull(threads.bucketSource), ne(threads.bucketSource, "user"));
}

export async function classifyJob(job: Job, ctx: JobContext) {
  const { threadId, summaryOnly } = job.payload as { threadId?: string; summaryOnly?: boolean };
  if (!threadId) throw new Error("classify job without threadId");
  if (summaryOnly) await summarizeThread(ctx.db, threadId, ctx.evaluate);
  else await classifyThread(ctx.db, threadId, ctx.evaluate, { confirm: ctx.confirm });
}
