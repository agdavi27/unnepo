# Plan: everything in the extension, no email tracking

Goal: the Chrome extension becomes the whole product. The web app keeps only the landing page, sign up/login,
the connect handoff, billing, privacy and terms. Email forwarding, Postmark and Gmail tracking go away.

## What stays on the server (and why)

The extension still talks to our API. Some things can't move into the browser:

- **API keys** (Apollo, Hunter, Anthropic). Anything shipped in an extension can be read by anyone, so people
  lookups and AI writing stay as `/api/extension/*` calls.
- **Accounts, credits, Stripe**, the resume file and the profile, so they survive a reinstall or a new laptop.
- **The tracker data** (applications, contacts). The extension shows it; the database stores it.

So "move it onto the extension" means the **UI and flows** move. The backend gets smaller, but it doesn't go away.

---

## 1. People finder in the extension

Most of this already exists on the server: `lib/apply/contacts.ts` (school alum → recruiter → department),
`lib/providers/contacts/*` (Apollo), `lib/apply/email-guess.ts` (learn the format, build the address, check it with Hunter),
`lib/apply/people-web.ts` (web search), and the LinkedIn "Meet the hiring team" scan in `extension/src/content/scan.ts`.
The work is mostly wiring and UI. Your three options aren't really rivals. They work best as a chain, cheapest step first:

| Step | Source | Cost | Already built? |
| --- | --- | --- | --- |
| a. Scan the page | LinkedIn hiring team, a recruiter named in the description, `mailto:` links | free | mostly (`hiringTeam()`, `findPostedRecruiter`) |
| b. Names from Apollo | Apollo people search by company domain + recruiter/department titles | paid (credits) | yes (`findPeopleForApplication`) |
| c. Email for each name | Apollo email, else the format learned from a known email or the company site, then Hunter check | ~3¢ a check | yes (`email-guess.ts`) |

**Recommendation:** use a → b → c, with a free preview first (names and titles, blurred emails). Spend credits only
on **Reveal email**. This is the existing `preview` / `revealHiddenPerson` model, so pricing doesn't change.

Work:
- `POST /api/extension/people` (find, preview) and `POST /api/extension/people/reveal`, calling `contacts.ts` directly.
  Send the page-scanned poster along so step a is free.
- Panel: a **People at {company}** card under the job box (name, title, why they fit, Reveal, Copy email,
  **Write email**, which reuses `writeOutreachEmails`). Write email opens Gmail compose or `mailto:` already filled in.
- **I emailed them** marks the contact `emailed` and stamps `emailedAt`. That starts the follow-up timer (section 4).
- **Email link, filled in.** Once a person's email is found (or revealed), their address on the card becomes a link.
  Clicking it opens a new email to them with the subject and body already written (`writeOutreachEmails`, written
  ahead of time while the card loads, so the click is instant):
  - Default: a Gmail compose link, `https://mail.google.com/mail/?view=cm&to=…&su=…&body=…`, in a new tab.
  - Setting **Open emails in**: Gmail (default) / Outlook web (`outlook.office.com/mail/deeplink/compose?to=…&subject=…&body=…`) /
    my mail app (`mailto:`).
  - Keep the whole URL under ~2,000 characters (mailto and Outlook links get cut off). If the body is longer, put it
    on the clipboard and say "Body copied, paste it in".
  - Clicking the link offers **I emailed them** right away, and Home asks again an hour later if the student didn't press it.
- Also scan non-LinkedIn pages for a named recruiter (Greenhouse/Lever descriptions often say "reach out to …").

## 2. Remove email tracking; reminders on the extension home

### Remove
- Turn the flags off first (one release), then delete the code:
  - `lib/email/{inbound,process,classify,match,filter,links,store,service,gmail,address}.ts`
  - `components/unnepo/{email-tracking,email-wizard}.tsx`, the Setup → Email tracking page, the 4th onboarding step
  - API: `/api/email/*`, the Postmark webhook, `/api/cron/gmail`, `/api/oauth/gmail`, plus the cron in `vercel.json`
  - `integrations.gmail` / `gmailConnect`, and the `GMAIL_*`, `POSTMARK_*`, `CRON_SECRET` env vars
  - `tests/fixtures/emails` and the email tests
- **Keep** `lib/email/transactional.ts` + `verification.ts` (signup and password reset emails).
- Database: stop writing to the 0006–0008 tables. Add a later migration that drops them once nothing reads them.
  Revoke any stored Gmail tokens before the drop.
