// Deleting an athlete's own data, all the way down.
//
// App data only. Not the Supabase auth row: this app never held the service
// role key that would take, and a header-identity athlete has no such row to
// begin with, so the two doors would need two different answers. Deleting the
// app data is what stops FightIQ remembering someone, which is the part that
// is actually holding their training, their injuries and their bodyweight.
//
// No export. The confirmation screen says so outright before anyone deletes.

import type { D1 } from "./debrief-db";

type R2Bucket = {
  list(options?: { prefix?: string; cursor?: string; limit?: number }): Promise<{
    objects: Array<{ key: string }>;
    truncated: boolean;
    cursor?: string;
  }>;
  delete(keys: string | string[]): Promise<void>;
};

/**
 * Every table keyed to `owner_id`, in the order the deletes run.
 *
 * `tests/account-deletion.test.mjs` cross-checks this against `lib/schema.ts`
 * and fails the moment a new owner_id table exists here that is not in this
 * list. Order does not matter for correctness, since the deletes all run in
 * one batch, but `athlete_accounts` is last so a half-read race during the
 * batch cannot find a signed-up athlete with nothing behind them.
 */
export const DELETABLE_TABLES: string[] = [
  "training_debriefs",
  "training_followups",
  "training_entries",
  "fighter_profiles",
  "fighter_brain_evidence",
  "fighter_focus_recommendation_log",
  "debrief_generation_leases",
  "coach_messages",
  "coach_chats",
  "coach_message_enrichments",
  "coach_turns",
  "workout_plans",
  "workout_setups",
  "workout_performances",
  "nutrition_entries",
  "pre_training_briefs",
  "training_experiments",
  "training_experiment_sessions",
  "video_recommendation_history",
  "focus_periods",
  "athlete_weigh_ins",
  "model_usage",
  "training_holds",
  "athlete_accounts",
];

type UsageRow = {
  surface: string;
  model: string;
  effort: string;
  ok: number;
  input_tokens: number;
  output_tokens: number;
  cache_read_tokens: number;
  cache_write_tokens: number;
  created_at: string;
};

type DailyTotal = {
  day: string;
  surface: string;
  model: string;
  effort: string;
  calls: number;
  okCalls: number;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
};

/** Folds one owner's model_usage rows into day + surface + model + effort totals that name nobody. */
export function rollUpDaily(rows: UsageRow[]): DailyTotal[] {
  const byKey = new Map<string, DailyTotal>();
  for (const row of rows) {
    const day = row.created_at.slice(0, 10);
    const key = `${day}|${row.surface}|${row.model}|${row.effort}`;
    const total = byKey.get(key) ?? {
      day, surface: row.surface, model: row.model, effort: row.effort,
      calls: 0, okCalls: 0, inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0,
    };
    total.calls += 1;
    total.okCalls += row.ok ? 1 : 0;
    total.inputTokens += row.input_tokens;
    total.outputTokens += row.output_tokens;
    total.cacheReadTokens += row.cache_read_tokens;
    total.cacheWriteTokens += row.cache_write_tokens;
    byKey.set(key, total);
  }
  return [...byKey.values()];
}

/** Every object key under this athlete's R2 prefix, following the cursor until the list stops truncating. */
async function ownedObjectKeys(uploads: R2Bucket, ownerId: string): Promise<string[]> {
  const keys: string[] = [];
  let cursor: string | undefined;
  for (;;) {
    const page = await uploads.list({ prefix: `${ownerId}/`, cursor });
    keys.push(...page.objects.map((object) => object.key));
    if (!page.truncated) return keys;
    cursor = page.cursor;
  }
}

const R2_DELETE_BATCH = 1000;

/**
 * Hard-deletes everything FightIQ holds for this athlete.
 *
 * R2 objects go first, then every D1 row in one batch, because a batch is one
 * transaction: either every table loses this owner or none of them do. The
 * model_usage rows are rolled into model_usage_daily inside the same batch, so
 * the aggregate spend is written and the identified rows are removed as one
 * atomic step rather than two that a crash could split.
 */
export async function deleteAccountData(db: D1, uploads: R2Bucket | undefined, ownerId: string): Promise<void> {
  if (uploads) {
    const keys = await ownedObjectKeys(uploads, ownerId);
    for (let index = 0; index < keys.length; index += R2_DELETE_BATCH) {
      await uploads.delete(keys.slice(index, index + R2_DELETE_BATCH));
    }
  }

  const usage = await db.prepare(
    "SELECT surface, model, effort, ok, input_tokens, output_tokens, cache_read_tokens, cache_write_tokens, created_at FROM model_usage WHERE owner_id = ?"
  ).bind(ownerId).all<UsageRow>();
  const totals = rollUpDaily(usage.results ?? []);

  const statements = [
    ...totals.map((total) => db.prepare(
      `INSERT INTO model_usage_daily (day, surface, model, effort, calls, ok_calls, input_tokens, output_tokens, cache_read_tokens, cache_write_tokens)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT (day, surface, model, effort) DO UPDATE SET
         calls = model_usage_daily.calls + excluded.calls,
         ok_calls = model_usage_daily.ok_calls + excluded.ok_calls,
         input_tokens = model_usage_daily.input_tokens + excluded.input_tokens,
         output_tokens = model_usage_daily.output_tokens + excluded.output_tokens,
         cache_read_tokens = model_usage_daily.cache_read_tokens + excluded.cache_read_tokens,
         cache_write_tokens = model_usage_daily.cache_write_tokens + excluded.cache_write_tokens`
    ).bind(total.day, total.surface, total.model, total.effort, total.calls, total.okCalls, total.inputTokens, total.outputTokens, total.cacheReadTokens, total.cacheWriteTokens)),
    ...DELETABLE_TABLES.map((table) => db.prepare(`DELETE FROM ${table} WHERE owner_id = ?`).bind(ownerId)),
  ];
  await db.batch(statements);
}
