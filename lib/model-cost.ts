// What the product actually spends, per person, per surface.
//
// Nothing recorded what a model call cost, which is a bigger gap than a missing
// metric: it means nobody can say whether this product is profitable at any
// price. It also means the most expensive configuration available, Opus at high
// effort with thinking on, is being spent on every interaction rather than on
// the ones that deserve it, and there was no way to notice.
//
// PRIVACY, and this is a hard rule rather than a preference. This table records
// counts and identifiers only. No prompt, no response, no fragment of either.
// What an athlete tells a coach about their own body and their own failures is
// the most private thing in this product and it has no business in a cost table.
// If a future change needs content to answer a cost question, the answer is that
// the question is wrong.

import type { D1 } from "./debrief-db";

/** The four places this app spends money, named so cost can be read per surface. */
export type ModelSurface = "debrief" | "coach" | "workout-plan" | "meal-estimate";

export type ModelUsage = {
  inputTokens: number;
  outputTokens: number;
  /** Tokens read from the prompt cache. Cheaper than input, and worth seeing separately. */
  cacheReadTokens: number;
  /** Tokens written into the prompt cache. More expensive than input, once. */
  cacheWriteTokens: number;
};

export type UsageRecord = ModelUsage & {
  surface: ModelSurface;
  model: string;
  effort: string;
  /** False when the call failed. A refusal or a timeout still costs money. */
  ok: boolean;
};

/**
 * Published Opus 5 rates, in dollars per million tokens.
 *
 * Kept here rather than inlined so that one edit re-prices every report, and so
 * that a reader can see exactly which numbers a cost claim rests on. If these
 * drift from the published rates the reports are wrong, which is why the test
 * asserts the shape rather than the arithmetic being clever.
 */
export const RATES = {
  input: 15 / 1_000_000,
  output: 75 / 1_000_000,
  cacheWrite: 18.75 / 1_000_000,
  cacheRead: 1.5 / 1_000_000,
};

export function costOf(usage: ModelUsage): number {
  return usage.inputTokens * RATES.input
    + usage.outputTokens * RATES.output
    + usage.cacheWriteTokens * RATES.cacheWrite
    + usage.cacheReadTokens * RATES.cacheRead;
}

/** Reads the counts out of whatever the SDK handed back, without trusting its shape. */
export function readUsage(value: unknown): ModelUsage {
  const usage = (value && typeof value === "object" ? value : {}) as Record<string, unknown>;
  const count = (key: string) => {
    const raw = usage[key];
    return typeof raw === "number" && Number.isFinite(raw) && raw > 0 ? Math.round(raw) : 0;
  };
  return {
    inputTokens: count("input_tokens"),
    outputTokens: count("output_tokens"),
    cacheReadTokens: count("cache_read_input_tokens"),
    cacheWriteTokens: count("cache_creation_input_tokens"),
  };
}

/**
 * Record one call.
 *
 * Never awaited into a response and never allowed to throw: a cost row must not
 * be the reason an athlete's debrief fails. A lost row is a rounding error in a
 * monthly figure; a lost debrief is the product not working.
 */
export async function recordModelUsage(db: D1, ownerId: string, record: UsageRecord, now = new Date().toISOString()) {
  try {
    await db.prepare(`INSERT INTO model_usage
      (id, owner_id, surface, model, effort, input_tokens, output_tokens, cache_read_tokens, cache_write_tokens, ok, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .bind(crypto.randomUUID(), ownerId, record.surface, record.model, record.effort,
        record.inputTokens, record.outputTokens, record.cacheReadTokens, record.cacheWriteTokens,
        record.ok ? 1 : 0, now).run();
  } catch { /* a cost row is never worth failing a request over */ }
}

export type SurfaceCost = {
  surface: string;
  calls: number;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  costUsd: number;
};

export type CostReport = {
  since: string;
  /** Owners with at least one call in the window. The denominator that matters. */
  activeOwners: number;
  calls: number;
  costUsd: number;
  /** The number the price has to clear. */
  costPerActiveOwnerUsd: number;
  bySurface: SurfaceCost[];
};

/**
 * Cost per active owner over a window.
 *
 * Active means they made at least one model call, which is the honest
 * denominator: an account that signed up and never came back costs nothing and
 * should not flatter the average.
 */
export async function getCostReport(db: D1, since: string): Promise<CostReport> {
  const rows = (await db.prepare(`SELECT owner_id, surface,
      SUM(input_tokens) AS input_tokens, SUM(output_tokens) AS output_tokens,
      SUM(cache_read_tokens) AS cache_read_tokens, SUM(cache_write_tokens) AS cache_write_tokens,
      COUNT(*) AS calls
    FROM model_usage WHERE created_at >= ? GROUP BY owner_id, surface`)
    .bind(since).all<{ owner_id: string; surface: string; input_tokens: number; output_tokens: number; cache_read_tokens: number; cache_write_tokens: number; calls: number }>()).results ?? [];

  const owners = new Set<string>();
  const bySurface = new Map<string, SurfaceCost>();
  let calls = 0;
  let costUsd = 0;
  for (const row of rows) {
    owners.add(row.owner_id);
    const usage: ModelUsage = {
      inputTokens: Number(row.input_tokens) || 0,
      outputTokens: Number(row.output_tokens) || 0,
      cacheReadTokens: Number(row.cache_read_tokens) || 0,
      cacheWriteTokens: Number(row.cache_write_tokens) || 0,
    };
    const cost = costOf(usage);
    calls += Number(row.calls) || 0;
    costUsd += cost;
    const existing = bySurface.get(row.surface) ?? { surface: row.surface, calls: 0, inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, costUsd: 0 };
    existing.calls += Number(row.calls) || 0;
    existing.inputTokens += usage.inputTokens;
    existing.outputTokens += usage.outputTokens;
    existing.cacheReadTokens += usage.cacheReadTokens;
    existing.cacheWriteTokens += usage.cacheWriteTokens;
    existing.costUsd += cost;
    bySurface.set(row.surface, existing);
  }
  return {
    since,
    activeOwners: owners.size,
    calls,
    costUsd: round(costUsd),
    costPerActiveOwnerUsd: owners.size ? round(costUsd / owners.size) : 0,
    bySurface: [...bySurface.values()].map((item) => ({ ...item, costUsd: round(item.costUsd) })).sort((a, b) => b.costUsd - a.costUsd),
  };
}

function round(value: number) {
  return Math.round(value * 10_000) / 10_000;
}
