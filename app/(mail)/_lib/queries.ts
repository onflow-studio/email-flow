import { and, asc, count, desc, eq, gt, isNotNull, isNull, lte, or, sql, type SQL } from "drizzle-orm";

import type { View, ViewSlug } from "@/components/mail/views";
import { VIEWS } from "@/components/mail/views";
import { db } from "@/lib/db";
import { accounts, attachments, messages, threads } from "@/lib/db/schema";

const live = () => and(eq(threads.archived, false), eq(threads.trashed, false), eq(threads.spam, false));

// A past-due snooze stays set until the thread is opened: that is what "resurfaced" means.
const resurfaced = () => lte(threads.snoozedUntil, sql`now()`);
const unseen = () => or(isNull(threads.seenAt), resurfaced());

function viewFilter(view: View): SQL | undefined {
  if (view.slug === "snoozed") return and(live(), gt(threads.snoozedUntil, sql`now()`));
  if (view.slug === "set-aside") return and(live(), isNotNull(threads.setAsideAt));
  const inBucket = and(eq(threads.bucket, view.bucket!), isNull(threads.snoozedUntil), isNull(threads.setAsideAt));
  // Resurfaced snoozes come back to the top of Inbox whatever their bucket.
  return and(live(), view.bucket === "inbox" ? or(inBucket, resurfaced()) : inBucket);
}

const accountFilter = (account: string | null) => (account ? eq(threads.accountId, account) : undefined);

export async function listAccounts() {
  return db
    .select({
      id: accounts.id,
      email: accounts.email,
      label: accounts.label,
      color: accounts.color,
      lastSyncAt: accounts.lastSyncAt,
      lastSyncError: accounts.lastSyncError,
    })
    .from(accounts)
    .orderBy(asc(accounts.createdAt));
}

export type AccountSummary = Awaited<ReturnType<typeof listAccounts>>[number];

/** Unseen count for bucket views, total for snoozed and set aside. */
export async function viewCounts(account: string | null): Promise<Record<ViewSlug, number>> {
  const rows = await Promise.all(
    VIEWS.map(async (view) => {
      const unseenOnly = !!view.bucket;
      const [row] = await db
        .select({ n: count() })
        .from(threads)
        .where(and(viewFilter(view), accountFilter(account), unseenOnly ? unseen() : undefined));
      return [view.slug, row.n] as const;
    }),
  );
  return Object.fromEntries(rows) as Record<ViewSlug, number>;
}

export async function listThreads(view: View, account: string | null) {
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
      setAsideAt: threads.setAsideAt,
      fromName: last.fromName,
      fromEmail: last.fromEmail,
      snippet: last.snippet,
      messageCount: sql<number>`(select count(*)::int from ${messages} where ${messages.threadId} = ${threads.id})`,
    })
    .from(threads)
    .leftJoinLateral(last, sql`true`)
    .where(and(viewFilter(view), accountFilter(account)))
    .orderBy(
      desc(sql`coalesce(${resurfaced()}, false)`),
      desc(sql`coalesce(${unseen()}, false)`),
      desc(threads.lastMessageAt),
    )
    .limit(300);

  return rows.map((r) => ({
    id: r.id,
    accountId: r.accountId,
    senderId: r.senderId,
    bucket: r.bucket,
    subject: r.subject || "(no subject)",
    sender: r.participants || r.fromName || r.fromEmail || "unknown",
    snippet: r.snippet ?? "",
    lastMessageAt: r.lastMessageAt.toISOString(),
    unseen: !!r.unseen,
    resurfaced: r.resurfaced,
    snoozedUntil: r.snoozedUntil?.toISOString() ?? null,
    needsReply: r.needsReply,
    deadlineAt: r.deadlineAt?.toISOString() ?? null,
    setAside: r.setAsideAt !== null,
    messageCount: r.messageCount,
  }));
}

export type ThreadListItem = Awaited<ReturnType<typeof listThreads>>[number];

export async function getThread(id: string) {
  const thread = await db.query.threads.findFirst({
    where: eq(threads.id, id),
    with: {
      account: { columns: { id: true, email: true, label: true, color: true } },
      sender: { columns: { imagesAllowed: true, screenerDecision: true, decidedBy: true } },
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
        },
        with: {
          sender: { columns: { imagesAllowed: true } },
          attachments: {
            columns: { id: true, filename: true, mimeType: true, size: true },
            orderBy: asc(attachments.filename),
          },
        },
      },
    },
  });
  if (!thread) return null;
  return {
    id: thread.id,
    gmailThreadId: thread.gmailThreadId,
    subject: thread.subject || "(no subject)",
    bucket: thread.bucket,
    bucketSource: thread.bucketSource,
    bucketSuggested: thread.bucketSuggested,
    bucketConfidence: thread.bucketConfidence,
    senderId: thread.senderId,
    // "new sender, let in by AI. undo?" applies while the AI's decision stands.
    aiLetIn:
      thread.sender?.screenerDecision === "allowed" &&
      thread.sender.decidedBy === "ai" &&
      thread.bucketSource === "ai",
    snoozedUntil: thread.snoozedUntil?.toISOString() ?? null,
    needsReply: thread.needsReply,
    deadlineAt: thread.deadlineAt?.toISOString() ?? null,
    setAside: thread.setAsideAt !== null,
    account: thread.account,
    messages: thread.messages.map((m) => ({
      ...m,
      date: m.date.toISOString(),
      imagesAllowed: m.sender?.imagesAllowed ?? thread.sender?.imagesAllowed ?? false,
    })),
  };
}

export type ThreadDetail = NonNullable<Awaited<ReturnType<typeof getThread>>>;
