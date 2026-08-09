CREATE TABLE `pre_training_briefs` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_id` text NOT NULL,
	`mission` text NOT NULL,
	`reason` text NOT NULL,
	`cue` text NOT NULL,
	`source_focus` text NOT NULL,
	`created_at` text NOT NULL,
	`consumed_at` text
);
--> statement-breakpoint
CREATE INDEX `idx_pre_training_briefs_owner_created` ON `pre_training_briefs` (`owner_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `training_experiments` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_id` text NOT NULL,
	`brief_id` text,
	`mission` text NOT NULL,
	`cue` text NOT NULL,
	`reason` text NOT NULL,
	`status` text DEFAULT 'planned' NOT NULL,
	`started_at` text,
	`outcome` text,
	`evidence` text,
	`created_at` text NOT NULL,
	`completed_at` text
);
--> statement-breakpoint
CREATE INDEX `idx_training_experiments_owner_status` ON `training_experiments` (`owner_id`,`status`,`created_at`);