import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";

import * as schema from "./schema";

const url = process.env.DATABASE_URL;
if (!url) throw new Error("DATABASE_URL is not set");

// Reuse one pool across dev hot reloads.
const globalForDb = globalThis as unknown as { pgClient?: postgres.Sql };
// On Vercel every function instance holds its own pool, and a page load prefetches a dozen routes at
// once; a small pool per instance keeps the burst inside the database's connection limit.
const client = globalForDb.pgClient ?? postgres(url, { max: process.env.VERCEL ? 3 : 10, idle_timeout: 20 });
if (process.env.NODE_ENV !== "production") globalForDb.pgClient = client;

export const db = drizzle({ client, schema, casing: "snake_case" });
export type Db = typeof db;
export { schema };
