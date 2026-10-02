/**
 * CONNECTABLE_EMAILS: comma-separated Gmail addresses that may be connected, case-insensitive.
 * Unset or empty lets any address connect.
 */
export function isConnectable(email: string, raw = process.env.CONNECTABLE_EMAILS): boolean {
  const allowed = (raw ?? "")
    .split(",")
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);
  return allowed.length === 0 || allowed.includes(email.trim().toLowerCase());
}
