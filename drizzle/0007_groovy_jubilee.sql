CREATE TABLE `coach_turns` (
	`user_message_id` text PRIMARY KEY NOT NULL,
	`owner_id` text NOT NULL,
	`assistant_message_id` text,
	`status` text DEFAULT 'pending' NOT NULL,
	`created_at` text NOT NULL,
	`completed_at` text
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_coach_turns_assistant_message` ON `coach_turns` (`assistant_message_id`);--> statement-breakpoint
CREATE INDEX `idx_coach_turns_owner_status` ON `coach_turns` (`owner_id`,`status`,`created_at`);