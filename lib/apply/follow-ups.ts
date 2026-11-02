/**
 * Follow-ups due: people the student emailed five business days ago or more who haven't replied (still
 * marked "Emailed"). Shared by the web app and the extension, so it has no server imports.
 */

export const FOLLOW_UP_BUSINESS_DAYS = 5;

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
type WithPeople = { id: string; company: string; title: string; contacts?: Person[]; fillReport?: { emailedAt?: Record<string, string> } | null };

export type FollowUpDue = { applicationId: string; contactId: string; name: string; company: string; title: string; emailedAt: string; days: number };

export function followUpsDue(apps: WithPeople[], now = new Date()): FollowUpDue[] {
  return apps.flatMap((app) => (app.contacts ?? []).flatMap((person) => {
    const at = app.fillReport?.emailedAt?.[person.id];
    if (person.outreachStatus !== "emailed" || !at) return [];
    const days = businessDaysBetween(new Date(at), now);
    return days >= FOLLOW_UP_BUSINESS_DAYS ? [{ applicationId: app.id, contactId: person.id, name: person.name, company: app.company, title: app.title, emailedAt: at, days }] : [];
  })).sort((a, b) => a.emailedAt.localeCompare(b.emailedAt));
}
