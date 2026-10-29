# Architecture spec — Unnepo extension + web app

## Part 1 — Chrome extension (Manifest V3, TypeScript, in `extension/`)

### 1a. Auth & profile sync
- Student signs into the extension with their Unnepo account (token issued by the web app).
- Pulls the application profile and resume file from the backend; caches in `chrome.storage.local` so filling works without a server round trip.

### 1b. ATS account creation & sign-in
- Settings: default email for job-site accounts (defaults to profile email).
- Passwords: generate a strong unique password per site by default; optional "use one default password" with a warning about reuse.
- Credentials encrypted, stored only in `chrome.storage.local`, never sent to the server. Let Chrome's own save-password prompt fire.
- If credentials exist for the tenant/domain → sign in. Otherwise → fill create-account form, submit, record the tenant (e.g. `company.wd5.myworkdayjobs.com`).
- Email verification → banner "Verify your email, then click Continue", resume after.
- CAPTCHA → stop, ask the student to solve it, resume. Never bypass.

### 1c. Autofill engine
- Detect ATS from URL/DOM: Greenhouse, Lever, Ashby, Workday, iCIMS, SmartRecruiters, Taleo, generic.
- One adapter file per ATS: field detection, fill functions for text, textarea, native `<select>`, custom React comboboxes (open → type/search → pick exact option → verify it stuck), multi-select, radio, checkbox, date pickers, file upload (resume/cover letter via `DataTransfer`), EEO sections; Next/Continue navigation waiting for the next step to render; Submit.
- Fire proper input/change/blur events so React-controlled inputs register values.
- Field matching, cheapest first:
  1. Per-ATS known field map (no AI)
  2. Label/name/placeholder keyword matching against the profile (no AI)
  3. Student's `savedAnswers` (fuzzy match, no AI)
  4. Only remaining fields: ONE batched backend call with all unmatched fields + options + profile → JSON field→value; dropdown values must exactly match an allowed option. Cache by question text.
- Before submit, verify every required field has a value; otherwise highlight and pause.
- Setting: Auto-submit vs Pause before submit (default pause).

### 1d. Batch mode
- Student selects saved jobs → extension opens them in background tabs (configurable, e.g. 5 at once), fills each, queues them.
- Side panel (see `design/mockups/Extension.dc.html`): filling / needs you (CAPTCHA, verification, missing field) / ready / submitted / failed. "Submit all ready" button.

### 1e. Submission detection
1. Network: `chrome.webRequest` (observe-only) sees POST to the ATS's submit endpoint with 2xx → confirmed
2. URL: redirect to the ATS's confirmation URL pattern → confirmed
3. DOM: "application submitted" / "thank you for applying" after a submit click → likely
- Normalize job identity (ATS + company + job ID; strip tracking params).
- Send to backend: URL, company, title, ATS, timestamp, confidence, confirmation screenshot (`chrome.tabs.captureVisibleTab`).
- Manual "I applied" / "I didn't apply".

## Part 2 — Web app (Next.js on Vercel, Supabase)

### 2a. Accounts
Existing auth. Profile = resume-first onboarding (see `onboarding-spec.md`). Extension token endpoint.

### 2b. Applied tracker (`design/mockups/Applied.dc.html`)
Company, role, ATS, date, status (submitted / interviewing / rejected / offer — student-editable), confidence, confirmation screenshot. Filters + search.

### 2c. Unlock people (`design/mockups/People.dc.html`)
- "Unlock contacts at {company}" on each applied job.
- Cache per company domain, shared across students, refresh after ~60 days. Cache miss → Apollo (existing) or Hunter, behind a swappable interface. Recruiting/talent/HR + relevant team titles. Verified emails only.
- Monthly unlock credits per user.
- "Draft follow-up email" → student copies or opens in their mail client. Unnepo never sends.

### 2d. Stats (`design/mockups/Stats.dc.html`)
Applications per day/week, totals, by ATS, funnel (applied → responded → interview → offer), response rate, avg time per application, streaks.

### 2e. Jobs you may like (`design/mockups/Jobs.dc.html`)
- Daily Vercel Cron ingests public boards for a curated company list (Greenhouse `boards-api.greenhouse.io/v1/boards/{token}/jobs`, Lever `api.lever.co/v0/postings/{site}?mode=json`, Ashby public job board API) + public internship lists on GitHub. Dedupe by ATS + job ID; mark closed jobs.
- Score against profile preferences + past applications with keyword/tag matching. Select → "Apply to N selected" sends them to the extension's batch.

## Quality
- Save real form HTML fixtures per ATS; test each adapter's detection and dropdown handling.
- Log per-application timing and which fields fell through to the LLM.
- Encrypt site credentials client-side; never log them.
