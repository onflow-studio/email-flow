CREATE TYPE "public"."bucket" AS ENUM('inbox', 'news', 'paper_trail', 'triage', 'out');--> statement-breakpoint
CREATE TYPE "public"."bucket_source" AS ENUM('ai', 'user', 'rule');--> statement-breakpoint
CREATE TYPE "public"."decided_by" AS ENUM('ai', 'user');--> statement-breakpoint
CREATE TYPE "public"."job_status" AS ENUM('pending', 'running', 'done', 'failed');--> statement-breakpoint
CREATE TYPE "public"."job_type" AS ENUM('classify', 'writeback', 'backfill');--> statement-breakpoint
CREATE TYPE "public"."screener_decision" AS ENUM('allowed', 'out_spam', 'out_not_now', 'none');--> statement-breakpoint
CREATE TABLE "accounts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" text NOT NULL,
	"label" text NOT NULL,
	"color" text NOT NULL,
	"access_token_enc" text,
	"refresh_token_enc" text,
	"token_expires_at" timestamp with time zone,
	"scope" text,
	"history_id" text,
	"last_sync_at" timestamp with time zone,
	"last_sync_error" text,
	"signature_html" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "accounts_email_unique" UNIQUE("email")
);
--> statement-breakpoint
CREATE TABLE "actions_log" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"thread_id" uuid,
	"batch_id" uuid,
	"action" text NOT NULL,
	"payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"undone_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "attachments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"message_id" uuid NOT NULL,
	"filename" text NOT NULL,
	"mime_type" text NOT NULL,
	"size" integer NOT NULL,
	"gmail_attachment_id" text NOT NULL,
	"content_id" text
);
--> statement-breakpoint
CREATE TABLE "classifications" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"thread_id" uuid NOT NULL,
	"model" text NOT NULL,
	"raw_response" jsonb NOT NULL,
	"bucket" "bucket" NOT NULL,
	"bucket_probabilities" jsonb NOT NULL,
	"urgency" smallint,
	"human_written" boolean,
	"legit_new_sender" boolean,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "corrections" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"thread_id" uuid,
	"sender_id" uuid,
	"from_bucket" "bucket",
	"to_bucket" "bucket" NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "jobs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"type" "job_type" NOT NULL,
	"account_id" uuid,
	"payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"status" "job_status" DEFAULT 'pending' NOT NULL,
	"priority" integer DEFAULT 0 NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"run_after" timestamp with time zone DEFAULT now() NOT NULL,
	"locked_at" timestamp with time zone,
	"dedupe_key" text,
	"error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "messages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"thread_id" uuid NOT NULL,
	"account_id" uuid NOT NULL,
	"gmail_message_id" text NOT NULL,
	"sender_id" uuid,
	"from_email" text NOT NULL,
	"from_name" text,
	"to" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"cc" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"bcc" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"subject" text,
	"date" timestamp with time zone NOT NULL,
	"snippet" text,
	"html_sanitized" text,
	"text" text,
	"is_inbound" boolean NOT NULL,
	"gmail_labels" text[] DEFAULT '{}' NOT NULL,
	"headers" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"search" "tsvector" GENERATED ALWAYS AS (to_tsvector('simple', coalesce(subject, '') || ' ' || coalesce(from_name, '') || ' ' || from_email || ' ' || coalesce(text, ''))) STORED,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "rules" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"text" text NOT NULL,
	"structured" jsonb,
	"enabled" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sender_accounts" (
	"sender_id" uuid NOT NULL,
	"account_id" uuid NOT NULL,
	"seen_count" integer DEFAULT 0 NOT NULL,
	"last_seen_at" timestamp with time zone,
	CONSTRAINT "sender_accounts_sender_id_account_id_pk" PRIMARY KEY("sender_id","account_id")
);
--> statement-breakpoint
CREATE TABLE "senders" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" text NOT NULL,
	"domain" text NOT NULL,
	"display_name" text,
	"first_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"screener_decision" "screener_decision" DEFAULT 'none' NOT NULL,
	"default_bucket" "bucket",
	"decided_at" timestamp with time zone,
	"decided_by" "decided_by",
	"images_allowed" boolean DEFAULT false NOT NULL,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "senders_email_unique" UNIQUE("email")
);
--> statement-breakpoint
CREATE TABLE "threads" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"account_id" uuid NOT NULL,
	"gmail_thread_id" text NOT NULL,
	"sender_id" uuid,
	"subject" text,
	"last_message_at" timestamp with time zone NOT NULL,
	"bucket" "bucket" DEFAULT 'inbox' NOT NULL,
	"bucket_source" "bucket_source",
	"bucket_confidence" real,
	"bucket_suggested" boolean DEFAULT false NOT NULL,
	"seen_at" timestamp with time zone,
	"snoozed_until" timestamp with time zone,
	"needs_reply" boolean DEFAULT false NOT NULL,
	"deadline_at" timestamp with time zone,
	"set_aside_at" timestamp with time zone,
	"archived" boolean DEFAULT false NOT NULL,
	"trashed" boolean DEFAULT false NOT NULL,
	"spam" boolean DEFAULT false NOT NULL,
	"participants_summary" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "actions_log" ADD CONSTRAINT "actions_log_thread_id_threads_id_fk" FOREIGN KEY ("thread_id") REFERENCES "public"."threads"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attachments" ADD CONSTRAINT "attachments_message_id_messages_id_fk" FOREIGN KEY ("message_id") REFERENCES "public"."messages"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "classifications" ADD CONSTRAINT "classifications_thread_id_threads_id_fk" FOREIGN KEY ("thread_id") REFERENCES "public"."threads"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "corrections" ADD CONSTRAINT "corrections_thread_id_threads_id_fk" FOREIGN KEY ("thread_id") REFERENCES "public"."threads"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "corrections" ADD CONSTRAINT "corrections_sender_id_senders_id_fk" FOREIGN KEY ("sender_id") REFERENCES "public"."senders"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "jobs" ADD CONSTRAINT "jobs_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "messages" ADD CONSTRAINT "messages_thread_id_threads_id_fk" FOREIGN KEY ("thread_id") REFERENCES "public"."threads"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "messages" ADD CONSTRAINT "messages_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "messages" ADD CONSTRAINT "messages_sender_id_senders_id_fk" FOREIGN KEY ("sender_id") REFERENCES "public"."senders"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sender_accounts" ADD CONSTRAINT "sender_accounts_sender_id_senders_id_fk" FOREIGN KEY ("sender_id") REFERENCES "public"."senders"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sender_accounts" ADD CONSTRAINT "sender_accounts_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "threads" ADD CONSTRAINT "threads_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "threads" ADD CONSTRAINT "threads_sender_id_senders_id_fk" FOREIGN KEY ("sender_id") REFERENCES "public"."senders"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "actions_log_thread_id_index" ON "actions_log" USING btree ("thread_id");--> statement-breakpoint
