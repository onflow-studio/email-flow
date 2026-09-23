import { createHash, timingSafeEqual } from "node:crypto";

import { NextResponse, type NextRequest } from "next/server";

import { syncAllAccounts } from "@/lib/sync";

// A first sync can pull a couple of weeks of mail.
export const maxDuration = 300;

function digest(value: string) {
  return createHash("sha256").update(value).digest();
}

function authorized(request: NextRequest): boolean {
  const secret = process.env.SYNC_SECRET;
  if (!secret) return false;
  const header = request.headers.get("authorization") ?? "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : "";
  return timingSafeEqual(digest(token), digest(secret));
}

// One sync pass. Vercel cron later, and anything else holding SYNC_SECRET.
export async function POST(request: NextRequest) {
  if (!authorized(request)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const accountId = request.nextUrl.searchParams.get("account") ?? undefined;
  const outcomes = await syncAllAccounts(accountId);
  const failed = outcomes.some((o) => o.status === "error");
  return NextResponse.json({ outcomes }, { status: failed ? 500 : 200 });
}

// Vercel cron calls GET with the same bearer header.
export const GET = POST;
