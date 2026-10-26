import { and, desc, eq, exists, gt, gte, inArray, isNotNull, isNull, lt, ne, not, notInArray, or, sql, type SQL } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";

import {
  buildEntityRequest,
  claudeExtractor,
  type EntityExtractor,
  type EntityMessage,
  type EntityProposal,
} from "@/lib/ai/entities";
import type { Db } from "@/lib/db";
import {
  accounts,
  entities,
  entityLinks,
  entityQuestions,
  jobs,
  messages,
  senders,
  threads,
  type Address,
  type Bucket,
  type Entity,
  type EntityLink,
  type Job,
  type NewEntityLink,
  type ScreenerDecision,
  type Thread,
} from "@/lib/db/schema";

import { PRIORITY_BACKFILL, PRIORITY_LIVE, enqueueJob, type JobContext } from "./jobs";
import { withTwins } from "./twins";

// The semantic layer: people, projects and companies read from Inbox and Receipts mail once it is
// placed. The model proposes, these helpers decide what it maps to, and user corrections always win:
// userEditedAt freezes an entity's names and summary, tombstones (merged or deleted) keep their names
// resolving, rejected links are never added back, and a "same as?" pair is only ever asked once.

type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];

export const ENTITY_BUCKETS: Bucket[] = ["inbox", "receipts"];
// The sync cron only reads recent mail; history goes through scripts/entities.ts, run on purpose.
export const ENTITY_LIVE_DAYS = 30;
export const ENTITY_BACKLOG_PER_PASS = 20;
export const CANDIDATE_LIMIT = 40;
// Newest messages read per call, so a long thread read for the first time stays one bounded call.
export const ENTITY_MESSAGE_LIMIT = 20;

const DAY_MS = 24 * 60 * 60_000;
const SCREENED_OUT: ScreenerDecision[] = ["out_spam", "out_not_now"];

