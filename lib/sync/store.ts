import { randomUUID } from "node:crypto";

import { and, eq, inArray, notInArray, sql } from "drizzle-orm";

import type { Db } from "@/lib/db";
import {
  attachments,
  jobs,
  messages,
  senderAccounts,
  senders,
  threads,
  type Account,
} from "@/lib/db/schema";
import { parseGmailMessage, type ParsedMessage } from "@/lib/mail/mime";
import { rewriteCidImages } from "@/lib/mail/remote";

import type { GmailSyncPort } from "./gmail";
import { PRIORITY_LIVE, enqueueClassify } from "./jobs";
import { LABEL, initialBucket, isInbound, mirrorState, nextSeenAt } from "./mirror";

type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];

export type IngestResult =
  | { status: "skipped" }
  | { status: "gone"; threadId: string | null }
  | { status: "stored"; threadId: string; created: boolean; newMessages: number; classify: boolean };

type ThreadMessage = {
  date: Date;
  fromName: string | null;
  fromEmail: string;
  subject: string | null;
  isInbound: boolean;
  senderId: string | null;
};

const MAX_PARTICIPANTS = 3;

// Thread columns that follow from its messages, ordered oldest first.
export function deriveThreadFields(rows: ThreadMessage[]) {
  const sorted = [...rows].sort((a, b) => a.date.getTime() - b.date.getTime());
  const names: string[] = [];
  for (const m of sorted) {
    const name = m.isInbound ? m.fromName || m.fromEmail.split("@")[0] : "me";
    if (!names.includes(name)) names.push(name);
  }
  const firstInbound = sorted.find((m) => m.isInbound);
  const last = sorted.at(-1);
  return {
    subject: sorted.find((m) => m.subject)?.subject ?? null,
    lastMessageAt: last?.date ?? new Date(0),
    senderId: firstInbound?.senderId ?? null,
    participantsSummary:
      names.slice(0, MAX_PARTICIPANTS).join(", ") + (names.length > MAX_PARTICIPANTS ? ` +${names.length - MAX_PARTICIPANTS}` : ""),
    hasInbound: Boolean(firstInbound),
  };
}

function domainOf(email: string) {
  return email.slice(email.lastIndexOf("@") + 1).toLowerCase();
}

async function upsertSender(tx: Tx, accountId: string, m: ParsedMessage): Promise<string> {
  const [row] = await tx
    .insert(senders)
    .values({ email: m.from.email, domain: domainOf(m.from.email), displayName: m.from.name, firstSeenAt: m.date })
    .onConflictDoUpdate({
      target: senders.email,
      set: {
        displayName: sql`coalesce(${senders.displayName}, excluded.display_name)`,
        firstSeenAt: sql`least(${senders.firstSeenAt}, excluded.first_seen_at)`,
      },
    })
    .returning({ id: senders.id });
  await tx
    .insert(senderAccounts)
    .values({ senderId: row.id, accountId, seenCount: 1, lastSeenAt: m.date })
    .onConflictDoUpdate({
      target: [senderAccounts.senderId, senderAccounts.accountId],
      set: {
        seenCount: sql`${senderAccounts.seenCount} + 1`,
        lastSeenAt: sql`greatest(${senderAccounts.lastSeenAt}, excluded.last_seen_at)`,
      },
    });
  return row.id;
}

// A queued writeback means our state is ahead of Gmail's; mirroring now would undo the user.
async function hasPendingWriteback(db: Db | Tx, threadId: string) {
  const [row] = await db
    .select({ id: jobs.id })
    .from(jobs)
    .where(
      and(
        eq(jobs.dedupeKey, `writeback:${threadId}`),
        inArray(jobs.status, ["pending", "running"]),
      ),
    )
    .limit(1);
  return Boolean(row);
}

