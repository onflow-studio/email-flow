import { NextResponse, type NextRequest } from "next/server";

import {
  authDisabled,
  createSessionToken,
  readSessionToken,
  SESSION_COOKIE,
  sessionCookie,
  shouldRenew,
  type Session,
} from "@/lib/auth/session";

// /api/sync carries its own bearer SYNC_SECRET; the login pages are how a session starts.
const PUBLIC = new Set(["/login", "/api/auth/login/start", "/api/auth/login/callback", "/api/sync"]);

function session(request: NextRequest): Session | null {
  try {
    return readSessionToken(request.cookies.get(SESSION_COOKIE)?.value);
  } catch (error) {
    console.error("session check failed", error);
    return null;
  }
}

/** One gate in front of every page, route handler and server action. */
export function proxy(request: NextRequest) {
  if (authDisabled()) return NextResponse.next();

  const { pathname, search } = request.nextUrl;
  // Server actions POST to whatever page they are called from, public ones included.
  const isAction = request.headers.has("next-action");
  if (PUBLIC.has(pathname) && !isAction) return NextResponse.next();

  const current = session(request);
  if (current) {
    const response = NextResponse.next();
    if (shouldRenew(current)) {
      response.cookies.set(sessionCookie(createSessionToken(current.email), request.nextUrl.protocol === "https:"));
    }
    return response;
  }

  const isPage = (request.method === "GET" || request.method === "HEAD") && !pathname.startsWith("/api/");
  if (!isPage || isAction) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const login = new URL("/login", request.url);
  if (pathname !== "/") login.searchParams.set("next", pathname + search);
  return NextResponse.redirect(login);
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon\\.ico|icon\\.svg|apple-icon\\.png|manifest\\.webmanifest|icons/).*)",
  ],
};