CREATE INDEX "actions_log_batch_id_index" ON "actions_log" USING btree ("batch_id");--> statement-breakpoint
CREATE INDEX "actions_log_created_at_index" ON "actions_log" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "attachments_message_id_index" ON "attachments" USING btree ("message_id");--> statement-breakpoint
CREATE INDEX "classifications_thread_id_created_at_index" ON "classifications" USING btree ("thread_id","created_at");--> statement-breakpoint
CREATE INDEX "corrections_sender_id_created_at_index" ON "corrections" USING btree ("sender_id","created_at");--> statement-breakpoint
CREATE INDEX "corrections_created_at_index" ON "corrections" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "jobs_status_priority_run_after_index" ON "jobs" USING btree ("status","priority","run_after");--> statement-breakpoint
CREATE INDEX "jobs_account_id_status_index" ON "jobs" USING btree ("account_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "jobs_dedupe_key_active_idx" ON "jobs" USING btree ("dedupe_key") WHERE status in ('pending', 'running');--> statement-breakpoint
CREATE UNIQUE INDEX "messages_account_id_gmail_message_id_index" ON "messages" USING btree ("account_id","gmail_message_id");--> statement-breakpoint
CREATE INDEX "messages_thread_id_date_index" ON "messages" USING btree ("thread_id","date");--> statement-breakpoint
CREATE INDEX "messages_sender_id_index" ON "messages" USING btree ("sender_id");--> statement-breakpoint
CREATE INDEX "messages_search_idx" ON "messages" USING gin ("search");--> statement-breakpoint
CREATE INDEX "sender_accounts_account_id_index" ON "sender_accounts" USING btree ("account_id");--> statement-breakpoint
CREATE INDEX "senders_domain_index" ON "senders" USING btree ("domain");--> statement-breakpoint
CREATE UNIQUE INDEX "threads_account_id_gmail_thread_id_index" ON "threads" USING btree ("account_id","gmail_thread_id");--> statement-breakpoint
CREATE INDEX "threads_bucket_last_message_at_index" ON "threads" USING btree ("bucket","last_message_at");--> statement-breakpoint
CREATE INDEX "threads_account_id_last_message_at_index" ON "threads" USING btree ("account_id","last_message_at");--> statement-breakpoint
CREATE INDEX "threads_sender_id_index" ON "threads" USING btree ("sender_id");--> statement-breakpoint
CREATE INDEX "threads_snoozed_until_index" ON "threads" USING btree ("snoozed_until");