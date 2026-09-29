CREATE TABLE "drafts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"account_id" uuid NOT NULL,
	"gmail_draft_id" text NOT NULL,
	"gmail_message_id" text NOT NULL,
	"thread_id" uuid,
	"mode" text NOT NULL,
	"to" text DEFAULT '' NOT NULL,
	"cc" text DEFAULT '' NOT NULL,
	"bcc" text DEFAULT '' NOT NULL,
	"subject" text DEFAULT '' NOT NULL,
	"html" text DEFAULT '' NOT NULL,
	"composed" boolean DEFAULT true NOT NULL,
	"date" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "drafts" ADD CONSTRAINT "drafts_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "drafts" ADD CONSTRAINT "drafts_thread_id_threads_id_fk" FOREIGN KEY ("thread_id") REFERENCES "public"."threads"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "drafts_account_id_gmail_draft_id_index" ON "drafts" USING btree ("account_id","gmail_draft_id");--> statement-breakpoint
CREATE INDEX "drafts_thread_id_index" ON "drafts" USING btree ("thread_id");