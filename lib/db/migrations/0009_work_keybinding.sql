-- Pin became work: a stored shortcut override moves to the new command id. The old row stays, ignored.
INSERT INTO "keybindings" ("command_id", "keys", "updated_at")
SELECT 'work', "keys", "updated_at" FROM "keybindings" WHERE "command_id" = 'pin'
ON CONFLICT ("command_id") DO NOTHING;
