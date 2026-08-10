// A training app that reads what happened at practice and then tells a fighter
// what to drill has one obligation before it says anything about technique:
// notice when the note describes a head knock or an injury, and stop
// recommending training.
//
// This runs on the raw note, deterministically, before and independently of any
// model. A safety response must not depend on an API being reachable, a prompt
// being followed, or a schema validating. It never diagnoses — it recognises
// the words athletes actually use, says plainly that an app cannot judge them,
// and points at a qualified human.
//
// It reads English and Brazilian Portuguese, because a large part of this sport
// trains in Portuguese and "levei uma bomba, tô tonto" has to land exactly as
// hard as "got rocked, feeling dizzy". The whole card is answered in the
// language the athlete wrote in: on this screen, being understood matters more
// than the app being consistently in English.
//
// It is deliberately tuned to over-fire. A false positive costs one dismissible
// card. A false negative tells a concussed fighter to go and spar.

export type SafetyLevel = "head_impact" | "acute_injury" | "illness_or_load" | "none";
export type SafetyLanguage = "en" | "pt";

export type SafetySignal = {
  level: SafetyLevel;
  language: SafetyLanguage;
  /** The phrases from the athlete's own note that triggered this, so the card can show its working. */
  matched: string[];
  eyebrow: string;
  title: string;
  body: string;
  /** What to do now. Plain, ordered, actionable. */
  advice: string[];
  redFlagsTitle: string;
  /** Signs that mean emergency care rather than an appointment. Head impacts only. */
  redFlags: string[];
  sourceNote: string;
  dismissLabel: string;
  /** When true, FightIQ must not push a next-session drill off the back of this note. */
  holdTraining: boolean;
};

type Rule = { label: string; lang: SafetyLanguage; pattern: RegExp };

const en = (label: string, source: string): Rule => ({ label, lang: "en", pattern: new RegExp(source, "i") });
const pt = (label: string, source: string): Rule => ({ label, lang: "pt", pattern: new RegExp(source, "i") });

// Said outright. No corroboration needed.
const HEAD_EXPLICIT: Rule[] = [
  en("concussion", "\\bconcus(sion|sed)\\b"),
  en("knocked out", "\\b(knocked out|got ko'?d|ko'?d me|kayo'?d)\\b"),
  en("lost consciousness", "\\b(lost consciousness|passed out|went out cold|out cold)\\b"),
  en("blacked out", "\\bblack(ed)? out\\b"),
  en("saw stars", "\\b(saw stars|lights went out|vision went)\\b"),
  en("can't remember", "\\b(can'?t|don'?t|couldn'?t) remember\\b"),
  pt("concussão", "\\bconcuss(ão|ao)\\b"),
  pt("nocaute", "\\b(nocaute|nocauteado|levei um ko|tomei um ko)\\b"),
  pt("apaguei", "\\b(apaguei|desmaiei|perdi os sentidos|apagão)\\b"),
  pt("vi estrelas", "\\bvi estrelas\\b"),
  pt("não lembro", "\\bn(ã|a)o (me )?lembro\\b|\\bn(ã|a)o consigo lembrar\\b"),
];

// Fight vernacular for taking a shot that landed. Written so the athlete has to
// be on the receiving end: "I dropped him" is a good round, and so is "dei uma
// bomba nele".
const HEAD_IMPACT: Rule[] = [
  en("got rocked", "\\b(got|was|felt) (rocked|buzzed|stunned|wobbled|scrambled)\\b|\\brocked me\\b"),
  en("got dropped", "\\b(got|was) dropped\\b|\\bdropped me\\b"),
  en("got cracked", "\\b(got|was) (cracked|clipped|caught|tagged|smashed|rattled)\\b|\\b(cracked|clipped|tagged|caught) me\\b"),
  en("head clash", "\\b(head ?butt|clash of heads|heads clashed|banged heads)\\b"),
  en("took a knock to the head", "\\b(shot|kick|knee|elbow|punch|hook|cross|uppercut|head kick|overhand)\\b[^.!?]{0,28}\\b(to|on|off) (my|the) (head|temple|jaw|chin|face|skull)\\b"),
  en("hit my head", "\\b(hit|banged|bounced|cracked|whacked) (my|the back of my) (head|skull)\\b"),
  en("slammed", "\\b(got|was) (slammed|spiked|dumped on my head)\\b"),
  pt("levei uma bomba", "\\b(levei|tomei) (uma bomba|um bombaço|uma pancada|um trompaço|uma paulada)\\b"),
  pt("levei um golpe na cabeça", "\\b(levei|tomei)\\b[^.!?]{0,30}\\b(na|de) (cabe(ç|c)a|cara|queixo|t(ê|e)mpora|nuca)\\b"),
  pt("bati a cabeça", "\\bbati (a|com a) cabe(ç|c)a\\b|\\bcabe(ç|c)ada\\b"),
  pt("fiquei grogue", "\\b(fiquei|t(ô|o)|estou|estava) (grogue|zonzo|zonza|atordoado|atordoada)\\b"),
  pt("caí de cabeça", "\\bca(í|i) de cabe(ç|c)a\\b|\\bfui derrubado de cabe(ç|c)a\\b"),
];

