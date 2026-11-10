# Unnepo Chrome extension

Fills job and internship applications from the student's Unnepo profile, in their own browser. The student
presses Submit (or turns on auto-submit). Job-site passwords never leave the browser.

## Build and load

```bash
npm run extension:build
```

Then in Chrome: `chrome://extensions` → turn on **Developer mode** → **Load unpacked** → pick `extension/dist`.
Click the Unnepo icon to open the side panel.

To point it at a local copy of the site: `UNNEPO_API=http://localhost:3000 npm run extension:build`.

## The panel

One page at a time, with the wordmark and spider on top (poke him and he gets mad, as on the front page)
and **See my job dashboard**, **Settings**, credits left and **Upgrade plan** along the bottom:

- **The job box** (above **Write a cover letter**): with a job on the tab, everything the page says about it
  (title, company, place, pay, kind of job, date posted, how many questions, whether there's a resume upload,
  and the description), with **Begin applying**, **Skip** (until the browser closes) and **Not a job** (kept).
  With none, it says **No job found yet**.
- **Begin applying:** the resume goes into the upload box straight away (fetched as soon as the job box shows,
  so it's ready), and every complex question (one that needs a written answer, not a name, a link or a
  dropdown) gets a little spider beside it on the page. The panel lists them with **Answer complex questions**,
  which writes an answer to each one still empty and types it into its box; each answer can be edited and put
  in again, or copied. Later steps of the form, and reloads on the same site, get the same by themselves.
  Nothing is pressed or submitted. `src/content/apply-help.ts`.
- **Autofill is off** (`AUTOFILL_ENABLED` in `src/shared/types.ts`). The code is all still here; set it to true
  to bring back the Autofill button, the quick-answers card and the fill run.
