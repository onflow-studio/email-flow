import type { VercelConfig } from "@vercel/config/v1";

// Evaluated at build time. DEPLOY_REGION takes a comma-separated list; unset keeps Vercel's default.
const regions = (process.env.DEPLOY_REGION ?? "")
  .split(",")
  .map((r) => r.trim())
  .filter(Boolean);

export const config: VercelConfig = {
  ...(regions.length > 0 && { regions }),
  crons: [{ path: "/api/sync", schedule: "*/5 * * * *" }],
};
