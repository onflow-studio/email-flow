import { loadEnvConfig } from "@next/env";

loadEnvConfig(process.cwd());

// One-off: link twins synced before live sync did, and make each group's copies agree.
// pnpm twins [--dry-run]
// Threads of different accounts sharing a message by Message-ID get one group id. Where the copies
// disagree on user-set state, the copy the user acted on last wins (see reconcileGroup), logged as
// `reconcile` under one batch per group with writeback for Gmail. Idempotent: a second run changes
// nothing. The dry run does the same work in a transaction it rolls back.

class DryRun extends Error {}

async function main() {
  const { and, asc, eq, isNotNull, ne, sql } = await import("drizzle-orm");
  const { alias } = await import("drizzle-orm/pg-core");
  const { db } = await import("@/lib/db");
  const { accounts, messages, threads } = await import("@/lib/db/schema");
  const { linkTwins, reconcileGroup } = await import("@/lib/sync/twins");

  const dryRun = process.argv.includes("--dry-run");
  const other = alias(messages, "other");
  const otherThread = alias(threads, "other_thread");
  const messageId = (m: { headers: unknown }) => sql`${m.headers}->>'messageId'`;

  const lines: string[] = [];
  try {
    await db.transaction(async (tx) => {
      const candidates = await tx
        .selectDistinct({ id: threads.id })
        .from(messages)
        .innerJoin(threads, eq(threads.id, messages.threadId))
        .innerJoin(other, and(eq(messageId(other), messageId(messages)), isNotNull(messageId(messages))))
        .innerJoin(otherThread, and(eq(otherThread.id, other.threadId), ne(otherThread.accountId, threads.accountId)));

      let linked = 0;
      for (const c of candidates) if ((await linkTwins(tx, c.id)).linked) linked++;

      const groups = await tx
        .select({ groupId: threads.groupId, n: sql<number>`count(*)::int` })
        .from(threads)
        .where(isNotNull(threads.groupId))
        .groupBy(threads.groupId);

      const label = async (id: string) => {
        const [t] = await tx
          .select({ subject: threads.subject, account: accounts.label })
          .from(threads)
          .innerJoin(accounts, eq(accounts.id, threads.accountId))
          .where(eq(threads.id, id))
          .orderBy(asc(threads.id));
        return `${t.account} ${id.slice(0, 8)} "${(t.subject ?? "(no subject)").slice(0, 50)}"`;
      };

      let reconciled = 0;
      for (const g of groups) {
        const r = await reconcileGroup(tx, g.groupId!);
        if (!r?.changed.length) continue;
        reconciled++;
        for (const c of r.changed) {
          const what = Object.entries(c.patch)
            .map(([k, v]) => `${k}=${v instanceof Date ? v.toISOString() : v}`)
            .join(", ");
          lines.push(`${await label(c.id)} <- ${r.source.slice(0, 8)}: ${what}`);
        }
      }

      lines.push(
        `\n${candidates.length} threads with a twin, ${linked} newly linked, ${groups.length} groups, ${reconciled} ${dryRun ? "would be reconciled" : "reconciled"}`,
      );
      if (dryRun) throw new DryRun();
    });
  } catch (error) {
    if (!(error instanceof DryRun)) throw error;
  }
  console.log(lines.join("\n"));
  await db.$client.end();
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
