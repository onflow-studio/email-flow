import { eq } from "drizzle-orm";

import type { Db } from "@/lib/db";
import { senders } from "@/lib/db/schema";

/** Remote images load for every message from this sender from now on. Local only, never written to Gmail. */
export async function allowSenderImages(db: Db, senderId: string): Promise<boolean> {
  const rows = await db.update(senders).set({ imagesAllowed: true }).where(eq(senders.id, senderId)).returning({ id: senders.id });
  return rows.length > 0;
}
