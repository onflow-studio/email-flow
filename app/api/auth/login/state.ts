export const LOGIN_STATE_COOKIE = "superfer_login_state";
export const LOGIN_COOKIE_PATH = "/api/auth/login";

/** Only same-origin paths, so the login cannot be turned into an open redirect. */
export function safeNext(next: string | null | undefined): string {
  if (!next || !next.startsWith("/") || next.startsWith("//") || next.startsWith("/\\")) return "/inbox";
  return next;
}
