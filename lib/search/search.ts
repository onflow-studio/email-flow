import { and, desc, eq, gte, ilike, inArray, lt, or, sql, type SQL } from "drizzle-orm";

import { embedTexts, embeddingsEnabled } from "@/lib/ai";
import type { Db } from "@/lib/db";
import { accounts, embeddings, messages, threads, type Bucket } from "@/lib/db/schema";

import { groupKey, showOrder } from "@/lib/sync/twins";

import { isEmptyQuery, MATCH_END, MATCH_START, parseQuery, type ParsedQuery } from "./query";

export type SearchHit = {
  id: string;
  subject: string;
  sender: string;
  accountId: string;
  /** Every account the conversation reached: twins match as one hit. */
  accountIds: string[];
  bucket: Bucket;
  archived: boolean;
  lastMessageAt: string;
  /** Keyword fragment with match markers, or unmarked text from the closest chunk. */
  snippet: string;
  related: boolean;
};

export type SearchResult = { query: ParsedQuery; hits: SearchHit[]; total: number };

const escapeLike = (s: string) => s.replace(/[\\%_]/g, (c) => `\\${c}`);

/** Text search config of `messages.search`: 'simple' plus unaccent, see the schema. */
const SEARCH_CONFIG = "simple_unaccent";
const VECTOR_CANDIDATES = 200;
const MAX_DISTANCE = 0.6;
const FUSION_K = 60;

/** `accountIds` limits results to the accounts toggled on; null searches all. */
export type SearchScope = { accountIds?: string[] | null };

function filters(q: ParsedQuery, scope: SearchScope): SQL | undefined {
  return and(
    eq(threads.trashed, false),
    scope.accountIds ? inArray(threads.accountId, scope.accountIds) : undefined,
    eq(threads.spam, false),
    ...q.from.map((f) => or(ilike(messages.fromEmail, `%${escapeLike(f)}%`), sql`unaccent(${messages.fromName}) ilike unaccent(${`%${escapeLike(f)}%`})`)),
    q.account.length
      ? or(...q.account.map((a) => or(ilike(accounts.label, escapeLike(a)), ilike(accounts.email, `${escapeLike(a)}%`))))
      : undefined,
    q.bucket.length ? inArray(threads.bucket, q.bucket as Bucket[]) : undefined,
    q.before ? lt(messages.date, q.before) : undefined,
    q.after ? gte(messages.date, q.after) : undefined,
  );
}

const where = (q: ParsedQuery, tsq: SQL | null, scope: SearchScope) =>
  and(filters(q, scope), tsq ? sql`${messages.search} @@ ${tsq}` : undefined);

const tsqueryOf = (q: ParsedQuery) => (q.tsquery ? sql`to_tsquery(${SEARCH_CONFIG}::regconfig, ${q.tsquery})` : null);

/** Ranking only: keep prefix matching in WHERE so typing never loses broader hits. */
function relevanceTier(q: ParsedQuery): SQL<number> {
  if (!q.tsquery) return sql<number>`0`;
  // The parser emits only words, addresses and operators. Removing prefix markers keeps
  // quoted phrase order while requiring complete words, using the same config.
  const exact = sql`to_tsquery(${SEARCH_CONFIG}::regconfig, ${q.tsquery.replace(/:\*/g, "")})`;
  const phrase = sql`to_tsquery(${SEARCH_CONFIG}::regconfig, ${q.words.join(" <-> ")})`;
  const subject = sql`to_tsvector(${SEARCH_CONFIG}::regconfig, coalesce(${threads.subject}, ''))`;
  return sql<number>`case
    when ${subject} @@ ${phrase} then 3
    when ${subject} @@ ${exact} then 2
    when ${messages.search} @@ ${exact} then 1
    else 0
  end`;
}

