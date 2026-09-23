import { and, asc, count, desc, eq, gt, isNotNull, isNull, lte, or, sql, type SQL } from "drizzle-orm";

import type { View, ViewSlug } from "@/components/mail/views";
import { VIEWS } from "@/components/mail/views";
import { db } from "@/lib/db";
import { accounts, attachments, messages, threads } from "@/lib/db/schema";

const live = () => and(eq(threads.archived, false), eq(threads.trashed, false), eq(threads.spam, false));
const notSnoozed = () => or(isNull(threads.snoozedUntil), lte(threads.snoozedUntil, sql`now()`));

function viewFilter(view: View): SQL | undefined {
  if (view.slug === "snoozed") return and(live(), gt(threads.snoozedUntil, sql`now()`));
  if (view.slug === "set-aside") return and(live(), isNotNull(threads.setAsideAt));
  return and(live(), eq(threads.bucket, view.bucket!), notSnoozed(), isNull(threads.setAsideAt));
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
        .where(and(viewFilter(view), accountFilter(account), unseenOnly ? isNull(threads.seenAt) : undefined));
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
      subject: threads.subject,
      participants: threads.participantsSummary,
      lastMessageAt: threads.lastMessageAt,
      seenAt: threads.seenAt,
      snoozedUntil: threads.snoozedUntil,
      needsReply: threads.needsReply,
      fromName: last.fromName,
      fromEmail: last.fromEmail,
      snippet: last.snippet,
      messageCount: sql<number>`(select count(*)::int from ${messages} where ${messages.threadId} = ${threads.id})`,
    })
    .from(threads)
    .leftJoinLateral(last, sql`true`)
    .where(and(viewFilter(view), accountFilter(account)))
    .orderBy(sql`${threads.seenAt} is null desc`, desc(threads.lastMessageAt))
    .limit(300);

  return rows.map((r) => ({
    id: r.id,
    accountId: r.accountId,
    subject: r.subject || "(no subject)",
    sender: r.participants || r.fromName || r.fromEmail || "unknown",
    snippet: r.snippet ?? "",
    lastMessageAt: r.lastMessageAt.toISOString(),
    unseen: r.seenAt === null,
    snoozedUntil: r.snoozedUntil?.toISOString() ?? null,
    needsReply: r.needsReply,
    messageCount: r.messageCount,
  }));
}

export type ThreadListItem = Awaited<ReturnType<typeof listThreads>>[number];

export async function getThread(id: string) {
  const thread = await db.query.threads.findFirst({
    where: eq(threads.id, id),
    with: {
      account: { columns: { id: true, email: true, label: true, color: true } },
      sender: { columns: { imagesAllowed: true } },
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
    bucketSuggested: thread.bucketSuggested,
    account: thread.account,
    messages: thread.messages.map((m) => ({
      ...m,
      date: m.date.toISOString(),
      imagesAllowed: m.sender?.imagesAllowed ?? thread.sender?.imagesAllowed ?? false,
    })),
  };
}

export type ThreadDetail = NonNullable<Awaited<ReturnType<typeof getThread>>>;
