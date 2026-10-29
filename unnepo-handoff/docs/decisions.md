# Decisions

## Product direction
- **Unnepo becomes a Chrome extension + web app.** The extension does the filling inside the student's own browser (fast, uses their real sign-ins, avoids bot detection, near-zero cost). The web app (Vercel) holds accounts, profile, the applied-jobs tracker, contacts unlock, stats, and job recommendations.
- **Browserbase is dropped** as the main way to apply. It took 10+ minutes per application because an AI model was called for every field, one at a time.
- **Schema first, one AI call per application.** Learn the form's questions as data (Greenhouse/Lever public APIs, or DOM inspection), map every field in one batched model call, then fill with plain code. AI only for fields rule-based matching can't handle and for essay answers.
- **Per-ATS adapters** for Greenhouse, Lever, Ashby, Workday, iCIMS, with a generic fallback.

## Extension behavior
- Fills text, textareas, native and custom (React) dropdowns, multi-select, radios, checkboxes, dates, file uploads, EEO sections. Clicks Next/Continue through multi-page flows and clicks Submit.
- Setting: "Auto-submit" vs "Pause before submit" (default: pause).
- Batch mode: open N tabs at a time, fill in the background, side panel shows each job's status.
- **Account creation (Workday etc.):** uses the student's saved default email. Passwords: generate a strong unique password per site by default; optional "use one default password" setting with a warning. Credentials are encrypted and stored ONLY in the extension (chrome.storage.local), never on the server. Let Chrome's password manager offer to save them.
- **Email verification:** pause with a banner, resume after the student verifies.
- **CAPTCHA:** stop and let the student solve it. Never bypass.
- **Submission detection:** network (chrome.webRequest observe-only: POST to the ATS submit endpoint with 2xx) → "confirmed"; redirect to known confirmation URL → "confirmed"; "thank you for applying" text after a submit click → "likely". Normalize job identity (ATS + company + job ID). Screenshot the confirmation. Student can also mark applied / not applied manually.

## Backend
- Accounts, profile, resume storage, applications tracker, stats, recommendations, contacts unlock, credits/Stripe (existing).
- **Contacts ("unlock people who work here"):** cache results per company domain and share across students; call Apollo (already integrated) or Hunter only on cache miss; monthly unlock credits per user. Show only verified emails.
- **Emails:** Unnepo drafts follow-up emails; the student sends them from their own mail client (mailto / copy). Unnepo does not send email.
- **Jobs you may like:** daily cron ingests public ATS boards (Greenhouse, Lever, Ashby) for a curated company list + public internship lists on GitHub; simple keyword/tag scoring against the profile. No paid AI.

## Cleanup (decided with the user)
Delete all four groups — see `repo-audit.md`:
1. Server-side browser apply (Browserbase/Playwright engine). Keep the fast schema + mapping code.
2. People search ("Find for Me" / "Custom Search"). Keep the Apollo unlock.
3. Mailbox sending (Gmail/Outlook OAuth, sending, follow-ups, reply sync).
4. Referrals & extra pages (/refer, /outreach, /saved, /checkout/demo, LinkedIn scraper).

## Onboarding (decided with the user)
**Resume first:** upload resume → auto-fill everything possible → student confirms → ask only what's missing. Spec in `onboarding-spec.md`.

## Design (decided with the user)
- Theme from the current site: near-black `#070708`, white `#F7F7F8`, blue `#3D8BFF`, Geist / Geist Mono. Way more minimal.
- Home page: a pixel-art spider hanging on a thread with a retro dialogue box as the centerpiece; his mouth moves while the problem/feature lines type out. CTA: **"Add to Chrome — it's free for students"**. The spider is an original drawing (don't use third-party sprites or any Pokémon branding).

## Cost rules
- No per-minute browser hosting.
- LLM only for unmatched fields and essay/email drafts; cheapest capable model; one batched call per application; cache answers by question text; per-user daily cap.
- Contact lookups cached globally per company + monthly unlock credits.
- Everything else is plain code.
- Admin page shows monthly LLM calls, contact API calls, estimated cost.
- Note: Vercel Hobby is for non-commercial use; once charging students, Vercel Pro (~$20/mo) is likely needed. Supabase free tier is fine to start.

## Delivery
Work on branch `extension-pivot` and push it to GitHub. (Pushing from Claude needs the Claude GitHub App installed on `agdavi27/unnepo`.)
