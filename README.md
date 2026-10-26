# Unnepo

Unnepo is a career networking workspace for college students. A student verifies a school email, uploads a resume, searches for professionals, spends one credit to unlock a verified work email or business phone, writes a grounded outreach email, sends it from their own mailbox, and tracks the reply.

Showing a list of people costs 1 credit and returns up to 20. An empty or failed search costs nothing. Unlocking a verified work email or business phone costs one more credit, and only after the lookup succeeds. Generating and sending email costs no contact credits.

## Local development

```bash
npm install
npm run dev
```

Open [http://127.0.0.1:43123](http://127.0.0.1:43123).

Copy `.env.example` to `.env.local` when you add provider keys. Without keys, the app runs in local mode:

- Accounts, credits, resumes, and outreach live in `.data/db.json`.
- Professional search uses a **labeled sample directory**. Those people are not live Apollo results, and emails stay hidden until a credit unlock.
- Checkout is a demo screen. It does not charge a card, and demo credits are excluded from revenue.
- “Demo outbox” records a message without claiming it was sent. Connect Gmail or Outlook before a message can be marked sent.
- School-email verification links are returned to the signup screen so you can finish onboarding without an email provider.

```bash
npm test
npm run lint
```

## Production database

Apply `supabase/migrations/0001_init.sql` in the Supabase SQL editor, or with the Supabase CLI:

```bash
supabase db push
```

Create a private Storage bucket named `resumes`. Put these on the server only:

- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`

Do not expose the service role with `NEXT_PUBLIC_`. Row Level Security is enabled and no anon policies are granted, so the browser cannot read tables with the anon key. The local file store is what `npm run dev` uses until a Supabase-backed repository is pointed at this schema. On Vercel, set `UNNEPO_DATA_DIR` only for a single long-running Node server; serverless instances need Supabase (or another Postgres) for durable data.

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
| Verified school email | 25 once |
| Search that returns people | 1, up to 20 people |
| Empty or failed search | 0 |
| Successful contact unlock | 1 |
| Failed or duplicate unlock | 0 |
| AI email and sending | 0 |
| Qualified referral | 50 to the referrer (`REFERRAL_CREDITS`) |
| The Grind | $19/month, 200 allowance credits per paid invoice |
| I Hate Subscriptions | $50 once, 500 purchased credits |

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

Automated follow-up sends only when the student explicitly authorizes one, a mailbox is connected, and no reply or opt-out has arrived. The daily Inngest job uses a stable idempotency key so a retry cannot send the follow-up twice.

## Contact providers

`ContactProviderRouter` searches and unlocks with Apollo. It does not enrich a person until that student clicks **Use 1 credit**. If Apollo returns no email and no phone, the unlock fails and the credit is returned. Apollo results are not replaced with sample profiles when Apollo fails.

Set `APOLLO_API_KEY`. Estimated unit costs are configured with `APOLLO_*_COST_CENTS` and are labeled as estimates in the admin dashboard until a provider invoice reports an actual charge. Cache provider rows with `shareable = false` unless your contract allows a shared cache.

## Anthropic, jobs, analytics

- `ANTHROPIC_API_KEY` turns on email generation. Without it, a grounded template uses only the facts the student selected. The model is `ANTHROPIC_FAST_MODEL`, which defaults to `claude-haiku-4-5`. Create a key at [console.anthropic.com](https://console.anthropic.com/settings/keys), put it in `.env.local`, and restart `npm run dev`. On the website, add the same variable in the host's environment settings.
- Jobs use Adzuna when `ADZUNA_APP_ID` and `ADZUNA_APP_KEY` are set. Otherwise the jobs page shows labeled sample listings and links to public careers pages.
- `POSTHOG_KEY` and `SENTRY_DSN` are read on the server. Product analytics stored in the app omit resume text and email bodies.
- Inngest: set `INNGEST_EVENT_KEY` and `INNGEST_SIGNING_KEY`, then point Inngest at `{APP_URL}/api/inngest`. Functions cover resume processing, hourly reply sync, daily authorized follow-ups, and referral checks.

## Admin

Set `ADMIN_EMAILS` to a comma-separated list. Open `/admin` while signed in with one of those addresses. The page separates demo activity from Stripe revenue and marks estimated costs.

## Tests

`npm test` covers signup credits granted once, duplicate referrals, successful and failed unlocks, concurrent credit races, Stripe webhook idempotency, resume parsing, email grounding, send confirmation, reply sync, cross-user isolation, spend limits, Apollo-only enrichment, and background-job idempotency.
