import type { Metadata } from "next";

import { entityActivity, liveEntities, openQuestions } from "../people-data";
import { PeopleSection } from "../people-section";

export const metadata: Metadata = { title: "people · settings · email-flow" };

export default async function PeoplePage() {
  const [entities, activity, questions] = await Promise.all([liveEntities(), entityActivity(), openQuestions()]);
  const byId = new Map(activity.map((row) => [row.entityId, row]));
  return <PeopleSection
    rows={entities.map((entity) => ({
      id: entity.id, type: entity.type, name: entity.name, aliases: entity.aliases,
      threadCount: byId.get(entity.id)?.threadCount ?? 0,
      lastActivity: byId.get(entity.id)?.lastActivity?.toISOString() ?? null,
    }))}
    questions={questions}
    extractorConfigured={Boolean(process.env.ANTHROPIC_API_KEY)}
  />;
}