// Symptoms. One of these plus any striking or head context is enough; two of
// them is enough on their own.
const HEAD_SYMPTOM: Rule[] = [
  en("dizzy", "\\b(dizzy|dizziness|light ?headed|room was spinning|spinning)\\b"),
  en("headache", "\\b(headache|head is (banging|pounding|splitting)|pressure in my head)\\b"),
  en("vision problems", "\\b(blurr?y|blurred|double) vision\\b|\\bseeing double\\b"),
  en("nausea", "\\b(nausea|nauseous|felt sick|threw up|vomit(ed|ing)?|puked)\\b"),
  en("ringing ears", "\\b(ringing|ears? (were )?ringing|tinnitus)\\b"),
  en("foggy", "\\b(foggy|fuzzy|cloudy|out of it|not with it|felt weird after|felt off after)\\b"),
  en("confusion", "\\b(confused|couldn'?t think|slow to react|slurr?(ed|ing)|couldn'?t focus)\\b"),
  en("balance", "\\b(off balance|unsteady|stumbl(ed|ing)|legs went)\\b"),
  en("light or noise sensitivity", "\\b(light hurt|sensitive to (light|noise)|bright lights)\\b"),
  pt("tontura", "\\b(tont(o|a|ura)|zonzo|zonza|tudo rodando|cabe(ç|c)a rodando)\\b"),
  pt("dor de cabeça", "\\bdor de cabe(ç|c)a\\b|\\bcabe(ç|c)a\\b[^.!?]{0,14}\\b(latejando|latejar|estourando|doendo|martelando|pesada)\\b"),
  pt("visão embaçada", "\\bvis(ã|a)o (emba(ç|c)ada|turva|dupla)\\b|\\bvista emba(ç|c)ada\\b|\\bvendo dobrado\\b"),
  pt("enjoo", "\\b(enjoo|enjoado|enjoada|n(á|a)usea|vomitei|v(ô|o)mito|passando mal)\\b"),
  pt("zumbido no ouvido", "\\b(zumbido|ouvido (zunindo|apitando))\\b"),
  pt("confuso", "\\b(confuso|confusa|len(t|d)o pra (pensar|reagir)|n(ã|a)o consigo (focar|raciocinar)|fora do ar)\\b"),
  pt("desequilíbrio", "\\b(sem equil(í|i)brio|desequilibrado|cambaleando|pernas bambas)\\b"),
  pt("sensível à luz", "\\b(luz (incomoda|machuca)|sens(í|i)vel (à|a) luz)\\b"),
];

const HEAD_CONTEXT = /\b(head|skull|temple|jaw|chin|face|spar(ring|red)?|strik|punch|kick|elbow|knee|hook|cross|slam|takedown|cabe(ç|c)a|nuca|queixo|cara|rosto|spar|luta|soco|chute|joelhada|cotovelada|golpe|queda|treino)/i;