// Twins match as one conversation, shown by the copy lists show.
function matches(db: Pick<Db, "select">, q: ParsedQuery, tsq: SQL | null, scope: SearchScope) {
  return db
    .select({
      key: sql<string>`${groupKey}::text`.as("group_key"),
      id: sql<string>`(array_agg(${threads.id} order by ${showOrder("threads")}))[1]`.as("matched_thread_id"),
      tier: sql<number>`max(${relevanceTier(q)})`.as("tier"),
      rank: tsq ? sql<number>`max(ts_rank(${messages.search}, ${tsq}))`.as("rank") : sql<number>`0`.as("rank"),
      total: sql<number>`count(*) over ()`.mapWith(Number).as("total"),
    })
    .from(messages)
    .innerJoin(threads, eq(threads.id, messages.threadId))
    .innerJoin(accounts, eq(accounts.id, threads.accountId))
    .where(where(q, tsq, scope))
    .groupBy(groupKey);
}

/** The closest filtered chunks, then one best chunk and displayed copy per conversation. */
async function vectorMatches(db: Db, q: ParsedQuery, vector: number[], scope: SearchScope) {
  const distance = sql<number>`${embeddings.embedding} <=> ${JSON.stringify(vector)}::vector`;
  return db.transaction(async (tx) => {
    await tx.execute(sql`SET LOCAL hnsw.iterative_scan = relaxed_order`);
    await tx.execute(sql`SET LOCAL hnsw.ef_search = 100`);
    const nearest = tx
      .select({
        threadId: embeddings.threadId,
        text: embeddings.text,
        distance: distance.as("distance"),
      })
      .from(embeddings)
      .innerJoin(messages, eq(messages.id, embeddings.messageId))
      .innerJoin(threads, eq(threads.id, embeddings.threadId))
      .innerJoin(accounts, eq(accounts.id, threads.accountId))
      .where(and(filters(q, scope), lt(distance, MAX_DISTANCE)))
      .orderBy(distance)
      .limit(VECTOR_CANDIDATES)
      .as("nearest");
    return tx
      .select({
        key: sql<string>`${groupKey}::text`.as("group_key"),
        id: sql<string>`(array_agg(${threads.id} order by ${showOrder("threads")}))[1]`.as("matched_thread_id"),
        distance: sql<number>`min(${nearest.distance})`.mapWith(Number).as("best_distance"),
        text: sql<string>`(array_agg(${nearest.text} order by ${nearest.distance}))[1]`.as("best_text"),
      })
      .from(nearest)
      .innerJoin(threads, eq(threads.id, nearest.threadId))
      .groupBy(groupKey)
      .orderBy(sql`min(${nearest.distance})`);
  });
}

function relatedSnippet(text: string) {
  const body = text.replace(/^subject: [^\n]*\nfrom: [^\n]*\n\n/, "").replace(/\s+/g, " ").trim();
  return body.length > 160 ? `${body.slice(0, 159).trimEnd()}…` : body;
}

/**
 * Threads matching a palette query, best first. Searches everything synced,
 * archived included; trash and spam stay out, as in Gmail.
 */
