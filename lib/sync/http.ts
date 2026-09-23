// HTTP status from a googleapis (gaxios) error, whichever shape it arrives in.
export function httpStatus(error: unknown): number | undefined {
  const e = error as { status?: number; code?: number | string; response?: { status?: number } };
  return e?.status ?? e?.response?.status ?? (typeof e?.code === "number" ? e.code : undefined);
}
