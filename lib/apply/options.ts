/** Matching an answer to a dropdown option, shared by answer planning and the browser filler. */

const OPTION_ALIASES: Record<string, string[]> = {
  "united states": ["united states of america", "usa", "us", "u.s", "u.s.a"],
  "united states of america": ["united states", "usa", "us"],
  "usa": ["united states of america", "united states"],
  "us": ["united states of america", "united states"],
  "united kingdom": ["uk", "great britain", "united kingdom of great britain and northern ireland"],
  "uk": ["united kingdom", "great britain"],
};

/** Lowercase, single spaces, no required-markers or trailing punctuation: "Yes.*" and "yes" are the same. */
const normal = (text: string) => text.replace(/\u00a0/g, " ").replace(/[‘’`]/g, "'").replace(/[*✱]/g, "").replace(/\s+/g, " ").trim().replace(/[.:;!,]+$/, "").trim().toLowerCase();

/** Without what's in brackets or a trailing dialing code: "United States of America (+1)" is "united states of america". */
const bare = (text: string) => normal(text.replace(/\s*[([][^)\]]*[)\]]/g, " ").replace(/\s*\+\d{1,4}\s*$/, "").replace(/^\+\d{1,4}\s+/, ""));

/** The words in an option, without punctuation: "Bachelor's - Degree" is ["bachelor's", "degree"]. */
const words = (text: string) => normal(text).split(/[^a-z0-9']+/).filter(Boolean);

/** The one option that passes, or null when none or several do. */
function only(options: string[], lower: string[], test: (option: string) => boolean) {
  const hits = lower.flatMap((option, index) => (test(option) ? [index] : []));
  return hits.length === 1 ? options[hits[0]] : null;
}

/**
 * The option that matches an answer: exact first, then a clear partial match. A short answer ("Yes",
 * "No", "N/A") matches an option that starts with it as a word ("No, I will not require sponsorship"),
 * never one that merely contains the letters ("Not applicable"). Brackets and dialing codes don't count
 * ("United States" is "United States (+1)"), and neither does word order once every word is there.
 */
export function bestOption(answer: string, options: string[]) {
  const want = normal(answer);
  if (!want) return null;
  const lower = options.map(normal);
  const exact = lower.indexOf(want);
  if (exact >= 0) return options[exact];
  const bareOptions = options.map(bare);
  const bareWant = bare(answer) || want;
  const sameBare = only(options, bareOptions, (option) => option === bareWant);
  if (sameBare) return sameBare;
  for (const alias of OPTION_ALIASES[bareWant] ?? []) {
    const index = bareOptions.findIndex((option) => option === alias);
    if (index >= 0) return options[index];
    // Only long names may start an option: "us" would fit "US Virgin Islands".
    const starts = alias.length < 5 ? -1 : lower.findIndex((option) => option.startsWith(`${alias} `) || option.startsWith(`${alias}(`));
    if (starts >= 0) return options[starts];
  }
  // Starts with the answer as whole words: "yes" fits "yes, i am authorized", not "yesterday".
  const asWord = new RegExp(`^${want.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?![a-z0-9])`);
  const wordStarts = lower.filter((option) => asWord.test(option));
  if (wordStarts.length === 1) return options[lower.indexOf(wordStarts[0])];
  if (wordStarts.length > 1 || want.length < 4) return null;
  const starts = lower.filter((option) => option.startsWith(want));
  if (starts.length === 1) return options[lower.indexOf(starts[0])];
  if (starts.length > 1) return null;
  const contains = lower.filter((option) => option.includes(want));
  if (contains.length === 1) return options[lower.indexOf(contains[0])];
  if (contains.length > 1) return null;
  // Every word of a longer answer, in any order: "Bachelor's Degree" fits "Degree - Bachelor's".
  const wanted = words(answer);
  if (wanted.length < 2) return null;
  return only(options, options, (option) => {
    const have = new Set(words(option));
    return wanted.every((word) => have.has(word));
  });
}

const DEGREE_NAMES: Array<[RegExp, string[]]> = [
  // Graduate degrees first: "M.B.A." also contains "B.A.".
  [/\b(m\.?\s?b\.?\s?a\b|mba\b)/i, ["Master of Business Administration (M.B.A.)", "MBA", "Master of Business Administration", "Master's Degree", "Masters"]],
  [/\b(ph\.?\s?d|doctor)/i, ["Doctor of Philosophy (Ph.D.)", "Doctorate", "PhD", "Doctoral Degree"]],
  [/\b(m\.?\s?a\b\.?|m\.?\s?s\b\.?|m\.?\s?sc|master)/i, ["Master's Degree", "Master's", "Masters", "Master"]],
  [/\b(b\.?\s?a\b\.?|b\.?\s?s\b\.?|b\.?\s?sc|bachelor)/i, ["Bachelor's Degree", "Bachelor's", "Bachelors", "Bachelor", "Bachelor of Arts", "Bachelor of Science", "BA", "BS", "Undergraduate"]],
  [/\bassociate/i, ["Associate's Degree", "Associate Degree", "Associates"]],
  [/high school|diploma|ged/i, ["High School Diploma", "High School", "GED"]],
];

/** The degree as the form's options word it. */
export function degreeAnswer(degree: string, options: string[]) {
  if (!options.length) return degree || null;
  // Exact wording first; then the degree's usual names. A loose match could turn "B.A." into "M.B.A.".
  const exact = options.find((option) => option.trim().toLowerCase() === degree.trim().toLowerCase());
  if (exact) return exact;
  const names = DEGREE_NAMES.find(([pattern]) => pattern.test(degree))?.[1] ?? [];
  for (const name of names) {
    const match = bestOption(name, options);
    if (match) return match;
  }
  return null;
}
