ALTER TABLE `fighter_profiles` ADD `onboarding_completed_at` text;--> statement-breakpoint
ALTER TABLE `fighter_profiles` ADD `athlete_setup_json` text DEFAULT '{}' NOT NULL;