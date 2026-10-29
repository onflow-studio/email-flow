import { and, eq, gte, inArray, isNull, ne, or, sql } from "drizzle-orm";

import type { Db } from "@/lib/db";
import { embeddings, projectDismissals, projects, senders, threads } from "@/lib/db/schema";
import { enqueueWriteback } from "@/lib/sync/jobs";

// Project sorting: which project, if any, a thread belongs to, from where the owner put the same
// sender's, the same domain's and similar mail before. No model call: counts and, where embeddings
// exist, nearest neighbours. Sure moves the thread in; unsure asks the owner (projectSuggestedId).
// Only the owner's own placements count as evidence, so the app never learns from itself.

/** Owner-placed threads like this one: how many in all, and how many in each project. */
export type Tally = { total: number; byProject: Record<string, number> };

export type ProjectEvidence = { sender?: Tally; domain?: Tally; neighbors?: Tally };

export type ProjectCall = { projectId: string; sure: boolean; why: "sender" | "domain" | "meaning" };

type Rule = { why: ProjectCall["why"]; sure?: { n: number; share: number }; ask: { n: number; share: number } };

// A sender is personal, a domain an organisation with several projects, meaning a hint only.
const RULES: Rule[] = [
  { why: "sender", sure: { n: 3, share: 0.8 }, ask: { n: 1, share: 0.5 } },
  { why: "domain", sure: { n: 5, share: 0.85 }, ask: { n: 3, share: 0.5 } },
  { why: "meaning", ask: { n: 3, share: 0.6 } },
];

const tallyOf = (e: ProjectEvidence, why: ProjectCall["why"]) => (why === "sender" ? e.sender : why === "domain" ? e.domain : e.neighbors);

function leader(t: Tally | undefined, eligible: Set<string>) {
  if (!t || t.total <= 0) return null;
  const [projectId, n] = Object.entries(t.byProject)
    .filter(([id]) => eligible.has(id))
    .sort((a, b) => b[1] - a[1])[0] ?? [null, 0];
  return projectId ? { projectId, n, share: n / t.total } : null;
}

/** The call for one thread: the first sure signal, else the first that is worth asking about, else none. */
export function decideProject(evidence: ProjectEvidence, eligible: Set<string>): ProjectCall | null {
  for (const rule of RULES) {
    const best = leader(tallyOf(evidence, rule.why), eligible);
    if (best && rule.sure && best.n >= rule.sure.n && best.share >= rule.sure.share) return { projectId: best.projectId, sure: true, why: rule.why };
  }
  for (const rule of RULES) {
    const best = leader(tallyOf(evidence, rule.why), eligible);
    if (best && best.n >= rule.ask.n && best.share >= rule.ask.share) return { projectId: best.projectId, sure: false, why: rule.why };
  }
  return null;
}

// Addresses at these are people, not an organisation.
const PUBLIC_DOMAINS = new Set([
  "gmail.com", "googlemail.com", "outlook.com", "hotmail.com", "hotmail.es", "live.com", "msn.com", "yahoo.com", "yahoo.es",
  "icloud.com", "me.com", "mac.com", "proton.me", "protonmail.com", "aol.com", "gmx.com", "gmx.es",
]);

export function orgDomain(email: string | null | undefined): string | null {
  const domain = email?.split("@")[1]?.toLowerCase().trim();
  return domain && !PUBLIC_DOMAINS.has(domain) ? domain : null;
}

// Threads one pass reads per account. Each costs a few small queries, and one vector search with embeddings.
const SORT_BATCH = 200;
// Nearest chunks read for the meaning signal, and how close they must be.
const NEIGHBOR_CHUNKS = 40;
const NEIGHBOR_DISTANCE = 0.45;

// What counts as evidence: threads the owner placed in a project, or left outside every project.
const owned = () => and(eq(threads.trashed, false), eq(threads.spam, false), or(isNull(threads.projectId), eq(threads.projectSource, "user")));

function tallies(rows: { key: string | null; projectId: string | null; n: number }[]) {
  const out = new Map<string, Tally>();
  for (const r of rows) {
    if (!r.key) continue;
    const t = out.get(r.key) ?? { total: 0, byProject: {} };
    t.total += r.n;
    if (r.projectId) t.byProject[r.projectId] = (t.byProject[r.projectId] ?? 0) + r.n;
    out.set(r.key, t);
  }
  return out;
}

/** The tally without the thread being sorted, which sits outside every project. */
const without = (t: Tally | undefined): Tally | undefined => (t ? { total: Math.max(0, t.total - 1), byProject: t.byProject } : undefined);

async function neighborTally(db: Db, threadId: string): Promise<Tally | undefined> {
  return db.transaction(async (tx) => {
    const [own] = await tx.select({ embedding: embeddings.embedding }).from(embeddings).where(eq(embeddings.threadId, threadId)).limit(1);
    if (!own) return undefined;
    await tx.execute(sql`SET LOCAL hnsw.iterative_scan = relaxed_order`);
    const distance = sql`${embeddings.embedding} <=> ${JSON.stringify(own.embedding)}::vector`;
    const near = await tx
      .select({ threadId: embeddings.threadId })
      .from(embeddings)
      .where(and(ne(embeddings.threadId, threadId), sql`${distance} < ${NEIGHBOR_DISTANCE}`))
      .orderBy(distance)
      .limit(NEIGHBOR_CHUNKS);
    const ids = [...new Set(near.map((n) => n.threadId))];
    if (!ids.length) return undefined;
    const rows = await tx
      .select({ projectId: threads.projectId, n: sql<number>`count(distinct coalesce(${threads.groupId}, ${threads.id}))::int` })
      .from(threads)
      .where(and(inArray(threads.id, ids), owned()))
      .groupBy(threads.projectId);
    return tallies(rows.map((r) => ({ key: "near", projectId: r.projectId, n: r.n }))).get("near");
  });
}

