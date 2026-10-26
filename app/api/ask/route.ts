import { NextResponse } from "next/server";

import { scope } from "@/app/(mail)/_lib/scope";
import type { AskEvent } from "@/lib/ai/ask";
import { db } from "@/lib/db";
import { runAsk, type AskInput } from "@/lib/search";

export const maxDuration = 60;

const MAX_QUESTION = 500;
const DAY = /^\d{4}-\d{2}-\d{2}$/;

function validTimeZone(value: unknown): value is string {
  if (typeof value !== "string" || !value) return false;
  try {
    new Intl.DateTimeFormat("en", { timeZone: value });
    return true;
  } catch {
    return false;
  }
}

function askInput(body: unknown): AskInput | null {
  const b = (body ?? {}) as { question?: unknown; today?: unknown; timeZone?: unknown };
  if (typeof b.question !== "string" || b.question.length < 1 || b.question.length > MAX_QUESTION) return null;
  if (typeof b.today !== "string" || !DAY.test(b.today) || Number.isNaN(Date.parse(b.today))) return null;
  if (!validTimeZone(b.timeZone)) return null;
  return { question: b.question, today: b.today, timeZone: b.timeZone };
}

// A question from the palette: plan, retrieve, answer, streamed as AskEvent lines. Closing the
// palette aborts the request, which stops the Claude call.
export async function POST(request: Request) {
  const input = askInput(await request.json().catch(() => null));
  if (!input) return NextResponse.json({ error: "bad question" }, { status: 400 });
  if (!process.env.ANTHROPIC_API_KEY) return NextResponse.json({ error: "ask needs ANTHROPIC_API_KEY" }, { status: 503 });

  const s = await scope();
  const encoder = new TextEncoder();
  let closed = false;
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (event: AskEvent) => {
        if (!closed) controller.enqueue(encoder.encode(`${JSON.stringify(event)}\n`));
      };
      try {
        for await (const event of runAsk(db, input, s, { signal: request.signal })) {
          if (closed) break;
          send(event);
        }
      } catch (error) {
        if (!request.signal.aborted) {
          console.error("ask failed", error);
          send({ type: "error", message: error instanceof Error ? error.message : "ask failed" });
        }
      }
      if (!closed) {
        closed = true;
        controller.close();
      }
    },
    cancel() {
      closed = true;
    },
  });
  return new Response(stream, { headers: { "content-type": "application/x-ndjson", "cache-control": "no-store" } });
}
