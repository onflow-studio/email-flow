import { cookies } from "next/headers";

/** Comma-separated ids of the accounts toggled off in the header. */
export const ACCOUNTS_OFF_COOKIE = "accounts-off";

export async function accountsOff(): Promise<string[]> {
  const value = (await cookies()).get(ACCOUNTS_OFF_COOKIE)?.value;
  return value ? value.split(",").filter(Boolean) : [];
}

/**
 * Ids of the accounts that are on, or null when every account is (no filter).
 * A cookie that would turn every account off counts as all on.
 */
export function accountsOn(all: { id: string }[], off: string[]): string[] | null {
  const on = all.filter((a) => !off.includes(a.id)).map((a) => a.id);
  return on.length && on.length < all.length ? on : null;
}
