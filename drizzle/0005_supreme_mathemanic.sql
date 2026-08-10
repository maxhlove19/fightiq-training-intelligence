CREATE TABLE `video_recommendation_history` (
	`owner_id` text NOT NULL,
	`video_id` text NOT NULL,
	`study_topic` text NOT NULL,
	`served_at` text NOT NULL,
	PRIMARY KEY(`owner_id`, `video_id`)
);
--> statement-breakpoint
CREATE INDEX `idx_video_recommendation_history_owner_served` ON `video_recommendation_history` (`owner_id`,`served_at`);