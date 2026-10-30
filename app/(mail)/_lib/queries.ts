import { and, asc, count, desc, eq, gt, inArray, isNotNull, isNull, lt, lte, or, sql, type SQL } from "drizzle-orm";

import type { View, ViewSlug } from "@/components/mail/views";
import { CLUSTER_VIEWS, clusterOf, clusterOrder, isMachine, type ClusterInput } from "@/components/mail/clusters";
import { VIEWS, type View as MailView } from "@/components/mail/views";
import { db } from "@/lib/db";
import type { StaleCutoffs } from "@/lib/sync/stale";
import { DIGEST_SECTIONS, digestSection, staleReason } from "@/lib/sync/stale";
import { aiAllowedSenders, currentChoice, inboundSenderIds, judgedSenders } from "@/lib/classify/screener";
import { accounts, attachments, digests, drafts, messages, projects, senderAccounts, senders, threads, type Address } from "@/lib/db/schema";
import { mergeTimeline, shownCopy } from "@/lib/sync/twins";

const live = () => and(eq(threads.archived, false), eq(threads.trashed, false), eq(threads.spam, false));

// A past-due snooze stays set until the thread is opened: that is what "resurfaced" means.
const resurfaced = () => lte(threads.snoozedUntil, sql`now()`);
const unseen = () => or(isNull(threads.seenAt), resurfaced());

const snoozed = () => gt(threads.snoozedUntil, sql`now()`);

const DAY = 24 * 60 * 60 * 1000;

// Threads the user wrote in, by their latest message from us.
const wroteIn = () => sql`exists (select 1 from ${messages} m where m.thread_id = ${threads.id} and not m.is_inbound)`;
const lastSentAt = () => sql`(select max(m.date) from ${messages} m where m.thread_id = ${threads.id} and not m.is_inbound)`;

function viewFilter(view: View, cutoffs: StaleCutoffs, now: Date): SQL | undefined {
  if (view.slug === "snoozed") return and(live(), snoozed());
  if (view.slug === "digest") return and(
    live(), isNull(threads.starredAt), or(isNull(threads.snoozedUntil), lte(threads.snoozedUntil, now)),
    or(
      lte(threads.deadlineAt, new Date(now.getTime() + DAY)),
      lt(threads.workAt, cutoffs.work),
      and(eq(threads.needsReply, true), isNull(threads.deadlineAt), lt(threads.lastMessageAt, cutoffs.reply)),
      and(eq(threads.bucket, "triage"), lt(threads.createdAt, cutoffs.triage)),
    ),
  );
  if (view.slug === "sent") return and(eq(threads.trashed, false), eq(threads.spam, false), wroteIn());
  // Drafts are not threads; see listDrafts.
  if (view.slug === "drafts") return sql`false`;
  if (view.slug === "trash") return and(eq(threads.trashed, true), eq(threads.spam, false));
  // A snoozed Work thread hides until its snooze ends, then comes back here.
  if (view.slug === "work") return and(live(), isNotNull(threads.workAt), or(isNull(threads.snoozedUntil), resurfaced()));
  // A project is a bucket of its own: its live threads as a bucket view holds them, then its archived history.
  // The live threads it suggests sit on top, to check, while they stay in their own view too.
  if (view.project) {
    const open = and(eq(threads.archived, false), isNull(threads.workAt), or(isNull(threads.snoozedUntil), resurfaced()));
    return and(
      eq(threads.trashed, false),
      eq(threads.spam, false),
      or(
        and(eq(threads.projectId, view.project.id), or(open, eq(threads.archived, true))),
        and(isNull(threads.projectId), eq(threads.projectSuggestedId, view.project.id), open),
      ),
    );
  }
  // Work and project threads leave every bucket view.
  const inBucket = and(eq(threads.bucket, view.bucket!), isNull(threads.snoozedUntil), isNull(threads.workAt), isNull(threads.projectId));
  // Resurfaced snoozes sit at the top of Inbox whatever their bucket, unless their project holds them.
  return and(
    live(),
    view.bucket === "inbox" ? or(inBucket, and(isNull(threads.workAt), isNull(threads.projectId), resurfaced())) : inBucket,
  );
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
      refreshTokenIssuedAt: accounts.refreshTokenIssuedAt,
      catchingUp: isNotNull(accounts.catchUp).mapWith(Boolean),
    })
    .from(accounts)
    .orderBy(asc(accounts.createdAt));
}

