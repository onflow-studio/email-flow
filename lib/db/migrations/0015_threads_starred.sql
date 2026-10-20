CREATE TYPE "public"."starred_from" AS ENUM('bucket', 'archived', 'snoozed', 'work');--> statement-breakpoint
ALTER TABLE "threads" ADD COLUMN "starred_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "threads" ADD COLUMN "starred_from" "starred_from";--> statement-breakpoint
-- Mail already starred in Gmail lands in Starred, with its twins. Its star time is unknown, so its newest message stands in.
UPDATE "threads" t SET
  "starred_at" = t."last_message_at",
  "starred_from" = (CASE
    WHEN t."pinned_at" IS NOT NULL THEN 'work'
    WHEN t."snoozed_until" > now() THEN 'snoozed'
    WHEN t."archived" THEN 'archived'
    ELSE 'bucket'
  END)::"starred_from",
  "archived" = false,
  "pinned_at" = NULL
WHERE NOT t."trashed" AND NOT t."spam" AND EXISTS (
  SELECT 1 FROM "messages" m JOIN "threads" s ON s."id" = m."thread_id"
  WHERE (s."id" = t."id" OR s."group_id" = t."group_id") AND 'STARRED' = ANY(m."gmail_labels")
);
