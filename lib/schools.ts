export const SCHOOLS = [
  "Colby College",
  "University of Pennsylvania",
  "University of Pittsburgh",
  "Cornell University",
  "Columbia University",
  "Boston College",
  "New York University",
  "University of Washington",
  "University of Texas at Austin",
  "Bowdoin College",
  "Bates College",
  "Middlebury College",
  "Williams College",
  "Amherst College",
  "Brown University",
  "Dartmouth College",
  "Yale University",
  "Harvard University",
  "Princeton University",
  "Stanford University",
  "University of Michigan",
  "University of California, Berkeley",
  "Georgetown University",
  "Duke University",
  "Northwestern University",
] as const;

/** Peer schools used when a student searches "and similar". */
export const SIMILAR_SCHOOLS: Record<string, string[]> = {
  "Colby College": ["Bowdoin College", "Bates College", "Middlebury College", "Williams College", "Amherst College"],
  "University of Pennsylvania": ["Columbia University", "Cornell University", "Brown University", "Dartmouth College", "Yale University"],
  "University of Pittsburgh": ["Boston College", "University of Michigan", "Georgetown University"],
  "Cornell University": ["Columbia University", "University of Pennsylvania", "Brown University", "Dartmouth College"],
  "Columbia University": ["Cornell University", "University of Pennsylvania", "New York University", "Brown University"],
  "Boston College": ["Georgetown University", "University of Notre Dame", "University of Virginia"],
  "New York University": ["Columbia University", "Boston University", "University of Southern California"],
  "University of Washington": ["University of California, Berkeley", "University of Michigan", "University of Wisconsin"],
  "University of Texas at Austin": ["University of Michigan", "University of California, Berkeley", "University of Illinois"],
};

export function expandSchools(schools: string[], includeSimilar: boolean) {
  if (!includeSimilar) return schools;
  const set = new Set(schools);
  for (const school of schools) {
    for (const peer of SIMILAR_SCHOOLS[school] ?? []) set.add(peer);
  }
  return [...set];
}

const EDUCATIONAL_SUFFIXES = [".edu", ".ac.uk", ".edu.au", ".ac.nz", ".edu.sg", ".edu.cn", ".ac.jp"];

const CONSUMER_DOMAINS = new Set([
  "gmail.com",
  "googlemail.com",
  "yahoo.com",
  "hotmail.com",
  "outlook.com",
  "live.com",
  "icloud.com",
  "me.com",
  "aol.com",
  "proton.me",
  "protonmail.com",
  "pm.me",
  "msn.com",
  "comcast.net",
  "mail.com",
]);

export function normalizeEmail(email: string) {
  const trimmed = email.trim().toLowerCase();
  const at = trimmed.lastIndexOf("@");
  if (at < 1) return trimmed;
  const local = trimmed.slice(0, at).split("+")[0];
  const domain = trimmed.slice(at + 1);
  return `${local}@${domain}`;
}

export function isSchoolEmail(email: string) {
  const normalized = normalizeEmail(email);
  const domain = normalized.split("@")[1] ?? "";
  if (!domain || !domain.includes(".")) return false;
  if (CONSUMER_DOMAINS.has(domain)) return false;
  return EDUCATIONAL_SUFFIXES.some((suffix) => domain.endsWith(suffix));
}
