/** Matching an answer to a dropdown option, shared by answer planning and the browser filler. */

const OPTION_ALIASES: Record<string, string[]> = {
  "united states": ["united states of america", "usa", "us"],
  "usa": ["united states of america", "united states"],
  "us": ["united states of america", "united states"],
};

/** The option that matches an answer: exact first, then a clear partial match for longer answers. */
export function bestOption(answer: string, options: string[]) {
  const want = answer.trim().toLowerCase();
  if (!want) return null;
  const lower = options.map((option) => option.trim().toLowerCase());
  const exact = lower.indexOf(want);
  if (exact >= 0) return options[exact];
  for (const alias of OPTION_ALIASES[want] ?? []) {
    const index = lower.findIndex((option) => option === alias || option.startsWith(`${alias} `) || option.startsWith(`${alias}(`));
    if (index >= 0) return options[index];
  }
  if (want.length < 4) return null;
  const starts = lower.filter((option) => option.startsWith(want));
  if (starts.length === 1) return options[lower.indexOf(starts[0])];
  if (starts.length > 1) return null;
  const contains = lower.filter((option) => option.includes(want));
  return contains.length === 1 ? options[lower.indexOf(contains[0])] : null;
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
