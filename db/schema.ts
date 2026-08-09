import { index, integer, real, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

export const profiles = sqliteTable("profiles", {
  id: text("id").primaryKey(),
  ownerId: text("owner_id").notNull().unique(),
  displayName: text("display_name"),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
});

export const trainingEntries = sqliteTable("training_entries", {
  id: text("id").primaryKey(),
  ownerId: text("owner_id").notNull(),
  discipline: text("discipline").notNull(),
  sessionType: text("session_type").notNull(),
  rawEntry: text("raw_entry").notNull(),
  inputMethod: text("input_method").notNull(),
  createdAt: text("created_at").notNull(),
}, (table) => [index("idx_training_entries_owner_created").on(table.ownerId, table.createdAt)]);

export const trainingDebriefs = sqliteTable("training_debriefs", {
  entryId: text("entry_id").primaryKey(),
  ownerId: text("owner_id").notNull(),
  summary: text("summary"),
  takeaway: text("takeaway"),
  coachDetail: text("coach_detail"),
  fightiqExplanation: text("fightiq_explanation"),
  nextSessionFocus: text("next_session_focus"),
  structuredMemoryJson: text("structured_memory_json"),
  status: text("status").notNull(),
  questionCount: integer("question_count").notNull().default(0),
  confidence: real("confidence").notNull().default(0),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
}, (table) => [index("idx_training_debriefs_owner_status").on(table.ownerId, table.status)]);

export const trainingFollowups = sqliteTable("training_followups", {
  id: text("id").primaryKey(),
  entryId: text("entry_id").notNull(),
  ownerId: text("owner_id").notNull(),
  sequence: integer("sequence").notNull(),
  question: text("question").notNull(),
  choicesJson: text("choices_json").notNull(),
  targetField: text("target_field").notNull(),
  whyAsked: text("why_asked").notNull(),
  answer: text("answer"),
  answerSource: text("answer_source"),
  status: text("status").notNull(),
  confidenceBefore: real("confidence_before").notNull(),
  confidenceAfter: real("confidence_after"),
  createdAt: text("created_at").notNull(),
  answeredAt: text("answered_at"),
}, (table) => [
  uniqueIndex("idx_training_followups_entry_sequence").on(table.entryId, table.sequence),
  index("idx_training_followups_owner_status").on(table.ownerId, table.status),
]);
