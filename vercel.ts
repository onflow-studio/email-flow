import type { VercelConfig } from "@vercel/config/v1";

// Every 10 minutes, longer than Neon's 5-minute scale to zero, so the database can sleep between passes.
// The functions region is a project setting (Settings, Functions), so each deployment can sit next to its database.
export const config: VercelConfig = {
  crons: [{ path: "/api/sync", schedule: "*/10 * * * *" }],
};
