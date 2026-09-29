import type { MessageHeaders } from "@/lib/db/schema";
import { obviousMachine } from "@/lib/mail/machine";

import type { ViewSlug } from "./views";

/** Views where automated mail from one source folds into a group. Work, triage and the rest keep their own order. */
export const CLUSTER_VIEWS: ViewSlug[] = ["inbox", "news", "paper-trail", "receipts"];

export type ClusterInput = {
  isInbound: boolean;
  fromEmail: string;
  fromName: string | null;
  subject: string | null;
  headers: MessageHeaders;
  /** The sender's judged machine flag (lib/classify/machine.ts), null when not judged yet. */
  machine: boolean | null;
};

export type Cluster = { key: string; label: string };

/**
 * Whether a thread's latest message came from a machine. A judged sender (by Jev, or by hand from the
 * action bar) decides; an unjudged one is a machine only when its headers or address make it obvious.
 * Anything unsure stays a person: a bot shown as a person costs one bright row, a person shown as a
 * bot can be missed.
 */
export function isMachine(m: ClusterInput): boolean {
  if (!m.isInbound) return false;
  return m.machine ?? obviousMachine(m);
}

/**
 * The group a thread's latest message belongs to, or null when it is not machine mail: obvious from
 * its headers or address, or its sender judged a machine by Jev. One sender
 * is one group; a `[owner/repo]` style tag in the subject splits it further, so each repo's GitHub
 * mail stays together.
 */
export function clusterOf(m: ClusterInput): Cluster | null {
  if (!isMachine(m)) return null;

  const email = m.fromEmail.toLowerCase();
  const domain = email.split("@")[1] ?? email;
  const brand = domain.split(".").slice(-2, -1)[0] ?? domain;
  const tag = (m.subject ?? "").replace(/^\s*((re|fwd?|fw)\s*:\s*)+/i, "").match(/^\[([^\]]{2,80})\]/)?.[1];
  if (tag) return { key: `${email}|${tag.toLowerCase()}`, label: `${brand} · ${tag}` };
  return { key: email, label: m.fromName?.trim() || brand };
}

/** Moves every group's rows up to where its first row is, keeping order otherwise. */
export function clusterOrder(ids: string[], clusters: Record<string, string>): string[] {
  const out: string[] = [];
  const placed = new Set<string>();
  const members = new Map<string, string[]>();
  for (const id of ids) {
    const key = clusters[id];
    if (key) members.set(key, [...(members.get(key) ?? []), id]);
  }
  for (const id of ids) {
    const key = clusters[id];
    if (!key) out.push(id);
    else if (!placed.has(key)) {
      placed.add(key);
      out.push(...members.get(key)!);
    }
  }
  return out;
}
