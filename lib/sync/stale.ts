import type { StaleSettings } from "@/lib/db/settings";

const DAY = 24 * 60 * 60 * 1000;

export function staleCutoffs(now: Date, settings: StaleSettings) {
  return {
    work: new Date(now.getTime() - settings.workDays * DAY),
    reply: new Date(now.getTime() - settings.replyDays * DAY),
    triage: new Date(now.getTime() - settings.triageDays * DAY),
  };
}

export type StaleCutoffs = ReturnType<typeof staleCutoffs>;
export type StaleThread = {
  workAt: Date | null;
  needsReply: boolean;
  deadlineAt: Date | null;
  lastMessageAt: Date;
  bucket: string;
  createdAt: Date;
  snoozedUntil: Date | null;
};

export type DigestSection = "reply" | "deadline" | "triage" | "work";
/** The digest's sections, in the order they show. */
export const DIGEST_SECTIONS: DigestSection[] = ["reply", "deadline", "triage", "work"];

/** Where a thread sits on the digest: a deadline due within a day or overdue, else why it went stale; null when it is not there. */
export function digestSection(thread: StaleThread, cutoffs: StaleCutoffs, now: Date): DigestSection | null {
  if (thread.snoozedUntil && thread.snoozedUntil > now) return null;
  if (thread.deadlineAt && thread.deadlineAt.getTime() <= now.getTime() + DAY) return "deadline";
  return staleReason(thread, cutoffs, now)?.kind ?? null;
}

export function staleReason(thread: StaleThread, cutoffs: StaleCutoffs, now: Date): { kind: "work" | "reply" | "triage"; days: number } | null {
  if (thread.snoozedUntil && thread.snoozedUntil > now) return null;
  const aged = (at: Date) => Math.floor((now.getTime() - at.getTime()) / DAY);
  if (thread.workAt && thread.workAt < cutoffs.work) return { kind: "work", days: aged(thread.workAt) };
  if (thread.needsReply && !thread.deadlineAt && thread.lastMessageAt < cutoffs.reply)
    return { kind: "reply", days: aged(thread.lastMessageAt) };
  if (thread.bucket === "triage" && thread.createdAt < cutoffs.triage)
    return { kind: "triage", days: aged(thread.createdAt) };
  return null;
}
