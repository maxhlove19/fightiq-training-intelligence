// Bodyweight, kept as a record instead of a current value.
//
// Weight lived inside athlete_setup_json, and the onboarding route upserts that
// whole blob. So an athlete who went back through setup and typed a new weight
// destroyed the old one. FightIQ could never show a curve, never relate how
// somebody performed to what they weighed, and never see a hard cut coming.
//
// In most apps that would be a nice-to-have. In combat sports the weight curve
// is the sport: making weight is half of what an athlete is managing, and the
// difference between walking around at 84 and fighting at 77 is the whole story
// of their camp. It is also the same unrecoverable class as the focus was. Every
// day without it is a day nobody can reconstruct.

import type { D1 } from "./debrief-db";

export type WeighIn = {
  id: string;
  weightKg: number;
  /** onboarding when it came from the setup blob, logged when the athlete entered it. */
  source: "onboarding" | "logged";
  recordedAt: string;
};

export type WeightRecord = {
  entries: WeighIn[];
  latest: WeighIn | null;
  /** The oldest weigh-in on record. The other end of the curve. */
  first: WeighIn | null;
  /** Latest minus the weigh-in closest to 30 days before it, or null with nothing to compare. */
  changeKg: number | null;
  /** Days between the two weigh-ins `changeKg` is measured across. */
  changeDays: number;
};

/** Two weigh-ins on the same day at the same weight are one weigh-in. */
const SAME_DAY = (left: string, right: string) => left.slice(0, 10) === right.slice(0, 10);

/** Scales disagree by less than this, and a record full of noise is not a record. */
const MEANINGFUL_KG = 0.05;

export function isUsableWeight(value: unknown): value is number {
  // 25kg is below any adult competitor and 300kg is above any human athlete, so
  // anything outside is a typo or a unit mix-up rather than a weigh-in.
  return typeof value === "number" && Number.isFinite(value) && value >= 25 && value <= 300;
}

/**
 * Record a weigh-in, unless it says the same thing as the last one.
 *
 * Called from the read path for the setup value, the same way the focus is, so
 * that an athlete who changes their weight in onboarding leaves both numbers
 * behind rather than one. Called directly when they log one.
 *
 * A repeat of the latest weight on the same day is dropped: /api/product is read
 * on every screen, and a record that gains a row per page load is not a record.
 */
export async function recordWeighIn(db: D1, ownerId: string, args: {
  weightKg: number;
  source: WeighIn["source"];
  now: string;
}) {
  if (!isUsableWeight(args.weightKg)) return false;
  const latest = await db.prepare("SELECT weight_kg, recorded_at FROM athlete_weigh_ins WHERE owner_id = ? ORDER BY recorded_at DESC LIMIT 1")
    .bind(ownerId).first<{ weight_kg: number; recorded_at: string }>();
  if (latest) {
    const unchanged = Math.abs(latest.weight_kg - args.weightKg) < MEANINGFUL_KG;
    // The same number again is nothing new. A different number on a day already
    // recorded replaces it, because an athlete correcting a typo should not end
    // up with two weights for one morning.
    if (unchanged) return false;
    if (SAME_DAY(latest.recorded_at, args.now)) {
      await db.prepare("UPDATE athlete_weigh_ins SET weight_kg = ?, source = ? WHERE owner_id = ? AND recorded_at = ?")
        .bind(args.weightKg, args.source, ownerId, latest.recorded_at).run();
      return true;
    }
  }
  await db.prepare("INSERT INTO athlete_weigh_ins (id, owner_id, weight_kg, source, recorded_at) VALUES (?, ?, ?, ?, ?)")
    .bind(crypto.randomUUID(), ownerId, args.weightKg, args.source, args.now).run();
  return true;
}

/**
 * The curve, oldest first, plus the one number an athlete actually asks for.
 *
 * `changeKg` is measured against the weigh-in nearest thirty days before the
 * latest one rather than against the previous row, because "down 2kg since last
 * Tuesday" and "down 2kg over a month" are different facts and only the second
 * one means anything about a camp.
 */
export async function getWeightRecord(db: D1, ownerId: string, limit = 60): Promise<WeightRecord> {
  const result = await db.prepare("SELECT id, weight_kg, source, recorded_at FROM athlete_weigh_ins WHERE owner_id = ? ORDER BY recorded_at DESC LIMIT ?")
    .bind(ownerId, limit).all<{ id: string; weight_kg: number; source: string; recorded_at: string }>();
  const entries: WeighIn[] = (result.results ?? [])
    .map((row) => ({
      id: row.id,
      weightKg: row.weight_kg,
      source: row.source === "logged" ? "logged" as const : "onboarding" as const,
      recordedAt: row.recorded_at,
    }))
    .reverse();
  const latest = entries.at(-1) ?? null;
  const first = entries[0] ?? null;
  if (!latest || entries.length < 2) {
    return { entries, latest, first, changeKg: null, changeDays: 0 };
  }
  const latestAt = Date.parse(latest.recordedAt);
  const target = latestAt - 30 * 86_400_000;
  // The weigh-in closest to thirty days back, from either side, so an athlete
  // who logs fortnightly still gets a comparison rather than nothing.
  const reference = entries.slice(0, -1).reduce((best, entry) =>
    Math.abs(Date.parse(entry.recordedAt) - target) < Math.abs(Date.parse(best.recordedAt) - target) ? entry : best);
  const changeDays = Math.max(1, Math.round((latestAt - Date.parse(reference.recordedAt)) / 86_400_000));
  return {
    entries,
    latest,
    first,
    changeKg: Math.round((latest.weightKg - reference.weightKg) * 10) / 10,
    changeDays,
  };
}
