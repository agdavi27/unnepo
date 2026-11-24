/**
 * Follow-ups due: people the student emailed who haven't replied (still marked "Emailed"), once enough business
 * days have passed: 5 after the first email, then 7 after the first follow-up. After two follow-ups, nothing more is
 * due: a fourth email gets more complaints than replies. Shared by the web app and the extension, so it has no
 * server imports.
 */

export const FOLLOW_UP_BUSINESS_DAYS = 5;
/** Business days to wait after the first follow-up before the second, and last, one. */
export const SECOND_FOLLOW_UP_BUSINESS_DAYS = 7;
/** Follow-ups after the first email, at most. */
export const FOLLOW_UPS_AT_MOST = 2;

/** Business days (Monday to Friday) from `from` to `to`. */
export function businessDaysBetween(from: Date, to: Date) {
  let days = 0;
  const day = new Date(Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), from.getUTCDate()));
  const end = Date.UTC(to.getUTCFullYear(), to.getUTCMonth(), to.getUTCDate());
  while (day.getTime() < end) {
    day.setUTCDate(day.getUTCDate() + 1);
    const weekday = day.getUTCDay();
    if (weekday !== 0 && weekday !== 6) days += 1;
  }
  return days;
}

type Person = { id: string; name: string; outreachStatus: string };
type WithPeople = { id: string; company: string; title: string; contacts?: Person[]; fillReport?: { emailedAt?: Record<string, string>; outreachLog?: Array<{ contactId: string; kind: string }> } | null };

/** `number`: which follow-up this would be, 1 or 2. */
export type FollowUpDue = { applicationId: string; contactId: string; name: string; company: string; title: string; emailedAt: string; days: number; number: 1 | 2 };

export function followUpsDue(apps: WithPeople[], now = new Date()): FollowUpDue[] {
  return apps.flatMap((app) => (app.contacts ?? []).flatMap((person) => {
    const at = app.fillReport?.emailedAt?.[person.id];
    if (person.outreachStatus !== "emailed" || !at) return [];
    const sent = (app.fillReport?.outreachLog ?? []).filter((entry) => entry.contactId === person.id && entry.kind === "follow_up").length;
    if (sent >= FOLLOW_UPS_AT_MOST) return [];
    const days = businessDaysBetween(new Date(at), now);
    const wait = sent ? SECOND_FOLLOW_UP_BUSINESS_DAYS : FOLLOW_UP_BUSINESS_DAYS;
    return days >= wait ? [{ applicationId: app.id, contactId: person.id, name: person.name, company: app.company, title: app.title, emailedAt: at, days, number: (sent + 1) as 1 | 2 }] : [];
  })).sort((a, b) => a.emailedAt.localeCompare(b.emailedAt));
}
