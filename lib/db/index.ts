import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";

import * as schema from "./schema";

const url = process.env.DATABASE_URL;
if (!url) throw new Error("DATABASE_URL is not set");

// Reuse one pool across dev hot reloads.
const globalForDb = globalThis as unknown as { pgClient?: postgres.Sql };
const client = globalForDb.pgClient ?? postgres(url, { max: 10 });
if (process.env.NODE_ENV !== "production") globalForDb.pgClient = client;

export const db = drizzle({ client, schema, casing: "snake_case" });
export type Db = typeof db;
export { schema };