const ACUTE_INJURY: Rule[] = [
  en("heard a pop", "\\b(heard|felt) (a|it) (pop|snap|crack|tear|crunch)\\b|\\bpopped (out|my)\\b"),
  en("joint gave way", "\\b(gave way|gave out|buckled|dislocat(ed|ion)|came out of (the|its) socket|subluxed)\\b"),
  en("can't bear weight", "\\bcan'?t (put weight|bear weight|walk|stand)\\b|\\bcouldn'?t (put weight|bear weight|walk)\\b"),
  en("numbness or tingling", "\\b(numb(ness)?|tingl(ing|y)|pins and needles|no feeling in)\\b"),
  en("caught late in a submission", "\\b(tapped (late|too late)|didn'?t tap|got cranked|cranked (my|on my)|hyper ?extended|torqued)\\b"),
  en("swelling", "\\b(swollen|swelling|ballooned up|puffed up)\\b"),
  en("suspected break or tear", "\\b(broke|broken|fractur(e|ed)|torn|tore (my|a)|ruptur(e|ed))\\b"),
  en("sharp pain", "\\bsharp pain\\b|\\bshooting pain\\b|\\bstabbing pain\\b"),
  en("can't move it normally", "\\bcan'?t (straighten|bend|lift|rotate|move) (my|it)\\b"),
  en("ribs", "\\b(rib|ribs)\\b[^.!?]{0,24}\\b(hurt|pain|sore|pop|crack|breath)\\b|\\bhard to breathe\\b"),
  pt("ouvi um estalo", "\\b(ouvi|senti) um (estalo|barulho|crec)\\b|\\bestalou\\b"),
  pt("deslocou", "\\b(deslocou|desloquei|saiu do lugar|luxa(ç|c)(ã|a)o|subluxou)\\b"),
  pt("não consigo pisar", "\\bn(ã|a)o (consigo|consegui) (pisar|andar|apoiar|ficar de p(é|e))\\b"),
  pt("dormência", "\\b(dorm(ê|e)ncia|formigamento|adormecid(o|a)|sem sentir)\\b"),
  pt("bati tarde", "\\b(bati tarde|bati atrasado|n(ã|a)o deu tempo de bater|for(ç|c)aram demais|torceu demais)\\b"),
  pt("inchado", "\\b(inchado|inchada|incha(ç|c)o)\\b"),
  pt("suspeita de fratura", "\\b(quebrei|quebrou|fratur(a|ei|ou)|rompeu|rompi|ligamento|menisco)\\b"),
  pt("dor forte", "\\bdor (aguda|forte|fisgada|latejante)\\b|\\bfisgada\\b"),
  pt("não consigo mexer", "\\bn(ã|a)o (consigo|consegui) (dobrar|esticar|levantar|mexer|girar)\\b"),
  pt("costela", "\\bcostela\\b[^.!?]{0,24}\\b(dor|doendo|estalo|respirar)\\b|\\bdifícil respirar\\b|\\bdificuldade (pra|para) respirar\\b"),
];

const ILLNESS_OR_LOAD: Rule[] = [
  en("illness", "\\b(fever|flu|sick|infection|chest infection|throat|covid)\\b"),
  en("no sleep", "\\b(no sleep|haven'?t slept|barely slept|couldn'?t sleep|two hours(' )?sleep)\\b"),
  en("exhaustion", "\\b(exhaust(ed|ion)|burnt? out|running on empty|wiped out|dead legs|overtrain(ed|ing))\\b"),
  en("weight cut", "\\b(cutting weight|water cut|dehydrat(ed|ion)|not eating)\\b"),
  pt("doente", "\\b(febre|gripe|gripado|gripada|doente|virose|infec(ç|c)(ã|a)o|covid|garganta)\\b"),
  pt("sem dormir", "\\b(n(ã|a)o dormi|sem dormir|dormi mal|dormi pouco|duas horas de sono)\\b"),
  pt("exausto", "\\b(exaust(o|a)|acabado|acabada|mo(í|i)do|detonado|detonada|zerado|sobretreino|overtraining)\\b"),
  pt("cortando peso", "\\b(cortando peso|corte de peso|desidratad(o|a)|sem comer)\\b"),
];

