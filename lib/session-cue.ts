// The one line an athlete reads on the way into the gym.
//
// It gets read more often than anything else in this app, and it is the only
// part that has to survive a noisy room and a warm-up. So it is short, it is
// imperative, and it has the shape coaches actually use: a trigger, then what
// to do about it.
//
// This used to be four keyword branches, three of which were grappling. A Muay
// Thai athlete — most of the people this app is for — fell through to "Pick one
// detail to pay attention to", which is not a cue, it is a shrug.
//
// Nothing here is novel coaching. Every line is the standard fix a coach gives
// for that specific problem, written short enough to hold onto for two hours.

type Cue = { pattern: RegExp; cue: string };

const cue = (source: string, text: string): Cue => ({ pattern: new RegExp(source, "i"), cue: text });

// Ordered. The first match wins, so the specific sits above the general.
const CUES: Cue[] = [
  // Kicking — the single biggest gap in the old list.
  cue("\\b(switch kick|round ?house|round kick|body kick|head kick)\\b", "Turn the support foot → the hip can finish."),
  cue("\\b(support foot|pivot|planted foot|lands flat|landing flat)\\b", "Pivot before the leg arrives → not after."),
  cue("\\b(low kick|leg kick|calf kick)\\b", "Hide it behind a hand → land above the knee."),
  cue("\\b(check|checking|checked)\\b.*\\bkick|\\bkick\\b.*\\bcheck", "Shin up early → knee turned out."),
  cue("\\b(teep|push kick|front kick)\\b", "Hips through it → land already balanced."),
  cue("\\b(catch(ing)? kicks?|caught kicks?)\\b", "Catch and step in → never stand and hold it."),
  // "Kick defence" is about defending them, not throwing them, so it has to sit
  // above the bare kick rule or it gets the wrong half of the skill.
  cue("\\b(kick defen[cs]e|defend(ing)? (the )?kicks?)\\b", "Shin up early → knee turned out."),
  cue("\\bkick\\b", "Pivot first → hip follows."),

  // Hands.
  cue("\\b(lead hand|hand drop|dropping (my |the )?(lead )?hand|hands down|guard drops)\\b", "Kick and punch with the hand up → chin behind the shoulder."),
  cue("\\b(jab|1-2|one two|straight)\\b", "Jab then move → never stand behind it."),
  cue("\\b(hook|uppercut|overhand)\\b", "Set it up with the straight → then turn on it."),
  cue("\\b(combination|combo|combinations)\\b", "Finish every combination with a step → not a stand."),
  cue("\\b(body (shot|work)s?|to the body|the body\\b|liver|upstairs)\\b", "Same rhythm to the body → then back upstairs."),
  cue("\\b(feint|feints|feinting)\\b", "Sell it with the feet → not just the hands."),

  // Clinch, knees, elbows.
  cue("\\b(clinch|plum|neck tie|collar tie)\\b", "Inside position first → then the knee."),
  cue("\\b(knee|knees)\\b", "Break the posture down → the knee comes up."),
  cue("\\b(elbow|elbows)\\b", "Close the gap → the elbow travels short."),
  cue("\\b(sweep|dump|trip)\\b", "Take the balance first → then the sweep."),

  // Defence, position, movement.
  cue("\\b(square|squared up|standing square|centre ?line|center ?line)\\b", "Turn the front foot in → get off the centre line."),
  cue("\\b(distance|range|too close|too far|reach)\\b", "Fix the distance first → then commit."),
  cue("\\b(angle|angles|off ?line|circling|footwork)\\b", "Step off after the last shot → not before it."),
  cue("\\b(counter|countering|on the way out)\\b", "Make him lead → land on the way out."),
  cue("\\b(head movement|slip|roll|parry|catch and shoot)\\b", "Move after you punch → not only before."),
  cue("\\b(pressure|walking forward|forward pressure)\\b", "Cut the angle → don't just walk forward."),
  cue("\\b(southpaw|orthodox|open stance|outside foot)\\b", "Win the outside foot → then throw."),
  cue("\\b(defen[cs]e|defensive|getting hit|taking shots)\\b", "See it early → make space."),

  // Grappling.
  cue("\\b(arm drag|drag)\\b", "Drag → take the angle."),
  cue("\\b(frame|frames|framing)\\b", "Frames first → then move."),
  cue("\\b(guard retention|keeping guard|passed|getting passed)\\b", "Hips before hands → get the knee back in."),
  cue("\\b(pass|passing)\\b", "Kill the legs → then walk around."),
  cue("\\b(takedown|single leg|double leg|shot|shooting)\\b", "Level change on the entry → head inside."),
  cue("\\b(sprawl|takedown defen[cs]e|stuffing)\\b", "Hips down first → then circle away."),
  cue("\\b(back take|seatbelt|hooks in)\\b", "Chest to back → then the seatbelt."),
  cue("\\b(escape|escaping|getting out|bottom)\\b", "Make the space → then take it."),
  cue("\\b(submission|finish|choke|armbar|triangle)\\b", "Position first → then the finish."),

  // Conditioning and pace.
  cue("\\b(gas|gassed|conditioning|cardio|pace|fatigue|tired)\\b", "Breathe out on every shot → set a pace you can hold."),
];

/**
 * A short cue for a mission. Returns "" when the mission says nothing a cue can
 * be built from, so the caller can decide what to show instead of inventing
 * coaching advice out of an empty string.
 */
export function cueForMission(mission: string): string {
  const text = (mission ?? "").trim();
  if (text.length < 3) return "";
  for (const item of CUES) if (item.pattern.test(text)) return item.cue;
  return "";
}

/** Trims a mission to something that fits on one line without cutting a word in half. */
function shorten(mission: string, limit = 46): string {
  const clean = mission.replace(/\s+/g, " ").trim().replace(/[.!?]+$/, "");
  if (clean.length <= limit) return clean;
  const cut = clean.slice(0, limit);
  return `${cut.slice(0, cut.lastIndexOf(" ") > 12 ? cut.lastIndexOf(" ") : limit)}…`;
}

/**
 * The cue an athlete actually sees. Falls back to naming their own focus rather
 * than to a generic instruction, because "One thing tonight: your kick lands
 * flat" is still useful and "Pick one detail to pay attention to" never was.
 */
export function sessionCue(mission: string): string {
  const matched = cueForMission(mission);
  if (matched) return matched;
  const named = shorten(mission ?? "");
  return named.length >= 3 ? `One thing tonight: ${named.toLowerCase()}.` : "Pick one detail and watch it all session.";
}

/**
 * The focus a brand-new athlete starts on, before there is any training to read.
 *
 * It used to be one hardcoded line about defence for everybody. A day-one focus
 * that names something from a sport the athlete does not train is the first
 * thing that tells them this app was not built for them.
 */
export function startingFocus(disciplines: string[]): string {
  const text = disciplines.join(" ").toLowerCase();
  if (/muay thai|kickbox/.test(text)) return "Build a guard and a distance you trust";
  if (/boxing/.test(text)) return "Make your jab and your exit reliable";
  if (/bjj|jiu|grappl/.test(text)) return "Build a guard you can keep";
  if (/wrestl/.test(text)) return "Make one entry and one defence reliable";
  if (/judo/.test(text)) return "Build a grip you can work from";
  if (/mma/.test(text)) return "Make one thing reliable in every range";
  return "Build a reliable first layer of defence";
}
