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

1. **Fill this application** injects `content/fill.js` into the tab and scans the form.
2. The background worker opens the job in Unnepo (`/api/extension/jobs`) and gets every answer
   (`/api/extension/map`): Greenhouse forms are read from Greenhouse's API; other forms send the scanned
   fields. The student's own data answers first, then cached AI answers, then at most one AI call.
3. The resume and, when the form asks, a cover letter PDF are attached.
4. The page script fills every field, checks what's still required and empty, and shows it in the panel.
   With auto-submit on and nothing missing (and no CAPTCHA), it clicks Submit; otherwise the student does.
5. Submission: a successful POST to the job site right after the Submit click is **confirmed**; the page's
   "thank you for applying" text alone is **likely**. Either is saved to Unnepo with a screenshot. Answers the
   student typed themselves are saved so the same question fills itself next time.

## Files

- `src/background.ts`: token, API client, fill flow, submission detection
- `src/content/scan.ts`: finds every field's question, section, options, and whether it's empty
- `src/content/greenhouse.ts`: Greenhouse's hosted form, by field id (React selects, uploads, checkbox groups)
- `src/content/generic.ts`: every other form (Lever, Ashby, company sites)
- `src/content/fill.ts`: the injected entry point
- `src/content/connect.ts`: receives the token on the connect page
- `src/shared/password.ts`: makes the job-site password and checks the rules
- `src/sidepanel/`: the panel

## Not yet

Tuned Lever and Ashby adapters, batch mode (many tabs, Submit all ready), and Workday (accounts with
per-site passwords kept in the extension, multi-page Next, email verification and CAPTCHA pauses).
Unnepo never solves CAPTCHAs.
