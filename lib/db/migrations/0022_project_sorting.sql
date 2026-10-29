CREATE TABLE "project_dismissals" (
	"project_id" uuid NOT NULL,
	"thread_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "project_dismissals_project_id_thread_id_pk" PRIMARY KEY("project_id","thread_id")
);
--> statement-breakpoint
ALTER TABLE "threads" ADD COLUMN "project_suggested_id" uuid;--> statement-breakpoint
ALTER TABLE "threads" ADD COLUMN "project_checked_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "project_dismissals" ADD CONSTRAINT "project_dismissals_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_dismissals" ADD CONSTRAINT "project_dismissals_thread_id_threads_id_fk" FOREIGN KEY ("thread_id") REFERENCES "public"."threads"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "threads" ADD CONSTRAINT "threads_project_suggested_id_projects_id_fk" FOREIGN KEY ("project_suggested_id") REFERENCES "public"."projects"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "threads_project_suggested_id_index" ON "threads" USING btree ("project_suggested_id");--> statement-breakpoint
CREATE INDEX "threads_account_id_project_checked_at_index" ON "threads" USING btree ("account_id","project_checked_at");