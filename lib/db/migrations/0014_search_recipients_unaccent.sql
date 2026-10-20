CREATE EXTENSION IF NOT EXISTS unaccent;--> statement-breakpoint
CREATE TEXT SEARCH CONFIGURATION simple_unaccent (COPY = simple);--> statement-breakpoint
ALTER TEXT SEARCH CONFIGURATION simple_unaccent ALTER MAPPING FOR hword, hword_part, word WITH unaccent, simple;--> statement-breakpoint
ALTER TABLE "messages" drop column "search";--> statement-breakpoint
ALTER TABLE "messages" ADD COLUMN "search" "tsvector" GENERATED ALWAYS AS (to_tsvector('simple_unaccent', coalesce(subject, '') || ' ' || coalesce(from_name, '') || ' ' || from_email || ' ' || translate(from_email, '@.', '  ') || ' ' || jsonb_path_query_array("to" || cc || bcc, '$[*].name ? (@ != null)')::text || ' ' || translate(jsonb_path_query_array("to" || cc || bcc, '$[*].email')::text, '@.', '  ') || ' ' || coalesce(text, ''))) STORED;--> statement-breakpoint
CREATE INDEX "messages_search_idx" ON "messages" USING gin ("search");
