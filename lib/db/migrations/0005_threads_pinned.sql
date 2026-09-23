ALTER TABLE "threads" ADD COLUMN "pinned_at" timestamp with time zone;--> statement-breakpoint
-- Set aside becomes pin: every set-aside thread is pinned.
UPDATE "threads" SET "pinned_at" = "set_aside_at" WHERE "set_aside_at" IS NOT NULL;
