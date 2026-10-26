import { alias } from "drizzle-orm/pg-core";
import { and, desc, eq, inArray, isNull, or, sql } from "drizzle-orm";

import { db } from "@/lib/db";
import { accounts, entities, entityLinks, entityQuestions, senderAccounts, senders, threads } from "@/lib/db/schema";

export async function liveEntities() {
  return db.select().from(entities).where(and(isNull(entities.deletedAt), isNull(entities.mergedIntoId)));
}

export async function openQuestions() {
  const other = alias(entities, "question_other");
  return db
    .select({ id: entityQuestions.id, question: entityQuestions.question, entityId: entities.id, entityName: entities.name, otherId: other.id, otherName: other.name })
    .from(entityQuestions)
    .innerJoin(entities, eq(entities.id, entityQuestions.entityId))
    .innerJoin(other, eq(other.id, entityQuestions.otherEntityId))
    .where(and(eq(entityQuestions.status, "open"), isNull(entities.deletedAt), isNull(entities.mergedIntoId), isNull(other.deletedAt), isNull(other.mergedIntoId)))
    .orderBy(entityQuestions.createdAt);
}

export type QuestionRow = Awaited<ReturnType<typeof openQuestions>>[number];

export async function entityActivity() {
  return db
    .select({
      entityId: entityLinks.entityId,
      threadCount: sql<number>`count(distinct coalesce(${threads.groupId}, ${threads.id}))::int`,
      lastActivity: sql<Date | null>`max(${threads.lastMessageAt})`,
    })
    .from(entityLinks)
    .innerJoin(threads, eq(threads.id, entityLinks.threadId))
    .where(eq(entityLinks.rejected, false))
    .groupBy(entityLinks.entityId);
}

export async function entitySenders(id: string) {
  return db
    .select({ email: senders.email, color: accounts.color, accountId: accounts.id })
    .from(entityLinks)
    .innerJoin(senders, eq(senders.id, entityLinks.senderId))
    .leftJoin(senderAccounts, eq(senderAccounts.senderId, senders.id))
    .leftJoin(accounts, eq(accounts.id, senderAccounts.accountId))
    .where(and(eq(entityLinks.entityId, id), eq(entityLinks.rejected, false)))
    .orderBy(senders.email);
}

export async function relatedEntities(id: string) {
  const other = alias(entities, "related_other");
  const outward = await db
    .select({ id: other.id, name: other.name, relation: entityLinks.relation })
    .from(entityLinks)
    .innerJoin(other, eq(other.id, entityLinks.otherEntityId))
    .where(and(eq(entityLinks.entityId, id), eq(entityLinks.rejected, false), isNull(other.deletedAt), isNull(other.mergedIntoId)));
  const inward = await db
    .select({ id: entities.id, name: entities.name, relation: entityLinks.relation })
    .from(entityLinks)
    .innerJoin(entities, eq(entities.id, entityLinks.entityId))
    .where(and(eq(entityLinks.otherEntityId, id), eq(entityLinks.rejected, false), isNull(entities.deletedAt), isNull(entities.mergedIntoId)));
  return [...outward, ...inward];
}

export async function entityThreads(id: string) {
  const linked = await db
    .select({ id: threads.id, groupId: threads.groupId })
    .from(entityLinks)
    .innerJoin(threads, eq(threads.id, entityLinks.threadId))
    .where(and(eq(entityLinks.entityId, id), eq(entityLinks.rejected, false)));
  if (!linked.length) return [];
  const groups = linked.flatMap((row) => row.groupId ? [row.groupId] : []);
  const singles = linked.flatMap((row) => row.groupId ? [] : [row.id]);
  const copies = await db
    .select({ id: threads.id, groupId: threads.groupId, subject: threads.subject, lastMessageAt: threads.lastMessageAt, color: accounts.color })
    .from(threads)
    .innerJoin(accounts, eq(accounts.id, threads.accountId))
    .where(or(groups.length ? inArray(threads.groupId, groups) : undefined, singles.length ? inArray(threads.id, singles) : undefined))
    .orderBy(desc(threads.lastMessageAt));
  const byGroup = new Map<string, { id: string; subject: string | null; lastMessageAt: Date; copies: { id: string; color: string }[] }>();
  for (const row of copies) {
    const key = row.groupId ?? row.id;
    const group = byGroup.get(key);
    if (group) group.copies.push({ id: row.id, color: row.color });
    else byGroup.set(key, { id: row.id, subject: row.subject, lastMessageAt: row.lastMessageAt, copies: [{ id: row.id, color: row.color }] });
  }
  return [...byGroup.values()];
}
