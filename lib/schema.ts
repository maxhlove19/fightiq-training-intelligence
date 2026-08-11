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

export const APP_TABLES: string[] = [
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
  `CREATE TABLE IF NOT EXISTS training_entries (
      id TEXT PRIMARY KEY NOT NULL,
      owner_id TEXT NOT NULL,
      discipline TEXT NOT NULL,
      session_type TEXT NOT NULL,
      raw_entry TEXT NOT NULL,
      input_method TEXT NOT NULL,
      created_at TEXT NOT NULL,
      client_key TEXT
    )`,
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
  // What FightIQ suggested, as a record rather than a current value.
  //
  // The old table was keyed on owner_id and upserted, the same class of bug as
  // the focus and the bodyweight before they got their own history: one good
  // debrief could overwrite the suggestion behind it, so there was never a
  // record of what FightIQ had told somebody or when. Renamed rather than
  // altered in place, because SQLite cannot drop a primary key: an owner_id
  // still holding a row under the old name is simply never read again, the
  // same way a stale focus is retired rather than migrated.
  `CREATE TABLE IF NOT EXISTS fighter_focus_recommendation_log (
      id TEXT PRIMARY KEY NOT NULL,
      owner_id TEXT NOT NULL,
      focus TEXT NOT NULL,
      reason TEXT NOT NULL,
      confidence REAL NOT NULL,
      entry_id TEXT NOT NULL,
      created_at TEXT NOT NULL
    )`,
  `CREATE TABLE IF NOT EXISTS debrief_generation_leases (
      entry_id TEXT PRIMARY KEY NOT NULL,
      owner_id TEXT NOT NULL,
      lease_id TEXT NOT NULL,
      expires_at TEXT NOT NULL,
      created_at TEXT NOT NULL
    )`,
  `CREATE TABLE IF NOT EXISTS coach_messages (
      id TEXT PRIMARY KEY NOT NULL,
      owner_id TEXT NOT NULL,
      chat_id TEXT,
      role TEXT NOT NULL,
      content TEXT NOT NULL,
      created_at TEXT NOT NULL
    )`,
  `CREATE TABLE IF NOT EXISTS coach_chats (
      id TEXT PRIMARY KEY NOT NULL,
      owner_id TEXT NOT NULL,
      title TEXT NOT NULL DEFAULT 'New chat',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )`,
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
  `CREATE TABLE IF NOT EXISTS coach_turns (
      user_message_id TEXT PRIMARY KEY NOT NULL,
      owner_id TEXT NOT NULL,
      chat_id TEXT,
      assistant_message_id TEXT,
      status TEXT NOT NULL DEFAULT 'pending',
      created_at TEXT NOT NULL,
      completed_at TEXT
    )`,
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
  `CREATE TABLE IF NOT EXISTS training_experiment_sessions (
      entry_id TEXT PRIMARY KEY NOT NULL,
      owner_id TEXT NOT NULL,
      experiment_id TEXT NOT NULL,
      created_at TEXT NOT NULL
    )`,
  `CREATE TABLE IF NOT EXISTS video_recommendation_history (
      owner_id TEXT NOT NULL,
      video_id TEXT NOT NULL,
      study_topic TEXT NOT NULL,
      served_at TEXT NOT NULL,
      PRIMARY KEY (owner_id, video_id)
    )`,
  // Who has actually signed up. Sign-in gives the app a stable id and nothing
  // else, so without this an owner cannot tell whether they have five athletes
  // or five hundred, let alone who came back.
  `CREATE TABLE IF NOT EXISTS athlete_accounts (
      owner_id TEXT PRIMARY KEY NOT NULL,
      email TEXT,
      display_name TEXT,
      first_seen_at TEXT NOT NULL,
      last_seen_at TEXT NOT NULL,
      visits INTEGER NOT NULL DEFAULT 1
    )`,
  // The record the product's whole promise depends on.
  //
  // "Current focus" was a single field that got overwritten every time the
  // evidence moved, so the moment it changed the old one was gone: no record it
  // existed, no record of when it started or ended, and no record of what was
  // logged while it was live. That makes the one question worth paying for after
  // month one unanswerable, because the answer is the sequence and the sequence
  // was being thrown away.
  //
  // Session counts are deliberately NOT stored here. They are derived from
  // training_entries by date range on read, so they cannot drift out of step
  // with the sessions they claim to count.
  `CREATE TABLE IF NOT EXISTS focus_periods (
      id TEXT PRIMARY KEY NOT NULL,
      owner_id TEXT NOT NULL,
      focus TEXT NOT NULL,
      reason TEXT NOT NULL DEFAULT '',
      /** stated | fightiq | opening | backfilled. Where this focus came from. */
      source TEXT NOT NULL DEFAULT 'fightiq',
      started_at TEXT NOT NULL,
      /** Null while this is the focus the athlete is on. */
      ended_at TEXT
    )`,
  // Bodyweight as a record rather than a current value.
  //
  // It lived inside athlete_setup_json, and onboarding upserts that whole blob,
  // so changing your weight destroyed the previous one. In combat sports the
  // weight curve is not a nice-to-have, it is half of what an athlete manages,
  // and like the focus it cannot be reconstructed after the fact.
  `CREATE TABLE IF NOT EXISTS athlete_weigh_ins (
      id TEXT PRIMARY KEY NOT NULL,
      owner_id TEXT NOT NULL,
      weight_kg REAL NOT NULL,
      /** onboarding | logged */
      source TEXT NOT NULL DEFAULT 'onboarding',
      recorded_at TEXT NOT NULL
    )`,
  // What each model call cost, per owner, per surface.
  //
  // Counts and identifiers only. No prompt, no response, no fragment of either:
  // what an athlete tells a coach about their own body and their own failures is
  // the most private thing here and it does not belong in a cost table.
  `CREATE TABLE IF NOT EXISTS model_usage (
      id TEXT PRIMARY KEY NOT NULL,
      owner_id TEXT NOT NULL,
      /** debrief | coach | workout-plan | meal-estimate */
      surface TEXT NOT NULL,
      model TEXT NOT NULL,
      effort TEXT NOT NULL,
      input_tokens INTEGER NOT NULL DEFAULT 0,
      output_tokens INTEGER NOT NULL DEFAULT 0,
      cache_read_tokens INTEGER NOT NULL DEFAULT 0,
      cache_write_tokens INTEGER NOT NULL DEFAULT 0,
      /** A refusal or a timeout still costs money, so failures are recorded too. */
      ok INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL
    )`,
  // What deleted accounts spent, with nothing left to identify who.
  //
  // Self-service deletion purges model_usage entirely for the owner it
  // belongs to, because "counts and identifiers only" still names an owner.
  // Before that delete runs, their rows are folded into this table by day,
  // surface, model and effort, so the total the product spent does not
  // disappear along with the person. Nothing here can be traced to an athlete.
  `CREATE TABLE IF NOT EXISTS model_usage_daily (
      day TEXT NOT NULL,
      surface TEXT NOT NULL,
      model TEXT NOT NULL,
      effort TEXT NOT NULL,
      calls INTEGER NOT NULL DEFAULT 0,
      ok_calls INTEGER NOT NULL DEFAULT 0,
      input_tokens INTEGER NOT NULL DEFAULT 0,
      output_tokens INTEGER NOT NULL DEFAULT 0,
      cache_read_tokens INTEGER NOT NULL DEFAULT 0,
      cache_write_tokens INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY (day, surface, model, effort)
    )`,
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
];