export type AccountSummary = Awaited<ReturnType<typeof listAccounts>>[number];

/** The owner's projects, in the order they were made. */
export async function listProjects() {
  return db.select({ id: projects.id, name: projects.name, slug: projects.slug }).from(projects).orderBy(asc(projects.createdAt));
}

/** The daily digest of one local day, null until it is made. */
export async function digestOf(day: string) {
  const [row] = await db.select().from(digests).where(eq(digests.day, day)).limit(1);
  return row ?? null;
}

export type ViewCounts = {
  /** Unseen count for News, Paper Trail and Receipts; total visible threads for other views. */
  n: Record<ViewSlug, number>;
  /** Views where a thread has an unread reply that the count does not show: work. */
  unread: Partial<Record<ViewSlug, boolean>>;
  /** Unseen threads per view, which the rail lights up. */
  unseen: Partial<Record<ViewSlug, number>>;
};

export async function viewCounts(on: string[] | null, cutoffs: StaleCutoffs, now: Date, extra: MailView[] = []): Promise<ViewCounts> {
  const rows = await Promise.all(
    [...VIEWS, ...extra].map(async (view) => {
      if (view.slug === "drafts") {
        const [row] = await db.select({ n: count() }).from(drafts).where(on ? inArray(drafts.accountId, on) : undefined);
        return { slug: view.slug, n: row.n, unread: false, unseen: 0 };
      }
      // A project counts what is unseen in it, as News does; its archived history counts nowhere.
      const unseenOnly = view.slug === "news" || view.slug === "paper-trail" || view.slug === "receipts" || !!view.project;
      const [row] = await db
        .select({ n: count(), unseen: count(sql`case when ${unseen()} then 1 end`) })
        .from(threads)
        .where(and(viewFilter(view, cutoffs, now), accountFilter(on), unseenOnly ? unseen() : undefined, view.project ? eq(threads.archived, false) : undefined));
      return { slug: view.slug, n: row.n, unread: view.slug === "work" && row.unseen > 0, unseen: row.unseen };
    }),
  );
  return {
    n: Object.fromEntries(rows.map((r) => [r.slug, r.n])) as Record<ViewSlug, number>,
    unread: Object.fromEntries(rows.filter((r) => r.unread).map((r) => [r.slug, true])),
    unseen: Object.fromEntries(rows.filter((r) => r.unseen > 0).map((r) => [r.slug, r.unseen])),
  };
}

/**
 * Work: overdue deadlines, then upcoming ones soonest first (both by deadline ascending), then the
 * threads without one, newest activity first.
 */
const workOrder = () => [sql`${threads.deadlineAt} asc nulls last`, desc(threads.lastMessageAt)];