- **Jobs only save by themselves when the site confirms it.** A page saying "thanks for applying" on a known job
  board (or a board's own "applied" mark) saves the job, with Undo. Anything less sure, like pressing Apply,
  goes into **Detected jobs**, a menu at the top of Home with the last 5 jobs noticed, each with **✓ I applied** /
  **✗ No**. Settings → Tracking can turn the automatic save off so every job asks. Jobs also come from
  **+ Add a job**, **I already applied** / **Save for later**, or the LinkedIn card. There is no email tracking.
- **Home is the tracker.** With no job on the tab, Home shows **Today** (reminders worked out in the extension from
  the jobs: follow-ups due, unfinished applications, "heard back?", the daily goal; each has **Later** and
  **Done**), then your jobs. A job opens its own page: status, the posting, and **People at the company**, where
  Find people searches, Show person reveals one, and a found email address is a link that opens Gmail, Outlook
  or the mail app with the email filled in (Settings → Tracking picks which). Reminders run every few hours
  (`chrome.alarms`) and can show one notification a day. `src/shared/tracker-view.ts`, `src/shared/reminders.ts`.
- **Dashboard** (`src/dashboard/`): a full tab with every job in a table (search, filter, sort, follow-ups due
  first), the reminders and Detected jobs beside it, and the open job's page with its people.
- **Applied, an error, or no job:** two big buttons, **Write a cover letter** and **Answer a question**. Each opens
  a popup asking one question at a time. A cover letter asks for the job description when there's no job on the
  tab (left empty, **Write generic one** writes a letter for no job in particular), then how it's built (see `docs/cover-letter-formats.md`), length, tone and what to
  mention, with bubbles from the resume to pick from. An answer asks for the question, then how long. The last
  question's button says what it costs: **Write cover letter (2 credits)**, **Answer question (1 credit)**. Under the big
  buttons, smaller: the resume (its name opens it, **Change** picks a new one), the job-site password as stars
  (click to copy, **Change** to type or make a new one). The line at the top says how it went.
  Reloading the page after an error brings Autofill back.

Settings has the profile, whether to press Submit, My jobs, activity, **Feedback**, sign out and the version.

## Connect

Side panel → **Connect on Unnepo** opens `/extension/connect`. Pressing Connect there hands the extension a
token (stored in `chrome.storage.local`, valid 90 days, only for `/api/extension/*`). The page also shows the
code to paste into the panel if needed.

## Job-site password

On install the extension makes one strong password (16 characters, with upper and lower case, a number,
and a special character) and types it into every empty password box on a form: sign-in, create account,
and confirm password. The student can show, copy, change, or remake it in the side panel; a new one has to
meet the same rules. It's kept only in `chrome.storage.local` and is never sent to Unnepo. Only the side
panel can read it; web pages and content scripts can't ask for it.

## How a fill works

Press **Fill this application** on a job posting or any step of the form. Unnepo keeps going until the
application is submitted or the student presses **Stop**:

1. First, if the page has an Apply button, it presses it (on Workday, then "Apply Manually"). A form's own
   "Apply" submit button doesn't count.
2. On an account page it creates the account the first time on that site, and signs in after that
   (`chrome.storage.local` remembers which sites have one). If the site says the account exists, it signs in.
3. On each new form page it gets every answer from Unnepo (`/api/extension/map`: the student's own data
   first, then cached AI answers, then at most one AI call), attaches the resume and cover letter, fills
   it, and types the job-site password into password boxes. Upload boxes get the resume from the student's
   account (the cover letter goes only where a cover letter is asked for; transcripts and the like get
   nothing). On Greenhouse, questions its API leaves out (the U.S. demographic questions) are read from the
   page, with dropdowns opened once to see their choices. When the page mentions a CV, the panel shows a
   **Generate CV** button (not connected yet).
4. It presses Next / Save and Continue. If a required field is still empty, a CAPTCHA is up, or the site
   wants an email verified, it waits and carries on by itself once that's done.
5. On the last page it presses Submit, unless "Let me press Submit myself" is on (the default).
6. Submission: a successful POST to the job site right after Submit is **confirmed**; the page's "thank you
   for applying" text alone is **likely**. Either is saved to Unnepo with a screenshot.

It never fills bot-trap fields (hidden or labelled for robots), never presses header links like Sign In or
"Apply with LinkedIn", and never solves CAPTCHAs. Buttons are found in `src/content/actions.ts`.

## The spider on job pages

On job systems (Workday, Greenhouse, Lever, Ashby, iCIMS, SmartRecruiters and others) and on pages whose
address mentions applying, careers, or jobs, a small spider drops down on the right once the page looks
like a job posting or an application. Clicking it opens the side panel; its × hides it on that site for
the browser session. It never shows on LinkedIn or on Unnepo itself, and it reads nothing but whether
the page looks like a job page (`src/content/launcher.ts`).

## Uploads and hard-to-read forms

- Upload boxes are filled before anything else, and the extension waits (up to six seconds) while a site
  reads the resume itself ("Analyzing resume…" on Lever, Ashby's autofill), so the site can't overwrite
  answers typed afterwards.
- A box that doesn't say what it's for gets the resume only if no box asks for the resume by name, and
  only once; cover letter boxes get the cover letter; transcripts, portfolios and the like get nothing.
- Forms built from web components (SmartRecruiters) are read through their open shadow roots.
- Forms in an embedded frame (a company site showing Greenhouse or iCIMS in a frame) are read in that
  frame. CAPTCHA, ad, video and payment frames are never touched.

## Files

- `src/background.ts`: token, API client, fill flow, submission detection
- `src/content/scan.ts`: finds every field's question, section, options, and whether it's empty
- `src/content/greenhouse.ts`: Greenhouse's hosted form, by field id (React selects, uploads, checkbox groups)
- `src/content/generic.ts`: every other form (Lever, Ashby, company sites)
- `src/content/fill.ts`: the injected entry point
- `src/content/launcher.ts`: the spider button that drops in on job pages and opens the panel
- `src/content/actions.ts`: finds and presses Apply, Create account, Sign in, Next, and Submit
- `src/content/spiders.ts`: the pixel spiders that drop in and crawl the page during a fill (skipped with reduced motion)
- `src/content/connect.ts`: receives the token on the connect page
- `src/shared/password.ts`: makes the job-site password and checks the rules
- `src/sidepanel/`: the panel

## Not yet

Tuned Lever and Ashby adapters, batch mode (many tabs, Submit all ready), and Workday (accounts with
per-site passwords kept in the extension, multi-page Next, email verification and CAPTCHA pauses).
Unnepo never solves CAPTCHAs.
