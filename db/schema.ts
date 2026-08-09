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

export const fighterProfiles = sqliteTable("fighter_profiles", {
  ownerId: text("owner_id").primaryKey(),
  currentFocus: text("current_focus"),
  focusReason: text("focus_reason"),
  primaryGoal: text("primary_goal").notNull().default("performance"),
  styleInfluencesJson: text("style_influences_json").notNull().default("[]"),
  calorieTarget: integer("calorie_target").notNull().default(2400),
  proteinTarget: integer("protein_target").notNull().default(180),
  carbTarget: integer("carb_target").notNull().default(260),
  fatTarget: integer("fat_target").notNull().default(70),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
});

export const coachMessages = sqliteTable("coach_messages", {
  id: text("id").primaryKey(),
  ownerId: text("owner_id").notNull(),
  role: text("role").notNull(),
  content: text("content").notNull(),
  createdAt: text("created_at").notNull(),
}, (table) => [index("idx_coach_messages_owner_created").on(table.ownerId, table.createdAt)]);

export const workoutPlans = sqliteTable("workout_plans", {
  id: text("id").primaryKey(),
  ownerId: text("owner_id").notNull(),
  discipline: text("discipline").notNull(),
  goal: text("goal").notNull(),
  fatigue: text("fatigue").notNull(),
  durationMinutes: integer("duration_minutes").notNull(),
  planJson: text("plan_json").notNull(),
  status: text("status").notNull().default("planned"),
  createdAt: text("created_at").notNull(),
  completedAt: text("completed_at"),
}, (table) => [index("idx_workout_plans_owner_created").on(table.ownerId, table.createdAt)]);

export const nutritionEntries = sqliteTable("nutrition_entries", {
  id: text("id").primaryKey(),
  ownerId: text("owner_id").notNull(),
  description: text("description").notNull(),
  foodsJson: text("foods_json").notNull().default("[]"),
  calories: integer("calories").notNull(),
  protein: real("protein").notNull(),
  carbs: real("carbs").notNull(),
  fat: real("fat").notNull(),
  inputMethod: text("input_method").notNull(),
  photoKey: text("photo_key"),
  createdAt: text("created_at").notNull(),
}, (table) => [index("idx_nutrition_entries_owner_created").on(table.ownerId, table.createdAt)]);
