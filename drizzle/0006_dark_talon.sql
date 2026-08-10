CREATE TABLE `coach_message_enrichments` (
	`assistant_message_id` text PRIMARY KEY NOT NULL,
	`owner_id` text NOT NULL,
	`follow_up` text NOT NULL,
	`video_mode` text DEFAULT 'none' NOT NULL,
	`video_topic` text,
	`video_prompt` text,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_coach_message_enrichments_owner_created` ON `coach_message_enrichments` (`owner_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `training_experiment_sessions` (
	`entry_id` text PRIMARY KEY NOT NULL,
	`owner_id` text NOT NULL,
	`experiment_id` text NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_training_experiment_sessions_owner_experiment` ON `training_experiment_sessions` (`owner_id`,`experiment_id`);