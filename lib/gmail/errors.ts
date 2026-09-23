// HTTP status from a googleapis (gaxios) error, whichever shape it arrives in.
export function httpStatus(error: unknown): number | undefined {
  const e = error as { status?: number; code?: number | string; response?: { status?: number } };
  return e?.status ?? e?.response?.status ?? (typeof e?.code === "number" ? e.code : undefined);
}

// Gmail gave up on us for now. Thrown once retries are spent, so callers can tell "come back
// later" from a real failure.
export class GmailRateLimitError extends Error {
  constructor(readonly retryAfterMs: number, options?: { cause?: unknown }) {
    super("Gmail rate limit, backing off", options);
    this.name = "GmailRateLimitError";
  }
}

const RATE_LIMIT_REASONS = new Set(["rateLimitExceeded", "userRateLimitExceeded", "RATE_LIMIT_EXCEEDED"]);

type GoogleErrorBody = {
  error?: { errors?: { reason?: string }[]; details?: { reason?: string }[]; message?: string };
};

function reasons(error: unknown): string[] {
  const e = error as { errors?: { reason?: string }[]; response?: { data?: GoogleErrorBody } };
  const body = e?.response?.data?.error;
  return [...(e?.errors ?? []), ...(body?.errors ?? []), ...(body?.details ?? [])].flatMap((r) =>
    r?.reason ? [r.reason] : [],
  );
}

// 429, or the 403 flavour Gmail uses for per-user quota ("Quota exceeded ... per minute per user").
export function isRateLimitError(error: unknown): boolean {
  if (error instanceof GmailRateLimitError) return true;
  const status = httpStatus(error);
  if (status === 429) return true;
  if (status !== 403) return false;
  if (reasons(error).some((r) => RATE_LIMIT_REASONS.has(r))) return true;
  return /quota exceeded|rate limit/i.test(error instanceof Error ? error.message : "");
}

function header(error: unknown, name: string): string | null {
  const headers = (error as { response?: { headers?: unknown } })?.response?.headers;
  if (!headers) return null;
  if (typeof (headers as Headers).get === "function") return (headers as Headers).get(name);
  const value = (headers as Record<string, unknown>)[name];
  return typeof value === "string" ? value : null;
}

// How long Gmail asked us to wait: Retry-After (seconds or a date), or "Retry after <date>" in the message.
export function retryAfterMs(error: unknown, now: number): number | null {
  const raw = header(error, "retry-after");
  if (raw) {
    const seconds = Number(raw);
    if (Number.isFinite(seconds)) return Math.max(0, seconds * 1000);
    const at = Date.parse(raw);
    if (Number.isFinite(at)) return Math.max(0, at - now);
  }
  const message = error instanceof Error ? error.message : "";
  const at = Date.parse(message.match(/retry after (\S+)/i)?.[1]?.replace(/[.,;]$/, "") ?? "");
  return Number.isFinite(at) ? Math.max(0, at - now) : null;
}
