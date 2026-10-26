CREATE TYPE "public"."entity_type" AS ENUM('person', 'project', 'company');--> statement-breakpoint
ALTER TYPE "public"."job_type" ADD VALUE 'entities';--> statement-breakpoint
CREATE TABLE "entities" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"type" "entity_type" NOT NULL,
	"name" text NOT NULL,
	"norm_name" text NOT NULL,
	"aliases" text[] DEFAULT '{}' NOT NULL,
	"summary" text,
	"user_edited_at" timestamp with time zone,
	"merged_into_id" uuid,
	"deleted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "entity_links" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"entity_id" uuid NOT NULL,
	"thread_id" uuid,
	"message_id" uuid,
	"sender_id" uuid,
	"other_entity_id" uuid,
	"relation" text,
	"source" "decided_by" NOT NULL,
	"rejected" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "entity_links_one_target" CHECK (num_nonnulls("entity_links"."thread_id", "entity_links"."message_id", "entity_links"."sender_id", "entity_links"."other_entity_id") = 1)
);
--> statement-breakpoint
CREATE TABLE "entity_questions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"entity_id" uuid NOT NULL,
	"other_entity_id" uuid NOT NULL,
	"question" text NOT NULL,
	"thread_id" uuid,
	"status" text DEFAULT 'open' NOT NULL,
	"answered_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "entity_questions_ordered" CHECK ("entity_questions"."entity_id" < "entity_questions"."other_entity_id")
);
--> statement-breakpoint
ALTER TABLE "threads" ADD COLUMN "entities_message_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "entities" ADD CONSTRAINT "entities_merged_into_id_entities_id_fk" FOREIGN KEY ("merged_into_id") REFERENCES "public"."entities"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "entity_links" ADD CONSTRAINT "entity_links_entity_id_entities_id_fk" FOREIGN KEY ("entity_id") REFERENCES "public"."entities"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "entity_links" ADD CONSTRAINT "entity_links_thread_id_threads_id_fk" FOREIGN KEY ("thread_id") REFERENCES "public"."threads"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "entity_links" ADD CONSTRAINT "entity_links_message_id_messages_id_fk" FOREIGN KEY ("message_id") REFERENCES "public"."messages"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "entity_links" ADD CONSTRAINT "entity_links_sender_id_senders_id_fk" FOREIGN KEY ("sender_id") REFERENCES "public"."senders"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "entity_links" ADD CONSTRAINT "entity_links_other_entity_id_entities_id_fk" FOREIGN KEY ("other_entity_id") REFERENCES "public"."entities"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "entity_questions" ADD CONSTRAINT "entity_questions_entity_id_entities_id_fk" FOREIGN KEY ("entity_id") REFERENCES "public"."entities"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "entity_questions" ADD CONSTRAINT "entity_questions_other_entity_id_entities_id_fk" FOREIGN KEY ("other_entity_id") REFERENCES "public"."entities"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "entity_questions" ADD CONSTRAINT "entity_questions_thread_id_threads_id_fk" FOREIGN KEY ("thread_id") REFERENCES "public"."threads"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "entities_type_norm_name_index" ON "entities" USING btree ("type","norm_name");--> statement-breakpoint
CREATE INDEX "entities_merged_into_id_index" ON "entities" USING btree ("merged_into_id");--> statement-breakpoint
CREATE UNIQUE INDEX "entity_links_entity_id_thread_id_index" ON "entity_links" USING btree ("entity_id","thread_id");--> statement-breakpoint
CREATE UNIQUE INDEX "entity_links_entity_id_message_id_index" ON "entity_links" USING btree ("entity_id","message_id");--> statement-breakpoint
CREATE UNIQUE INDEX "entity_links_entity_id_sender_id_index" ON "entity_links" USING btree ("entity_id","sender_id");--> statement-breakpoint
CREATE UNIQUE INDEX "entity_links_entity_id_other_entity_id_index" ON "entity_links" USING btree ("entity_id","other_entity_id");--> statement-breakpoint
CREATE INDEX "entity_links_thread_id_index" ON "entity_links" USING btree ("thread_id");--> statement-breakpoint
CREATE INDEX "entity_links_sender_id_index" ON "entity_links" USING btree ("sender_id");--> statement-breakpoint
CREATE UNIQUE INDEX "entity_questions_entity_id_other_entity_id_index" ON "entity_questions" USING btree ("entity_id","other_entity_id");