// Indexes are applied after APP_COLUMNS, never alongside the tables. An index
// over a column that APP_COLUMNS adds cannot be created until that column
// exists, and on a database that predates the column it does not. Creating it
// in the same batch as the tables took every request in the app down with
// "no such column" — while a brand-new database was perfectly fine, which is
// why tests/schema-boot.test.mjs now upgrades an old database as well as
// building a new one.
export const APP_INDEXES: string[] = [
  "CREATE INDEX IF NOT EXISTS idx_training_debriefs_owner_status ON training_debriefs (owner_id, status)",
  "CREATE UNIQUE INDEX IF NOT EXISTS idx_training_followups_entry_sequence ON training_followups (entry_id, sequence)",
  "CREATE INDEX IF NOT EXISTS idx_training_followups_owner_status ON training_followups (owner_id, status)",
  "CREATE INDEX IF NOT EXISTS idx_training_entries_owner_created ON training_entries (owner_id, created_at)",
  // NULLs are distinct in SQLite, so entries saved without a key are unaffected.
  "CREATE UNIQUE INDEX IF NOT EXISTS idx_training_entries_owner_client_key ON training_entries (owner_id, client_key)",
  "CREATE UNIQUE INDEX IF NOT EXISTS idx_fighter_brain_evidence_entry_claim ON fighter_brain_evidence (owner_id, entry_id, category, canonical_key)",
  "CREATE INDEX IF NOT EXISTS idx_fighter_brain_evidence_owner_category_observed ON fighter_brain_evidence (owner_id, category, observed_at)",
  "CREATE INDEX IF NOT EXISTS idx_fighter_focus_recommendation_log_owner_created ON fighter_focus_recommendation_log (owner_id, created_at)",
  "CREATE INDEX IF NOT EXISTS idx_debrief_generation_leases_owner_expires ON debrief_generation_leases (owner_id, expires_at)",
  "CREATE INDEX IF NOT EXISTS idx_coach_messages_owner_created ON coach_messages (owner_id, created_at)",
  "CREATE INDEX IF NOT EXISTS idx_coach_chats_owner_updated ON coach_chats (owner_id, updated_at)",
  "CREATE INDEX IF NOT EXISTS idx_coach_message_enrichments_owner_created ON coach_message_enrichments (owner_id, created_at)",
  "CREATE UNIQUE INDEX IF NOT EXISTS idx_coach_turns_assistant_message ON coach_turns (assistant_message_id)",
  "CREATE INDEX IF NOT EXISTS idx_coach_turns_owner_status ON coach_turns (owner_id, status, created_at)",
  "CREATE INDEX IF NOT EXISTS idx_workout_plans_owner_created ON workout_plans (owner_id, created_at)",
  "CREATE INDEX IF NOT EXISTS idx_workout_performances_owner_exercise_created ON workout_performances (owner_id, exercise_key, created_at)",
  "CREATE UNIQUE INDEX IF NOT EXISTS idx_workout_performances_workout_exercise ON workout_performances (workout_id, exercise_key)",
  "CREATE INDEX IF NOT EXISTS idx_nutrition_entries_owner_created ON nutrition_entries (owner_id, created_at)",
  "CREATE INDEX IF NOT EXISTS idx_pre_training_briefs_owner_created ON pre_training_briefs (owner_id, created_at)",
  "CREATE INDEX IF NOT EXISTS idx_training_experiments_owner_status ON training_experiments (owner_id, status, created_at)",
  "CREATE INDEX IF NOT EXISTS idx_training_experiment_sessions_owner_experiment ON training_experiment_sessions (owner_id, experiment_id)",
  "CREATE INDEX IF NOT EXISTS idx_video_recommendation_history_owner_served ON video_recommendation_history (owner_id, served_at)",
  // Reads are always "the open hold for this athlete", so cleared_at leads.
  "CREATE INDEX IF NOT EXISTS idx_training_holds_owner_open ON training_holds (owner_id, cleared_at, opened_at)",
  // Every read is either "the open period" or "the whole history, newest first".
  "CREATE INDEX IF NOT EXISTS idx_focus_periods_owner_started ON focus_periods (owner_id, started_at)",
  // On owner_id alone, not (owner_id, ended_at). SQLite treats NULLs as distinct
  // in a unique index, so indexing the always-NULL column would have enforced
  // nothing at all while looking like it enforced something.
  "CREATE UNIQUE INDEX IF NOT EXISTS idx_focus_periods_owner_open ON focus_periods (owner_id) WHERE ended_at IS NULL",
  // Every read is "everything since a date", grouped by owner and surface.
  "CREATE INDEX IF NOT EXISTS idx_model_usage_created ON model_usage (created_at)",
  "CREATE INDEX IF NOT EXISTS idx_model_usage_owner_created ON model_usage (owner_id, created_at)",
  "CREATE INDEX IF NOT EXISTS idx_athlete_weigh_ins_owner_recorded ON athlete_weigh_ins (owner_id, recorded_at)",
  "CREATE INDEX IF NOT EXISTS idx_athlete_accounts_last_seen ON athlete_accounts (last_seen_at)",
  "CREATE INDEX IF NOT EXISTS idx_athlete_accounts_first_seen ON athlete_accounts (first_seen_at)",
];

/** Everything, in order, for anything building a database from nothing. */
export const APP_SCHEMA: string[] = [...APP_TABLES, ...APP_INDEXES];

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
  { table: "training_entries", column: "client_key", definition: "TEXT" },
];
