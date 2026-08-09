DROP INDEX `idx_training_followups_entry_sequence`;--> statement-breakpoint
CREATE UNIQUE INDEX `idx_training_followups_entry_sequence` ON `training_followups` (`entry_id`,`sequence`);