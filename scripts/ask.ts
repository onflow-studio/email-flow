import { loadEnvConfig } from "@next/env";

loadEnvConfig(process.cwd());

// A question over every account, as the palette asks it: pnpm ask "<question>" [--json]
// Prints the plan query, the numbered sources and the streamed answer; --json prints the events.

async function main() {
  const json = process.argv.includes("--json");
  const question = process.argv.slice(2).filter((a) => a !== "--json").join(" ").trim();
  if (!question) {
    console.error('usage: pnpm ask "<question>" [--json]');
    process.exit(1);
  }
  const { db } = await import("@/lib/db");
  const { runAsk } = await import("@/lib/search");

  const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const today = new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());

  for await (const event of runAsk(db, { question, today, timeZone }, {})) {
    if (json) {
      console.log(JSON.stringify(event));
      continue;
    }
    if (event.type === "plan") console.log(`${event.intent}: ${event.query || "(no query)"}\n`);
    if (event.type === "sources") {
      for (const s of event.sources) {
        const files = s.attachments.length ? `  [${s.attachments.join(", ")}]` : "";
        console.log(`[${s.n}] ${s.lastMessageAt.slice(0, 10)}  ${s.bucket}  ${s.subject}  ${s.sender}${files}`);
      }
      if (!event.sources.length) console.log("no sources");
      console.log("");
    }
    if (event.type === "list") console.log(`list: ${event.total} threads in the set, ${event.hits.length} shown\n`);
    if (event.type === "text") process.stdout.write(event.delta);
    if (event.type === "done") process.stdout.write("\n");
  }
  process.exit(0);
}

main().catch((error) => {
  console.error("ask failed", error);
  process.exit(1);
});
