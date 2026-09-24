import { and, desc, eq, gte, ilike, inArray, lt, or, sql, type SQL } from "drizzle-orm";

import type { Db } from "@/lib/db";
import { accounts, messages, threads, type Bucket } from "@/lib/db/schema";

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
  /** Best matching fragment, matches wrapped in MATCH_START/MATCH_END. */
  snippet: string;
};

export type SearchResult = { query: ParsedQuery; hits: SearchHit[]; total: number };

const escapeLike = (s: string) => s.replace(/[\\%_]/g, (c) => `\\${c}`);

/** `accountIds` limits results to the accounts toggled on; null searches all. */
export type SearchScope = { accountIds?: string[] | null };

function where(q: ParsedQuery, tsq: SQL | null, scope: SearchScope): SQL | undefined {
  return and(
    eq(threads.trashed, false),
    scope.accountIds ? inArray(threads.accountId, scope.accountIds) : undefined,
    eq(threads.spam, false),
    tsq ? sql`${messages.search} @@ ${tsq}` : undefined,
    ...q.from.map((f) => or(ilike(messages.fromEmail, `%${escapeLike(f)}%`), ilike(messages.fromName, `%${escapeLike(f)}%`))),
    q.account.length
      ? or(...q.account.map((a) => or(ilike(accounts.label, escapeLike(a)), ilike(accounts.email, `${escapeLike(a)}%`))))
      : undefined,
    q.before ? lt(messages.date, q.before) : undefined,
    q.after ? gte(messages.date, q.after) : undefined,
  );
}

const tsqueryOf = (q: ParsedQuery) => (q.tsquery ? sql`to_tsquery('simple', ${q.tsquery})` : null);

/** Ranking only: keep prefix matching in WHERE so typing never loses broader hits. */
function relevanceTier(q: ParsedQuery): SQL<number> {
  if (!q.tsquery) return sql<number>`0`;
  // The parser emits only words and operators. Removing prefix markers keeps
  // quoted phrase order while requiring complete words, using the same config.
  const exact = sql`to_tsquery('simple', ${q.tsquery.replace(/:\*/g, "")})`;
  const phrase = sql`to_tsquery('simple', ${q.words.join(" <-> ")})`;
  const subject = sql`to_tsvector('simple', coalesce(${threads.subject}, ''))`;
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

/**
 * Threads matching a palette query, best first. Searches everything synced,
 * archived included; trash and spam stay out, as in Gmail.
 */
export async function searchThreads(db: Db, input: string, scope: SearchScope = {}, limit = 50): Promise<SearchResult> {
  const query = parseQuery(input);
  if (isEmptyQuery(query)) return { query, hits: [], total: 0 };
  const tsq = tsqueryOf(query);

  const ranked = matches(db, query, tsq, scope).as("ranked");
  const rows = await db
    .select({
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
    .limit(limit);
  if (!rows.length) return { query, hits: [], total: 0 };

  const ids = rows.map((r) => r.id);
  const options = `StartSel=${MATCH_START}, StopSel=${MATCH_END}, MaxWords=18, MinWords=6, MaxFragments=1`;
  const snippets = await db
    .selectDistinctOn([messages.threadId], {
      threadId: messages.threadId,
      snippet: tsq
        ? sql<string>`ts_headline('simple', coalesce(${messages.text}, ${messages.snippet}, ''), ${tsq}, ${options})`
        : sql<string>`coalesce(${messages.snippet}, '')`,
    })
    .from(messages)
    .where(and(inArray(messages.threadId, ids), tsq ? sql`${messages.search} @@ ${tsq}` : undefined))
    .orderBy(messages.threadId, tsq ? desc(sql`ts_rank(${messages.search}, ${tsq})`) : desc(messages.date), desc(messages.date));
  const snippetOf = new Map(snippets.map((s) => [s.threadId, s.snippet.replace(/\s+/g, " ").trim()]));

  return {
    query,
    total: rows[0].total,
    hits: rows.map((r) => ({
      id: r.id,
      subject: r.subject || "(no subject)",
      sender: r.participants || "unknown",
      accountId: r.accountId,
      accountIds: r.accountIds,
      bucket: r.bucket,
      archived: r.archived,
      lastMessageAt: r.lastMessageAt.toISOString(),
      snippet: snippetOf.get(r.id) ?? "",
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
