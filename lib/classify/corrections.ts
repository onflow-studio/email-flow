import type { Db } from "@/lib/db";
import { corrections, type Bucket } from "@/lib/db/schema";

export type CorrectionInput = {
  threadId: string;
  senderId: string | null;
  fromBucket: Bucket | null;
  toBucket: Bucket;
};

// Append-only, separate from classifications. Feeds exemplar selection on later calls.
export async function recordCorrection(db: Pick<Db, "insert">, c: CorrectionInput) {
  if (c.fromBucket === c.toBucket) return;
  await db.insert(corrections).values(c);
}
