CREATE TABLE "compose_uploads" (
	"id" uuid NOT NULL,
	"part" smallint NOT NULL,
	"filename" text NOT NULL,
	"mime_type" text NOT NULL,
	"data" "bytea" NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "compose_uploads_id_part_pk" PRIMARY KEY("id","part")
);
--> statement-breakpoint
CREATE INDEX "compose_uploads_created_at_index" ON "compose_uploads" USING btree ("created_at");