- Privacy policy: remove the forwarding and Gmail sections.
- `next-up.ts`: remove the `review` section and the "company wrote back" rows that came from parsed emails.

### Reminders (extension home)
The panel's first screen becomes **Home** when there's no job on the tab (the job box stays on top when there is one):

- **Today**: from `nextUp()` (it has no server imports, so it runs in the extension as is): goal progress,
  follow-ups due, applications to finish, "how did it go?" check-ins.
- Each row has one action: Write follow-up, Mark replied, Mark rejected/interview, Snooze 3 days, Done.
- **chrome.alarms** checks once a day; **chrome.notifications** says "2 follow-ups due" and also badges the icon.
  Needs the `alarms` + `notifications` permissions (easy to justify on the Web Store).
- Reminder rules (all local, no email reading):
  - follow up with a person 5 business days after **I emailed them** (`follow-ups.ts`, exists)
  - check in on an application 14 days after applied with no status change
  - finish an application left unsubmitted after 2 days
  - custom: "remind me on…" for any job

## 3. Logging jobs you applied to

| Way | State today | Work |
| --- | --- | --- |
| **Manual** | ✓ I applied, + Add a job, the LinkedIn card | Move "+ Add a job" onto Home; one form (link, title, company, date). |
| **Autodetect** | Detected (network POST, confirmation URL, "thanks for applying" text) but **only logged**. Saving needs ✓ I applied | Save automatically when detection is `confirmed`. For `likely`, show "Looks like you applied to X. ✓ / ✗" in the panel and as a notification. Every auto-save gets **Undo** (`extensionUndoSubmission` exists). Add a setting: Auto / Ask me. |
| **Scan email (extension)** | none | See section 5. Optional, later. |

**Detected jobs menu.** At the top of Home, a dropdown: **Detected jobs (5)**. Closed by default; open, it lists
the last 5 jobs the extension detected, newest first. Each row has the title, company, site, when it was seen, and how
sure the detection was (Confirmed / Likely / Left the tab).
- Confirmed jobs are already saved: the row shows **Saved ✓** and **Undo**.
- Likely and left-the-tab jobs show **✓ I applied** / **✗ No** (the server's existing `maybe` list: `extensionMaybe`
  add/answer/drop, already filled by `addMaybe` in `background.ts`).
- Answered rows stay in the list, greyed, until 5 newer ones push them out, so the menu always shows the last 5.
- The count on the closed menu is how many still need an answer. It's also shown on the extension icon badge.
- Today the server keeps only unanswered items (`liveMaybe`) and the panel doesn't show them. The server needs to keep the
  last 5 detections with their answer (`maybeApplied` → `detected`, capped at 5), and `/api/extension/me` needs to return them.

Also: on Handshake/LinkedIn, the "Applied on …" status the scanner already skips can be read as proof.
That's a cheap autodetect for Easy Apply, which never hits our form watcher.

## 4. Follow-ups

Without email tracking, follow-ups are driven by what the student marks:
1. Student emails someone from the People card → **I emailed them** (or Unnepo saw the Gmail compose sent, see section 5).
2. After 5 business days, Home shows "Follow up with Jane (Acme)". **Write follow-up** reuses `writeOutreachEmails({ followUp })`
   and opens compose filled in as a reply.
3. **They replied** / **No reply, stop** close it out. Two follow-ups max per person.

Scanning email for replies (so step 3 happens on its own) is section 5.

## 5. (Later, optional) The extension reads Gmail while it's open

This covers your "scan email with extension" ideas for 3 and 4. It runs locally, with no forwarding and no OAuth:
a content script on `mail.google.com` reads only the messages the student opens or the inbox list rows,
matches sender domain/subject against tracked companies, and asks "Is this Acme's reply? ✓".

Caveats to decide on before building:
- It's **still email tracking**, just in the browser. It conflicts with "remove email tracking" if the reason was
  privacy or trust. If the reason was setup friction (forwarding was too hard), this fixes that.
- It needs the `https://mail.google.com/*` host permission. Chrome Web Store review looks hard at that, and the install prompt
  will say "read and change your data on mail.google.com". Ask for it as an **optional permission**, turned on in Settings.
