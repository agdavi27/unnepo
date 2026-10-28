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
