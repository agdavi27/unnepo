# Unnepo — Claude Code master prompt

Paste everything below the line into Claude Code, run from the root of the `unnepo` repo, with this `unnepo-handoff` folder copied into the repo root.

---

I'm pivoting Unnepo (Next.js 16 + Supabase on Vercel, repo `agdavi27/unnepo`) from a server-side Browserbase autofill to a **Chrome extension + lightweight backend**. Everything we've decided is in the `unnepo-handoff/` folder in this repo. Read these first, in order:

1. `unnepo-handoff/docs/decisions.md` — what we decided and why (non-negotiable unless I say otherwise)
2. `unnepo-handoff/docs/repo-audit.md` — what exists in this repo, what to delete, what to keep
3. `unnepo-handoff/docs/architecture.md` — the full spec for the extension + backend
4. `unnepo-handoff/docs/onboarding-spec.md` — the new resume-first "getting to know you" flow
5. `unnepo-handoff/design/README.md` — visual design, tokens, and mockups (`design/home-spider.html` is the new landing page; open it in a browser)
6. `unnepo-handoff/docs/research.md` — background research (why Browserbase was slow, ATS APIs, costs)

Also read `AGENTS.md`: this Next.js version has breaking changes, so check `node_modules/next/dist/docs/` before writing Next code.

## Rules
- Work on a new branch `extension-pivot`. Commit after each phase with a clear message.
- BEFORE CODING: summarize your understanding of the current repo and the plan back to me, list every file you'll delete, and wait for my OK.
- Stop for my review after every phase below.
- Running costs must stay near $0 (see decisions.md → Cost rules).
- Never store students' job-site passwords on our server. Never try to bypass CAPTCHAs or bot detection. Never scrape LinkedIn.
- Run `npm run lint && npm test && npm run build` at the end of every phase and fix what breaks. Delete or rewrite tests for removed features rather than leaving them failing.

## Phases
1. **Cleanup.** Delete the features listed in `repo-audit.md` → "Delete". Move what the fast pipeline still needs out of `lib/apply/browser.ts` / `lib/apply/fixer.ts` (types like `EmptyField`, `acceptFixes`) into the modules that use them before deleting. Remove now-unused dependencies (`playwright-core`, etc.). Remove dead API routes from `app/api/[...slug]/route.ts` and dead UI/menu items. App must build and tests pass.
2. **New landing page.** Rebuild `components/marketing/landing.tsx` from `design/home-spider.html`: pixel spider on a thread, retro dialogue box typing the six lines with the mouth moving, CTA "Add to Chrome — it's free for students". Keep `app/page.tsx` rendering it. Respect `prefers-reduced-motion`.
3. **Resume-first onboarding.** Replace the 5-step networking quiz with the flow in `onboarding-spec.md`, including the new application-profile data model and Supabase migration.
4. **Backend API for the extension.** Extension auth token, profile endpoint, form-schema + one-call mapping endpoint (reuse `lib/apply/fast/*`), application logging endpoint (submission confirmations from the extension).
5. **Chrome extension (MV3, TypeScript)** in a new `extension/` folder: auth + profile sync, Greenhouse adapter end-to-end (fill, dropdowns, upload, submit, submission detection), then Lever + Ashby, batch side panel, then Workday (account creation/sign-in, multi-page Next, verification/CAPTCHA pause).
6. **Web app pages** matching the mockups: Applied tracker, Unlock people (+ email draft), Stats, Jobs you may like.
7. **Contacts unlock** (cache per company + Apollo/Hunter behind an interface + monthly unlock credits) and **job ingestion cron** for recommendations.
