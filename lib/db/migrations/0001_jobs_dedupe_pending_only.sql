DROP INDEX "jobs_dedupe_key_active_idx";--> statement-breakpoint
CREATE UNIQUE INDEX "jobs_dedupe_key_pending_idx" ON "jobs" USING btree ("dedupe_key") WHERE status = 'pending';