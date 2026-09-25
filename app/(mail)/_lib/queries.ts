import { and, asc, count, desc, eq, gt, inArray, isNotNull, isNull, lte, or, sql, type SQL } from "drizzle-orm";

import type { View, ViewSlug } from "@/components/mail/views";
import { VIEWS } from "@/components/mail/views";
import { db } from "@/lib/db";
import { aiAllowedSenders, inboundSenderIds, judgedSenders } from "@/lib/classify/screener";
import { accounts, attachments, messages, threads } from "@/lib/db/schema";
import { mergeTimeline, shownCopy } from "@/lib/sync/twins";

const live = () => and(eq(threads.archived, false), eq(threads.trashed, false), eq(threads.spam, false));

// A past-due snooze stays set until the thread is opened: that is what "resurfaced" means.
const resurfaced = () => lte(threads.snoozedUntil, sql`now()`);
const unseen = () => or(isNull(threads.seenAt), resurfaced());

const snoozed = () => gt(threads.snoozedUntil, sql`now()`);

function viewFilter(view: View): SQL | undefined {
  if (view.slug === "snoozed") return and(live(), snoozed());
  if (view.slug === "trash") return and(eq(threads.trashed, true), eq(threads.spam, false));
  // A snoozed Work thread hides until its snooze ends, then comes back here.
  if (view.slug === "work") return and(live(), isNotNull(threads.workAt), or(isNull(threads.snoozedUntil), resurfaced()));
  // Work threads leave every bucket view.
  const inBucket = and(eq(threads.bucket, view.bucket!), isNull(threads.snoozedUntil), isNull(threads.workAt));
  // Resurfaced snoozes sit at the top of Inbox whatever their bucket.
  return and(live(), view.bucket === "inbox" ? or(inBucket, and(isNull(threads.workAt), resurfaced())) : inBucket);
}

/**
 * `on` is the accounts toggled on in the header, null for all. Twins show as one row: the copy
 * `shownCopy` picks among the accounts that are on.
 */
const accountFilter = (on: string[] | null) => and(on ? inArray(threads.accountId, on) : undefined, shownCopy(on));

// Every copy of the row's conversation: the thread itself, and its twins.
const copies = sql`(select t.id from ${threads} t where t.id = ${threads.id} or t.group_id = ${threads.groupId})`;

export async function listAccounts() {
  return db
    .select({
      id: accounts.id,
      email: accounts.email,
      label: accounts.label,
      color: accounts.color,
      lastSyncAt: accounts.lastSyncAt,
      lastSyncError: accounts.lastSyncError,
      catchingUp: isNotNull(accounts.catchUp).mapWith(Boolean),
    })
    .from(accounts)
    .orderBy(asc(accounts.createdAt));
}

export type AccountSummary = Awaited<ReturnType<typeof listAccounts>>[number];

export type ViewCounts = {
  /** Unseen count for News, Paper Trail and Receipts; total visible threads for other views. */
  n: Record<ViewSlug, number>;
  /** Views where a thread has an unread reply that the count does not show: work. */
  unread: Partial<Record<ViewSlug, boolean>>;
};

export async function viewCounts(on: string[] | null): Promise<ViewCounts> {
  const rows = await Promise.all(
    VIEWS.map(async (view) => {
      const unseenOnly = view.slug === "news" || view.slug === "paper-trail" || view.slug === "receipts";
      const [row] = await db
        .select({ n: count(), unseen: count(sql`case when ${unseen()} then 1 end`) })
        .from(threads)
        .where(and(viewFilter(view), accountFilter(on), unseenOnly ? unseen() : undefined));
      return { slug: view.slug, n: row.n, unread: view.slug === "work" && row.unseen > 0 };
    }),
  );
  return {
    n: Object.fromEntries(rows.map((r) => [r.slug, r.n])) as Record<ViewSlug, number>,
    unread: Object.fromEntries(rows.filter((r) => r.unread).map((r) => [r.slug, true])),
  };
}

/**
 * Work: overdue deadlines, then upcoming ones soonest first (both by deadline ascending), then the
 * threads without one in the order they entered Work.
 */
