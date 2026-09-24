import { NextResponse, type NextRequest } from "next/server";

import { verifyLogin } from "@/lib/auth/google";
import { createSessionToken, isAllowed, sessionCookie } from "@/lib/auth/session";

import { LOGIN_COOKIE_PATH, LOGIN_STATE_COOKIE, safeNext } from "../state";

function done(to: URL) {
  const response = NextResponse.redirect(to);
  response.cookies.delete({ name: LOGIN_STATE_COOKIE, path: LOGIN_COOKIE_PATH });
  return response;
}

function failed(request: NextRequest, error: string) {
  const url = new URL("/login", request.url);
  url.searchParams.set("error", error);
  return done(url);
}

export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  const [expected, next] = (request.cookies.get(LOGIN_STATE_COOKIE)?.value ?? "").split("|");

  if (params.get("error")) return failed(request, `google: ${params.get("error")}`);
  const code = params.get("code");
  if (!code || !expected || params.get("state") !== expected) {
    return failed(request, "login expired or tampered, try again");
  }

  let email: string;
  let token: string;
  try {
    email = await verifyLogin(code);
    token = createSessionToken(email);
  } catch (error) {
    console.error("google login callback failed", error);
    return failed(request, "login failed, check server log and retry");
  }
  if (!isAllowed(email)) return failed(request, `${email} is not allowed`);

  const response = done(new URL(safeNext(next), request.url));
  response.cookies.set(sessionCookie(token, request.nextUrl.protocol === "https:"));
  return response;
}
