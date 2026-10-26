# Unnepo

Unnepo is a career networking workspace for college students. A student verifies a school email, uploads a resume, searches for professionals, spends one credit to unlock a verified work email or business phone, writes a grounded outreach email, sends it from their own mailbox, and tracks the reply.

Showing a list of people costs 1 credit and returns up to 20. The same search is not charged again. An empty or failed search costs nothing. Unlocking a verified work email costs one more credit, and only after a real email comes back. Phone unlocking is not offered. AI email and cover letters are on Pro and Premium. Sending from a connected mailbox does not spend a contact credit.

Production does not show sample people. Without `APOLLO_API_KEY` the search page says the live directory is unavailable.

## Local development

```bash
npm install
npm run dev
```

Open [http://127.0.0.1:43123](http://127.0.0.1:43123).

Copy `.env.example` to `.env.local` when you add provider keys. Without keys, the app runs in local mode:

- Accounts, credits, resumes, and outreach live in `.data/db.json`.
- Professional search uses a **labeled sample directory** on your laptop. Production never does. Emails stay hidden until a successful unlock.
- Checkout is a demo screen. It does not charge a card, and demo credits are excluded from revenue.
- “Demo outbox” records a message without claiming it was sent. Connect Gmail or Outlook before a message can be marked sent.
- School-email verification links are returned to the signup screen so you can finish onboarding without an email provider.

```bash
npm test
npm run lint
```

## Production database (Supabase)

Hosted signup writes to Postgres. The local file `.data/db.json` works on your laptop and fails on Vercel.

### 1. Create the project

1. Open [https://supabase.com/dashboard](https://supabase.com/dashboard) and sign in with GitHub.
2. **New project**. Name it `unnepo`. Region: **East US (N. Virginia)** to match Vercel.
3. Set a database password and store it. You cannot see it again.
4. Wait until the project is ready.

### 2. Copy the connection string (recommended)

1. Open **Project Settings → Database → Connection string**.
2. Choose **URI** and the **Session pooler** (port `6543`).
3. Replace `[YOUR-PASSWORD]` with the password from step 1.
4. Put it in `.env.local`:

```bash
DATABASE_URL=postgresql://postgres.xxxx:YOUR_PASSWORD@aws-0-us-east-1.pooler.supabase.com:6543/postgres
```

5. Confirm it from this repo:

```bash
npm run setup:db
```

The first successful save creates the `app_state` table. You do not need to paste SQL if `DATABASE_URL` works.

### 3. Or use API keys only

If you do not have the database password, use the API keys instead:

1. **Project Settings → API**.
2. Copy **Project URL** into `SUPABASE_URL`.
3. Copy **`service_role`** (secret) into `SUPABASE_SERVICE_ROLE_KEY`. Never prefix it with `NEXT_PUBLIC_`.
4. Open **SQL Editor → New query**, paste `supabase/setup.sql`, and click **Run**.
5. Run `npm run setup:db`.

The anon key is not used for signup. Leave `NEXT_PUBLIC_SUPABASE_ANON_KEY` empty.

### 4. Put the same values on Vercel

In the Vercel project → **Settings → Environment Variables**, add these for Production and Preview:

| Name | Value |
| --- | --- |
| `DATABASE_URL` | the URI from step 2, **or** skip this and set the two Supabase keys |
| `SUPABASE_URL` | `https://<ref>.supabase.co` |
| `SUPABASE_SERVICE_ROLE_KEY` | the `service_role` secret |
| `SESSION_SECRET` | a long random string |
| `APP_URL` | `https://unneponew.vercel.app` |
| `NEXT_PUBLIC_APP_URL` | same as `APP_URL` |

Redeploy after saving. `/api/health` should show `"persistence":"postgres"` or `"persistence":"supabase"`. Then Create account can save a user.

Create a private Storage bucket named `resumes` later, when resume uploads go to Supabase Storage. Row Level Security is on and no anon policies are granted, so a leaked anon key cannot read rows.

## Vercel

Vercel is the hosting target. A purchased domain is not required.

1. Import this GitHub repository in the Vercel dashboard.
2. Framework preset: Next.js. Root directory: repository root.
3. Add the variables from `.env.example` to Development, Preview, and Production. Keep secrets server-side.
4. Set `APP_URL` and `NEXT_PUBLIC_APP_URL` to the generated `https://<project>.vercel.app` URL.
5. Deploy. Later, add a custom domain under Project Settings → Domains and update `APP_URL`. OAuth callbacks and Stripe webhooks are derived from `APP_URL`.

Use the Hobby plan only for non-commercial testing. Move to a Vercel plan that allows commercial use before charging students. Keep long work in Inngest, resumes in Supabase Storage, and provider calls behind the spend caps in `.env.example`.

This environment cannot attach the repository to your Vercel team. After you import it, pushes to the connected branch deploy automatically.

## Credits and Stripe

| Action | Credits |
| --- | --- |
| Verified school email | 25 once, unless `SIGNUP_CREDITS` overrides it |
| Search that returns people | 1, up to 20 people, once per filter set |
| Empty or failed search | 0 |
| Successful work-email unlock | 1 |
| Failed or duplicate unlock | 0 |
| AI email, follow-up draft, cover letter | Pro 200/month, Premium 600/month, free 0 |
| Sending | 0 contact credits, and only after you approve |
| Qualified referral | 25 promotional credits to the referrer |
| Pro | $30/month, 200 credits. New purchases. |
| Premium | $60/month, 500 credits. New purchases. |
| Legacy Grind and credit pack | Kept for accounts that already bought them |

Purchased credits stay in a separate balance from signup, referral, and subscription allowance. Stripe retries use the event id and a ledger idempotency key, so they cannot grant credits twice. Refunds claw back unused purchased credits.

Webhook endpoint: `POST {APP_URL}/api/billing/webhook`

Subscribe to `checkout.session.completed`, `invoice.paid`, `customer.subscription.deleted`, and `charge.refunded`. Set `STRIPE_WEBHOOK_SECRET`. Optional price ids: `STRIPE_PRICE_GRIND`, `STRIPE_PRICE_PACK`. Without them, Checkout uses inline prices.

## OAuth

Sign-in is school email and password. Google and Microsoft are only used to connect a mailbox so a student can send from their own inbox. Open `/connect` for the setup steps. Put `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `MICROSOFT_CLIENT_ID`, and `MICROSOFT_CLIENT_SECRET` in `.env.local`. The redirect URI is the origin in the browser plus the path below, which is `APP_URL` in production.

| Provider | Redirect URI |
| --- | --- |
| Gmail send | `{APP_URL}/api/oauth/gmail/callback` |
| Outlook send | `{APP_URL}/api/oauth/outlook/callback` |

Gmail scopes: `gmail.send` and `gmail.readonly`. Outlook scopes: `Mail.Send` and `Mail.Read`. Tokens are encrypted with `SESSION_SECRET` and are not returned to the browser. A message is marked sent only after the provider returns a message id.

Follow-ups are reminders. Unnepo does not send them automatically. A reply sync still runs when Inngest is configured.

## Contact providers

`ContactProviderRouter` searches and unlocks with Apollo. It does not enrich a person until that student clicks **Use 1 credit**. If Apollo returns no email and no phone, the unlock fails and the credit is returned. Apollo results are not replaced with sample profiles when Apollo fails.

Set `APOLLO_API_KEY`. Search uses Apollo's people API search (`mixed_people/api_search`). Estimated unit costs are configured with `APOLLO_*_COST_CENTS` and are labeled as estimates in the admin dashboard until a provider invoice reports an actual charge. Cache provider rows with `shareable = false` unless your contract allows a shared cache.

## Anthropic, jobs, analytics

- `ANTHROPIC_API_KEY` turns on email and cover-letter writing for Pro, Premium, and legacy paid plans. Free accounts get a clear paywall. Without the key, a paid account still gets a grounded draft that uses only selected facts. The model is `ANTHROPIC_FAST_MODEL`, which defaults to `claude-haiku-4-5`.

Follow-up reminders are manual. The daily job does not send email.

Ashby, Greenhouse, and Lever listings come from a small set of public company boards, not a global job index. Adzuna runs only when `ADZUNA_APP_ID` and `ADZUNA_APP_KEY` are set. Gmail and Outlook still need their OAuth client ids. Stripe Pro and Premium need `STRIPE_PRICE_PRO` and `STRIPE_PRICE_PREMIUM` if you do not want inline prices. None of those missing keys are simulated as success.
- Jobs use Adzuna when `ADZUNA_APP_ID` and `ADZUNA_APP_KEY` are set. Otherwise the jobs page shows labeled sample listings and links to public careers pages.
- `POSTHOG_KEY` and `SENTRY_DSN` are read on the server. Product analytics stored in the app omit resume text and email bodies.
- Inngest: set `INNGEST_EVENT_KEY` and `INNGEST_SIGNING_KEY`, then point Inngest at `{APP_URL}/api/inngest`. Functions cover resume processing, hourly reply sync, daily authorized follow-ups, and referral checks.

## Admin

Set `ADMIN_EMAILS` to a comma-separated list. Open `/admin` while signed in with one of those addresses. The page separates demo activity from Stripe revenue and marks estimated costs.

## Tests

`npm test` covers signup credits granted once, duplicate referrals, successful and failed unlocks, concurrent credit races, Stripe webhook idempotency, resume parsing, email grounding, send confirmation, reply sync, cross-user isolation, spend limits, Apollo-only enrichment, and background-job idempotency.