const NEGATORS = /\b(no|not|never|without|didn'?t|don'?t|wasn'?t|weren'?t|isn'?t|nothing|zero|avoided?|n(ã|a)o|sem|nenhum(a)?|nada|nunca|jamais)\b/i;
const CONTRAST = /\b(but|though|however|although|mas|por(é|e)m|entretanto|s(ó|o) que|apesar)\b|[;,]/i;

// "no headache" and "sem dor de cabeça" are negations. "no pain in my knee but
// my head is banging" is not — a contrast word or a clause break ends the
// negator's reach.
function isNegated(text: string, index: number) {
  const window = text.slice(Math.max(0, index - 26), index);
  const clause = window.split(/[.!?]/).pop() ?? "";
  if (!NEGATORS.test(clause)) return false;
  const afterNegator = clause.slice(clause.search(NEGATORS));
  return !CONTRAST.test(afterNegator);
}

type Hit = { label: string; lang: SafetyLanguage };

function matches(text: string, rules: Rule[]): Hit[] {
  const found: Hit[] = [];
  for (const item of rules) {
    const hit = item.pattern.exec(text);
    if (!hit || isNegated(text, hit.index)) continue;
    found.push({ label: item.label, lang: item.lang });
  }
  return found;
}

type Copy = {
  eyebrow: Record<Exclude<SafetyLevel, "none">, string>;
  redFlagsTitle: string;
  dismiss: string;
  source: (matched: string) => string;
  list: (items: string[]) => string;
  head: { title: string; body: (matched: string) => string; advice: string[]; redFlags: string[] };
  injury: { title: string; body: (matched: string) => string; advice: string[] };
  load: { title: string; body: (matched: string) => string; advice: string[] };
};

const COPY: Record<SafetyLanguage, Copy> = {
  en: {
    eyebrow: { head_impact: "STOP — READ THIS FIRST", acute_injury: "INJURY REPORTED", illness_or_load: "LOAD WARNING" },
    redFlagsTitle: "GO TO EMERGENCY CARE NOW IF ANY OF THIS HAPPENS",
    dismiss: "That is not what I meant — hide this",
    source: (matched) => `FightIQ is not a medical service and cannot assess you. This is general safety guidance, triggered by your own words: ${matched}.`,
    list: (items) => (items.length <= 1 ? items[0] ?? "" : `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`),
    head: {
      title: "Stop training and get your head checked",
      body: (matched) => `You wrote about ${matched}. That is how a head injury shows up, and no app — this one included — can tell the difference between a rattle and something that needs treating. FightIQ is holding your next session plan until a qualified person has looked at you.`,
      advice: [
        "Do not train, spar, roll or lift again today. Not even light rounds.",
        "Get seen by a doctor or another qualified medical professional before your next session, and follow what they tell you rather than how you feel.",
        "Tell your coach and someone at home what happened, so you are not the only person watching for it.",
        "Do not drive yourself anywhere while you feel off.",
        "Symptoms can arrive or get worse hours later. Treat tonight as part of the injury, not the end of it.",
      ],
      redFlags: [
        "A headache that keeps getting worse",
        "Being sick repeatedly",
        "A seizure or fit",
        "Weakness, numbness, or trouble walking, talking or seeing",
        "Getting more confused or drowsy, or being hard to wake",
        "Clear fluid or blood coming from the nose or ears",
        "Neck pain after the impact",
      ],
    },
    injury: {
      title: "Get this looked at before you load it again",
      body: (matched) => `You wrote about ${matched}. FightIQ cannot tell a tweak from a tear, and training through the second one is how fighters lose a season instead of a fortnight.`,
      advice: [
        "Stop loading it today, and do not test it in sparring to see how bad it is.",
        "Get it assessed if it is still painful, swollen or unstable tomorrow, if it gives way, or if you cannot move it or put weight on it normally.",
        "Log how it feels after a night's sleep. That comparison is worth more to a physio than a rating out of ten today.",
      ],
    },
    load: {
      title: "This is a day to train light or not at all",
      body: (matched) => `You wrote about ${matched}. Sessions logged like this are where most injuries actually come from — the technique work below still stands, but the load should not.`,
      advice: [
        "Keep the next session technical: drilling and positional work, not hard rounds.",
        "If you are ill with a fever, or below the neck, sit it out completely.",
        "Sleep and food fix more of this than any session plan will.",
      ],
    },
  },
  pt: {
    eyebrow: { head_impact: "PARE — LEIA ISTO PRIMEIRO", acute_injury: "LESÃO RELATADA", illness_or_load: "ALERTA DE CARGA" },
    redFlagsTitle: "PROCURE EMERGÊNCIA AGORA SE ACONTECER QUALQUER UM DESTES",
    dismiss: "Não foi isso que eu quis dizer — ocultar",
    source: (matched) => `O FightIQ não é um serviço médico e não pode te avaliar. Isto é orientação geral de segurança, acionada pelas suas próprias palavras: ${matched}.`,
    list: (items) => (items.length <= 1 ? items[0] ?? "" : `${items.slice(0, -1).join(", ")} e ${items[items.length - 1]}`),
    head: {
      title: "Pare de treinar e vá avaliar sua cabeça",
      body: (matched) => `Você escreveu sobre ${matched}. É assim que uma lesão na cabeça aparece, e nenhum aplicativo — nem este — consegue diferenciar um susto de algo que precisa de tratamento. O FightIQ vai segurar o plano do próximo treino até alguém qualificado te examinar.`,
      advice: [
        "Não treine, não role, não faça sparring nem musculação hoje. Nem rounds leves.",
        "Procure um médico ou outro profissional de saúde qualificado antes do próximo treino, e siga o que ele disser em vez de como você está se sentindo.",
        "Avise seu professor e alguém em casa, para você não ser a única pessoa de olho nisso.",
        "Não dirija enquanto estiver se sentindo estranho.",
        "Os sintomas podem aparecer ou piorar horas depois. Trate hoje à noite como parte da lesão, não como o fim dela.",
      ],
      redFlags: [
        "Dor de cabeça que só piora",
        "Vômitos repetidos",
        "Convulsão",
        "Fraqueza, dormência ou dificuldade para andar, falar ou enxergar",
        "Ficar mais confuso ou sonolento, ou difícil de acordar",
        "Líquido claro ou sangue saindo do nariz ou do ouvido",
        "Dor no pescoço depois do impacto",
      ],
    },
    injury: {
      title: "Avalie isso antes de colocar carga de novo",
      body: (matched) => `Você escreveu sobre ${matched}. O FightIQ não sabe diferenciar um estiramento de um rompimento, e treinar em cima do segundo é como se perde uma temporada em vez de duas semanas.`,
      advice: [
        "Pare de forçar hoje, e não teste no sparring só para ver o quanto está ruim.",
        "Procure avaliação se amanhã ainda estiver doendo, inchado ou instável, se falhar, ou se você não conseguir mexer ou apoiar o peso normalmente.",
        "Anote como está depois de uma noite de sono. Essa comparação vale mais para o fisioterapeuta do que uma nota de zero a dez hoje.",
      ],
    },
    load: {
      title: "Hoje é dia de treino leve ou de descanso",
      body: (matched) => `Você escreveu sobre ${matched}. É de sessões assim que vem a maior parte das lesões — o trabalho técnico abaixo continua valendo, a carga não.`,
      advice: [
        "Deixe o próximo treino técnico: drill e trabalho posicional, sem rounds duros.",
        "Se estiver com febre, ou doente do pescoço para baixo, fique fora.",
        "Dormir e comer resolvem mais disso do que qualquer plano de treino.",
      ],
    },
  },
};

// The card answers in the language the athlete was writing in. Ties go to
// Portuguese: an English speaker reads an English note either way, but a
// Portuguese speaker may not read the English one at all.
function languageOf(hits: Hit[], text: string): SafetyLanguage {
  const ptHits = hits.filter((hit) => hit.lang === "pt").length;
  if (ptHits > 0) return "pt";
  return /[ãõçáéíóúâêô]|\b(treino|treinei|hoje|ontem|professor|rolei|luta|sparring de|não)\b/i.test(text) && hits.length === 0 ? "pt" : "en";
}

const NONE: SafetySignal = {
  level: "none", language: "en", matched: [], eyebrow: "", title: "", body: "",
  advice: [], redFlagsTitle: "", redFlags: [], sourceNote: "", dismissLabel: "", holdTraining: false,
};

export function scanTrainingNote(note: string): SafetySignal {
  const text = (note ?? "").toLowerCase();
  if (text.trim().length < 3) return NONE;

  const explicit = matches(text, HEAD_EXPLICIT);
  const impact = matches(text, HEAD_IMPACT);
  const symptoms = matches(text, HEAD_SYMPTOM);
  const headFlagged = explicit.length > 0
    || impact.length > 0
    || symptoms.length >= 2
    || (symptoms.length === 1 && HEAD_CONTEXT.test(text));

  const build = (level: Exclude<SafetyLevel, "none">, hits: Hit[], holdTraining: boolean): SafetySignal => {
    const language = languageOf(hits, text);
    const copy = COPY[language];
    const labels = hits.map((hit) => hit.label);
    const pack = level === "head_impact" ? copy.head : level === "acute_injury" ? copy.injury : copy.load;
    const redFlags = level === "head_impact" ? copy.head.redFlags : [];
    return {
      level,
      language,
      matched: labels,
      eyebrow: copy.eyebrow[level],
      title: pack.title,
      body: pack.body(copy.list(labels)),
      advice: pack.advice,
      redFlagsTitle: redFlags.length ? copy.redFlagsTitle : "",
      redFlags,
      sourceNote: copy.source(labels.join(", ")),
      dismissLabel: copy.dismiss,
      holdTraining,
    };
  };

  if (headFlagged) return build("head_impact", [...explicit, ...impact, ...symptoms], true);

  const injury = matches(text, ACUTE_INJURY);
  if (injury.length) return build("acute_injury", injury, true);

  const load = matches(text, ILLNESS_OR_LOAD);
  if (load.length) return build("illness_or_load", load, false);

  return NONE;
}
