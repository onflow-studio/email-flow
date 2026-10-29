"use server";

import { and, eq, isNull, sql } from "drizzle-orm";

import { db } from "@/lib/db";
import { entities, entityLinks, senders } from "@/lib/db/schema";

import { senderCard } from "./_lib/queries";

/**
 * Who an address is, for the person card: its sender standing when they ever wrote, and the
 * person it is linked to on the people pages. Null fields when the address never wrote.
 */
export async function personCard(email: unknown) {
  if (typeof email !== "string" || !email.includes("@") || email.length > 320) throw new Error("invalid address");
  const [sender] = await db
    .select({ id: senders.id })
    .from(senders)
    .where(eq(sql`lower(${senders.email})`, email.trim().toLowerCase()))
    .limit(1);
  if (!sender) return { sender: null, person: null };
  const [card, [person]] = await Promise.all([
    senderCard(sender.id),
    db
      .select({ id: sql<string>`coalesce(${entities.mergedIntoId}, ${entities.id})`, name: entities.name })
      .from(entityLinks)
      .innerJoin(entities, eq(entities.id, entityLinks.entityId))
      .where(and(eq(entityLinks.senderId, sender.id), eq(entityLinks.rejected, false), eq(entities.type, "person"), isNull(entities.deletedAt)))
      .limit(1),
  ]);
  return {
    sender: card ? { threadCount: card.threadCount, lastSeenAt: card.lastSeenAt, decision: card.decision, decidedBy: card.decidedBy } : null,
    person: person ?? null,
  };
}

export type PersonCardData = Awaited<ReturnType<typeof personCard>>;
