import { and, asc, desc, eq, gte, isNotNull, isNull, lte, ne, or, sql } from "drizzle-orm";

import { summarizeDigest } from "@/lib/ai/digest";
import type { Db } from "@/lib/db";
import {
  accounts,
  digests,
  threads,
  type DigestBucket,
  type DigestContent,
  type DigestItem,
  type Job,
} from "@/lib/db/schema";
import { loadStaleSettings, type DigestSettings } from "@/lib/db/settings";

import { enqueueJob, type JobContext } from "./jobs";
import { staleCutoffs, staleReason, type StaleThread } from "./stale";
import { groupKey, shownCopy } from "./twins";

// The daily digest: once the set hour has passed in the owner's time zone, a sync pass enqueues one
// `digest:<day>` job. It gathers the last 24 hours across all accounts, asks Claude for a few lines,
// and stores one `digests` row for the day. The view reads that row.

const DAY = 24 * 60 * 60 * 1000;
// Longest needs-reply and deadline lists kept; their totals are always exact.
export const DIGEST_LIST_LIMIT = 40;
const BUCKETS: DigestBucket[] = ["inbox", "news", "paper_trail", "receipts", "triage"];

/** The local date (YYYY-MM-DD) and hour (0 to 23) at `now` in a time zone. */
export function localTime(now: Date, timeZone: string) {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      hourCycle: "h23",
    })
      .formatToParts(now)
      .map((p) => [p.type, p.value]),
  );
  return { day: `${parts.year}-${parts.month}-${parts.day}`, hour: Number(parts.hour) };
}

/** Today's local date once the local time has reached the set hour, otherwise null. */
export function dueDay(now: Date, settings: DigestSettings): string | null {
  const { day, hour } = localTime(now, settings.timeZone);
  return hour >= settings.hour ? day : null;
}

async function hasDigest(db: Pick<Db, "select">, day: string) {
  const [row] = await db.select({ id: digests.id }).from(digests).where(eq(digests.day, day)).limit(1);
  return Boolean(row);
}

/** Queues the day's digest unless it exists. A pending job with the same key absorbs a repeat. */
export async function enqueueDigest(db: Pick<Db, "select" | "insert">, day: string) {
  if (await hasDigest(db, day)) return;
  await enqueueJob(db, { type: "digest", accountId: null, payload: { day }, dedupeKey: `digest:${day}` });
}

const live = () => and(eq(threads.archived, false), eq(threads.trashed, false), eq(threads.spam, false));
const notSnoozed = (now: Date) => or(isNull(threads.snoozedUntil), lte(threads.snoozedUntil, now));

type ItemRow = { id: string; subject: string | null; account: string; summary: string | null };
type Rows = {
  arrivals: { bucket: string; n: number }[];
  inbox: ItemRow[];
  needsReply: (ItemRow & { lastMessageAt: Date })[];
  needsReplyTotal: number;
  deadlines: (ItemRow & { deadlineAt: Date })[];
  deadlinesTotal: number;
  triage: number;
  stale: StaleThread[];
};

const item = (r: ItemRow): DigestItem => ({
  threadId: r.id,
  subject: r.subject || "(no subject)",
  account: r.account,
  summary: r.summary,
});

/** Shapes the queried rows into a digest. Pure, so the counting is testable without a database. */
export function shapeDigest(rows: Rows, now: Date, cutoffs: ReturnType<typeof staleCutoffs>): DigestContent {
  const arrivals = Object.fromEntries(BUCKETS.map((b) => [b, 0])) as Record<DigestBucket, number>;
  for (const { bucket, n } of rows.arrivals) if (bucket in arrivals) arrivals[bucket as DigestBucket] += n;
  const stale = { work: 0, reply: 0, triage: 0 };
  for (const thread of rows.stale) {
    const reason = staleReason(thread, cutoffs, now);
    if (reason) stale[reason.kind]++;
  }
  return {
    since: new Date(now.getTime() - DAY).toISOString(),
    until: now.toISOString(),
    arrivals,
    inbox: rows.inbox.map(item),
    needsReply: {
      total: rows.needsReplyTotal,
      items: rows.needsReply.map((r) => ({
        ...item(r),
        lastMessageAt: r.lastMessageAt.toISOString(),
        days: Math.max(0, Math.floor((now.getTime() - r.lastMessageAt.getTime()) / DAY)),
      })),
    },
    deadlines: {
      total: rows.deadlinesTotal,
      items: rows.deadlines.map((r) => ({ ...item(r), deadlineAt: r.deadlineAt.toISOString(), overdue: r.deadlineAt < now })),
    },
    triage: rows.triage,
    stale,
  };
}

