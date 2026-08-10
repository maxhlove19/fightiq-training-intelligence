CREATE TABLE `coach_chats` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_id` text NOT NULL,
	`title` text DEFAULT 'New chat' NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_coach_chats_owner_updated` ON `coach_chats` (`owner_id`,`updated_at`);--> statement-breakpoint
ALTER TABLE `coach_messages` ADD `chat_id` text;--> statement-breakpoint
CREATE INDEX `idx_coach_messages_owner_chat_created` ON `coach_messages` (`owner_id`,`chat_id`,`created_at`);--> statement-breakpoint
ALTER TABLE `coach_turns` ADD `chat_id` text;
