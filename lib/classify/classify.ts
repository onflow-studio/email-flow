import { and, eq, isNull, ne, or } from "drizzle-orm";

import type { LanguageModel } from "ai";

import { generateStructured } from "@/lib/ai";
import type { Db } from "@/lib/db";
import { classifications, senders, threads, type Job } from "@/lib/db/schema";
import { enqueueWriteback, type JobContext } from "@/lib/sync/jobs";

import { loadContext } from "./context";
import {
  answerSchema,
  buildClassifierRequest,
  parseAnswer,
  type ClassifierAnswer,
  type ClassifierRequest,
} from "./prompt";
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

  const response = await evaluate(buildClassifierRequest({ ...ctx, rules: rules.hints }));
  const result = parseAnswer(response.output, needsScreening(ctx.sender));
  const decision =
    rules.conditional && modelConfirms(rules.conditional, result)
      ? ruleDecision(rules.conditional.bucket, ctx.sender)
      : decide(result, ctx.sender);
  return {
    decision,
    model: { id: response.modelId, raw: response.raw, result },
  };
}

// Classify one thread and apply the decision. Skips threads the user already placed.
export async function classifyThread(
  db: Db,
  threadId: string,
  evaluate: Evaluator = defaultEvaluator,
): Promise<Decision | null> {
  const loaded = await loadContext(db, threadId);
  if (!loaded || loaded.thread.bucketSource === "user") return null;

  const { decision, model } = await runClassifier(loaded.ctx, evaluate);
  const { thread, senderId } = loaded;

  await db.transaction(async (tx) => {
    if (model) {
      await tx.insert(classifications).values({
        threadId,
        model: model.id,
        rawResponse: model.raw,
        bucket: model.result.bucket,
        bucketProbabilities: model.result.bucketProbabilities,
        urgency: model.result.urgency,
        humanWritten: model.result.humanWritten >= 0.5,
        legitNewSender:
          model.result.legitNewSender === null ? null : model.result.legitNewSender >= 0.5,
      });
    }

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
  });

  return decision;
}

// bucket_source is null until first placement; `<> 'user'` alone would drop nulls.
function notUserPlaced() {
  return or(isNull(threads.bucketSource), ne(threads.bucketSource, "user"));
}

export async function classifyJob(job: Job, ctx: JobContext) {
  const { threadId } = job.payload as { threadId?: string };
  if (!threadId) throw new Error("classify job without threadId");
  await classifyThread(ctx.db, threadId, ctx.evaluate);
}
