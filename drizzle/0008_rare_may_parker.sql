CREATE TABLE `debrief_generation_leases` (
	`entry_id` text PRIMARY KEY NOT NULL,
	`owner_id` text NOT NULL,
	`lease_id` text NOT NULL,
	`expires_at` text NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_debrief_generation_leases_owner_expires` ON `debrief_generation_leases` (`owner_id`,`expires_at`);--> statement-breakpoint
CREATE TABLE `fighter_brain_evidence` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_id` text NOT NULL,
	`entry_id` text NOT NULL,
	`category` text NOT NULL,
	`canonical_key` text NOT NULL,
	`label` text NOT NULL,
	`source` text NOT NULL,
	`confidence` real NOT NULL,
	`observed_at` text NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_fighter_brain_evidence_entry_claim` ON `fighter_brain_evidence` (`owner_id`,`entry_id`,`category`,`canonical_key`);--> statement-breakpoint
CREATE INDEX `idx_fighter_brain_evidence_owner_category_observed` ON `fighter_brain_evidence` (`owner_id`,`category`,`observed_at`);--> statement-breakpoint
CREATE TABLE `fighter_focus_recommendations` (
	`owner_id` text PRIMARY KEY NOT NULL,
	`focus` text NOT NULL,
	`reason` text NOT NULL,
	`confidence` real NOT NULL,
	`entry_id` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_fighter_focus_recommendations_updated` ON `fighter_focus_recommendations` (`updated_at`);