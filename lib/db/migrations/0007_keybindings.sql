CREATE TABLE "keybindings" (
	"command_id" text PRIMARY KEY NOT NULL,
	"keys" text[] NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
