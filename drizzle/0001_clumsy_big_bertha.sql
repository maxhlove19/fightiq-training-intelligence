CREATE TABLE `training_debriefs` (
	`entry_id` text PRIMARY KEY NOT NULL,
	`owner_id` text NOT NULL,
	`summary` text,
	`takeaway` text,
	`coach_detail` text,
	`fightiq_explanation` text,
	`next_session_focus` text,
	`structured_memory_json` text,
	`status` text NOT NULL,
	`question_count` integer DEFAULT 0 NOT NULL,
	`confidence` real DEFAULT 0 NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_training_debriefs_owner_status` ON `training_debriefs` (`owner_id`,`status`);--> statement-breakpoint
CREATE TABLE `training_followups` (
	`id` text PRIMARY KEY NOT NULL,
	`entry_id` text NOT NULL,
	`owner_id` text NOT NULL,
	`sequence` integer NOT NULL,
	`question` text NOT NULL,
	`choices_json` text NOT NULL,
	`target_field` text NOT NULL,
	`why_asked` text NOT NULL,
	`answer` text,
	`answer_source` text,
	`status` text NOT NULL,
	`confidence_before` real NOT NULL,
	`confidence_after` real,
	`created_at` text NOT NULL,
	`answered_at` text
);
--> statement-breakpoint
CREATE INDEX `idx_training_followups_entry_sequence` ON `training_followups` (`entry_id`,`sequence`);--> statement-breakpoint
CREATE INDEX `idx_training_followups_owner_status` ON `training_followups` (`owner_id`,`status`);