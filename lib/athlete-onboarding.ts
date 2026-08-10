import type { AthleteSetup } from "./product-db";

export type MacroTargets = { calories: number; protein: number; carbs: number; fat: number };

export type OnboardingInput = AthleteSetup & {
  primaryGoal: "cut" | "maintain" | "gain muscle" | "performance";
  currentFocus: string;
  styleInfluences: string[];
};

const goals = new Set(["cut", "maintain", "gain muscle", "performance"]);
const experienceLevels = new Set(["New to martial arts", "Building fundamentals", "Experienced competitor", "Advanced / coaching"]);
const competitionIntents = new Set(["Training for myself", "I may compete", "I compete regularly"]);

function text(value: unknown, max: number) {
  return typeof value === "string" ? value.replace(/\s+/g, " ").trim().slice(0, max) : "";
}

function list(value: unknown, maxItems: number, maxLength: number) {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string").map((item) => text(item, maxLength)).filter(Boolean).slice(0, maxItems) : [];
}

function whole(value: unknown, min: number, max: number) {
  return typeof value === "number" && Number.isInteger(value) && value >= min && value <= max ? value : null;
}

export function validateOnboarding(value: unknown): { input?: OnboardingInput; error?: string } {
  if (!value || typeof value !== "object" || Array.isArray(value)) return { error: "Tell FightIQ a little about your training first." };
  const body = value as Record<string, unknown>;
  const disciplines = list(body.disciplines, 8, 40);
  const experienceLevel = text(body.experienceLevel, 50);
  const sessionsPerWeek = whole(body.sessionsPerWeek, 1, 14);
  const sessionTypes = list(body.sessionTypes, 6, 40);
  const competitionIntent = text(body.competitionIntent, 50);
  const primaryGoal = text(body.primaryGoal, 30) as OnboardingInput["primaryGoal"];
  const age = whole(body.age, 18, 100);
  const calculatorSex = body.calculatorSex === "female" || body.calculatorSex === "male" || body.calculatorSex === "manual" ? body.calculatorSex : null;
  const heightCm = whole(body.heightCm, 130, 230);
  const weightKg = typeof body.weightKg === "number" && Number.isFinite(body.weightKg) && body.weightKg >= 35 && body.weightKg <= 250 ? Math.round(body.weightKg * 10) / 10 : null;
  const mealsPerDay = whole(body.mealsPerDay, 1, 8);
  if (!disciplines.length || !experienceLevels.has(experienceLevel) || !sessionsPerWeek || !sessionTypes.length || !competitionIntents.has(competitionIntent) || !goals.has(primaryGoal)) return { error: "Complete the training setup so FightIQ can tailor your starting point." };
  if (calculatorSex !== "manual" && (!age || !heightCm || !weightKg || !calculatorSex)) return { error: "Add your adult body details to calculate a starting nutrition target, or choose manual targets." };
  if (calculatorSex === "manual" && !mealsPerDay) return { error: "Choose how many meals you usually prefer so FightIQ can personalize food guidance." };
  return {
    input: {
      disciplines, experienceLevel, sessionsPerWeek, sessionTypes, competitionIntent,
      age, calculatorSex, heightCm, weightKg,
      dietaryRestrictions: list(body.dietaryRestrictions, 8, 60),
      foodPreferences: text(body.foodPreferences, 240), foodsToAvoid: text(body.foodsToAvoid, 240), mealsPerDay,
      trainingTime: text(body.trainingTime, 50), primaryGoal,
      currentFocus: text(body.currentFocus, 240), styleInfluences: list(body.styleInfluences, 8, 80),
    },
  };
}

export function calculateStartingMacros(input: OnboardingInput): MacroTargets | null {
  if (input.calculatorSex === "manual" || !input.age || !input.heightCm || !input.weightKg) return null;
  const bmr = input.calculatorSex === "male"
    ? 10 * input.weightKg + 6.25 * input.heightCm - 5 * input.age + 5
    : 10 * input.weightKg + 6.25 * input.heightCm - 5 * input.age - 161;
  const activity = input.sessionsPerWeek <= 2 ? 1.375 : input.sessionsPerWeek <= 4 ? 1.55 : 1.725;
  const adjustment = input.primaryGoal === "cut" ? 0.85 : input.primaryGoal === "gain muscle" ? 1.1 : 1;
  const calories = Math.round(Math.max(1400, bmr * activity * adjustment) / 25) * 25;
  const protein = Math.round(input.weightKg * 1.8);
  const fat = Math.round(input.weightKg * 0.8);
  const carbs = Math.max(50, Math.round((calories - protein * 4 - fat * 9) / 4));
  return { calories, protein, carbs, fat };
}

