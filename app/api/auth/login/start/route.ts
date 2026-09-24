import { randomBytes } from "node:crypto";

import { NextResponse, type NextRequest } from "next/server";

import { buildLoginUrl } from "@/lib/auth/google";

import { LOGIN_COOKIE_PATH, LOGIN_STATE_COOKIE, safeNext } from "../state";

export async function GET(request: NextRequest) {
  const state = randomBytes(24).toString("base64url");
  const next = safeNext(request.nextUrl.searchParams.get("next"));
  let authUrl: string;
  try {
    authUrl = buildLoginUrl(state);
  } catch (error) {
    console.error("google login start failed", error);
    const back = new URL("/login", request.url);
    back.searchParams.set("error", "google login not configured, check .env");
    return NextResponse.redirect(back);
  }
  const response = NextResponse.redirect(authUrl);
  response.cookies.set(LOGIN_STATE_COOKIE, `${state}|${next}`, {
    httpOnly: true,
    sameSite: "lax",
    secure: request.nextUrl.protocol === "https:",
    path: LOGIN_COOKIE_PATH,
    maxAge: 600,
  });
  return response;
}
