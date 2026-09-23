import { randomUUID } from "node:crypto";
import { isIP } from "node:net";

import { and, desc, eq } from "drizzle-orm";

import type { Db } from "@/lib/db";
import { actionsLog, messages, threads } from "@/lib/db/schema";
import { sendMessage } from "@/lib/gmail/send";

import { senderActionIn, threadActionIn } from "./apply";

export type UnsubscribeResult =
  /** Sent by one-click POST or mailto; the sender is kept out and the thread archived under `token`. */
  | { kind: "sent"; method: "one-click" | "mailto"; sender: string; token: string }
  /** Only a web page; the client opens it. Nothing else changes. */
  | { kind: "open"; url: string }
  | { kind: "none" }
  | { kind: "failed" };

type Targets = { https: URL[]; mailto: URL[] };

/** The `<...>` entries of a List-Unsubscribe header, sorted into https and mailto. */
export function parseListUnsubscribe(header: string): Targets {
  const targets: Targets = { https: [], mailto: [] };
  for (const [, raw] of header.matchAll(/<([^>]+)>/g)) {
    let url: URL;
    try {
      url = new URL(raw.trim());
    } catch {
      continue;
    }
    if (url.protocol === "https:") targets.https.push(url);
    else if (url.protocol === "mailto:") targets.mailto.push(url);
  }
  return targets;
}

const isOneClick = (post: string | undefined) => post?.replace(/\s+/g, "").toLowerCase() === "list-unsubscribe=one-click";

// The URL comes from an email, so the server must not be pointed at itself or the local network.
function isPublicHost(url: URL) {
  const host = url.hostname.replace(/^\[|\]$/g, "").toLowerCase();
  if (host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local") || host.endsWith(".internal")) return false;
  const version = isIP(host);
  if (version === 4) {
    const [a, b] = host.split(".").map(Number);
    return !(a === 10 || a === 127 || a === 0 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127));
  }
  if (version === 6) return !(host === "::1" || host === "::" || /^f[cd]/.test(host) || host.startsWith("fe80") || host.startsWith("::ffff:"));
  return true;
}

const TIMEOUT_MS = 10_000;
const MAX_REDIRECTS = 3;

/** RFC 8058 one-click: a bare POST, no cookies, following redirects only to public https. */
async function oneClick(url: URL): Promise<boolean> {
  let target = url;
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    if (target.protocol !== "https:" || !isPublicHost(target)) return false;
    const res = await fetch(target, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: "List-Unsubscribe=One-Click",
      credentials: "omit",
      redirect: "manual",
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (res.status >= 200 && res.status < 300) return true;
    const location = res.headers.get("location");
    if (res.status < 300 || res.status >= 400 || !location) return false;
    target = new URL(location, target);
  }
  return false;
}

const escapeHtml = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/** Sends the mailto's message, with its subject and body, from the thread's account. */
async function mailto(url: URL, accountId: string) {
  const to = decodeURIComponent(url.pathname)
    .split(",")
    .map((e) => e.trim())
    .filter((e) => /^[^\s@]+@[^\s@]+$/.test(e));
  if (!to.length) return false;
  const subject = url.searchParams.get("subject") || "unsubscribe";
  const body = url.searchParams.get("body") || "unsubscribe";
  await sendMessage(accountId, {
    to: to.map((email) => ({ email, name: null })),
    cc: [],
    bcc: [],
    subject,
    html: escapeHtml(body).replace(/\r?\n/g, "<br>"),
  });
  return true;
}

/**
 * Unsubscribe from the list behind a thread, from its latest inbound message's
 * List-Unsubscribe header: one-click POST first, else mailto, else hand the web
 * page back. When the request went out, the sender is kept out (not now) and
 * the thread archived, logged as one batch so undo reverses both. The request
 * itself cannot be taken back.
 */
export async function unsubscribeThread(db: Db, threadId: string): Promise<UnsubscribeResult> {
  const [latest] = await db
    .select({
      accountId: threads.accountId,
      headers: messages.headers,
      fromName: messages.fromName,
      fromEmail: messages.fromEmail,
    })
    .from(messages)
    .innerJoin(threads, eq(threads.id, messages.threadId))
    .where(and(eq(messages.threadId, threadId), eq(messages.isInbound, true)))
    .orderBy(desc(messages.date))
    .limit(1);
  const header = latest?.headers.listUnsubscribe;
  if (!latest || !header) return { kind: "none" };

  const targets = parseListUnsubscribe(header);
  let method: "one-click" | "mailto" | null = null;
  let target = "";

  const https = targets.https.find(isPublicHost);
  if (https && isOneClick(latest.headers.listUnsubscribePost)) {
    try {
      if (await oneClick(https)) [method, target] = ["one-click", https.href];
    } catch (error) {
      console.error("unsubscribe: one-click failed", error);
    }
  }
  if (!method && targets.mailto[0]) {
    try {
      if (await mailto(targets.mailto[0], latest.accountId)) [method, target] = ["mailto", targets.mailto[0].href];
    } catch (error) {
      console.error("unsubscribe: mailto failed", error);
    }
  }
  if (!method) return https ? { kind: "open", url: https.href } : { kind: "failed" };

  const token = randomUUID();
  await db.transaction(async (tx) => {
    await tx.insert(actionsLog).values({ threadId, batchId: token, action: "unsubscribe", payload: { unsubscribe: { method, target } } });
    await senderActionIn(tx, token, threadId, { type: "keepOut" });
    await threadActionIn(tx, token, [threadId], { type: "archive" });
  });
  return { kind: "sent", method, sender: latest.fromName || latest.fromEmail, token };
}