const workOrder = () => [sql`${threads.deadlineAt} asc nulls last`, asc(threads.workAt), desc(threads.lastMessageAt)];

export async function listThreads(view: View, on: string[] | null) {
  const last = db
    .select({
      fromName: messages.fromName,
      fromEmail: messages.fromEmail,
      snippet: messages.snippet,
    })
    .from(messages)
    .where(eq(messages.threadId, threads.id))
    .orderBy(desc(messages.date))
    .limit(1)
    .as("last");

  const rows = await db
    .select({
      id: threads.id,
      accountId: threads.accountId,
      senderId: threads.senderId,
      bucket: threads.bucket,
      subject: threads.subject,
      participants: threads.participantsSummary,
      lastMessageAt: threads.lastMessageAt,
      unseen: sql<boolean>`${unseen()}`,
      resurfaced: sql<boolean>`coalesce(${resurfaced()}, false)`,
      snoozedUntil: threads.snoozedUntil,
      needsReply: threads.needsReply,
      deadlineAt: threads.deadlineAt,
      workAt: threads.workAt,
      fromName: last.fromName,
      fromEmail: last.fromEmail,
      snippet: last.snippet,
      summary: threads.summary,
      summaryMessageAt: threads.summaryMessageAt,
      // Distinct messages across copies: the same Message-ID in two accounts counts once.
      messageCount: sql<number>`(select count(distinct coalesce(${messages.headers}->>'messageId', ${messages.id}::text))::int from ${messages} where ${messages.threadId} in ${copies})`,
      accountIds: sql<string[]>`array(select a.id from ${accounts} a where a.id in (select t.account_id from ${threads} t where t.id in ${copies}) order by a.created_at)`,
    })
    .from(threads)
    .leftJoinLateral(last, sql`true`)
    .where(and(viewFilter(view), accountFilter(on)))
    .orderBy(
      ...(view.slug === "work"
        ? workOrder()
        : [
            desc(sql`coalesce(${resurfaced()}, false)`),
            desc(sql`coalesce(${unseen()}, false)`),
            desc(threads.lastMessageAt),
          ]),
    )
    .limit(300);

  // News keeps the snippet. Elsewhere the summary stands in once it covers the newest message.
  const summaryOf = (r: (typeof rows)[number]) =>
    view.slug !== "news" && r.summary && r.summaryMessageAt && r.summaryMessageAt >= r.lastMessageAt
      ? r.summary
      : null;

  return rows.map((r) => ({
    id: r.id,
    accountId: r.accountId,
    // Every account the conversation reached, in account order.
    accountIds: r.accountIds,
    senderId: r.senderId,
    bucket: r.bucket,
    subject: r.subject || "(no subject)",
    sender: r.participants || r.fromName || r.fromEmail || "unknown",
    snippet: r.snippet ?? "",
    summary: summaryOf(r),
    lastMessageAt: r.lastMessageAt.toISOString(),
    unseen: !!r.unseen,
    resurfaced: r.resurfaced,
    snoozedUntil: r.snoozedUntil?.toISOString() ?? null,
    needsReply: r.needsReply,
    deadlineAt: r.deadlineAt?.toISOString() ?? null,
    work: r.workAt !== null,
    messageCount: r.messageCount,
  }));
}

export type ThreadListItem = Awaited<ReturnType<typeof listThreads>>[number];

const threadWith = {
  account: { columns: { id: true, email: true, label: true, color: true } },
  sender: { columns: { id: true, email: true, displayName: true, imagesAllowed: true, screenerDecision: true, decidedBy: true } },
  messages: {
    orderBy: asc(messages.date),
    columns: {
      id: true,
      fromEmail: true,
      fromName: true,
      to: true,
      cc: true,
      date: true,
      snippet: true,
      htmlSanitized: true,
      text: true,
      isInbound: true,
      headers: true,
    },
    with: {
      sender: { columns: { id: true, email: true, displayName: true, imagesAllowed: true, screenerDecision: true, decidedBy: true } },
      attachments: {
        columns: { id: true, filename: true, mimeType: true, size: true },
        orderBy: asc(attachments.filename),
      },
    },
  },
} as const;

