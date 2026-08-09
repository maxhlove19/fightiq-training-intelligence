CREATE TABLE `coach_messages` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_id` text NOT NULL,
	`role` text NOT NULL,
	`content` text NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_coach_messages_owner_created` ON `coach_messages` (`owner_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `fighter_profiles` (
	`owner_id` text PRIMARY KEY NOT NULL,
	`current_focus` text,
	`focus_reason` text,
	`primary_goal` text DEFAULT 'performance' NOT NULL,
	`style_influences_json` text DEFAULT '[]' NOT NULL,
	`calorie_target` integer DEFAULT 2400 NOT NULL,
	`protein_target` integer DEFAULT 180 NOT NULL,
	`carb_target` integer DEFAULT 260 NOT NULL,
	`fat_target` integer DEFAULT 70 NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `nutrition_entries` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_id` text NOT NULL,
	`description` text NOT NULL,
	`foods_json` text DEFAULT '[]' NOT NULL,
	`calories` integer NOT NULL,
	`protein` real NOT NULL,
	`carbs` real NOT NULL,
	`fat` real NOT NULL,
	`input_method` text NOT NULL,
	`photo_key` text,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_nutrition_entries_owner_created` ON `nutrition_entries` (`owner_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `workout_plans` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_id` text NOT NULL,
	`discipline` text NOT NULL,
	`goal` text NOT NULL,
	`fatigue` text NOT NULL,
	`duration_minutes` integer NOT NULL,
	`plan_json` text NOT NULL,
	`status` text DEFAULT 'planned' NOT NULL,
	`created_at` text NOT NULL,
	`completed_at` text
);
--> statement-breakpoint
CREATE INDEX `idx_workout_plans_owner_created` ON `workout_plans` (`owner_id`,`created_at`);