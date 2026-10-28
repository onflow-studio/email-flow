ALTER TYPE "public"."job_type" ADD VALUE 'digest' BEFORE 'entities';--> statement-breakpoint
CREATE TABLE "digests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"day" date NOT NULL,
	"content" jsonb NOT NULL,
	"summary" text NOT NULL,
	"model" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "digests_day_unique" UNIQUE("day")
);
