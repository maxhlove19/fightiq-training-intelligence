import { index, integer, primaryKey, real, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

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

// Evidence is the durable source of truth for Fighter Brain. We retain the
// athlete's own wording in `label`, but group related reports under a stable
// canonical key so natural language variation does not create fake new traits.
export const fighterBrainEvidence = sqliteTable("fighter_brain_evidence", {
  id: text("id").primaryKey(),
  ownerId: text("owner_id").notNull(),
  entryId: text("entry_id").notNull(),
  category: text("category").notNull(),
  canonicalKey: text("canonical_key").notNull(),
  label: text("label").notNull(),
  source: text("source").notNull(),
  confidence: real("confidence").notNull(),
  observedAt: text("observed_at").notNull(),
  createdAt: text("created_at").notNull(),
}, (table) => [
  uniqueIndex("idx_fighter_brain_evidence_entry_claim").on(table.ownerId, table.entryId, table.category, table.canonicalKey),
  index("idx_fighter_brain_evidence_owner_category_observed").on(table.ownerId, table.category, table.observedAt),
]);

// The athlete's manually edited focus always wins. This is FightIQ's evolving
// recommendation, kept separately so one good session cannot overwrite intent.
export const fighterFocusRecommendations = sqliteTable("fighter_focus_recommendations", {
  ownerId: text("owner_id").primaryKey(),
  focus: text("focus").notNull(),
  reason: text("reason").notNull(),
  confidence: real("confidence").notNull(),
  entryId: text("entry_id").notNull(),
  updatedAt: text("updated_at").notNull(),
}, (table) => [index("idx_fighter_focus_recommendations_updated").on(table.updatedAt)]);

export const debriefGenerationLeases = sqliteTable("debrief_generation_leases", {
  entryId: text("entry_id").primaryKey(),
  ownerId: text("owner_id").notNull(),
  leaseId: text("lease_id").notNull(),
  expiresAt: text("expires_at").notNull(),
  createdAt: text("created_at").notNull(),
}, (table) => [index("idx_debrief_generation_leases_owner_expires").on(table.ownerId, table.expiresAt)]);

export const coachMessages = sqliteTable("coach_messages", {
  id: text("id").primaryKey(),
  ownerId: text("owner_id").notNull(),
  role: text("role").notNull(),
  content: text("content").notNull(),
  createdAt: text("created_at").notNull(),
}, (table) => [index("idx_coach_messages_owner_created").on(table.ownerId, table.createdAt)]);

export const coachMessageEnrichments = sqliteTable("coach_message_enrichments", {
  assistantMessageId: text("assistant_message_id").primaryKey(),
  ownerId: text("owner_id").notNull(),
  followUp: text("follow_up").notNull(),
  followUpChoicesJson: text("follow_up_choices_json").notNull().default("[]"),
  videoMode: text("video_mode").notNull().default("none"),
  videoTopic: text("video_topic"),
  videoPrompt: text("video_prompt"),
  createdAt: text("created_at").notNull(),
}, (table) => [index("idx_coach_message_enrichments_owner_created").on(table.ownerId, table.createdAt)]);

// One athlete message owns one Coach response. Besides keeping the chat in a
// sensible turn order, this makes a retry safe when a request finishes on the
// server after the client lost the response.
export const coachTurns = sqliteTable("coach_turns", {
  userMessageId: text("user_message_id").primaryKey(),
  ownerId: text("owner_id").notNull(),
  assistantMessageId: text("assistant_message_id"),
  status: text("status").notNull().default("pending"),
  createdAt: text("created_at").notNull(),
  completedAt: text("completed_at"),
}, (table) => [
  uniqueIndex("idx_coach_turns_assistant_message").on(table.assistantMessageId),
  index("idx_coach_turns_owner_status").on(table.ownerId, table.status, table.createdAt),
]);

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

export const preTrainingBriefs = sqliteTable("pre_training_briefs", {
  id: text("id").primaryKey(),
  ownerId: text("owner_id").notNull(),
  mission: text("mission").notNull(),
  reason: text("reason").notNull(),
  cue: text("cue").notNull(),
  sourceFocus: text("source_focus").notNull(),
  createdAt: text("created_at").notNull(),
  consumedAt: text("consumed_at"),
}, (table) => [index("idx_pre_training_briefs_owner_created").on(table.ownerId, table.createdAt)]);

export const trainingExperiments = sqliteTable("training_experiments", {
  id: text("id").primaryKey(),
  ownerId: text("owner_id").notNull(),
  briefId: text("brief_id"),
  mission: text("mission").notNull(),
  cue: text("cue").notNull(),
  reason: text("reason").notNull(),
  status: text("status").notNull().default("planned"),
  startedAt: text("started_at"),
  outcome: text("outcome"),
  evidence: text("evidence"),
  createdAt: text("created_at").notNull(),
  completedAt: text("completed_at"),
}, (table) => [index("idx_training_experiments_owner_status").on(table.ownerId, table.status, table.createdAt)]);

export const trainingExperimentSessions = sqliteTable("training_experiment_sessions", {
  entryId: text("entry_id").primaryKey(),
  ownerId: text("owner_id").notNull(),
  experimentId: text("experiment_id").notNull(),
  createdAt: text("created_at").notNull(),
}, (table) => [index("idx_training_experiment_sessions_owner_experiment").on(table.ownerId, table.experimentId)]);

export const videoRecommendationHistory = sqliteTable("video_recommendation_history", {
  ownerId: text("owner_id").notNull(),
  videoId: text("video_id").notNull(),
  studyTopic: text("study_topic").notNull(),
  servedAt: text("served_at").notNull(),
}, (table) => [
  primaryKey({ columns: [table.ownerId, table.videoId] }),
  index("idx_video_recommendation_history_owner_served").on(table.ownerId, table.servedAt),
]);