// Bring one Gmail thread into Postgres: new messages in full, label state for the rest.
export async function ingestThread(
  db: Db,
  gmail: GmailSyncPort,
  account: Pick<Account, "id" | "email">,
  gmailThreadId: string,
  now = new Date(),
  { classifyPriority = PRIORITY_LIVE }: { classifyPriority?: number } = {},
): Promise<IngestResult> {
  const [existing] = await db
    .select({ id: threads.id, bucket: threads.bucket, seenAt: threads.seenAt })
    .from(threads)
    .where(and(eq(threads.accountId, account.id), eq(threads.gmailThreadId, gmailThreadId)));

  const remote = await gmail.getThreadLabels(gmailThreadId);
  if (!remote) {
    // Deleted forever in Gmail. Keep our copy, out of sight.
    if (existing) await db.update(threads).set({ trashed: true }).where(eq(threads.id, existing.id));
    return { status: "gone", threadId: existing?.id ?? null };
  }

  const live = remote.messages.filter((m) => !m.labelIds.includes(LABEL.draft));
  if (live.length === 0) return { status: "skipped" };

  const local = existing
    ? await db
        .select({ id: messages.id, gmailMessageId: messages.gmailMessageId, gmailLabels: messages.gmailLabels })
        .from(messages)
        .where(eq(messages.threadId, existing.id))
    : [];
  const localById = new Map(local.map((m) => [m.gmailMessageId, m]));

  const fetched: ParsedMessage[] = [];
  for (const m of live) {
    if (localById.has(m.id)) continue;
    const full = await gmail.getMessage(m.id);
    if (full) fetched.push(parseGmailMessage(full));
  }

  const liveIds = live.map((m) => m.id);
  const mirror = mirrorState(
    live.map((m) => m.labelIds),
    existing?.bucket ?? initialBucket(live.flatMap((m) => m.labelIds)),
  );

  return db.transaction(async (tx) => {
    const parsed = fetched.map((m) => ({
      m,
      inbound: isInbound(m.labelIds, m.from.email, account.email),
    }));
    const senderIds = new Map<string, string>();
    for (const { m, inbound } of parsed) {
      if (inbound) senderIds.set(m.gmailMessageId, await upsertSender(tx, account.id, m));
    }

    let threadId = existing?.id;
    let created = false;
    if (!threadId) {
      const first = parsed.map((p) => p.m).sort((a, b) => a.date.getTime() - b.date.getTime())[0];
      const bucket = initialBucket(live.flatMap((m) => m.labelIds));
      const [row] = await tx
        .insert(threads)
        .values({
          accountId: account.id,
          gmailThreadId,
          subject: first?.subject ?? null,
          lastMessageAt: first?.date ?? now,
          bucket,
          archived: mirror.archived ?? false,
          trashed: mirror.trashed,
          spam: mirror.spam,
          seenAt: nextSeenAt(mirror.unread, null, now),
        })
        // Backfill and live sync can meet on the same new thread; the second one just joins it.
        .onConflictDoNothing()
        .returning({ id: threads.id });
      if (row) {
        threadId = row.id;
        created = true;
      } else {
        const [other] = await tx
          .select({ id: threads.id })
          .from(threads)
          .where(and(eq(threads.accountId, account.id), eq(threads.gmailThreadId, gmailThreadId)));
        threadId = other.id;
      }
    }

    for (const { m, inbound } of parsed) {
      const files = m.attachments.map((a) => ({ ...a, id: randomUUID() }));
      const byContentId = new Map(
        files.flatMap((f) => (f.contentId ? [[f.contentId.toLowerCase(), f.id] as const] : [])),
      );
      const html = m.htmlSanitized && byContentId.size ? rewriteCidImages(m.htmlSanitized, byContentId) : m.htmlSanitized;
      const [row] = await tx
        .insert(messages)
        .values({
          threadId,
          accountId: account.id,
          gmailMessageId: m.gmailMessageId,
          senderId: senderIds.get(m.gmailMessageId) ?? null,
          fromEmail: m.from.email,
          fromName: m.from.name,
          to: m.to,
          cc: m.cc,
          bcc: m.bcc,
          subject: m.subject,
          date: m.date,
          snippet: m.snippet,
          htmlSanitized: html,
          text: m.text,
          isInbound: inbound,
          gmailLabels: m.labelIds,
          headers: m.headers,
        })
        .onConflictDoNothing()
        .returning({ id: messages.id });
      if (row && files.length > 0) {
        await tx.insert(attachments).values(files.map((f) => ({ ...f, messageId: row.id })));
      }
    }

    // Label changes on messages we already have.
    for (const m of live) {
      const known = localById.get(m.id);
      if (known && known.gmailLabels.join(",") !== m.labelIds.join(",")) {
        await tx.update(messages).set({ gmailLabels: m.labelIds }).where(eq(messages.id, known.id));
      }
    }
    // Deleted forever in Gmail, or turned back into a draft.
    if (existing && local.length > 0) {
      await tx
        .delete(messages)
        .where(and(eq(messages.threadId, threadId), notInArray(messages.gmailMessageId, liveIds)));
    }

    const all = await tx
      .select({
        date: messages.date,
        fromName: messages.fromName,
        fromEmail: messages.fromEmail,
        subject: messages.subject,
        isInbound: messages.isInbound,
        senderId: messages.senderId,
      })
      .from(messages)
      .where(eq(messages.threadId, threadId));
    const derived = deriveThreadFields(all);

    const mirrored =
      created || (await hasPendingWriteback(tx, threadId))
        ? {}
        : {
            ...(mirror.archived === undefined ? {} : { archived: mirror.archived }),
            trashed: mirror.trashed,
            spam: mirror.spam,
            seenAt: nextSeenAt(mirror.unread, existing?.seenAt ?? null, now),
          };

    await tx
      .update(threads)
      .set({
        subject: derived.subject,
        lastMessageAt: derived.lastMessageAt,
        senderId: derived.senderId,
        participantsSummary: derived.participantsSummary,
        ...mirrored,
      })
      .where(eq(threads.id, threadId));

    const classify = created && derived.hasInbound && !mirror.trashed && !mirror.spam;
    if (classify) await enqueueClassify(tx, { id: threadId, accountId: account.id }, classifyPriority);

    return { status: "stored" as const, threadId, created, newMessages: parsed.length, classify };
  });
}
