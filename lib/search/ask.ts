import { and, asc, desc, eq, exists, gte, ilike, inArray, isNull, lt, or, sql } from "drizzle-orm";

import {
  buildAskPlanRequest,
  cleanPlan,
  planAsk,
  streamAnswer,
  type AnswerSource,
  type AskEvent,
  type AskPlan,
  type AskPlanner,
  type AskSource,
} from "@/lib/ai/ask";
import type { Db } from "@/lib/db";
import { accounts, attachments, entities, entityLinks, messages, threads } from "@/lib/db/schema";
import { splitTextQuote } from "@/lib/mail/quote";
import { followMerges, normalizeName, type CatalogEntity } from "@/lib/sync/entities";
import { groupKey, showOrder } from "@/lib/sync/twins";

import { parseDate } from "./query";
import { FUSION_K, searchThreadIds, searchThreads, type SearchHit, type SearchScope } from "./search";

export const ASK_SOURCES = 12;
export const ASK_SOURCE_CHARS = 40_000;
const ASK_HITS = 30;
const ASK_LIST_HITS = 50;
const ASK_LIST_MAX = 1000;
const SOURCE_MESSAGES = 3;
const MESSAGE_CHARS = 1500;

const escapeLike = (s: string) => s.replace(/[\\%_]/g, (c) => `\\${c}`);
const quote = (v: string) => {
  const s = v.replace(/"/g, "").trim();
  return /\s/.test(s) ? `"${s}"` : s;
};

/**
 * The plan as a palette query, so its filters mean what they mean when typed. Without words, the
 * entity names stand in for them.
 */
export function planQuery(plan: AskPlan): string {
  const words = plan.words.length ? plan.words : plan.entities;
  const day = (d: string | null) => (d && parseDate(d) ? d : null);
  const after = day(plan.after);
  const before = day(plan.before);
  return [
    ...words.map(quote),
    ...plan.from.map((f) => `from:${quote(f)}`),
    ...plan.accounts.map((a) => `account:${quote(a)}`),
    ...plan.buckets.map((b) => `bucket:${b === "paper_trail" ? "paper-trail" : b}`),
    after ? `after:${after}` : "",
    before ? `before:${before}` : "",
  ]
    .filter((t) => t && t !== '""')
    .join(" ");
}

/**
 * Threads linked to the entities these names name, through merges, newest first: one copy per twin
 * group, in the scope's accounts and the plan's accounts, buckets and dates, never trash or spam.
 */
export async function entityThreadIds(
  db: Db,
  names: string[],
  plan: AskPlan,
  scope: SearchScope,
  max: number,
): Promise<string[]> {
  const wanted = new Set(names.map(normalizeName).filter(Boolean));
  if (!wanted.size) return [];
  const catalog: CatalogEntity[] = await db
    .select({
      id: entities.id,
      type: entities.type,
      name: entities.name,
      normName: entities.normName,
      aliases: entities.aliases,
      mergedIntoId: entities.mergedIntoId,
      deletedAt: entities.deletedAt,
    })
    .from(entities);
  const byId = new Map(catalog.map((e) => [e.id, e]));
  const ids = new Set<string>();
  for (const e of catalog) {
    if (![e.normName, ...e.aliases.map(normalizeName)].some((n) => wanted.has(n))) continue;
    const settled = followMerges(e.id, byId);
    if (settled && !settled.deletedAt) ids.add(settled.id);
  }
  if (!ids.size) return [];

  const after = plan.after ? parseDate(plan.after) : null;
  const before = plan.before ? parseDate(plan.before) : null;
  const linked = db
    .select({ id: entityLinks.threadId })
    .from(entityLinks)
    .where(and(inArray(entityLinks.entityId, [...ids]), eq(entityLinks.rejected, false)));
  // A message in the dates, as typed after: and before: match.
  const dated = after || before
    ? exists(
        db
          .select({ one: messages.id })
          .from(messages)
          .where(
            and(
              eq(messages.threadId, threads.id),
              after ? gte(messages.date, after) : undefined,
              before ? lt(messages.date, before) : undefined,
            ),
          ),
      )
    : undefined;
  const rows = await db
    .select({
      id: sql<string>`(array_agg(${threads.id} order by ${showOrder("threads")}))[1]`,
      last: sql<Date>`max(${threads.lastMessageAt})`,
    })
    .from(threads)
    .innerJoin(accounts, eq(accounts.id, threads.accountId))
    .where(
      and(
        inArray(threads.id, linked),
        eq(threads.trashed, false),
        eq(threads.spam, false),
        scope.accountIds ? inArray(threads.accountId, scope.accountIds) : undefined,
        plan.accounts.length
          ? or(...plan.accounts.map((a) => or(ilike(accounts.label, escapeLike(a)), ilike(accounts.email, `${escapeLike(a)}%`))))
          : undefined,
        plan.buckets.length ? inArray(threads.bucket, plan.buckets) : undefined,
        dated,
      ),
    )
    .groupBy(groupKey)
    .orderBy(desc(sql`max(${threads.lastMessageAt})`))
    .limit(max);
  return rows.map((r) => r.id);
}

/** Twin group key per thread id, so two copies of one conversation fuse as one. */
async function groupKeys(db: Db, ids: string[]): Promise<Map<string, string>> {
  if (!ids.length) return new Map();
  const rows = await db
    .select({ id: threads.id, key: sql<string>`${groupKey}::text` })
    .from(threads)
    .where(inArray(threads.id, ids));
  return new Map(rows.map((r) => [r.id, r.key]));
}

/** Reciprocal rank fusion of ranked id lists, one entry per twin group; the first list's copy wins. */
async function fuse(db: Db, lists: string[][]): Promise<string[]> {
  const keys = await groupKeys(db, lists.flat());
  const scores = new Map<string, { id: string; score: number; first: number }>();
  let order = 0;
  for (const list of lists) {
    list.forEach((id, index) => {
      const key = keys.get(id) ?? id;
      const entry = scores.get(key) ?? { id, score: 0, first: order++ };
      entry.score += 1 / (FUSION_K + index + 1);
      scores.set(key, entry);
    });
  }
  return [...scores.values()].sort((a, b) => b.score - a.score || a.first - b.first).map((e) => e.id);
}

/** Threads with a real file, not an inline image, first; order kept otherwise. */
async function filesFirst(db: Db, ids: string[]): Promise<string[]> {
  if (!ids.length) return ids;
  const rows = await db
    .selectDistinct({ threadId: messages.threadId })
    .from(attachments)
    .innerJoin(messages, eq(messages.id, attachments.messageId))
    .where(and(inArray(messages.threadId, ids), isNull(attachments.contentId)));
  const withFile = new Set(rows.map((r) => r.threadId));
  return [...ids.filter((id) => withFile.has(id)), ...ids.filter((id) => !withFile.has(id))];
}

const accountIdsOf = sql<string[]>`array(select a.id from ${accounts} a where a.id in (select t.account_id from ${threads} t where t.id = ${threads.id} or t.group_id = ${threads.groupId}) order by a.created_at)`;

async function threadRows(db: Db, ids: string[]) {
  if (!ids.length) return [];
  return db
    .select({
      id: threads.id,
      subject: threads.subject,
      participants: threads.participantsSummary,
      summary: threads.summary,
      accountId: threads.accountId,
      accountIds: accountIdsOf,
      bucket: threads.bucket,
      archived: threads.archived,
      lastMessageAt: threads.lastMessageAt,
      firstMessageAt: sql<string>`(select min(m.date) from ${messages} m where m.thread_id = ${threads.id})`.mapWith(
        (v: string | Date) => new Date(v),
      ),
      snippet: sql<string | null>`(select m.snippet from ${messages} m where m.thread_id = ${threads.id} order by m.date desc limit 1)`,
    })
    .from(threads)
    .where(inArray(threads.id, ids));
}

/** The sources the answer reads, best first, within the character budget. */
async function loadSources(db: Db, ids: string[]): Promise<{ sources: AskSource[]; context: AnswerSource[] }> {
  if (!ids.length) return { sources: [], context: [] };
  const [rows, labels, files] = await Promise.all([
    threadRows(db, ids),
    db.select({ id: accounts.id, label: accounts.label }).from(accounts),
    db
      .selectDistinct({ threadId: messages.threadId, filename: attachments.filename })
      .from(attachments)
      .innerJoin(messages, eq(messages.id, attachments.messageId))
      .where(and(inArray(messages.threadId, ids), isNull(attachments.contentId))),
  ]);
  const ranked = db
    .select({
      threadId: messages.threadId,
      fromName: messages.fromName,
      fromEmail: messages.fromEmail,
      date: messages.date,
      text: sql<string | null>`coalesce(${messages.text}, ${messages.snippet})`.as("body"),
      position: sql<number>`row_number() over (partition by ${messages.threadId} order by ${messages.date} desc)`.as("position"),
    })
    .from(messages)
    .where(inArray(messages.threadId, ids))
    .as("ranked");
  const latest = await db
    .select()
    .from(ranked)
    .where(sql`${ranked.position} <= ${SOURCE_MESSAGES}`)
    .orderBy(asc(ranked.date));

  const labelOf = new Map(labels.map((a) => [a.id, a.label]));
  const byId = new Map(rows.map((r) => [r.id, r]));
  const found = ids.flatMap((id) => {
    const r = byId.get(id);
    return r ? [r] : [];
  });
  const context: AnswerSource[] = found.map((r, i) => ({
    n: i + 1,
    subject: r.subject || "(no subject)",
    participants: r.participants || "unknown",
    account: r.accountIds.map((a) => labelOf.get(a) ?? a).join(", "),
    bucket: r.bucket,
    firstMessageAt: r.firstMessageAt.toISOString(),
    lastMessageAt: r.lastMessageAt.toISOString(),
    attachments: files.filter((f) => f.threadId === r.id).map((f) => f.filename),
    messages: latest
      .filter((m) => m.threadId === r.id)
      .map((m) => ({
        from: m.fromName ? `${m.fromName} <${m.fromEmail}>` : m.fromEmail,
        date: new Date(m.date).toISOString(),
        text: splitTextQuote(m.text ?? "").body.trim().slice(0, MESSAGE_CHARS),
      })),
  }));

  // Over budget: drop whole messages, oldest first, from the lowest-ranked source up.
  let chars = context.reduce((sum, s) => sum + s.messages.reduce((n, m) => n + m.text.length, 0), 0);
  for (let i = context.length - 1; i >= 0 && chars > ASK_SOURCE_CHARS; i--) {
    const kept = context[i].messages;
    while (kept.length && chars > ASK_SOURCE_CHARS) chars -= kept.shift()!.text.length;
  }

  const sources: AskSource[] = found.map((r, i) => ({
    n: i + 1,
    id: r.id,
    subject: r.subject || "(no subject)",
    sender: r.participants || "unknown",
    accountIds: r.accountIds,
    bucket: r.bucket,
    archived: r.archived,
    lastMessageAt: r.lastMessageAt.toISOString(),
    attachments: context[i].attachments,
  }));
  return { sources, context };
}

/** Search hits for these ids in order: from the hybrid hits when there, else built from the thread. */
async function hitsFor(db: Db, ids: string[], known: SearchHit[], inSet: Set<string>): Promise<SearchHit[]> {
  const byId = new Map(known.map((h) => [h.id, h]));
  const rows = await threadRows(db, ids.filter((id) => !byId.has(id)));
  const loaded = new Map(rows.map((r) => [r.id, r]));
  return ids.flatMap((id): SearchHit[] => {
    const hit = byId.get(id);
    if (hit) return [{ ...hit, related: !inSet.has(id) }];
    const r = loaded.get(id);
    if (!r) return [];
    return [{
      id: r.id,
      subject: r.subject || "(no subject)",
      sender: r.participants || "unknown",
      accountId: r.accountId,
      accountIds: r.accountIds,
      bucket: r.bucket,
      archived: r.archived,
      lastMessageAt: r.lastMessageAt.toISOString(),
      snippet: (r.summary ?? r.snippet ?? "").replace(/\s+/g, " ").trim(),
      related: !inSet.has(id),
    }];
  });
}

export type AskRetrieval = {
  query: string;
  sources: AskSource[];
  context: AnswerSource[];
  list: { hits: SearchHit[]; ids: string[]; total: number } | null;
};

/** Hybrid search fused with entity links; for list intent also the bulk set the list acts on. */
export async function retrieveForAsk(db: Db, plan: AskPlan, scope: SearchScope): Promise<AskRetrieval> {
  const query = planQuery(plan);
  const [hybrid, linked] = await Promise.all([
    searchThreads(db, query, scope, ASK_HITS, { semantic: true }),
    entityThreadIds(db, plan.entities, plan, scope, ASK_HITS),
  ]);
  let fused = await fuse(db, [hybrid.hits.map((h) => h.id), linked]);
  if (plan.attachment) fused = await filesFirst(db, fused);
  const { sources, context } = await loadSources(db, fused.slice(0, ASK_SOURCES));
  if (plan.intent !== "list") return { query, sources, context, list: null };

  // Keyword matches plus entity links, never vector-only neighbours: bulk actions change exactly these.
  const [matched, all] = await Promise.all([
    searchThreadIds(db, query, scope, ASK_LIST_MAX),
    entityThreadIds(db, plan.entities, plan, scope, ASK_LIST_MAX),
  ]);
  const keys = await groupKeys(db, [...matched, ...all]);
  const seen = new Set<string>();
  const ids: string[] = [];
  for (const id of [...matched, ...all]) {
    const key = keys.get(id) ?? id;
    if (seen.has(key) || ids.length >= ASK_LIST_MAX) continue;
    seen.add(key);
    ids.push(id);
  }
  // A hit counts as in the set when any copy of its conversation is.
  const fusedKeys = await groupKeys(db, fused.slice(0, ASK_LIST_HITS));
  const inSet = new Set(fused.slice(0, ASK_LIST_HITS).filter((id) => seen.has(fusedKeys.get(id) ?? id)));
  const hits = await hitsFor(db, fused.slice(0, ASK_LIST_HITS), hybrid.hits, inSet);
  return { query, sources, context, list: { hits, ids, total: ids.length } };
}

export type AskInput = { question: string; today: string; timeZone: string };

/**
 * One question end to end: plan, retrieval, answer, as the events POST /api/ask streams. Errors
 * throw; the caller turns them into an error event.
 */
export async function* runAsk(
  db: Db,
  input: AskInput,
  scope: SearchScope,
  { signal, planner = planAsk }: { signal?: AbortSignal; planner?: AskPlanner } = {},
): AsyncGenerator<AskEvent> {
  const known = await db.select({ label: accounts.label, email: accounts.email }).from(accounts).orderBy(asc(accounts.createdAt));
  const { output } = await planner(buildAskPlanRequest({ ...input, accounts: known }));
  const plan = cleanPlan(output);
  if (signal?.aborted) return;
  yield { type: "plan", intent: plan.intent, query: planQuery(plan) };
  const retrieval = await retrieveForAsk(db, plan, scope);
  yield { type: "sources", sources: retrieval.sources };
  if (retrieval.list) yield { type: "list", ...retrieval.list };
  if (signal?.aborted) return;
  for await (const delta of streamAnswer(
    { question: input.question, today: input.today, intent: plan.intent, sources: retrieval.context },
    { signal },
  )) {
    yield { type: "text", delta };
  }
  if (!signal?.aborted) yield { type: "done" };
}
