CREATE TABLE "project_labels" (
	"project_id" uuid NOT NULL,
	"account_id" uuid NOT NULL,
	"gmail_label_id" text NOT NULL,
	CONSTRAINT "project_labels_project_id_account_id_pk" PRIMARY KEY("project_id","account_id")
);
--> statement-breakpoint
CREATE TABLE "projects" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"label_name" text NOT NULL,
	"since" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "projects_slug_unique" UNIQUE("slug"),
	CONSTRAINT "projects_labelName_unique" UNIQUE("label_name")
);
--> statement-breakpoint
ALTER TABLE "threads" ADD COLUMN "project_id" uuid;--> statement-breakpoint
ALTER TABLE "threads" ADD COLUMN "project_source" "bucket_source";--> statement-breakpoint
ALTER TABLE "project_labels" ADD CONSTRAINT "project_labels_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_labels" ADD CONSTRAINT "project_labels_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "project_labels_account_id_gmail_label_id_index" ON "project_labels" USING btree ("account_id","gmail_label_id");--> statement-breakpoint
ALTER TABLE "threads" ADD CONSTRAINT "threads_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "threads_project_id_last_message_at_index" ON "threads" USING btree ("project_id","last_message_at");