-- A star now pins a thread in the list that holds it. One starred out of Work goes back to Work.
UPDATE "threads" SET "pinned_at" = "starred_at" WHERE "starred_from" = 'work' AND "pinned_at" IS NULL;--> statement-breakpoint
-- Starred threads keep Gmail's INBOX label now: write each one back, which also holds off reading its labels until then.
INSERT INTO "jobs" ("type", "account_id", "payload", "priority", "dedupe_key")
  SELECT 'writeback', "account_id", jsonb_build_object('threadId', "id"), 10, 'writeback:' || "id"
  FROM "threads" WHERE "starred_at" IS NOT NULL
  ON CONFLICT DO NOTHING;--> statement-breakpoint
ALTER TABLE "threads" DROP COLUMN "starred_from";--> statement-breakpoint
DROP TYPE "public"."starred_from";
