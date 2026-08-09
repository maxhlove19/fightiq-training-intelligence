CREATE TABLE `profiles` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_id` text NOT NULL,
	`display_name` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `profiles_owner_id_unique` ON `profiles` (`owner_id`);--> statement-breakpoint
CREATE TABLE `training_entries` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_id` text NOT NULL,
	`discipline` text NOT NULL,
	`session_type` text NOT NULL,
	`raw_entry` text NOT NULL,
	`input_method` text NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_training_entries_owner_created` ON `training_entries` (`owner_id`,`created_at`);