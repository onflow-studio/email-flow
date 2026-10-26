CREATE EXTENSION IF NOT EXISTS vector;--> statement-breakpoint
ALTER TYPE "public"."job_type" ADD VALUE 'embed';--> statement-breakpoint
CREATE TABLE "embeddings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"message_id" uuid NOT NULL,
	"thread_id" uuid NOT NULL,
	"account_id" uuid NOT NULL,
	"chunk" integer NOT NULL,
	"text" text NOT NULL,
	"metadata" jsonb,
	"model" text NOT NULL,
	"embedding" vector(512) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "embeddings" ADD CONSTRAINT "embeddings_message_id_messages_id_fk" FOREIGN KEY ("message_id") REFERENCES "public"."messages"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "embeddings" ADD CONSTRAINT "embeddings_thread_id_threads_id_fk" FOREIGN KEY ("thread_id") REFERENCES "public"."threads"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "embeddings" ADD CONSTRAINT "embeddings_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "embeddings_message_id_chunk_index" ON "embeddings" USING btree ("message_id","chunk");--> statement-breakpoint
CREATE INDEX "embeddings_thread_id_index" ON "embeddings" USING btree ("thread_id");--> statement-breakpoint
CREATE INDEX "embeddings_embedding_idx" ON "embeddings" USING hnsw ("embedding" vector_cosine_ops);