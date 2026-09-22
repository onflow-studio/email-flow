import { and, eq, isNull, ne, or } from "drizzle-orm";

import { evaluateWithJev, type EvaluationQuestion, type JevState } from "@/lib/ai";
import type { Db } from "@/lib/db";
import { classifications, senders, threads, type Job } from "@/lib/db/schema";
import { enqueueWriteback, type JobContext } from "@/lib/sync/jobs";

import { loadContext } from "./context";
import { buildJevRequest, parseJevAnswers, type JevAnswer } from "./prompt";
import { decide } from "./thresholds";
import type { ClassifyContext, Decision, ModelResult } from "./types";

export type Evaluator = (
  state: JevState,
  questions: Record<string, EvaluationQuestion>,
) => Promise<{
  answers: Record<string, JevAnswer>;
  response: { modelId: string };
  usage?: unknown;
  providerMetadata?: unknown;
}>;

export type ClassifierRun = {
  decision: Decision;
  // Null when the sender is kept out and the model was not called.
  model: { id: string; raw: unknown; result: ModelResult } | null;
};

export async function runClassifier(
  ctx: ClassifyContext,
  evaluate: Evaluator = evaluateWithJev,
): Promise<ClassifierRun> {
  const { decision: screened } = ctx.sender;
  if (screened === "out_spam" || screened === "out_not_now") {
    return { decision: decide(null, ctx.sender), model: null };
  }
  const request = buildJevRequest(ctx);
  const response = await evaluate(request.state, request.questions);
  const result = parseJevAnswers(response.answers);
  return {
    decision: decide(result, ctx.sender),
    model: {
      id: response.response.modelId,
      raw: {
        answers: response.answers,
        usage: response.usage ?? null,
        providerMetadata: response.providerMetadata ?? null,
      },
      result,
    },
  };
}

// Classify one thread and apply the decision. Skips threads the user already placed.
export async function classifyThread(
  db: Db,
  threadId: string,
  evaluate: Evaluator = evaluateWithJev,
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
