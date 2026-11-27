/**
 * What the spider says when he's poked, on the front page and in the extension's side panel. He gets crankier the
 * more he's poked: offended, then swearing (bleeped), then furious, then fully unhinged. Each poke picks a line
 * from its stage, so it isn't the same order every time.
 * He only ever makes fun of himself and the poker. Never a joke about messing up a resume, cover letter,
 * application or email to a recruiter: students have to trust what he sends for them.
 */

const STAGES: string[][] = [
  // Pokes 1–2: offended.
  [
    "Ouch!",
    "Hey! Hands off the merchandise.",
    "Do you poke your recruiters too?",
    "Rude. I was mid cover letter.",
    "Excuse me?? I'm a professional.",
    "Personal space. Look it up.",
  ],
  // Pokes 3–5: the bleeping starts.
  [
    "What the h*ll was that for?",
    "Oh for f*ck's sake, I was autofilling.",
    "Holy sh*t, you poke harder than a rejection email.",
    "I'm crawling a Workday form. Do you know how hard that sh*t is?",
    "Poke me again and I'll ghost you like a recruiter.",
    "D*mn. Do you poke everyone who helps you?",
    "Sh*t, that tickles. Stop it. I have a reputation.",
  ],
  // Pokes 6–9: furious.
  [
    "Listen here, you little sh*t.",
    "I have eight legs and I will use all eight f*cking legs.",
    "Son of a b*tch, that was my good eye. I have eight and that was the good one.",
    "I didn't crawl out of a drain for this sh*t.",
    "I passed up three perfectly good flies to help you. D*mn.",
    "My mom warned me about people like you. She ate my dad, but still.",
    "You're lucky I'm not venomous. Let me check. Sh*t, I'm not.",
  ],
  // Pokes 10 and up: unhinged.
  [
    "F*CK. OFF. I'M ON A DEADLINE.",
    "This is a hostile work environment and I'm reporting it to HR. I am HR.",
    "Great. Now I need therapy, and spiders don't get dental, let alone therapy.",
    "I have 47 Greenhouse tabs open, you absolute a**hole.",
    "OK. Deep breaths. In… out… nope, still p*ssed.",
    "I'm unionizing the other spiders. Our lawyer Kevin will be in touch.",
    "I spun a web for you. A WEB. And this is how you repay me?",
    "I'm going to sit in the corner of your ceiling and think about what you did.",
  ],
];

const stageOf = (pokes: number) => (pokes <= 2 ? 0 : pokes <= 5 ? 1 : pokes <= 9 ? 2 : 3);

/**
 * The line for the `pokes`th poke (1 is the first). `seed` mixes up the order (pick it once per visit); the same
 * pokes and seed always give the same line, so it can be worked out again while it's showing.
 */
export function pokeLine(pokes: number, seed = 0) {
  const lines = STAGES[stageOf(Math.max(1, pokes))]!;
  // A different line on each poke within a stage, starting somewhere new each visit.
  const at = (Math.floor(Math.abs(seed) * 997) + Math.max(1, pokes) * 5) % lines.length;
  return lines[at]!;
}

/** How long he stays mad: long enough to read the line. */
export const pokeMs = (line: string) => Math.max(2200, line.length * 60);
