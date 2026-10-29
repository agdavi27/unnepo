# Repo audit — agdavi27/unnepo (commit b579c3c, Oct 29 2026)

Next.js 16.4 + React 19, Supabase (or local `.data/db.json`), Stripe, Inngest, Apollo, Anthropic SDK. About 17,600 lines. Signed-in app is one page (`components/unnepo/app-home.tsx`) with views "Apply to Job" and "Jobs Applied To"; Home, My Contacts, Find and Recommended Jobs are hidden but still in the code. All API routes go through `app/api/[...slug]/route.ts`.

## Delete

### 1. Server-side browser apply
- `lib/apply/browser.ts` (1,180 lines, Playwright/Browserbase)
- `lib/apply/fixer.ts`
- Browser parts of `lib/apply/service.ts`: `createBrowserSession`, `runFlow`, `fastFill`, `withSessionPage`, live view, stop/continue/submit-in-browser, `browserSessionId` handling
- `lib/apply/fast/greenhouse.ts` (it drives a Playwright page; its field-filling logic is a useful reference for the extension's Greenhouse adapter — port the ideas, then delete)
- Tests: `tests/apply-browser.test.ts`, `tests/apply-workday.test.ts`, browser parts of `tests/apply.test.ts`
- Dependency: `playwright-core`
- **Watch out:** `lib/apply/fast/mapper.ts` imports `EmptyField` from `browser.ts` and `acceptFixes` from `fixer.ts`. Move those into `mapper.ts` (or a small `lib/apply/fast/types.ts`) before deleting.

### 2. People search
- `lib/search/interpret.ts`, `lib/search/apollo-query.ts` (keep `RECRUITER_TITLES`: move it into `lib/apply/contacts.ts`)
- `lib/providers/contacts/sample-directory.ts`
- `lib/services/contacts.ts` (search side)
- `FindForMe`, `CustomSearch` in `components/unnepo/UnnepoForms.tsx` and their views in `app-home.tsx`
- `app/contacts/page.tsx` if it only serves search
- Search routes in the API catch-all
- **Keep** `lib/providers/contacts/router.ts` enrichment/unlock functions used by `lib/apply/contacts.ts` (`enrichPeopleBatch`, `resolveCompanyDomains`, `searchPeopleQuery`, `assertSpendAllowed`, …). Trim the rest.

### 3. Mailbox sending
- `lib/services/oauth.ts`, `app/connect/page.tsx`
- `lib/services/outreach.ts`, `lib/services/composer.ts`, `lib/services/followups.ts`, `lib/email/classify.ts`, `lib/email/grounded.ts`
- Reply-sync and follow-up functions in `lib/inngest/functions.ts` (delete `app/api/inngest/route.ts` and `inngest` dep if nothing is left)
- OAuth/send routes in the API catch-all; mailbox fields in the workspace payload
- **Keep** a simple "draft email" generator for the People page (can reuse the prompt idea from `lib/apply/contacts.ts` → `writeOutreachEmails`).

### 4. Referrals & extra pages
- `lib/services/referrals.ts` (also referenced from `lib/services/auth.ts` — remove that call)
- `app/refer/page.tsx`, `app/outreach/page.tsx`, `app/saved/page.tsx`, `app/checkout/demo/page.tsx`
- `lib/jobs/linkedin.ts` (referenced by `lib/services/jobs.ts`)

## Keep (and adapt)
- Auth: `lib/services/auth.ts`, `components/auth/*`, `app/login`, `app/signup`, `app/reset`
- Credits/billing: `lib/services/billing.ts`, `lib/services/entitlements.ts`, `lib/credits/*`, `lib/config.ts`
- Resume: `lib/services/resume.ts`, `lib/resume/parse.ts`, `lib/apply/resume-profile.ts`, `lib/pdf/text.ts` → basis for resume-first onboarding
- Fast pipeline: `lib/apply/fast/schema.ts`, `mapper.ts`, `pipeline.ts`, `lib/apply/questions.ts`, `options.ts`, `extract.ts`, `safe-fetch.ts` → the extension's mapping API
- Applications tracker: `lib/apply/store.ts`, `lib/apply/types.ts`, `components/unnepo/dashboard.tsx`, `lib/services/dashboard.ts`
- Contacts unlock: `lib/apply/contacts.ts`, `lib/providers/contacts/router.ts` (trimmed), `http.ts`
- Jobs: `lib/jobs/recommend.ts`, `lib/services/jobs.ts`, `components/unnepo/jobs.tsx`
- Cover letters: `lib/apply/cover-letter.ts` (optional; keep if cheap)
- Admin: `app/admin`, `lib/services/admin.ts`
- Landing: `components/marketing/landing.tsx` (to be replaced by the spider page), `components/unnepo/spiders.tsx` (existing spider component — check and replace)
- Privacy page, `proxy.ts`, Supabase migrations

## Replace
- Onboarding: `lib/profile/quiz-model.ts`, `lib/profile/intelligence.ts`, `ProfileOnboarding` in `UnnepoForms.tsx`, `lib/suggestions.ts`, the `PROFILE_SECTIONS` in `app-home.tsx` → new resume-first flow (see `onboarding-spec.md`).
- `README.md` → rewrite for the new architecture once done.

## Notes
- The build/test environment I used couldn't reach npm, so none of this was compiled. Verify everything with `npm run lint && npm test && npm run build`.
