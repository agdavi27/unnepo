# Research: making Unnepo fast (Oct 29, 2026)

## Why Browserbase was slow
Every agent step (`act("fill X")`) is a separate model call plus page processing plus browser work. Stagehand's own speed guide shows a single form fill dropping from ~8s to ~500ms when planned once instead of acted field by field. With 30–60 fields and several pages, that's the 10+ minutes.

## What fixes it
1. **Read the form as data first.** Lever's public postings feed returns JSON without a key. Greenhouse's Job Board API GET endpoints are public and return the full question schema (questions, types, options, EEOC blocks).
2. **One model call per application** to map all fields (Skyvern's form tool works this way: DOM scan with no LLM → one text-only mapping call → fill by selector with AI fallback). Stagehand equivalent: one `observe()` then replay — 2–3x faster than per-field `act()`.
3. **Per-ATS scripts** for the big systems, agent only for the long tail. Stagehand caching gives up to ~2x faster / ~30% cheaper on repeat structures.
4. **Parallelism.** Browserbase concurrency: Free 1, Developer 25, Startup 100, Scale 250+; session-creation rate limits apply. Billed per minute.
5. **Benchmark:** a commercial apply API reports ~3 min median, under a minute for Greenhouse/Lever/Ashby.

## Hard limits
- Greenhouse application POST needs the employer's Job Board API key, and the hosted form validates a reCAPTCHA Enterprise token + client fingerprint minted in-page → submission must happen in a real browser.
- Lever's apply POST needs an API key configured by Lever for the employer.
- Workday needs a separate account per company.

## Why a browser extension
Simplify Copilot works this way: it runs in the student's own browser (real sign-ins, no bot detection) and keeps the student in control of the final submit. Trade-off: the student's laptop must be open, so batch mode = open many tabs, fill in background, student clicks through. Differentiator for Unnepo: schema-first batch prep + confirmed-submission tracker + recruiter unlock and follow-up drafts.

## Sources
- [Stagehand speed optimization](https://docs.stagehand.dev/v3/best-practices/speed-optimization)
- [Browserbase changelog: Stagehand caching](https://browserbase.com/changelog/stagehand-caching)
- [Browserbase plans & pricing](https://docs.browserbase.com/guides/plans-and-pricing)
- [Skyvern form-filling SDK](https://www.skyvern.com/docs/sdk-reference/browser-automation/forms.md)
- [Browserless: Greenhouse apply playbook](https://cloud.browserless.io/skills/greenhouse.com/apply-to-jobs)
- [Greenhouse API overview (Knit)](https://getknit.dev/?p=1404)
- [Lever postings API (Apify)](https://apify.com/appdata-labs/lever-jobs)
- [Lever postings gem docs](https://rubydoc.info/gems/lever_postings)
- [Job Application API (Boring Project)](https://publicapis.io/job-application-api-boringproject)
- [Simplify Copilot help](https://help.simplify.jobs/articles/1749022-installing-and-setting-up-copilot)
