ALTER TABLE "threads" ADD COLUMN "group_id" uuid;--> statement-breakpoint
CREATE INDEX "messages_message_id_idx" ON "messages" USING btree (("headers"->>'messageId'));--> statement-breakpoint
CREATE INDEX "threads_group_id_index" ON "threads" USING btree ("group_id");