CREATE TABLE `workout_performances` (
	`id` text PRIMARY KEY NOT NULL,
	`workout_id` text NOT NULL,
	`owner_id` text NOT NULL,
	`exercise_key` text NOT NULL,
	`completed_sets` integer DEFAULT 0 NOT NULL,
	`completed_reps` integer,
	`load_value` real,
	`unit` text DEFAULT 'lb' NOT NULL,
	`effort` text DEFAULT 'not_logged' NOT NULL,
	`next_action` text NOT NULL,
	`next_load_value` real,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_workout_performances_owner_exercise_created` ON `workout_performances` (`owner_id`,`exercise_key`,`created_at`);--> statement-breakpoint
CREATE UNIQUE INDEX `idx_workout_performances_workout_exercise` ON `workout_performances` (`workout_id`,`exercise_key`);--> statement-breakpoint
CREATE TABLE `workout_setups` (
	`owner_id` text PRIMARY KEY NOT NULL,
	`equipment_json` text DEFAULT '[]' NOT NULL,
	`location` text DEFAULT '' NOT NULL,
	`default_duration_minutes` integer DEFAULT 35 NOT NULL,
	`unit` text DEFAULT 'lb' NOT NULL,
	`limitations` text DEFAULT '' NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