- Gmail's DOM changes often and Outlook web would need its own code. Expect upkeep.
- Detecting "sent" in Gmail compose (to mark `emailed` automatically) uses the same permission.

**Recommendation:** ship 1–4 without it, then decide based on how many students actually press I emailed them / They replied.

## 6. Move the rest of the web app into the extension

| Web page | Where it goes |
| --- | --- |
| `/home`, `/applications` (tracker table, stats) | Panel **Home** + **Jobs** tab. The full table opens as an extension page (`dashboard.html` in a tab), since the side panel is too narrow for it. |
| `/onboarding` (resume first) | Panel first run: Connect → upload resume → confirm facts → goals. Same API (`extensionSetup` exists). |
| `/settings`, Setup | Panel Settings (most already there). Billing links out to the web. |
| `/jobs` (recommendations) | Panel **Jobs for you** list, or drop it. |
| `/login`, `/signup`, `/extension/connect`, `/privacy`, `/terms`, landing | Stay on the web. After login, send people to "Open the extension" instead of `/home`. |
| `/admin` | Stays on the web. |

`panel.ts` is 1,754 lines in one file. Before adding Home, Jobs and People, split it into `sidepanel/views/*.ts`
(job box, home, jobs, people, settings) with a tiny router. That's the first engineering task.

---

## Order of work

1. **Split the panel** into views (no behavior change). Build the dashboard page shell.
2. **Remove email tracking**: flags off, delete code/routes/cron, policy text. Keep signup emails.
3. **Extension Home + reminders**: `nextUp()` in the panel, alarms + notifications, snooze/done.
4. **Applied logging**: auto-save `confirmed`, prompt for `likely`, undo, the **Detected jobs** menu (last 5),
   Easy Apply status read, Add a job on Home.
5. **People finder**: `/api/extension/people` + reveal, People card, the email link that opens a filled-in email, I emailed them.
6. **Follow-up flow** on top of 3 + 5.
7. **Onboarding + tracker table in the extension**; web `/home`, `/applications`, `/onboarding` redirect to "open the extension".
8. *(Optional)* Gmail read-while-open, as an optional permission.

Each step is its own release (`npm run push`).

## Decisions needed

- Why remove email tracking: **privacy/trust** or **setup friction**? This decides whether section 5 is ever built.
- Autodetect default: **save automatically** or **ask me**?
- People finder pricing: keep "free preview, credits to reveal", or include N reveals per month?
- Keep **Jobs for you** recommendations, or cut them?
- Is the web tracker deleted, or kept read-only for students who don't have Chrome open (phone)?

## What was built (Nov 10, 2026)

Decisions taken: Gmail reading in the extension (section 5) is skipped for now; autodetect saves by itself only
when the site confirms it, everything else asks, every save has Undo; people-finder pricing is unchanged; the
website keeps login, profile, settings and plans, and its Home now says Unnepo lives in Chrome.

- **Email tracking is gone.** `lib/email/*` (except `transactional.ts`), the Postmark inbound route, Gmail
  connect and its cron, the email pages and tests are removed. `supabase/migrations/0009_remove_email_tracking.sql`
  drops `email_texts`, `email_events`, `email_inboxes` and `gmail_connections`. Company/title matching moved to
  `lib/apply/match.ts`.
- **Extension API:** `GET /api/extension/tracker`, `POST /api/extension/status`, `POST /api/extension/people`
  (find, reveal, write, status, bounced), `DELETE /api/extension/applications` (`lib/extension/service.ts`).
- **Side panel Home:** the Detected jobs menu (last 5, closed by default, a count of ones waiting), Today
  reminders, your jobs, and a page per job with the people at the company. A found address is a link that opens
  the filled-in email (Gmail, Outlook or mailto; Settings → Tracking). After a link is opened, the reminders ask
  "Did you send it?"; after two follow-ups with no reply they suggest stopping.
- **Reminders** are worked out in the extension (`extension/src/shared/reminders.ts`, using
  `lib/apply/next-up.ts`), checked every 3 hours, with at most one notification a day and a count on the icon.
- **Dashboard tab** (`extension/src/dashboard/`): every job in a table with search, filter and sort, reminders
  and Detected jobs beside it, the open job on the right.
- **Web onboarding** step 4 is now "Add the Unnepo extension" instead of email forwarding.

Still to do: section 5 (reading Gmail in the extension), and moving the rest of onboarding (section 6) into the
panel; the resume upload is already there.