export async function listThreads(view: View, on: string[] | null, cutoffs: StaleCutoffs, now: Date) {
  const last = db
    .select({
      fromName: messages.fromName,
      fromEmail: messages.fromEmail,
      snippet: messages.snippet,
      isInbound: messages.isInbound,
      headers: messages.headers,
      subject: messages.subject,
      machine: sql<boolean | null>`(select ${senders.machine} from ${senders} where ${senders.id} = ${messages.senderId})`.as("machine"),
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
      projectId: threads.projectId,
      projectSuggestedId: threads.projectSuggestedId,
      archived: threads.archived,
      createdAt: threads.createdAt,
      subject: threads.subject,
      participants: threads.participantsSummary,
      lastMessageAt: threads.lastMessageAt,
      unseen: sql<boolean>`${unseen()}`,
      resurfaced: sql<boolean>`coalesce(${resurfaced()}, false)`,
      snoozedUntil: threads.snoozedUntil,
      needsReply: threads.needsReply,
      deadlineAt: threads.deadlineAt,
      workAt: threads.workAt,
      starredAt: threads.starredAt,
      fromName: last.fromName,
      fromEmail: last.fromEmail,
      snippet: last.snippet,
      lastInbound: last.isInbound,
      lastHeaders: last.headers,
      lastSubject: last.subject,
      lastMachine: last.machine,
      summary: threads.summary,
      summaryMessageAt: threads.summaryMessageAt,
      // Distinct messages across copies: the same Message-ID in two accounts counts once.
      messageCount: sql<number>`(select count(distinct coalesce(${messages.headers}->>'messageId', ${messages.id}::text))::int from ${messages} where ${messages.threadId} in ${copies})`,
      accountIds: sql<string[]>`array(select a.id from ${accounts} a where a.id in (select t.account_id from ${threads} t where t.id in ${copies}) order by a.created_at)`,
      sentTo:
        view.slug === "sent"
          ? sql<Address[] | null>`(select m.to from ${messages} m where m.thread_id = ${threads.id} and not m.is_inbound order by m.date desc limit 1)`
          : sql<null>`null`,
    })
    .from(threads)
    .leftJoinLateral(last, sql`true`)
    .where(and(viewFilter(view, cutoffs, now), accountFilter(on)))
    .orderBy(
      // Starred threads are pinned on top of the list that holds them, latest starred first.
      ...(view.slug === "sent" || view.slug === "digest" ? [] : [asc(sql`${threads.starredAt} is null`), desc(threads.starredAt)]),
      ...(view.slug === "work"
        ? workOrder()
        : view.slug === "digest"
          ? [asc(sql`case
              when ${lt(threads.workAt, cutoffs.work)} then ${threads.workAt} - ${cutoffs.work.toISOString()}::timestamptz
              when ${threads.needsReply} and ${threads.deadlineAt} is null and ${lt(threads.lastMessageAt, cutoffs.reply)} then ${threads.lastMessageAt} - ${cutoffs.reply.toISOString()}::timestamptz
              else ${threads.createdAt} - ${cutoffs.triage.toISOString()}::timestamptz
            end`), asc(threads.id)]
        : view.slug === "sent"
          ? [desc(lastSentAt())]
          : view.project
          ? [
            asc(sql`${threads.projectId} is not null`),
            asc(threads.archived),
            desc(sql`coalesce(${resurfaced()}, false)`),
            desc(sql`coalesce(${unseen()}, false)`),
            desc(threads.lastMessageAt),
            ]
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

  const latest = rows.map((r): ClusterInput | null =>
    r.fromEmail
      ? {
          isInbound: !!r.lastInbound,
          fromEmail: r.fromEmail,
          fromName: r.fromName,
          subject: r.lastSubject ?? r.subject,
          headers: r.lastHeaders ?? {},
          machine: r.lastMachine ?? null,
        }
      : null,
  );
  // Machine mail from one source folds into a group once it has two threads here.
  // A starred thread stays out of them, pinned on its own.
  const found = CLUSTER_VIEWS.includes(view.slug) ? latest.map((m, i) => (m && !rows[i].starredAt ? clusterOf(m) : null)) : [];
  const sizes = new Map<string, number>();
  // One name per group, its newest thread's.
  const labels = new Map<string, string>();
  for (const c of found) {
    if (!c) continue;
    sizes.set(c.key, (sizes.get(c.key) ?? 0) + 1);
    if (!labels.has(c.key)) labels.set(c.key, c.label);
  }
  const clusterAt = (i: number) => {
    const c = found[i];
    return c && sizes.get(c.key)! > 1 ? { key: c.key, label: labels.get(c.key)! } : null;
  };

  const items = rows.map((r, i) => ({
    id: r.id,
    cluster: clusterAt(i),
    // Who the latest message is from sets the row: people get two lines, machines one.
    kind: latest[i] && isMachine(latest[i]) ? ("machine" as const) : ("person" as const),
    // The user wrote last, so the next move is theirs.
    lastFromMe: r.lastInbound === false,
    accountId: r.accountId,
    // Every account the conversation reached, in account order.
    accountIds: r.accountIds,
    senderId: r.senderId,
    bucket: r.bucket,
    projectId: r.projectId,
    projectSuggestedId: r.projectId ? null : r.projectSuggestedId,
    archived: r.archived,
    subject: r.subject || "(no subject)",
    // Sent names who it went to.
    sender: r.sentTo ? sentLabel(r.sentTo) : r.participants || r.fromName || r.fromEmail || "unknown",
    snippet: r.snippet ?? "",
    summary: summaryOf(r),
    lastMessageAt: r.lastMessageAt.toISOString(),
    unseen: !!r.unseen,
    resurfaced: r.resurfaced,
    snoozedUntil: r.snoozedUntil?.toISOString() ?? null,
    needsReply: r.needsReply,
    staleReason: staleReason(r, cutoffs, now),
    digestSection: view.slug === "digest" ? digestSection(r, cutoffs, now) : null,
    deadlineAt: r.deadlineAt?.toISOString() ?? null,
    work: r.workAt !== null,
    starred: r.starredAt !== null,
    messageCount: r.messageCount,
  }));
  // The digest shows its sections in order, deadlines soonest first; the rest keep the query's order.
  if (view.slug === "digest") {
    const rank = (t: (typeof items)[number]) => DIGEST_SECTIONS.indexOf(t.digestSection!);
    items.sort((a, b) => rank(a) - rank(b) || (a.digestSection === "deadline" ? a.deadlineAt!.localeCompare(b.deadlineAt!) : 0));
  }
  const byId = new Map(items.map((t) => [t.id, t]));
  const keys = Object.fromEntries(items.flatMap((t) => (t.cluster ? [[t.id, t.cluster.key]] : [])));
  return clusterOrder(items.map((t) => t.id), keys).map((id) => byId.get(id)!);
}

export type ThreadListItem = Awaited<ReturnType<typeof listThreads>>[number];

function sentLabel(to: Address[]): string {
  if (!to.length) return "to (no recipient)";
  const names = to.map((a) => a.name?.split(/\s+/)[0] || a.email.split("@")[0]);
  return `to ${names.slice(0, 3).join(", ")}${names.length > 3 ? ` +${names.length - 3}` : ""}`;
}

/** Drafts, newest edit first, for the accounts toggled on. */
export async function listDrafts(on: string[] | null) {
  const rows = await db
    .select({
      id: drafts.id,
      accountId: drafts.accountId,
      to: drafts.to,
      subject: drafts.subject,
      html: drafts.html,
      date: drafts.date,
    })
    .from(drafts)
    .where(on ? inArray(drafts.accountId, on) : undefined)
    .orderBy(desc(drafts.date))
    .limit(300);
  return rows.map((r) => ({
    id: r.id,
    accountId: r.accountId,
    to: r.to.trim() ? `to ${r.to.trim()}` : "no recipient",
    subject: r.subject.trim() || "(no subject)",
    // A line of text for the row, never the whole body.
    snippet: r.html
      .slice(0, 4000)
      .replace(/<(style|script)[\s\S]*?<\/\1>/gi, " ")
      .replace(/<[^>]+>/g, " ")
      .replace(/&nbsp;/g, " ")
      .replace(/&amp;/g, "&")
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 200),
    date: r.date.toISOString(),
  }));
}

export type DraftListItem = Awaited<ReturnType<typeof listDrafts>>[number];

const threadWith = {
  account: { columns: { id: true, email: true, label: true, color: true } },
  sender: { columns: { id: true, email: true, displayName: true, imagesAllowed: true, screenerDecision: true, decidedBy: true } },
  project: { columns: { id: true, name: true, slug: true } },
  messages: {
    orderBy: asc(messages.date),
    columns: {
      id: true,
      fromEmail: true,
      fromName: true,
      to: true,
      cc: true,
      date: true,
      subject: true,
      snippet: true,
      htmlSanitized: true,
      text: true,
      isInbound: true,
      headers: true,
    },
    with: {
      sender: { columns: { id: true, email: true, displayName: true, imagesAllowed: true, screenerDecision: true, decidedBy: true, machine: true } },
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
  const [accountList, card] = await Promise.all([listAccounts(), opened.senderId ? senderCard(opened.senderId) : null]);
  const accountOrder = new Map(accountList.map((a, i) => [a.id, i]));
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
    // The project it sits in, which is its view while live.
    project: thread.project ? { id: thread.project.id, name: thread.project.name, slug: thread.project.slug } : null,
    // A project the app asks about: confirm or dismiss.
    projectSuggestedId: thread.project ? null : thread.projectSuggestedId,
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
    starred: thread.starredAt !== null,
    trashed: thread.trashed,
    archived: thread.archived,
    spam: thread.spam,
    canUnsubscribe: !!latestInbound?.headers.listUnsubscribe,
    // The latest inbound sender and how the list shows them, so a wrong call can be corrected.
    latestSender:
      latestInbound?.sender
        ? {
            id: latestInbound.sender.id,
            name: latestInbound.fromName || latestInbound.fromEmail,
            machine: isMachine({
              isInbound: true,
              fromEmail: latestInbound.fromEmail,
              fromName: latestInbound.fromName,
              subject: latestInbound.subject,
              headers: latestInbound.headers,
              machine: latestInbound.sender.machine,
            }),
          }
        : null,
    // The sender card: who the thread's sender is to you, from what sync already counted.
    sender: card
      ? { ...card, accounts: card.accounts.sort((a, b) => (accountOrder.get(a.id) ?? 0) - (accountOrder.get(b.id) ?? 0)) }
      : null,
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

/** A sender's standing: the accounts it writes to, its threads (twins once), last mail and screener choice. */
export async function senderCard(senderId: string) {
  const [[sender], reached, [threadCount]] = await Promise.all([
    db
      .select({
        id: senders.id,
        email: senders.email,
        name: senders.displayName,
        decision: senders.screenerDecision,
        defaultBucket: senders.defaultBucket,
        decidedBy: senders.decidedBy,
      })
      .from(senders)
      .where(eq(senders.id, senderId)),
    db
      .select({
        id: accounts.id,
        label: accounts.label,
        color: accounts.color,
        seenCount: senderAccounts.seenCount,
        lastSeenAt: senderAccounts.lastSeenAt,
      })
      .from(senderAccounts)
      .innerJoin(accounts, eq(accounts.id, senderAccounts.accountId))
      .where(eq(senderAccounts.senderId, senderId)),
    db
      .select({ n: sql<number>`count(distinct coalesce(${threads.groupId}, ${threads.id}))`.mapWith(Number) })
      .from(threads)
      .where(eq(threads.senderId, senderId)),
  ]);
  if (!sender) return null;
  const last = reached.reduce<Date | null>((max, a) => (a.lastSeenAt && (!max || a.lastSeenAt > max) ? a.lastSeenAt : max), null);
  return {
    id: sender.id,
    email: sender.email,
    name: sender.name,
    decision: sender.decision,
    decidedBy: sender.decidedBy,
    choice: currentChoice(sender.decision, sender.defaultBucket),
    threadCount: threadCount?.n ?? 0,
    lastSeenAt: last?.toISOString() ?? null,
    accounts: reached.map((a) => ({ id: a.id, label: a.label, color: a.color, seenCount: a.seenCount })),
  };
}

export type ThreadDetail = NonNullable<Awaited<ReturnType<typeof getThread>>>;