export async function searchThreads(
  db: Db, input: string, scope: SearchScope = {}, limit = 50, { semantic = false }: { semantic?: boolean } = {},
): Promise<SearchResult> {
  const query = parseQuery(input);
  if (isEmptyQuery(query)) return { query, hits: [], total: 0 };
  const tsq = tsqueryOf(query);

  const ranked = matches(db, query, tsq, scope).as("ranked");
  const hybrid = semantic && query.words.length > 0 && embeddingsEnabled();
  const keywordRows = await db
    .select({
      key: ranked.key,
      tier: ranked.tier,
      id: threads.id,
      subject: threads.subject,
      participants: threads.participantsSummary,
      accountId: threads.accountId,
      accountIds: sql<string[]>`array(select a.id from ${accounts} a where a.id in (select t.account_id from ${threads} t where t.id = ${threads.id} or t.group_id = ${threads.groupId}) order by a.created_at)`,
      bucket: threads.bucket,
      archived: threads.archived,
      lastMessageAt: threads.lastMessageAt,
      total: ranked.total,
    })
    .from(ranked)
    .innerJoin(threads, eq(threads.id, ranked.id))
    .orderBy(desc(ranked.tier), desc(ranked.rank), desc(threads.lastMessageAt), threads.id)
    .limit(hybrid ? VECTOR_CANDIDATES : limit);
  const vectors = hybrid ? await embedTexts([query.words.join(" ")]) : [];
  const vectorRows = vectors.length ? await vectorMatches(db, query, vectors[0], scope) : [];
  const scores = new Map<string, { id: string; tier: number; score: number; text?: string }>();
  if (hybrid) {
    keywordRows.forEach((row, index) => scores.set(row.key, {
      id: row.id, tier: row.tier, score: 1 / (FUSION_K + index + 1),
    }));
    vectorRows.forEach((row, index) => {
      const existing = scores.get(row.key);
      if (existing) existing.score += 1 / (FUSION_K + index + 1);
      else scores.set(row.key, { id: row.id, tier: -1, score: 1 / (FUSION_K + index + 1), text: row.text });
    });
  }
  const ordered = hybrid
    ? [...scores.values()].sort((a, b) => b.tier - a.tier || b.score - a.score || a.id.localeCompare(b.id)).slice(0, limit)
    : [];
  const rows = hybrid
    ? await db.select({
        id: threads.id,
        subject: threads.subject,
        participants: threads.participantsSummary,
        accountId: threads.accountId,
        accountIds: sql<string[]>`array(select a.id from ${accounts} a where a.id in (select t.account_id from ${threads} t where t.id = ${threads.id} or t.group_id = ${threads.groupId}) order by a.created_at)`,
        bucket: threads.bucket,
        archived: threads.archived,
        lastMessageAt: threads.lastMessageAt,
      }).from(threads).where(inArray(threads.id, ordered.map((r) => r.id)))
    : keywordRows;
  const orderedRows = hybrid ? ordered.flatMap((entry) => {
    const row = rows.find((r) => r.id === entry.id);
    return row ? [{ ...row, related: entry.tier < 0, text: entry.text }] : [];
  }) : keywordRows.map((row) => ({ ...row, related: false, text: undefined }));
  if (!orderedRows.length) return { query, hits: [], total: 0 };

  const ids = orderedRows.filter((r) => !r.related).map((r) => r.id);
  const options = `StartSel=${MATCH_START}, StopSel=${MATCH_END}, MaxWords=18, MinWords=6, MaxFragments=1`;
  const snippets = ids.length ? await db
    .selectDistinctOn([messages.threadId], {
      threadId: messages.threadId,
      snippet: tsq
        ? sql<string>`ts_headline(${SEARCH_CONFIG}::regconfig, coalesce(${messages.text}, ${messages.snippet}, ''), ${tsq}, ${options})`
        : sql<string>`coalesce(${messages.snippet}, '')`,
    })
    .from(messages)
    .where(and(inArray(messages.threadId, ids), tsq ? sql`${messages.search} @@ ${tsq}` : undefined))
    .orderBy(messages.threadId, tsq ? desc(sql`ts_rank(${messages.search}, ${tsq})`) : desc(messages.date), desc(messages.date)) : [];
  const snippetOf = new Map(snippets.map((s) => [s.threadId, s.snippet.replace(/\s+/g, " ").trim()]));

  return {
    query,
    total: hybrid ? scores.size : keywordRows[0].total,
    hits: orderedRows.map((r) => ({
      id: r.id,
      subject: r.subject || "(no subject)",
      sender: r.participants || "unknown",
      accountId: r.accountId,
      accountIds: r.accountIds,
      bucket: r.bucket,
      archived: r.archived,
      lastMessageAt: r.lastMessageAt.toISOString(),
      snippet: r.related ? relatedSnippet(r.text ?? "") : snippetOf.get(r.id) ?? "",
      related: r.related,
    })),
  };
}

/** Every matching thread id, for bulk actions on a query. */
export async function searchThreadIds(db: Db, input: string, scope: SearchScope = {}, max = 1000): Promise<string[]> {
  const query = parseQuery(input);
  if (isEmptyQuery(query)) return [];
  const rows = await matches(db, query, tsqueryOf(query), scope).limit(max);
  return rows.map((r) => r.id);
}
