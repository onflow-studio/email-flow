import type { VercelConfig } from "@vercel/config/v1";

// The functions region is a project setting (Settings, Functions), so each deployment can sit next to its database.
export const config: VercelConfig = {
  crons: [{ path: "/api/sync", schedule: "*/5 * * * *" }],
};
