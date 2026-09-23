import { loadEnvConfig } from "@next/env";

loadEnvConfig(process.cwd());

// One-off: apply "participation beats the screener" to mail synced before the rule existed.
// pnpm participation [--dry-run]
// Every thread the user wrote in gets its undecided senders let in by AI, and leaves triage for inbox
// if it was held there. Idempotent: a second run finds nothing. Each thread is logged in actions_log
// like live sync does, so its batch undoes it, and moves enqueue Gmail writeback.

async function main() {
  const { and, asc, eq, exists, or } = await import("drizzle-orm");
  const { db } = await import("@/lib/db");
  const { messages, senders, threads } = await import("@/lib/db/schema");
  const { applyParticipation, loadParticipation, participationPlan } = await import("@/lib/classify/participation");

  const dryRun = process.argv.includes("--dry-run");

  const wrote = exists(
    db.select({ one: messages.id }).from(messages).where(and(eq(messages.threadId, threads.id), eq(messages.isInbound, false))),
  );
  const undecidedInbound = exists(
    db
      .select({ one: messages.id })
      .from(messages)
      .innerJoin(senders, eq(senders.id, messages.senderId))
      .where(and(eq(messages.threadId, threads.id), eq(messages.isInbound, true), eq(senders.screenerDecision, "none"))),
  );
  const candidates = await db
    .select({ id: threads.id, subject: threads.subject })
    .from(threads)
    .where(and(eq(threads.spam, false), wrote, or(eq(threads.bucket, "triage"), undecidedInbound)))
    .orderBy(asc(threads.lastMessageAt));

  // The dry run carries its own let-ins forward, so a sender shared by two threads is counted once.
  const simulated = new Set<string>();
  const senderNames = new Map<string, string>();
  let released = 0;

  for (const c of candidates) {
    const loaded = await loadParticipation(db, c.id);
    if (!loaded) continue;
    for (const id of simulated) loaded.input.states.set(id, { decision: "allowed", decidedBy: "ai" });
    const plan = participationPlan(loaded.input);
    if (!plan.letIn.length && !plan.release) continue;

    if (!dryRun) await db.transaction((tx) => applyParticipation(tx, c.id));
    for (const id of plan.letIn) {
      simulated.add(id);
      const n = loaded.found.names.get(id);
      senderNames.set(id, n?.name ? `${n.name} <${n.email}>` : (n?.email ?? id));
    }
    if (plan.release) released++;

    const who = plan.letIn.map((id) => senderNames.get(id)).join(", ");
    console.log(
      `${plan.release ? "triage -> inbox" : `stays ${loaded.input.bucket}`.padEnd(15)} | ${(c.subject ?? "(no subject)").slice(0, 60)}${who ? ` | let in: ${who}` : ""}`,
    );
  }

  console.log(
    `\n${dryRun ? "would let in" : "let in"} ${senderNames.size} senders, ${dryRun ? "would move" : "moved"} ${released} threads from triage to inbox`,
  );
  await db.$client.end();
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