/** What the digest covers, across all accounts: one row per twin group throughout. */
export async function gatherDigest(db: Pick<Db, "select">, now: Date): Promise<DigestContent> {
  const since = new Date(now.getTime() - DAY);
  const until = new Date(now.getTime() + DAY);
  const total = sql<number>`count(*)::int`;
  const itemColumns = { id: threads.id, subject: threads.subject, account: accounts.label, summary: threads.summary };
  const listed = () =>
    db.select({ ...itemColumns, lastMessageAt: threads.lastMessageAt, deadlineAt: threads.deadlineAt })
      .from(threads)
      .innerJoin(accounts, eq(accounts.id, threads.accountId));

  const needsReplyWhere = and(live(), shownCopy(null), eq(threads.needsReply, true), notSnoozed(now));
  const deadlinesWhere = and(live(), shownCopy(null), isNotNull(threads.deadlineAt), lte(threads.deadlineAt, until));
  const [arrivals, inbox, needsReply, [replyCount], deadlines, [deadlineCount], [triage], stale, settings] = await Promise.all([
    db
      .select({ bucket: threads.bucket, n: sql<number>`count(distinct ${groupKey})::int` })
      .from(threads)
      .where(and(gte(threads.createdAt, since), lte(threads.createdAt, now), eq(threads.spam, false), ne(threads.bucket, "out")))
      .groupBy(threads.bucket),
    db
      .select(itemColumns)
      .from(threads)
      .innerJoin(accounts, eq(accounts.id, threads.accountId))
      .where(and(live(), shownCopy(null), eq(threads.bucket, "inbox"), gte(threads.createdAt, since), lte(threads.createdAt, now)))
      .orderBy(desc(threads.createdAt))
      .limit(DIGEST_LIST_LIMIT),
    listed().where(needsReplyWhere).orderBy(asc(threads.lastMessageAt)).limit(DIGEST_LIST_LIMIT),
    db.select({ n: total }).from(threads).where(needsReplyWhere),
    listed().where(deadlinesWhere).orderBy(asc(threads.deadlineAt)).limit(DIGEST_LIST_LIMIT),
    db.select({ n: total }).from(threads).where(deadlinesWhere),
    // As the Triage view counts it.
    db
      .select({ n: total })
      .from(threads)
      .where(and(live(), shownCopy(null), eq(threads.bucket, "triage"), isNull(threads.starredAt), isNull(threads.workAt), isNull(threads.snoozedUntil))),
    // Candidates for the digest view's stale list; staleReason decides.
    db
      .select({
        workAt: threads.workAt,
        needsReply: threads.needsReply,
        deadlineAt: threads.deadlineAt,
        lastMessageAt: threads.lastMessageAt,
        bucket: threads.bucket,
        createdAt: threads.createdAt,
        snoozedUntil: threads.snoozedUntil,
      })
      .from(threads)
      .where(
        and(
          live(),
          shownCopy(null),
          isNull(threads.starredAt),
          or(isNotNull(threads.workAt), eq(threads.needsReply, true), eq(threads.bucket, "triage")),
        ),
      ),
    loadStaleSettings(db),
  ]);

  return shapeDigest(
    {
      arrivals,
      inbox,
      needsReply,
      needsReplyTotal: replyCount?.n ?? 0,
      deadlines: deadlines.map((r) => ({ ...r, deadlineAt: r.deadlineAt! })),
      deadlinesTotal: deadlineCount?.n ?? 0,
      triage: triage?.n ?? 0,
      stale,
    },
    now,
    staleCutoffs(now, settings),
  );
}

export function digestDay(payload: unknown): string {
  const day = (payload as { day?: unknown } | null)?.day;
  if (typeof day !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(day)) throw new Error(`digest job without a valid day: ${String(day)}`);
  return day;
}

/** Gathers, asks Claude for the lines and stores the day's row. A second run for the day does nothing. */
export async function digestJob(job: Job, ctx: JobContext, now = new Date()) {
  const day = digestDay(job.payload);
  if (await hasDigest(ctx.db, day)) return;
  const content = await gatherDigest(ctx.db, now);
  const { lines, modelId } = await summarizeDigest(content, { model: ctx.digestModel });
  await ctx.db
    .insert(digests)
    .values({ day, content, summary: lines.join("\n"), model: modelId })
    .onConflictDoNothing({ target: digests.day });
}