/** Lowercase, accents stripped, anything not a letter or digit as one space. */
export function normalizeName(s: string): string {
  return s
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

export type CatalogEntity = Pick<Entity, "id" | "type" | "name" | "normName" | "aliases" | "mergedIntoId" | "deletedAt">;

export type EntityCatalog = {
  // Every entity, tombstones included.
  entities: CatalogEntity[];
  // Senders linked (not rejected) to person entities, by lowercased email.
  senderLinks: { email: string; entityId: string }[];
};

export type Resolution = { kind: "existing"; id: string } | { kind: "new" } | { kind: "suppressed" };

type Proposal = Pick<EntityProposal, "ref" | "type" | "name" | "aliases" | "emails">;

const lower = (s: string) => s.trim().toLowerCase();

/** The entity an id ends up as, through merges. Undefined when unknown. */
export function followMerges(id: string, byId: Map<string, CatalogEntity>): CatalogEntity | undefined {
  const seen = new Set<string>();
  let e = byId.get(id);
  while (e?.mergedIntoId && !seen.has(e.id)) {
    seen.add(e.id);
    e = byId.get(e.mergedIntoId);
  }
  return e;
}

function settled(e: CatalogEntity | undefined): Resolution | null {
  if (!e) return null;
  return e.deletedAt ? { kind: "suppressed" } : { kind: "existing", id: e.id };
}

function namesOf(e: Pick<CatalogEntity, "normName" | "aliases">): string[] {
  return [e.normName, ...e.aliases.map(normalizeName)].filter(Boolean);
}

/** What a proposed entity maps to: a known id, then a known address, then a known name, else new. */
export function resolveProposal(proposal: Proposal, catalog: EntityCatalog, ownAddresses: string[]): Resolution {
  const byId = new Map(catalog.entities.map((e) => [e.id, e]));
  const byRef = byId.has(proposal.ref) ? settled(followMerges(proposal.ref, byId)) : null;
  if (byRef) return byRef;

  const own = new Set(ownAddresses.map(lower));
  const emails = proposal.type === "person" ? proposal.emails.map(lower).filter((e) => e && !own.has(e)) : [];
  for (const email of emails) {
    const link = catalog.senderLinks.find((l) => l.email === email);
    const linked = link ? followMerges(link.entityId, byId) : undefined;
    const byEmail = linked?.type === "person" ? settled(linked) : null;
    if (byEmail) return byEmail;
  }

  const names = new Set([proposal.name, ...proposal.aliases].map(normalizeName).filter(Boolean));
  const matched = catalog.entities
    .filter((e) => e.type === proposal.type && namesOf(e).some((n) => names.has(n)))
    .flatMap((e) => followMerges(e.id, byId) ?? []);
  // A live entity beats a tombstone that shares the name.
  const alive = matched.find((e) => !e.deletedAt);
  if (alive) return { kind: "existing", id: alive.id };
  if (matched.length) return { kind: "suppressed" };

  if (proposal.type === "person" && proposal.emails.some((e) => lower(e)) && emails.length === 0) {
    return { kind: "suppressed" };
  }
  return { kind: "new" };
}

/** `current` plus `more`, without the name itself or repeats, compared normalized. */
export function joinAliases(name: string, current: string[], more: string[]): string[] {
  const seen = new Set([normalizeName(name)]);
  const out: string[] = [];
  for (const raw of [...current, ...more]) {
    const alias = raw.trim();
    const norm = normalizeName(alias);
    if (!norm || seen.has(norm)) continue;
    seen.add(norm);
    out.push(alias);
  }
  return out;
}

/** What extraction changes on an existing entity; null when nothing, or when the user edited it. */
export function planEntityUpdate(
  entity: Pick<Entity, "name" | "aliases" | "summary" | "userEditedAt">,
  proposal: Pick<EntityProposal, "name" | "aliases" | "summary">,
): { aliases: string[]; summary: string | null } | null {
  if (entity.userEditedAt) return null;
  const aliases = joinAliases(entity.name, entity.aliases, [proposal.name, ...proposal.aliases]);
  const summary = proposal.summary?.trim() || entity.summary;
  const sameAliases = aliases.length === entity.aliases.length && aliases.every((a, i) => a === entity.aliases[i]);
  if (sameAliases && summary === entity.summary) return null;
  return { aliases, summary };
}

export type LinkTarget = Pick<EntityLink, "entityId"> &
  Partial<Pick<EntityLink, "threadId" | "messageId" | "senderId" | "otherEntityId">>;

function linkKey(l: LinkTarget): string {
  if (l.threadId) return `${l.entityId} thread ${l.threadId}`;
  if (l.messageId) return `${l.entityId} message ${l.messageId}`;
  if (l.senderId) return `${l.entityId} sender ${l.senderId}`;
  return `${l.entityId} entity ${l.otherEntityId}`;
}

/** Links to insert: any target already linked, rejected or not, is skipped, and so are repeats. */
export function planLinks<L extends LinkTarget>(existing: LinkTarget[], wanted: L[]): L[] {
  const seen = new Set(existing.map(linkKey));
  return wanted.filter((l) => {
    const key = linkKey(l);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export function orderedPair(a: string, b: string): [string, string] {
  return a < b ? [a, b] : [b, a];
}

/** The pair to ask about, ordered as stored; null when it is one entity or was ever asked before. */
export function questionPair(
  a: string,
  b: string,
  asked: { entityId: string; otherEntityId: string }[] = [],
): [string, string] | null {
  if (a === b) return null;
  const [lo, hi] = orderedPair(a, b);
  return asked.some((q) => q.entityId === lo && q.otherEntityId === hi) ? null : [lo, hi];
}

export type EntityThread = Pick<Thread, "bucket" | "bucketSource" | "spam" | "trashed" | "lastMessageAt" | "entitiesMessageAt"> & {
  screenerDecision: ScreenerDecision | null;
};

/** Placed Inbox or Receipts mail from a sender not screened out, with messages extraction has not read. SQL twin: `wantsEntitiesWhere`. */
export function wantsEntities(thread: EntityThread): boolean {
  return (
    ENTITY_BUCKETS.includes(thread.bucket) &&
    thread.bucketSource !== null &&
    !thread.spam &&
    !thread.trashed &&
    !(thread.screenerDecision !== null && SCREENED_OUT.includes(thread.screenerDecision)) &&
    (thread.entitiesMessageAt === null || thread.entitiesMessageAt < thread.lastMessageAt)
  );
}

/** `wantsEntities` over `threads` left joined to `senders` on the thread's sender. */
export function wantsEntitiesWhere(): SQL {
  return and(
    inArray(threads.bucket, ENTITY_BUCKETS),
    isNotNull(threads.bucketSource),
    eq(threads.spam, false),
    eq(threads.trashed, false),
    or(isNull(senders.screenerDecision), notInArray(senders.screenerDecision, SCREENED_OUT)),
    or(isNull(threads.entitiesMessageAt), lt(threads.entitiesMessageAt, threads.lastMessageAt)),
  )!;
}

const entitiesKey = (thread: { id: string; groupId: string | null }) => `entities:${thread.groupId ?? thread.id}`;

/** One job per conversation: twin copies share the key, so they are read once. */
export function enqueueEntities(
  db: Pick<Db, "insert">,
  thread: { id: string; accountId: string; groupId: string | null },
  priority = PRIORITY_LIVE,
) {
  return enqueueJob(db, {
    type: "entities",
    accountId: thread.accountId,
    payload: { threadId: thread.id },
    priority,
    dedupeKey: entitiesKey(thread),
  });
}

/**
 * The live sweep, run each sync pass when the AI key is set: the newest recent threads that want
 * extraction and have no entities job waiting or failed. Returns how many jobs it queued.
 */
export async function enqueueEntityBacklog(
  db: Db,
  accountId: string,
  limit = ENTITY_BACKLOG_PER_PASS,
  now = new Date(),
): Promise<number> {
  const queued = db
    .select({ one: sql`1` })
    .from(jobs)
    .where(
      and(
        eq(jobs.type, "entities"),
        inArray(jobs.status, ["pending", "running", "failed"]),
        eq(jobs.dedupeKey, sql`'entities:' || coalesce(${threads.groupId}, ${threads.id})::text`),
      ),
    );
  const rows = await db
    .select({ id: threads.id, accountId: threads.accountId, groupId: threads.groupId })
    .from(threads)
    .leftJoin(senders, eq(senders.id, threads.senderId))
    .where(
      and(
        eq(threads.accountId, accountId),
        wantsEntitiesWhere(),
        gte(threads.lastMessageAt, new Date(now.getTime() - ENTITY_LIVE_DAYS * DAY_MS)),
        not(exists(queued)),
      ),
    )
    .orderBy(desc(threads.lastMessageAt))
    .limit(limit);
  const keys = new Set<string>();
  for (const row of rows) {
    if (keys.has(entitiesKey(row))) continue;
    keys.add(entitiesKey(row));
    await enqueueEntities(db, row, PRIORITY_BACKFILL);
  }
  return keys.size;
}

export async function entitiesJob(job: Job, ctx: JobContext) {
  const { threadId } = job.payload as { threadId?: string };
  if (!threadId) throw new Error("entities job without threadId");
  await extractEntities(ctx.db, threadId, ctx.extract);
}

export type EntityRun = { entities: number; created: number; links: number; questions: number; raw: unknown };

type ReadMessage = EntityMessage & { ids: string[] };

/**
 * Read a thread and its twin copies for entities and store what was found. Null when skipped: the
 * thread does not want it, or no new message was left to read.
 */
export async function extractEntities(
  db: Db,
  threadId: string,
  extract: EntityExtractor = claudeExtractor,
): Promise<EntityRun | null> {
  const copies = await db
    .select({
      id: threads.id,
      bucket: threads.bucket,
      bucketSource: threads.bucketSource,
      spam: threads.spam,
      trashed: threads.trashed,
      lastMessageAt: threads.lastMessageAt,
      entitiesMessageAt: threads.entitiesMessageAt,
      screenerDecision: senders.screenerDecision,
    })
    .from(threads)
    .leftJoin(senders, eq(senders.id, threads.senderId))
    .where(inArray(threads.id, await withTwins(db, [threadId])));
  if (!copies.some(wantsEntities)) return null;
  const copyIds = copies.map((c) => c.id);

  const read = await readMessages(db, copyIds, copies);
  if (!read.length) {
    await db.transaction((tx) => markRead(tx, copies));
    return null;
  }

  const own = (await db.select({ email: accounts.email }).from(accounts)).map((a) => lower(a.email));
  const ownSet = new Set(own);
  const catalog = await db
    .select({
      id: entities.id,
      type: entities.type,
      name: entities.name,
      normName: entities.normName,
      aliases: entities.aliases,
      summary: entities.summary,
      userEditedAt: entities.userEditedAt,
      mergedIntoId: entities.mergedIntoId,
      deletedAt: entities.deletedAt,
    })
    .from(entities);
  const byId = new Map(catalog.map((e) => [e.id, e]));

  const candidates = await findCandidates(db, read, catalog, byId, ownSet);
  const response = await extract(buildEntityRequest({ ownAddresses: own, candidates, messages: read }));
  const proposals = response.output.entities;

  const proposedEmails = [
    ...new Set(proposals.flatMap((p) => (p.type === "person" ? p.emails.map(lower) : [])).filter((e) => e && !ownSet.has(e))),
  ];

  return db.transaction(async (tx) => {
    const senderRows = proposedEmails.length
      ? await tx.select({ id: senders.id, email: senders.email }).from(senders).where(inArray(senders.email, proposedEmails))
      : [];
    const senderLinks = senderRows.length
      ? await tx
          .select({ email: senders.email, entityId: entityLinks.entityId })
          .from(entityLinks)
          .innerJoin(senders, eq(senders.id, entityLinks.senderId))
          .innerJoin(entities, eq(entities.id, entityLinks.entityId))
          .where(
            and(
              inArray(entityLinks.senderId, senderRows.map((s) => s.id)),
              eq(entityLinks.rejected, false),
              eq(entities.type, "person"),
            ),
          )
      : [];
    const known: EntityCatalog = { entities: catalog, senderLinks };

    const refs = new Map<string, string>();
    const wanted: NewEntityLink[] = [];
    const unsure: { id: string; other: string; question: string }[] = [];
    let created = 0;

    for (const p of proposals) {
      const name = p.name.trim();
      if (!normalizeName(name)) continue;
      const resolution = resolveProposal(p, known, own);
      if (resolution.kind === "suppressed") continue;

      let id: string;
      if (resolution.kind === "existing") {
        id = resolution.id;
        const entity = byId.get(id)!;
        const patch = planEntityUpdate(entity, p);
        if (patch) {
          await tx.update(entities).set(patch).where(and(eq(entities.id, id), isNull(entities.userEditedAt)));
          Object.assign(entity, patch);
        }
      } else {
        const [row] = await tx
          .insert(entities)
          .values({
            type: p.type,
            name,
            normName: normalizeName(name),
            aliases: joinAliases(name, [], p.aliases),
            summary: p.summary?.trim() || null,
          })
          .returning();
        id = row.id;
        created++;
        // Later proposals in this answer with the same name land on it.
        catalog.push(row);
        byId.set(id, row);
        if (p.unsureOf) unsure.push({ id, other: p.unsureOf.id, question: p.unsureOf.question });
      }
      refs.set(p.ref, id);

      for (const copyId of copyIds) wanted.push({ entityId: id, threadId: copyId, source: "ai" });
      for (const index of p.messages) {
        for (const messageId of read[index]?.ids ?? []) wanted.push({ entityId: id, messageId, source: "ai" });
      }
      if (p.type === "person") {
        const emails = new Set(p.emails.map(lower));
        for (const s of senderRows) {
          if (!emails.has(s.email)) continue;
          wanted.push({ entityId: id, senderId: s.id, source: "ai" });
          senderLinks.push({ email: s.email, entityId: id });
        }
      }
    }

    for (const r of response.output.relations) {
      const from = refs.get(r.from);
      const to = refs.get(r.to);
      const relation = r.relation.trim();
      if (from && to && from !== to && relation) wanted.push({ entityId: from, otherEntityId: to, relation, source: "ai" });
    }

    const links = planLinks(await existingLinks(tx, wanted), wanted);
    if (links.length) await tx.insert(entityLinks).values(links).onConflictDoNothing();

    let questions = 0;
    for (const u of unsure) {
      const other = followMerges(u.other, byId);
      if (!other || other.deletedAt || !u.question.trim()) continue;
      const [lo, hi] = orderedPair(u.id, other.id);
      const asked = await tx
        .select({ entityId: entityQuestions.entityId, otherEntityId: entityQuestions.otherEntityId })
        .from(entityQuestions)
        .where(and(eq(entityQuestions.entityId, lo), eq(entityQuestions.otherEntityId, hi)));
      const pair = questionPair(u.id, other.id, asked);
      if (!pair) continue;
      const inserted = await tx
        .insert(entityQuestions)
        .values({ entityId: pair[0], otherEntityId: pair[1], question: u.question.trim(), threadId })
        .onConflictDoNothing()
        .returning({ id: entityQuestions.id });
      questions += inserted.length;
    }

    await markRead(tx, copies);
    return { entities: refs.size, created, links: links.length, questions, raw: response.raw };
  });
}

/** Messages of every copy after the earliest point extraction covered, one per Message-ID, newest kept. */
async function readMessages(
  db: Db,
  copyIds: string[],
  copies: { entitiesMessageAt: Date | null }[],
): Promise<ReadMessage[]> {
  const since = copies.some((c) => c.entitiesMessageAt === null)
    ? null
    : new Date(Math.min(...copies.map((c) => c.entitiesMessageAt!.getTime())));
  const rows = await db
    .select({
      id: messages.id,
      fromEmail: messages.fromEmail,
      fromName: messages.fromName,
      to: messages.to,
      cc: messages.cc,
      date: messages.date,
      subject: messages.subject,
      text: messages.text,
      messageId: sql<string | null>`${messages.headers}->>'messageId'`,
    })
    .from(messages)
    .where(and(inArray(messages.threadId, copyIds), since ? gt(messages.date, since) : undefined))
    .orderBy(messages.date);
  const byKey = new Map<string, ReadMessage>();
  for (const m of rows) {
    const key = m.messageId || `id:${m.id}`;
    const seen = byKey.get(key);
    if (seen) {
      seen.ids.push(m.id);
      continue;
    }
    byKey.set(key, {
      ids: [m.id],
      from: { name: m.fromName, email: m.fromEmail },
      to: [...m.to, ...m.cc],
      date: m.date,
      subject: m.subject,
      text: m.text,
    });
  }
  return [...byKey.values()].slice(-ENTITY_MESSAGE_LIMIT);
}

/**
 * Known entities the model should reuse: those linked to the participants' senders, then those whose
 * name or an alias appears as a whole word in the mail. Through merges, deleted ones left out.
 */
async function findCandidates(
  db: Db,
  read: ReadMessage[],
  catalog: (CatalogEntity & Pick<Entity, "summary">)[],
  byId: Map<string, CatalogEntity & Pick<Entity, "summary">>,
  own: Set<string>,
) {
  const emails = [
    ...new Set(read.flatMap((m) => [m.from, ...m.to]).map((a: Address) => lower(a.email)).filter((e) => e && !own.has(e))),
  ];
  const linked = emails.length
    ? await db
        .selectDistinct({ entityId: entityLinks.entityId })
        .from(entityLinks)
        .innerJoin(senders, eq(senders.id, entityLinks.senderId))
        .where(and(inArray(senders.email, emails), eq(entityLinks.rejected, false)))
    : [];

  const text = ` ${normalizeName(read.map((m) => `${m.subject ?? ""} ${m.text ?? ""}`).join(" "))} `;
  const named = catalog.filter((e) => namesOf(e).some((n) => text.includes(` ${n} `))).map((e) => e.id);

  const out = new Map<string, CatalogEntity & Pick<Entity, "summary">>();
  for (const id of [...linked.map((l) => l.entityId), ...named]) {
    const e = followMerges(id, byId) as (CatalogEntity & Pick<Entity, "summary">) | undefined;
    if (e && !e.deletedAt) out.set(e.id, e);
    if (out.size >= CANDIDATE_LIMIT) break;
  }
  return [...out.values()].map((e) => ({ id: e.id, type: e.type, name: e.name, aliases: e.aliases, summary: e.summary }));
}

/** Targets the wanted links already have, rejected or not. */
async function existingLinks(tx: Tx, wanted: NewEntityLink[]): Promise<LinkTarget[]> {
  if (!wanted.length) return [];
  const ids = (k: "threadId" | "messageId" | "senderId" | "otherEntityId") => [
    ...new Set(wanted.flatMap((l) => (l[k] ? [l[k]] : []))),
  ];
  const targets = [
    [entityLinks.threadId, ids("threadId")],
    [entityLinks.messageId, ids("messageId")],
    [entityLinks.senderId, ids("senderId")],
    [entityLinks.otherEntityId, ids("otherEntityId")],
  ] as const;
  return tx
    .select({
      entityId: entityLinks.entityId,
      threadId: entityLinks.threadId,
      messageId: entityLinks.messageId,
      senderId: entityLinks.senderId,
      otherEntityId: entityLinks.otherEntityId,
    })
    .from(entityLinks)
    .where(
      and(
        inArray(entityLinks.entityId, [...new Set(wanted.map((l) => l.entityId))]),
        or(...targets.flatMap(([column, values]) => (values.length ? [inArray(column, values)] : []))),
      ),
    );
}

/** Only moves forward, like storeSummary: a slower call must not mark newer messages read. */
async function markRead(tx: Tx, copies: { id: string; lastMessageAt: Date }[]) {
  for (const c of copies) {
    await tx
      .update(threads)
      .set({ entitiesMessageAt: c.lastMessageAt })
      .where(and(eq(threads.id, c.id), or(isNull(threads.entitiesMessageAt), lt(threads.entitiesMessageAt, c.lastMessageAt))));
  }
}

// User edits. Each one sets userEditedAt, so extraction never changes the names or summary again.

async function loadEntity(db: Db | Tx, id: string): Promise<Entity> {
  const [entity] = await db.select().from(entities).where(eq(entities.id, id));
  if (!entity) throw new Error(`entity ${id} not found`);
  return entity;
}

/** New name; the old one stays as an alias so mail that uses it still finds the entity. */
export async function renameEntity(db: Db, id: string, name: string, now = new Date()) {
  const entity = await loadEntity(db, id);
  const next = name.trim();
  if (!normalizeName(next)) throw new Error("an entity needs a name");
  await db
    .update(entities)
    .set({ name: next, normName: normalizeName(next), aliases: joinAliases(next, entity.aliases, [entity.name]), userEditedAt: now })
    .where(eq(entities.id, id));
}

export async function setAliases(db: Db, id: string, aliases: string[], now = new Date()) {
  const entity = await loadEntity(db, id);
  await db
    .update(entities)
    .set({ aliases: joinAliases(entity.name, [], aliases), userEditedAt: now })
    .where(eq(entities.id, id));
}

export async function setSummary(db: Db, id: string, summary: string | null, now = new Date()) {
  await db
    .update(entities)
    .set({ summary: summary?.trim() || null, userEditedAt: now })
    .where(eq(entities.id, id));
}

/**
 * Fold the loser into the winner. Links move unless the winner already has the target (a rejected
 * one stays rejected), names join, and the loser stays as a tombstone pointing at the winner so
 * extraction resolves its names there. Questions between the two are answered; the loser's others
 * move to the winner unless the winner was already asked about that pair.
 */
export async function mergeEntities(db: Db, winnerId: string, loserId: string, now = new Date()) {
  await db.transaction(async (tx) => {
    const rows = await tx.select().from(entities).where(inArray(entities.id, [winnerId, loserId]));
    const winner = rows.find((e) => e.id === winnerId);
    const loser = rows.find((e) => e.id === loserId);
    if (!winner || !loser || winnerId === loserId) throw new Error("a merge needs two entities");
    if (winner.type !== loser.type) throw new Error("only entities of the same type merge");
    if (winner.mergedIntoId || winner.deletedAt || loser.mergedIntoId || loser.deletedAt) {
      throw new Error("a merged or deleted entity cannot merge");
    }

    const w = alias(entityLinks, "w");
    const winnerHas = tx
      .select({ one: sql`1` })
      .from(w)
      .where(
        and(
          eq(w.entityId, winnerId),
          or(
            eq(w.threadId, entityLinks.threadId),
            eq(w.messageId, entityLinks.messageId),
            eq(w.senderId, entityLinks.senderId),
            eq(w.otherEntityId, entityLinks.otherEntityId),
          ),
        ),
      );
    await tx
      .delete(entityLinks)
      .where(and(eq(entityLinks.entityId, loserId), or(eq(entityLinks.otherEntityId, winnerId), exists(winnerHas))));
    await tx.update(entityLinks).set({ entityId: winnerId }).where(eq(entityLinks.entityId, loserId));

    // Other entities' relations to the loser now point at the winner.
    const alreadyRelated = tx
      .select({ one: sql`1` })
      .from(w)
      .where(and(eq(w.entityId, entityLinks.entityId), eq(w.otherEntityId, winnerId)));
    await tx
      .delete(entityLinks)
      .where(
        and(eq(entityLinks.otherEntityId, loserId), or(eq(entityLinks.entityId, winnerId), exists(alreadyRelated))),
      );
    await tx.update(entityLinks).set({ otherEntityId: winnerId }).where(eq(entityLinks.otherEntityId, loserId));

    await tx
      .update(entities)
      .set({
        aliases: joinAliases(winner.name, winner.aliases, [loser.name, ...loser.aliases]),
        summary: winner.summary ?? loser.summary,
        userEditedAt: now,
      })
      .where(eq(entities.id, winnerId));
    await tx
      .update(entities)
      .set({ mergedIntoId: winnerId })
      .where(or(eq(entities.id, loserId), eq(entities.mergedIntoId, loserId)));

    const [lo, hi] = orderedPair(winnerId, loserId);
    await tx
      .update(entityQuestions)
      .set({ status: "same", answeredAt: now })
      .where(and(eq(entityQuestions.entityId, lo), eq(entityQuestions.otherEntityId, hi)));

    const others = await tx
      .select({ id: entityQuestions.id, entityId: entityQuestions.entityId, otherEntityId: entityQuestions.otherEntityId })
      .from(entityQuestions)
      .where(
        and(
          or(eq(entityQuestions.entityId, loserId), eq(entityQuestions.otherEntityId, loserId)),
          not(and(eq(entityQuestions.entityId, lo), eq(entityQuestions.otherEntityId, hi))!),
        ),
      );
    for (const q of others) {
      const other = q.entityId === loserId ? q.otherEntityId : q.entityId;
      const [a, b] = orderedPair(winnerId, other);
      const asked = await tx
        .select({ entityId: entityQuestions.entityId, otherEntityId: entityQuestions.otherEntityId })
        .from(entityQuestions)
        .where(and(eq(entityQuestions.entityId, a), eq(entityQuestions.otherEntityId, b)));
      if (questionPair(winnerId, other, asked)) {
        await tx.update(entityQuestions).set({ entityId: a, otherEntityId: b }).where(eq(entityQuestions.id, q.id));
      } else {
        await tx.delete(entityQuestions).where(eq(entityQuestions.id, q.id));
      }
    }
  });
}

/** Tombstone: its links go, its open questions are dismissed, and its names keep extraction from recreating it. */
export async function deleteEntity(db: Db, id: string, now = new Date()) {
  await db.transaction(async (tx) => {
    await tx.update(entities).set({ deletedAt: now }).where(eq(entities.id, id));
    await tx.delete(entityLinks).where(or(eq(entityLinks.entityId, id), eq(entityLinks.otherEntityId, id)));
    await tx
      .update(entityQuestions)
      .set({ status: "dismissed", answeredAt: now })
      .where(
        and(eq(entityQuestions.status, "open"), or(eq(entityQuestions.entityId, id), eq(entityQuestions.otherEntityId, id))),
      );
  });
}

/** Remove a thread from an entity, on every twin copy. The rows stay, rejected, so extraction never adds them back. */
export async function unlinkThread(db: Db, entityId: string, threadId: string) {
  const copies = await withTwins(db, [threadId]);
  if (!copies.length) return;
  await db
    .insert(entityLinks)
    .values(copies.map((id) => ({ entityId, threadId: id, source: "user" as const, rejected: true })))
    .onConflictDoUpdate({
      target: [entityLinks.entityId, entityLinks.threadId],
      set: { rejected: true, source: "user" },
    });
}

/** Same merges the pair into the older entity; different means the pair is never asked again. */
export async function answerQuestion(db: Db, id: string, same: boolean, now = new Date()) {
  const [question] = await db.select().from(entityQuestions).where(eq(entityQuestions.id, id));
  if (!question) throw new Error(`question ${id} not found`);
  if (!same) {
    await db.update(entityQuestions).set({ status: "different", answeredAt: now }).where(eq(entityQuestions.id, id));
    return;
  }
  const pair = await db
    .select({ id: entities.id, createdAt: entities.createdAt })
    .from(entities)
    .where(inArray(entities.id, [question.entityId, question.otherEntityId]));
  const [older, newer] = pair.sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime() || (a.id < b.id ? -1 : 1));
  await mergeEntities(db, older.id, newer.id, now);
}

export async function dismissQuestion(db: Db, id: string, now = new Date()) {
  await db
    .update(entityQuestions)
    .set({ status: "dismissed", answeredAt: now })
    .where(and(eq(entityQuestions.id, id), ne(entityQuestions.status, "dismissed")));
}
