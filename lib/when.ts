// Dates the way a fighter says them.
//
// A takeaway that reads "felt successful in this session" is vague to everyone
// except the app. The athlete wants to know whether it is talking about Sunday's
// rounds or last Tuesday's drilling, and "Sunday night" is how they would say it
// themselves. Past about a week the weekday stops locating anything, so it
// becomes a real date.

/** "this night", "yesterday morning", "Sunday night", or "9 Aug". */
export function sessionDay(iso: string, now: Date = new Date()) {
  const when = new Date(iso);
  if (Number.isNaN(when.getTime())) return "";
  const startOfToday = new Date(now).setHours(0, 0, 0, 0);
  const startOfThen = new Date(when).setHours(0, 0, 0, 0);
  const daysAgo = Math.round((startOfToday - startOfThen) / 86_400_000);
  const hour = when.getHours();
  const partOfDay = hour >= 17 ? "night" : hour < 12 ? "morning" : "afternoon";
  if (daysAgo <= 0) return `this ${partOfDay}`;
  if (daysAgo === 1) return `yesterday ${partOfDay}`;
  if (daysAgo < 7) return `${when.toLocaleDateString("en-GB", { weekday: "long" })} ${partOfDay}`;
  return when.toLocaleDateString("en-GB", { day: "numeric", month: "short" });
}

/** "9 Aug". Short enough to sit in a column beside a focus. */
export function shortDate(iso: string) {
  const when = new Date(iso);
  return Number.isNaN(when.getTime()) ? "" : when.toLocaleDateString("en-GB", { day: "numeric", month: "short" });
}
