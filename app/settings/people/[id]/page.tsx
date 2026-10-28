import { eq } from "drizzle-orm";
import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";

import { db } from "@/lib/db";
import { entities } from "@/lib/db/schema";

import { EntitySection } from "../../entity-section";
import { entitySenders, entityThreads, liveEntities, openQuestions, relatedEntities } from "../../people-data";

export const metadata: Metadata = { title: "people · settings · email-flow" };

export default async function EntityPage({ params }: PageProps<"/settings/people/[id]">) {
  const { id } = await params;
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) notFound();
  const [entity] = await db.select().from(entities).where(eq(entities.id, id));
  if (!entity || entity.deletedAt) notFound();
  if (entity.mergedIntoId) redirect(`/settings/people/${entity.mergedIntoId}`);
  const [all, questions, senders, related, threads] = await Promise.all([
    liveEntities(), openQuestions(), entity.type === "person" ? entitySenders(id) : Promise.resolve([]), relatedEntities(id), entityThreads(id),
  ]);
  return <EntitySection
    entity={{ id: entity.id, type: entity.type, name: entity.name, aliases: entity.aliases, summary: entity.summary }}
    mergeTargets={all.filter((candidate) => candidate.id !== id && candidate.type === entity.type).map(({ id, name }) => ({ id, name }))}
    questions={questions.filter((question) => question.entityId === id || question.otherId === id)}
    senders={senders}
    related={related}
    threads={threads.map((thread) => ({ ...thread, lastMessageAt: thread.lastMessageAt.toISOString() }))}
  />;
}
