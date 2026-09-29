import { and, desc, eq, inArray, isNull, sql } from "drizzle-orm";

import { askJev, jevConfigured, type JevChoice, type JevResponse } from "@/lib/ai/jev";
import type { Db } from "@/lib/db";
import { messages, senders, threads, type MessageHeaders } from "@/lib/db/schema";
import { obviousMachine } from "@/lib/mail/machine";

// Machine senders' threads fold into groups in the list (components/mail/clusters.ts). Headers and
// addresses settle most senders; Jev judges the rest, once per sender.
export const MACHINE_THRESHOLD = 0.8;
export const MACHINE_TEXT_LIMIT = 1500;
// Senders judged per sync pass, so a backlog drains without holding up sync.
export const MACHINE_BATCH = 10;

export const MACHINE_QUESTION: JevChoice = {
  type: "choice",
  instructions: "Was this email sent automatically by a system, or written by a person to the recipient?",
  criteria: {
    machine:
      "Sent automatically by a system or service: notifications, alerts, statements, receipts, order or shipping updates, reminders, newsletters and other template or bulk mail, even when signed with a person's name",
    person: "Written individually by a person to the recipient, including replies in a conversation",
  },
};

export type SenderSample = {
  senderId: string;
  fromEmail: string;
  fromName: string | null;
  subject: string | null;
  text: string | null;
  headers: MessageHeaders;
};

export type MachineVerdict = { machine: boolean; confidence: number | null };

export type MachineAsk = (sample: SenderSample) => Promise<JevResponse>;

export const jevMachineAsk: MachineAsk = (s) =>
  askJev(
    {
      from: `${s.fromName ?? ""} <${s.fromEmail}>`,
      subject: s.subject ?? "",
      has_list_unsubscribe: Boolean(s.headers.listUnsubscribe),
      body: (s.text ?? "").slice(0, MACHINE_TEXT_LIMIT),
    },
    { machine: MACHINE_QUESTION },
  );

/** A machine only when Jev is confident; anything less stays a person, whose mail never folds away. */
export function machineVerdict(response: JevResponse): MachineVerdict {
  const answer = response.answers.machine;
  if (!answer || !["machine", "person"].includes(answer.choice)) {
    throw new Error(`Jev returned no usable answer: ${JSON.stringify(answer)}`);
  }
  const p = answer.probabilities.machine ?? (answer.choice === "machine" ? answer.confidence : 1 - answer.confidence);
  return { machine: answer.choice === "machine" && answer.confidence >= MACHINE_THRESHOLD, confidence: p };
}

/**
 * Senders not judged yet with a live thread where grouping applies, most threads first, each with
 * their latest inbound message as the sample. One thread is enough: the list sets a row by whether
 * its sender is a person, not only whether its mail groups.
 */
async function candidates(db: Db, limit: number): Promise<SenderSample[]> {
  const rows = await db
    .select({ senderId: threads.senderId, n: sql<number>`count(*)::int` })
    .from(threads)
    .innerJoin(senders, eq(senders.id, threads.senderId))
    .where(
      and(
        isNull(senders.machine),
        eq(threads.archived, false),
        eq(threads.trashed, false),
        eq(threads.spam, false),
        inArray(threads.bucket, ["inbox", "news", "paper_trail", "receipts"]),
      ),
    )
    .groupBy(threads.senderId)
    .orderBy(desc(sql`count(*)`))
    .limit(limit);

  const samples: SenderSample[] = [];
  for (const { senderId } of rows) {
    if (!senderId) continue;
    const [m] = await db
      .select({ fromEmail: messages.fromEmail, fromName: messages.fromName, subject: messages.subject, text: messages.text, headers: messages.headers })
      .from(messages)
      .where(and(eq(messages.senderId, senderId), eq(messages.isInbound, true)))
      .orderBy(desc(messages.date))
      .limit(1);
    if (m) samples.push({ senderId, ...m });
  }
  return samples;
}

/**
 * One pass: settles up to `limit` unjudged senders, by the rules when obvious, else by Jev. A failed
 * Jev call leaves the sender for the next pass. Returns how many were settled each way.
 */
export async function judgeSenders(db: Db, ask: MachineAsk = jevMachineAsk, limit = MACHINE_BATCH) {
  const out = { rules: 0, jev: 0, failed: 0 };
  const useJev = ask !== jevMachineAsk || jevConfigured();
  for (const sample of await candidates(db, limit)) {
    let verdict: MachineVerdict;
    if (obviousMachine(sample)) {
      verdict = { machine: true, confidence: null };
      out.rules++;
    } else if (useJev) {
      try {
        verdict = machineVerdict(await ask(sample));
        out.jev++;
      } catch (error) {
        console.error("machine judge failed", sample.fromEmail, error);
        out.failed++;
        continue;
      }
    } else continue;
    await db
      .update(senders)
      .set({ machine: verdict.machine, machineConfidence: verdict.confidence })
      .where(eq(senders.id, sample.senderId));
  }
  return out;
}

/** The user's own call on a sender, from the action bar. It stands like a Jev verdict: never judged again. */
export async function setSenderMachine(db: Db, senderId: string, machine: boolean): Promise<boolean> {
  const rows = await db
    .update(senders)
    .set({ machine, machineConfidence: null })
    .where(eq(senders.id, senderId))
    .returning({ id: senders.id });
  return rows.length > 0;
}
