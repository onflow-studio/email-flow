import { and, desc, eq, inArray, ne, sql } from "drizzle-orm";

import { EMBEDDING_DIMENSIONS, EMBEDDING_MODEL, embedTexts, embeddingsEnabled, type Embedder } from "@/lib/ai";
import type { Db } from "@/lib/db";
import { attachments, embeddings, messages, threads, type Job } from "@/lib/db/schema";
import { chunkMessage } from "@/lib/mail/chunk";

import { enqueueEmbed, PRIORITY_BACKFILL, type JobContext } from "./jobs";

type EmbedMessage = Pick<typeof messages.$inferSelect, "id" | "subject" | "fromName" | "fromEmail" | "text">;
type ExistingEmbedding = Pick<typeof embeddings.$inferSelect, "messageId" | "model">;

export function planEmbeds(
  thread: { spam: boolean; trashed: boolean },
  candidates: EmbedMessage[],
  existing: ExistingEmbedding[],
) {
  if (thread.spam || thread.trashed) return { messages: [] as EmbedMessage[], deleteMessageIds: [] as string[] };
  const byMessage = new Map<string, Set<string>>();
  for (const row of existing) {
    const models = byMessage.get(row.messageId) ?? new Set<string>();
    models.add(row.model);
    byMessage.set(row.messageId, models);
  }
  const toEmbed = candidates.filter((message) => !byMessage.get(message.id)?.has(EMBEDDING_MODEL));
  return {
    messages: toEmbed,
    deleteMessageIds: toEmbed.filter((message) => byMessage.has(message.id)).map((message) => message.id),
  };
}

export async function embedJob(job: Job, ctx: JobContext) {
  if (!ctx.embed && !embeddingsEnabled()) return;
  const threadId = (job.payload as { threadId?: unknown }).threadId;
  if (typeof threadId !== "string") throw new Error("Embed job has no threadId");
  const [thread] = await ctx.db.select({ id: threads.id, accountId: threads.accountId, spam: threads.spam, trashed: threads.trashed })
    .from(threads).where(and(eq(threads.id, threadId), eq(threads.accountId, job.accountId!)));
  if (!thread || thread.spam || thread.trashed) return;

  const candidates = await ctx.db.select({
    id: messages.id, subject: messages.subject, fromName: messages.fromName,
    fromEmail: messages.fromEmail, text: messages.text,
  }).from(messages).where(eq(messages.threadId, threadId));
  if (candidates.length === 0) return;
  const ids = candidates.map((message) => message.id);
  const existing = await ctx.db.select({ messageId: embeddings.messageId, model: embeddings.model })
    .from(embeddings).where(inArray(embeddings.messageId, ids));
  const plan = planEmbeds(thread, candidates, existing);
  if (plan.messages.length === 0) return;
  const files = await ctx.db.select({ messageId: attachments.messageId, filename: attachments.filename })
    .from(attachments).where(inArray(attachments.messageId, plan.messages.map((message) => message.id)));
  const filenames = new Map<string, string[]>();
  for (const file of files) filenames.set(file.messageId, [...(filenames.get(file.messageId) ?? []), file.filename]);
  const chunks = plan.messages.flatMap((message) => chunkMessage({
    ...message, attachments: filenames.get(message.id) ?? [],
  }).map((chunk) => ({ ...chunk, messageId: message.id })));
  const embed: Embedder = ctx.embed ?? embedTexts;
  const vectors: number[][] = [];
  for (let start = 0; start < chunks.length; start += 100) {
    const batch = chunks.slice(start, start + 100);
    const result = await embed(batch.map((chunk) => chunk.text));
    if (result.length !== batch.length || result.some((vector) => vector.length !== EMBEDDING_DIMENSIONS)) {
      throw new Error("Embedder returned vectors with unexpected dimensions or count");
    }
    vectors.push(...result);
  }
  await ctx.db.transaction(async (tx) => {
    if (plan.deleteMessageIds.length > 0) {
      await tx.delete(embeddings).where(and(
        inArray(embeddings.messageId, plan.deleteMessageIds), ne(embeddings.model, EMBEDDING_MODEL),
      ));
    }
    for (let start = 0; start < chunks.length; start += 100) {
      await tx.insert(embeddings).values(chunks.slice(start, start + 100).map((chunk, i) => ({
        messageId: chunk.messageId, threadId, accountId: thread.accountId, chunk: chunk.chunk,
        text: chunk.text, metadata: chunk.metadata, model: EMBEDDING_MODEL, embedding: vectors[start + i],
      }))).onConflictDoUpdate({
        target: [embeddings.messageId, embeddings.chunk],
        set: {
          text: sql`excluded.text`, metadata: sql`excluded.metadata`, model: EMBEDDING_MODEL,
          embedding: sql`excluded.embedding`,
        },
      });
    }
  });
}

export async function enqueueEmbedBacklog(db: Db, accountId: string, limit = 200) {
  const rows = await db.select({ id: threads.id, accountId: threads.accountId }).from(threads)
    .where(and(
      eq(threads.accountId, accountId), eq(threads.spam, false), eq(threads.trashed, false),
      sql`exists (select 1 from messages m where m.thread_id = ${threads.id} and not exists (select 1 from embeddings e where e.message_id = m.id and e.model = ${EMBEDDING_MODEL}))`,
      sql`not exists (select 1 from jobs j where j.dedupe_key = 'embed:' || ${threads.id}::text and j.status in ('pending', 'running'))`,
    )).orderBy(desc(threads.lastMessageAt)).limit(limit);
  for (const thread of rows) await enqueueEmbed(db, thread, PRIORITY_BACKFILL);
  return rows.length;
}
