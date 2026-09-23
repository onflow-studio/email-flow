import { randomBytes } from "node:crypto";

import { NextResponse, type NextRequest } from "next/server";

import { buildAuthUrl } from "@/lib/gmail/oauth";

import { STATE_COOKIE } from "../state";

export async function GET(request: NextRequest) {
  const state = randomBytes(24).toString("base64url");
  const hint = request.nextUrl.searchParams.get("hint") ?? undefined;
  let authUrl: string;
  try {
    authUrl = buildAuthUrl(state, hint);
  } catch (error) {
    console.error("google oauth start failed", error);
    const back = new URL("/settings", request.url);
    back.searchParams.set("error", "google oauth not configured, check .env");
    return NextResponse.redirect(back);
  }
  const response = NextResponse.redirect(authUrl);
  response.cookies.set(STATE_COOKIE, state, {
    httpOnly: true,
    sameSite: "lax",
    secure: request.nextUrl.protocol === "https:",
    path: "/api/auth/google",
    maxAge: 600,
  });
  return response;
}
