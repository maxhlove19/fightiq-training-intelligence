// Every table and index the app runs on, in one list.
//
// This used to live in two functions in two files, and which one you called
// decided which half of the schema existed. A database that had never been
// written to failed on the first screen an athlete saw, because the table
// holding their sessions was only created by the route that saved one.
//
// One list, applied by every entry point, on reads as well as writes. Adding a
// table here is the only place it needs to go — and tests/schema-boot.test.mjs
// proves every query in the codebase still parses against it.

export const APP_SCHEMA: string[] = [
  `CREATE TABLE IF NOT EXISTS training_debriefs (
      entry_id TEXT PRIMARY KEY NOT NULL,
      owner_id TEXT NOT NULL,
      summary TEXT,
      takeaway TEXT,
      coach_detail TEXT,
      fightiq_explanation TEXT,
      next_session_focus TEXT,
      structured_memory_json TEXT,
      status TEXT NOT NULL,
      question_count INTEGER NOT NULL DEFAULT 0,
      confidence REAL NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )`,
  "CREATE INDEX IF NOT EXISTS idx_training_debriefs_owner_status ON training_debriefs (owner_id, status)",
  `CREATE TABLE IF NOT EXISTS training_followups (
      id TEXT PRIMARY KEY NOT NULL,
      entry_id TEXT NOT NULL,
      owner_id TEXT NOT NULL,
      sequence INTEGER NOT NULL,
      question TEXT NOT NULL,
      choices_json TEXT NOT NULL,
      target_field TEXT NOT NULL,
      why_asked TEXT NOT NULL,
      answer TEXT,
      answer_source TEXT,
      status TEXT NOT NULL,
      confidence_before REAL NOT NULL,
      confidence_after REAL,
      created_at TEXT NOT NULL,
      answered_at TEXT
    )`,
  "CREATE UNIQUE INDEX IF NOT EXISTS idx_training_followups_entry_sequence ON training_followups (entry_id, sequence)",
  "CREATE INDEX IF NOT EXISTS idx_training_followups_owner_status ON training_followups (owner_id, status)",
  `CREATE TABLE IF NOT EXISTS training_entries (
      id TEXT PRIMARY KEY NOT NULL,
      owner_id TEXT NOT NULL,
      discipline TEXT NOT NULL,
      session_type TEXT NOT NULL,
      raw_entry TEXT NOT NULL,
      input_method TEXT NOT NULL,
      created_at TEXT NOT NULL
    )`,
  "CREATE INDEX IF NOT EXISTS idx_training_entries_owner_created ON training_entries (owner_id, created_at)",
  `CREATE TABLE IF NOT EXISTS fighter_profiles (
      owner_id TEXT PRIMARY KEY NOT NULL,
      onboarding_completed_at TEXT,
      athlete_setup_json TEXT NOT NULL DEFAULT '{}',
      current_focus TEXT,
      focus_reason TEXT,
      primary_goal TEXT NOT NULL DEFAULT 'performance',
      style_influences_json TEXT NOT NULL DEFAULT '[]',
      calorie_target INTEGER NOT NULL DEFAULT 2400,
      protein_target INTEGER NOT NULL DEFAULT 180,
      carb_target INTEGER NOT NULL DEFAULT 260,
      fat_target INTEGER NOT NULL DEFAULT 70,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )`,
  `CREATE TABLE IF NOT EXISTS fighter_brain_evidence (
      id TEXT PRIMARY KEY NOT NULL,
      owner_id TEXT NOT NULL,
      entry_id TEXT NOT NULL,
      category TEXT NOT NULL,
      canonical_key TEXT NOT NULL,
      label TEXT NOT NULL,
      source TEXT NOT NULL,
      confidence REAL NOT NULL,
      observed_at TEXT NOT NULL,
      created_at TEXT NOT NULL
    )`,
  "CREATE UNIQUE INDEX IF NOT EXISTS idx_fighter_brain_evidence_entry_claim ON fighter_brain_evidence (owner_id, entry_id, category, canonical_key)",
  "CREATE INDEX IF NOT EXISTS idx_fighter_brain_evidence_owner_category_observed ON fighter_brain_evidence (owner_id, category, observed_at)",
  `CREATE TABLE IF NOT EXISTS fighter_focus_recommendations (
      owner_id TEXT PRIMARY KEY NOT NULL,
      focus TEXT NOT NULL,
      reason TEXT NOT NULL,
      confidence REAL NOT NULL,
      entry_id TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )`,
  "CREATE INDEX IF NOT EXISTS idx_fighter_focus_recommendations_updated ON fighter_focus_recommendations (updated_at)",
  `CREATE TABLE IF NOT EXISTS debrief_generation_leases (
      entry_id TEXT PRIMARY KEY NOT NULL,
      owner_id TEXT NOT NULL,
      lease_id TEXT NOT NULL,
      expires_at TEXT NOT NULL,
      created_at TEXT NOT NULL
    )`,
  "CREATE INDEX IF NOT EXISTS idx_debrief_generation_leases_owner_expires ON debrief_generation_leases (owner_id, expires_at)",
  `CREATE TABLE IF NOT EXISTS coach_messages (
      id TEXT PRIMARY KEY NOT NULL,
      owner_id TEXT NOT NULL,
      chat_id TEXT,
      role TEXT NOT NULL,
      content TEXT NOT NULL,
      created_at TEXT NOT NULL
    )`,
  "CREATE INDEX IF NOT EXISTS idx_coach_messages_owner_created ON coach_messages (owner_id, created_at)",
  `CREATE TABLE IF NOT EXISTS coach_chats (
      id TEXT PRIMARY KEY NOT NULL,
      owner_id TEXT NOT NULL,
      title TEXT NOT NULL DEFAULT 'New chat',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )`,
  "CREATE INDEX IF NOT EXISTS idx_coach_chats_owner_updated ON coach_chats (owner_id, updated_at)",
  `CREATE TABLE IF NOT EXISTS coach_message_enrichments (
      assistant_message_id TEXT PRIMARY KEY NOT NULL,
      owner_id TEXT NOT NULL,
      follow_up TEXT NOT NULL,
      follow_up_choices_json TEXT NOT NULL DEFAULT '[]',
      video_mode TEXT NOT NULL DEFAULT 'none',
      video_topic TEXT,
      video_prompt TEXT,
      created_at TEXT NOT NULL
    )`,
  "CREATE INDEX IF NOT EXISTS idx_coach_message_enrichments_owner_created ON coach_message_enrichments (owner_id, created_at)",
  `CREATE TABLE IF NOT EXISTS coach_turns (
      user_message_id TEXT PRIMARY KEY NOT NULL,
      owner_id TEXT NOT NULL,
      chat_id TEXT,
      assistant_message_id TEXT,
      status TEXT NOT NULL DEFAULT 'pending',
      created_at TEXT NOT NULL,
      completed_at TEXT
    )`,
  "CREATE UNIQUE INDEX IF NOT EXISTS idx_coach_turns_assistant_message ON coach_turns (assistant_message_id)",
  "CREATE INDEX IF NOT EXISTS idx_coach_turns_owner_status ON coach_turns (owner_id, status, created_at)",
  `CREATE TABLE IF NOT EXISTS workout_plans (
      id TEXT PRIMARY KEY NOT NULL,
      owner_id TEXT NOT NULL,
      discipline TEXT NOT NULL,
      goal TEXT NOT NULL,
      fatigue TEXT NOT NULL,
      duration_minutes INTEGER NOT NULL,
      plan_json TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'planned',
      created_at TEXT NOT NULL,
      completed_at TEXT
    )`,
  "CREATE INDEX IF NOT EXISTS idx_workout_plans_owner_created ON workout_plans (owner_id, created_at)",
  `CREATE TABLE IF NOT EXISTS workout_setups (
      owner_id TEXT PRIMARY KEY NOT NULL,
      equipment_json TEXT NOT NULL DEFAULT '[]',
      location TEXT NOT NULL DEFAULT '',
      default_duration_minutes INTEGER NOT NULL DEFAULT 35,
      unit TEXT NOT NULL DEFAULT 'lb',
      limitations TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )`,
  `CREATE TABLE IF NOT EXISTS workout_performances (
      id TEXT PRIMARY KEY NOT NULL,
      workout_id TEXT NOT NULL,
      owner_id TEXT NOT NULL,
      exercise_key TEXT NOT NULL,
      completed_sets INTEGER NOT NULL DEFAULT 0,
      completed_reps INTEGER,
      load_value REAL,
      unit TEXT NOT NULL DEFAULT 'lb',
      effort TEXT NOT NULL DEFAULT 'not_logged',
      next_action TEXT NOT NULL,
      next_load_value REAL,
      created_at TEXT NOT NULL
    )`,
  "CREATE INDEX IF NOT EXISTS idx_workout_performances_owner_exercise_created ON workout_performances (owner_id, exercise_key, created_at)",
  "CREATE UNIQUE INDEX IF NOT EXISTS idx_workout_performances_workout_exercise ON workout_performances (workout_id, exercise_key)",
  `CREATE TABLE IF NOT EXISTS nutrition_entries (
      id TEXT PRIMARY KEY NOT NULL,
      owner_id TEXT NOT NULL,
      description TEXT NOT NULL,
      foods_json TEXT NOT NULL DEFAULT '[]',
      calories INTEGER NOT NULL,
      protein REAL NOT NULL,
      carbs REAL NOT NULL,
      fat REAL NOT NULL,
      input_method TEXT NOT NULL,
      photo_key TEXT,
      created_at TEXT NOT NULL
    )`,
  "CREATE INDEX IF NOT EXISTS idx_nutrition_entries_owner_created ON nutrition_entries (owner_id, created_at)",
  `CREATE TABLE IF NOT EXISTS pre_training_briefs (
      id TEXT PRIMARY KEY NOT NULL,
      owner_id TEXT NOT NULL,
      mission TEXT NOT NULL,
      reason TEXT NOT NULL,
      cue TEXT NOT NULL,
      source_focus TEXT NOT NULL,
      created_at TEXT NOT NULL,
      consumed_at TEXT
    )`,
  "CREATE INDEX IF NOT EXISTS idx_pre_training_briefs_owner_created ON pre_training_briefs (owner_id, created_at)",
  `CREATE TABLE IF NOT EXISTS training_experiments (
      id TEXT PRIMARY KEY NOT NULL,
      owner_id TEXT NOT NULL,
      brief_id TEXT,
      mission TEXT NOT NULL,
      cue TEXT NOT NULL,
      reason TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'planned',
      started_at TEXT,
      outcome TEXT,
      evidence TEXT,
      created_at TEXT NOT NULL,
      completed_at TEXT
    )`,
  "CREATE INDEX IF NOT EXISTS idx_training_experiments_owner_status ON training_experiments (owner_id, status, created_at)",
  `CREATE TABLE IF NOT EXISTS training_experiment_sessions (
      entry_id TEXT PRIMARY KEY NOT NULL,
      owner_id TEXT NOT NULL,
      experiment_id TEXT NOT NULL,
      created_at TEXT NOT NULL
    )`,
  "CREATE INDEX IF NOT EXISTS idx_training_experiment_sessions_owner_experiment ON training_experiment_sessions (owner_id, experiment_id)",
  `CREATE TABLE IF NOT EXISTS video_recommendation_history (
      owner_id TEXT NOT NULL,
      video_id TEXT NOT NULL,
      study_topic TEXT NOT NULL,
      served_at TEXT NOT NULL,
      PRIMARY KEY (owner_id, video_id)
    )`,
  "CREATE INDEX IF NOT EXISTS idx_video_recommendation_history_owner_served ON video_recommendation_history (owner_id, served_at)",
  `CREATE TABLE IF NOT EXISTS training_holds (
      id TEXT PRIMARY KEY NOT NULL,
      owner_id TEXT NOT NULL,
      reason TEXT NOT NULL,
      entry_id TEXT,
      matched_json TEXT NOT NULL DEFAULT '[]',
      opened_at TEXT NOT NULL,
      step INTEGER NOT NULL DEFAULT 1,
      step_entered_at TEXT NOT NULL,
      medical_cleared_at TEXT,
      cleared_at TEXT,
      cleared_reason TEXT,
      setbacks INTEGER NOT NULL DEFAULT 0,
      updated_at TEXT NOT NULL
    )`,
  // Reads are always "the open hold for this athlete", so cleared_at leads.
  "CREATE INDEX IF NOT EXISTS idx_training_holds_owner_open ON training_holds (owner_id, cleared_at, opened_at)",
];

/**
 * Columns added to tables that already exist somewhere. SQLite has no
 * ADD COLUMN IF NOT EXISTS, so these are applied one at a time and the
 * "duplicate column" failure is the success case on every run after the first.
 *
 * Adding a column means adding it here AND to the CREATE above, so a fresh
 * database gets it directly and an existing one gets it on the next request.
 */
export const APP_COLUMNS: Array<{ table: string; column: string; definition: string }> = [
  { table: "training_holds", column: "cleared_reason", definition: "TEXT" },
];
