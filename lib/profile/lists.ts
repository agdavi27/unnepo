/**
 * Multi-value onboarding answers are stored as one string joined with "; " so older profiles,
 * the organizer prompt, and search keep working. Older answers used commas.
 */
export const LIST_SEPARATOR = "; ";

export function splitProfileList(value: string, { legacyCommas = true } = {}) {
  const text = (value ?? "").trim();
  if (!text) return [];
  const parts = text.includes(";") ? text.split(";") : legacyCommas ? text.split(/[,\n]/) : [text];
  const seen = new Set<string>();
  return parts
    .map((part) => part.trim())
    .filter((part) => {
      const key = part.toLowerCase();
      if (!part || seen.has(key)) return false;
      seen.add(key);
      return true;
    });
}

export function joinProfileList(items: string[]) {
  return items.map((item) => item.trim()).filter(Boolean).join(LIST_SEPARATOR);
}

const RADIUS = /\s*\(within (\d+) mi\)$/i;

/** "New York, NY (within 25 mi)" -> { place: "New York, NY", miles: 25 } */
export function parseLocation(entry: string) {
  const match = entry.match(RADIUS);
  return { place: entry.replace(RADIUS, "").trim(), miles: match ? Number(match[1]) : null };
}

export function formatLocation(place: string, miles: number | null) {
  const clean = place.trim();
  return miles ? `${clean} (within ${miles} mi)` : clean;
}

/** Locations keep their commas ("Boston, MA"), so older comma lists are read as one entry. */
export function splitLocations(value: string) {
  return splitProfileList(value, { legacyCommas: false });
}
