import { and, asc, count, desc, eq, or, sql } from "drizzle-orm";

import type { Db } from "@/lib/db";
import {
  accounts,
  corrections,
  messages,
  rules,
  senderAccounts,
  senders,
  threads,
  type Thread,
} from "@/lib/db/schema";

import { selectExemplars } from "./exemplars";
import type { ClassifyContext, Exemplar, SenderFacts } from "./types";

const RECENT_CORRECTIONS = 200;
const SENDER_CORRECTIONS = 50;

export type LoadedContext = {
  ctx: ClassifyContext;
  thread: Pick<Thread, "id" | "accountId" | "bucket" | "bucketSource">;
  senderId: string | null;
};

export function domainOf(email: string) {
  return email.slice(email.lastIndexOf("@") + 1).toLowerCase();
}

async function loadExemplarCandidates(db: Db, email: string, domain: string) {
  const base = () =>
    db
      .select({
        id: corrections.id,
        senderEmail: senders.email,
        domain: senders.domain,
        subject: threads.subject,
        fromBucket: corrections.fromBucket,
        toBucket: corrections.toBucket,
        createdAt: corrections.createdAt,
      })
      .from(corrections)
      .leftJoin(senders, eq(corrections.senderId, senders.id))
      .leftJoin(threads, eq(corrections.threadId, threads.id));

  const [related, recent] = await Promise.all([
    base()
      .where(or(eq(senders.email, email), eq(senders.domain, domain)))
      .orderBy(desc(corrections.createdAt))
      .limit(SENDER_CORRECTIONS),
    base().orderBy(desc(corrections.createdAt)).limit(RECENT_CORRECTIONS),
  ]);
  return [...related, ...recent] satisfies Exemplar[];
}

// Everything one Jev call needs about a thread. Null when there is nothing inbound to judge.
export async function loadContext(db: Db, threadId: string): Promise<LoadedContext | null> {
  const [thread] = await db
    .select({
      id: threads.id,
      accountId: threads.accountId,
      bucket: threads.bucket,
      bucketSource: threads.bucketSource,
      senderId: threads.senderId,
      subject: threads.subject,
      accountEmail: accounts.email,
      accountLabel: accounts.label,
    })
    .from(threads)
    .innerJoin(accounts, eq(threads.accountId, accounts.id))
    .where(eq(threads.id, threadId));
  if (!thread) return null;

  const threadMessages = await db
    .select({
      fromEmail: messages.fromEmail,
      fromName: messages.fromName,
      subject: messages.subject,
      text: messages.text,
      snippet: messages.snippet,
      headers: messages.headers,
      isInbound: messages.isInbound,
      senderId: messages.senderId,
    })
    .from(messages)
    .where(eq(messages.threadId, threadId))
    .orderBy(asc(messages.date));

  const first = threadMessages.find((m) => m.isInbound);
  if (!first) return null;

  const email = first.fromEmail.toLowerCase();
  const senderId = thread.senderId ?? first.senderId;
  const [sender] = senderId
    ? await db.select().from(senders).where(eq(senders.id, senderId))
    : [];
  const domain = sender?.domain ?? domainOf(email);

  const [[threadCount], [accountCount], [written], enabledRules, candidates] = await Promise.all([
    senderId
      ? db.select({ n: count() }).from(threads).where(eq(threads.senderId, senderId))
      : Promise.resolve([{ n: 1 }]),
    senderId
      ? db.select({ n: count() }).from(senderAccounts).where(eq(senderAccounts.senderId, senderId))
      : Promise.resolve([{ n: 1 }]),
    db
      .select({ n: count() })
      .from(messages)
      .where(
        and(
          eq(messages.isInbound, false),
          sql`${messages.to} @> ${JSON.stringify([{ email }])}::jsonb`,
        ),
      ),
    db
      .select({ id: rules.id, text: rules.text, structured: rules.structured, updatedAt: rules.updatedAt })
      .from(rules)
      .where(eq(rules.enabled, true)),
    loadExemplarCandidates(db, email, domain),
  ]);

  const facts: SenderFacts = {
    email,
    domain,
    displayName: sender?.displayName ?? first.fromName,
    decision: sender?.screenerDecision ?? "none",
    defaultBucket: sender?.defaultBucket ?? null,
    threadCount: Math.max(1, threadCount.n),
    accountCount: Math.max(1, accountCount.n),
    userHasWrittenTo: written.n > 0,
    userStartedThread: !threadMessages[0].isInbound,
  };

  const subject = thread.subject ?? first.subject;
  const senderCorrectedAt =
    candidates
      .filter((c) => c.senderEmail === email)
      .map((c) => c.createdAt)
      .sort((a, b) => b.getTime() - a.getTime())[0] ?? null;
  return {
    thread,
    senderId,
    ctx: {
      thread: {
        accountEmail: thread.accountEmail,
        accountLabel: thread.accountLabel,
        subject,
        fromName: first.fromName,
        fromEmail: email,
        text: first.text ?? first.snippet ?? "",
        headers: first.headers,
        messageCount: threadMessages.length,
      },
      sender: facts,
      rules: enabledRules,
      exemplars: selectExemplars(candidates, { senderEmail: email, domain, subject }),
      senderCorrectedAt,
    },
  };
}
