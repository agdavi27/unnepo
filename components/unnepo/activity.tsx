/** The shapes of the applying session and of jobs that might have been submitted, as the server sends them. */

export type Maybe = { id: string; title: string; company: string; site: string; at: string };
export type Session = { startedAt: string; lastAt: string; active: boolean } | null;
