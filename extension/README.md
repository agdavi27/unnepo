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

1. On a posting it presses Apply (on Workday, then "Apply Manually").
2. On an account page it creates the account the first time on that site, and signs in after that
   (`chrome.storage.local` remembers which sites have one). If the site says the account exists, it signs in.
3. On each new form page it gets every answer from Unnepo (`/api/extension/map`: the student's own data
   first, then cached AI answers, then at most one AI call), attaches the resume and cover letter, fills
   it, and types the job-site password into password boxes.
4. It presses Next / Save and Continue. If a required field is still empty, a CAPTCHA is up, or the site
   wants an email verified, it waits and carries on by itself once that's done.
5. On the last page it presses Submit, unless "Let me press Submit myself" is on (the default).
6. Submission: a successful POST to the job site right after Submit is **confirmed**; the page's "thank you
   for applying" text alone is **likely**. Either is saved to Unnepo with a screenshot.

It never fills bot-trap fields (hidden or labelled for robots), never presses header links like Sign In or
"Apply with LinkedIn", and never solves CAPTCHAs. Buttons are found in `src/content/actions.ts`.

## Files

- `src/background.ts`: token, API client, fill flow, submission detection
- `src/content/scan.ts`: finds every field's question, section, options, and whether it's empty
- `src/content/greenhouse.ts`: Greenhouse's hosted form, by field id (React selects, uploads, checkbox groups)
- `src/content/generic.ts`: every other form (Lever, Ashby, company sites)
- `src/content/fill.ts`: the injected entry point
- `src/content/actions.ts`: finds and presses Apply, Create account, Sign in, Next, and Submit
- `src/content/spiders.ts`: the pixel spiders that drop in and crawl the page during a fill (skipped with reduced motion)
- `src/content/connect.ts`: receives the token on the connect page
- `src/shared/password.ts`: makes the job-site password and checks the rules
- `src/sidepanel/`: the panel

## Not yet

Tuned Lever and Ashby adapters, batch mode (many tabs, Submit all ready), and Workday (accounts with
per-site passwords kept in the extension, multi-page Next, email verification and CAPTCHA pauses).
Unnepo never solves CAPTCHAs.