/**
 * A thread for the reading pane. Twins merge into one timeline: every distinct message of every
 * copy (by Message-ID), oldest first; state comes from the opened copy.
 */
export async function getThread(id: string) {
  const opened = await db.query.threads.findFirst({ where: eq(threads.id, id), with: threadWith });
  if (!opened) return null;
  const twins = opened.groupId
    ? (await db.query.threads.findMany({ where: eq(threads.groupId, opened.groupId), with: threadWith })).filter((t) => t.id !== opened.id)
    : [];
  const all = [opened, ...twins];
  const thread = {
    ...opened,
    messages: mergeTimeline(all.map((t) => t.messages.map((m) => ({ ...m, messageId: m.headers.messageId })))),
  };
  const accountOrder = new Map((await listAccounts()).map((a, i) => [a.id, i]));
  const reached = [...new Map(all.map((t) => [t.account.id, t.account])).values()].sort(
    (a, b) => (accountOrder.get(a.id) ?? 0) - (accountOrder.get(b.id) ?? 0),
  );
  const latestInbound = thread.messages.findLast((m) => m.isInbound);
  const people = new Map(
    [thread.sender, ...thread.messages.map((m) => m.sender)].flatMap((s) => (s ? [[s.id, s] as const] : [])),
  );
  const ids = inboundSenderIds(thread.messages.map((m) => ({ isInbound: m.isInbound, senderId: m.sender?.id ?? null })));
  if (thread.senderId && !ids.includes(thread.senderId)) ids.unshift(thread.senderId);
  const states = new Map([...people].map(([id, s]) => [id, { decision: s.screenerDecision, decidedBy: s.decidedBy }]));
  return {
    id: thread.id,
    gmailThreadId: thread.gmailThreadId,
    subject: thread.subject || "(no subject)",
    bucket: thread.bucket,
    bucketSource: thread.bucketSource,
    bucketSuggested: thread.bucketSuggested,
    bucketConfidence: thread.bucketConfidence,
    senderId: thread.senderId,
    // Who let in and keep out decide on, in thread order.
    judged: judgedSenders(ids, states, thread.senderId).map((id) => {
      const s = people.get(id)!;
      return { id, name: s.displayName, email: s.email };
    }),
    // "new sender, let in by AI. undo?" applies while the AI's decision on the thread's sender stands.
    aiLetIn:
      thread.sender?.screenerDecision === "allowed" &&
      thread.sender.decidedBy === "ai" &&
      thread.bucketSource === "ai",
    // Every sender of the thread the AI let in; ok and undo act on all of them.
    aiAllowed: aiAllowedSenders(ids, states).length,
    // The user wrote in the thread, the reason participation let its senders in.
    wroteIn: thread.messages.some((m) => !m.isInbound),
    snoozedUntil: thread.snoozedUntil?.toISOString() ?? null,
    needsReply: thread.needsReply,
    deadlineAt: thread.deadlineAt?.toISOString() ?? null,
    work: thread.workAt !== null,
    trashed: thread.trashed,
    archived: thread.archived,
    spam: thread.spam,
    canUnsubscribe: !!latestInbound?.headers.listUnsubscribe,
    account: thread.account,
    // Every account the conversation reached, twins included, in account order.
    accounts: reached,
    // This thread and its twins, so a page can find whichever copy its list shows.
    copyIds: all.map((t) => t.id),
    // Headers stay on the server; the client only needs canUnsubscribe.
    messages: thread.messages.map((m) => {
      const { headers, messageId, ...rest } = m;
      void headers;
      void messageId;
      return {
        ...rest,
        date: m.date.toISOString(),
        imagesAllowed: m.sender?.imagesAllowed ?? thread.sender?.imagesAllowed ?? false,
        senderId: m.sender?.id ?? null,
      };
    }),
  };
}

export type ThreadDetail = NonNullable<Awaited<ReturnType<typeof getThread>>>;
