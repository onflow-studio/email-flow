import type { VercelConfig } from "@vercel/config/v1";

export const config: VercelConfig = {
  regions: ["fra1"],
  crons: [{ path: "/api/sync", schedule: "*/5 * * * *" }],
};
