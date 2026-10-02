import { eq } from "drizzle-orm";
import { NextResponse, type NextRequest } from "next/server";

import { db } from "@/lib/db";
import { accounts } from "@/lib/db/schema";
import { isConnectable } from "@/lib/gmail/allowlist";
import { tokenColumns } from "@/lib/gmail/client";
import { defaultAccountStyle, exchangeCode } from "@/lib/gmail/oauth";

import { STATE_COOKIE } from "../state";

function back(request: NextRequest, params: Record<string, string>) {
  const url = new URL("/settings/accounts", request.url);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  const response = NextResponse.redirect(url);
  response.cookies.delete({ name: STATE_COOKIE, path: "/api/auth/google" });
  return response;
}

export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  const expected = request.cookies.get(STATE_COOKIE)?.value;

  if (params.get("error")) return back(request, { error: `google: ${params.get("error")}` });
  const code = params.get("code");
  if (!code || !expected || params.get("state") !== expected) {
    return back(request, { error: "connect expired or tampered, try again" });
  }

  try {
    const { email, tokens } = await exchangeCode(code);
    if (!isConnectable(email)) {
      return back(request, { error: `${email} is not allowed to connect, add it to CONNECTABLE_EMAILS` });
    }
    const columns = tokenColumns(tokens);
    const [existing] = await db
      .select({ id: accounts.id, refreshTokenEnc: accounts.refreshTokenEnc })
      .from(accounts)
      .where(eq(accounts.email, email));

    if (!columns.refreshTokenEnc && !existing?.refreshTokenEnc) {
      return back(request, { error: `no refresh token for ${email}, remove email-flow access in google account settings and connect again` });
    }

    await db
      .insert(accounts)
      .values({
        email,
        ...defaultAccountStyle(email, await db.select({ label: accounts.label, color: accounts.color }).from(accounts)),
        ...columns,
        lastSyncError: null,
      })
      .onConflictDoUpdate({
        target: accounts.email,
        set: { ...columns, lastSyncError: null },
      });

    return back(request, { connected: email });
  } catch (error) {
    console.error("google oauth callback failed", error);
    return back(request, { error: "connect failed, check server log and retry" });
  }
}