/**
 * One pass of project sorting on an account: the threads not read since the last change, outside
 * every project. Sure calls move the thread in (with its twins); unsure ones on live threads ask.
 * Archived history is only ever moved, never asked about. Returns how many were moved and asked.
 */
export async function sortProjects(db: Db, accountId: string, { limit = SORT_BATCH, now = new Date() } = {}) {
  const all = await db.select({ id: projects.id, since: projects.since }).from(projects);
  if (!all.length) return { moved: 0, asked: 0 };

  const batch = await db
    .select({
      id: threads.id,
      accountId: threads.accountId,
      groupId: threads.groupId,
      senderId: threads.senderId,
      email: senders.email,
      archived: threads.archived,
      lastMessageAt: threads.lastMessageAt,
    })
    .from(threads)
    .leftJoin(senders, eq(senders.id, threads.senderId))
    .where(
      and(
        eq(threads.accountId, accountId),
        isNull(threads.projectCheckedAt),
        isNull(threads.projectId),
        eq(threads.trashed, false),
        eq(threads.spam, false),
      ),
    )
    .limit(limit);
  if (!batch.length) return { moved: 0, asked: 0 };

  const ids = batch.map((t) => t.id);
  const senderIds = [...new Set(batch.flatMap((t) => (t.senderId ? [t.senderId] : [])))];
  const domains = [...new Set(batch.flatMap((t) => orgDomain(t.email) ?? []))];
  const domainOf = sql<string>`split_part(lower(${senders.email}), '@', 2)`;
  const once = sql<number>`count(distinct coalesce(${threads.groupId}, ${threads.id}))::int`;
  const [dismissed, bySender, byDomain] = await Promise.all([
    db.select().from(projectDismissals).where(inArray(projectDismissals.threadId, ids)),
    senderIds.length
      ? db
          .select({ key: threads.senderId, projectId: threads.projectId, n: once })
          .from(threads)
          .where(and(inArray(threads.senderId, senderIds), owned()))
          .groupBy(threads.senderId, threads.projectId)
      : [],
    domains.length
      ? db
          .select({ key: domainOf, projectId: threads.projectId, n: once })
          .from(threads)
          .innerJoin(senders, eq(senders.id, threads.senderId))
          .where(and(inArray(domainOf, domains), owned()))
          .groupBy(domainOf, threads.projectId)
      : [],
  ]);
  const senderTally = tallies(bySender);
  const domainTally = tallies(byDomain);

  let moved = 0;
  let asked = 0;
  for (const t of batch) {
    const eligible = new Set(
      all
        .filter((p) => (!p.since || t.lastMessageAt >= p.since) && !dismissed.some((d) => d.threadId === t.id && d.projectId === p.id))
        .map((p) => p.id),
    );
    const evidence: ProjectEvidence = {
      sender: t.senderId ? without(senderTally.get(t.senderId)) : undefined,
      domain: without(domainTally.get(orgDomain(t.email) ?? "")),
    };
    let call = eligible.size ? decideProject(evidence, eligible) : null;
    // Meaning only ever asks, so it is worth a vector search only where nothing sure was found and the owner would see the question.
    if (eligible.size && !call?.sure && !t.archived) {
      const near = await neighborTally(db, t.id);
      if (near) call = call ?? decideProject({ neighbors: near }, eligible);
    }

    await db.transaction(async (tx) => {
      // Re-check: the owner may have placed it while this pass ran.
      const open = and(eq(threads.id, t.id), isNull(threads.projectId));
      if (call?.sure) {
        const done = await tx
          .update(threads)
          .set({ projectId: call.projectId, projectSource: "ai", projectSuggestedId: null, projectCheckedAt: now })
          .where(open)
          .returning({ id: threads.id, accountId: threads.accountId });
        if (!done.length) return;
        // Its twins follow, so the conversation sits in one place.
        const twins = t.groupId
          ? await tx
              .update(threads)
              .set({ projectId: call.projectId, projectSource: "ai", projectSuggestedId: null, projectCheckedAt: now })
              .where(and(eq(threads.groupId, t.groupId), ne(threads.id, t.id), isNull(threads.projectId)))
              .returning({ id: threads.id, accountId: threads.accountId })
          : [];
        for (const row of [...done, ...twins]) await enqueueWriteback(tx, row);
        moved++;
      } else if (call && !t.archived) {
        await tx.update(threads).set({ projectSuggestedId: call.projectId, projectCheckedAt: now }).where(open);
        asked++;
      } else {
        await tx.update(threads).set({ projectCheckedAt: now }).where(eq(threads.id, t.id));
      }
    });
  }
  return { moved, asked };
}

/** Every thread is read again on the next passes: a project was made or its evidence changed a lot. */
export async function resortProjects(db: Pick<Db, "update">, since?: Date | null) {
  await db
    .update(threads)
    .set({ projectCheckedAt: null })
    .where(and(isNull(threads.projectId), since ? gte(threads.lastMessageAt, since) : undefined));
}
