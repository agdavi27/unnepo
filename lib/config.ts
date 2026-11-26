function intEnv(name: string, fallback: number) {
  const raw = process.env[name];
  if (!raw) return fallback;
  const value = Number(raw);
  return Number.isFinite(value) ? value : fallback;
}

/** Where students, schools and anyone else can reach Unnepo. */
export const CONTACT_EMAIL = "contact@unnepo.com";

/** The public site, for canonical URLs, the sitemap, RSS and structured data. */
export const SITE_URL = "https://www.unnepo.com";
/** Unnepo on the Chrome Web Store. NEXT_PUBLIC_CHROME_EXTENSION_URL can point somewhere else (a test listing). */
export const CHROME_STORE_URL = process.env.NEXT_PUBLIC_CHROME_EXTENSION_URL || "https://chromewebstore.google.com/detail/unnepo/loheheacekocdbngdoehppjhdmdcingb";

/** Pricing, credit rules, and spend caps. All of these are environment-configurable. */
export function serverConfig() {
  return {
    // Whole lists of people a new account starts with (only a trial, when TRIAL_DAYS turns one on, can use them).
    signupCredits: intEnv("SIGNUP_CREDITS", 3),
    unlockCreditCost: intEnv("UNLOCK_CREDIT_COST", 1),
    referralCredits: intEnv("REFERRAL_CREDITS", 25),
    referralDailyCap: intEnv("REFERRAL_DAILY_CAP", 10),
    grindPriceCents: intEnv("GRIND_PRICE_CENTS", 2900),
    grindMonthlyCredits: intEnv("GRIND_MONTHLY_CREDITS", 30),
    packPriceCents: intEnv("PACK_PRICE_CENTS", 1500),
    packCredits: intEnv("PACK_CREDITS", 15),
    proPriceCents: intEnv("PRO_PRICE_CENTS", 2999),
    proMonthlyCredits: intEnv("PRO_MONTHLY_CREDITS", 20),
    /** Pro by the semester, the default plan: four months for $99, renewing every four months. */
    proSemesterPriceCents: intEnv("PRO_SEMESTER_PRICE_CENTS", PLAN_CENTS.pro_semester),
    /** Outreach Season: one payment for OUTREACH_SEASON_DAYS, never renewed, giftable. */
    outreachPriceCents: intEnv("OUTREACH_PRICE_CENTS", PLAN_CENTS.outreach),
    outreachPeopleLimit: intEnv("OUTREACH_PEOPLE_LIMIT", OUTREACH_COMPANIES_PER_MONTH),
    /** Pro paid for a year up front: twelve months of Pro, for less than twelve monthly payments. */
    proYearCredits: intEnv("PRO_YEAR_CREDITS", 240),
    proYearPriceCents: intEnv("PRO_YEAR_PRICE_CENTS", 19900),
    premiumPriceCents: intEnv("PREMIUM_PRICE_CENTS", 3900),
    premiumMonthlyCredits: intEnv("PREMIUM_MONTHLY_CREDITS", 75),
    premiumSemesterPriceCents: intEnv("PREMIUM_SEMESTER_PRICE_CENTS", 11700),
    // Pro's writing and autofill are unlimited; this is a hidden fair-use guard against scripts, never shown as a number.
    proAiLimit: intEnv("PRO_AI_LIMIT", 1000),
    /** Companies Pro finds people at each month (about 20–30¢ each). Shown to the student; see PRO_COMPANIES_PER_MONTH. */
    proPeopleLimit: intEnv("PRO_PEOPLE_LIMIT", PRO_COMPANIES_PER_MONTH),
    premiumAiLimit: intEnv("PREMIUM_AI_LIMIT", 1000),
    dailyGlobalSpendCents: intEnv("DAILY_GLOBAL_SPEND_CENTS", 25000),
    // The most one account can spend on finding people in a day ($3): stops a script, never a real student.
    dailyUserSpendCents: intEnv("DAILY_USER_SPEND_CENTS", 300),
    aiHourlyLimit: intEnv("AI_HOURLY_LIMIT", 30),
    aiDailyLimit: intEnv("AI_DAILY_LIMIT", 100),
    apolloSearchCostCents: intEnv("APOLLO_SEARCH_COST_CENTS", 1),
    apolloEnrichCostCents: intEnv("APOLLO_ENRICH_COST_CENTS", 8),
    hostingMonthlyCents: intEnv("HOSTING_MONTHLY_CENTS", 0),
    emailInfraMonthlyCents: intEnv("EMAIL_INFRA_MONTHLY_CENTS", 0),
    fastInputCentsPerMillion: intEnv("AI_FAST_INPUT_CENTS_PER_MILLION", 100),
    fastOutputCentsPerMillion: intEnv("AI_FAST_OUTPUT_CENTS_PER_MILLION", 500),
    strongInputCentsPerMillion: intEnv("AI_STRONG_INPUT_CENTS_PER_MILLION", 300),
    strongOutputCentsPerMillion: intEnv("AI_STRONG_OUTPUT_CENTS_PER_MILLION", 1500),
    sampleDirectory: process.env.NODE_ENV === "production" ? false : process.env.UNNEPO_SAMPLE_DIRECTORY !== "false",
    appUrl: process.env.APP_URL || process.env.NEXT_PUBLIC_APP_URL || "http://127.0.0.1:43123",
  };
}

/**
 * Pricing. Free gets FREE_LIMITS each day (cover letters, answers and written emails; autofill has no limit on any plan,
 * only Pro's hidden guard against scripts, so its number here is unused) and FREE_UNLOCKS_PER_DAY unlocks: the best person at a
 * company, with a checked email, found when the student presses Unlock. Pro's writing and autofill have no limit (only
 * a hidden guard against scripts, PRO_AI_LIMIT); its people are PRO_COMPANIES_PER_MONTH companies a month, shown on the plan. `balance` on an account counts people searches left from the trial or a pack.
 */
/** `resumes`: resumes tailored to a job ("Tailor my resume to this job"), counted apart from cover letters. */
export const FREE_LIMITS = { letters: 3, answers: 3, autofills: 3, emails: 3, resumes: 3 };
/** People Free unlocks each day: one person at each of two companies, with a checked email. */
export const FREE_UNLOCKS_PER_DAY = 2;
/** Companies Pro finds people at each month: up to 3 people at each, with verified emails. Shown on the plan. */
export const PRO_COMPANIES_PER_MONTH = 100;
export const CREDIT_COST = { letters: 2, answers: 1, autofills: 1, emails: 1, people: 5 };
/** What Free gets each day, in credits. */
export const FREE_CREDITS = FREE_LIMITS.letters * CREDIT_COST.letters + FREE_LIMITS.answers * CREDIT_COST.answers + FREE_LIMITS.emails * CREDIT_COST.emails;

/** Companies Outreach Season finds people at each month, alumni from the student's school first. Shown on the plan. */
export const OUTREACH_COMPANIES_PER_MONTH = 250;
/** How long an Outreach Season pass lasts: one recruiting season, paid once, never renewed. */
export const OUTREACH_SEASON_DAYS = 120;
/** A full refund, no questions, for this many days after any payment. Said on the plans and in the Terms. */
export const REFUND_DAYS = 14;

/** Pro by the semester (the default): four months paid up front, renewing every four months until cancelled. */
export const SEMESTER_MONTHS = 4;
/** The yearly plan (no longer sold; students already on one keep it): twelve months paid up front. */
export const YEAR_MONTHS = 12;

/** "40 jobs' people lists" */
export function creditMath(credits: number) {
  return credits === 1 ? "People at 1 company" : `People at ${credits} companies`;
}

/**
 * The plans on the site and in the app. `priceLabel` is what each one costs for its `per` (a semester is four months),
 * and `altLabel` the other way to pay. Checkout refuses to charge anything but these prices.
 */
export const PUBLIC_PLANS = [
  {
    id: "free" as const,
    name: "Free",
    priceLabel: "$0",
    per: null as string | null,
    altLabel: null as string | null,
    cadence: "Free for students, no card",
    blurb: "Unlimited autofill and tracking, free for good",
    cta: "Start free",
    popular: false,
    giftable: false,
    applicationsLabel: "Free every day",
    features: ["Unlimited autofill that answers the questions too", "Unlimited job tracking", `${FREE_LIMITS.letters} cover letters a day`, `${FREE_LIMITS.resumes} resumes tailored to the job a day`, `${FREE_LIMITS.answers} question answers a day`, `${FREE_LIMITS.emails} emails written for you a day`, `${FREE_UNLOCKS_PER_DAY} people to email a day, each at a different company`, "Compete with friends"],
  },
  {
    id: "pro" as const,
    name: "Pro",
    priceLabel: "$99",
    per: "semester" as string | null,
    altLabel: "or $29.99 a month" as string | null,
    cadence: "Billed every 4 months, or monthly",
    blurb: "Every application tailored, and the right people to email about it",
    cta: "Choose Pro",
    popular: true,
    giftable: false,
    applicationsLabel: "Unlimited writing and autofill",
    features: ["Everything in Free", "Unlimited cover letters and answers, tailored to each job", `Verified contacts at ${PRO_COMPANIES_PER_MONTH} companies a month: the right 3 people at each`, "Short, tailored emails to each person, under 100 words", "A follow-up written for you when it's time", "Cancel in two clicks"],
  },
  {
    id: "outreach" as const,
    name: "Outreach Season",
    priceLabel: "$199",
    per: "season" as string | null,
    altLabel: "4 months, paid once, never renews" as string | null,
    cadence: "Paid once for a recruiting season",
    blurb: "A season of networking, for a tenth of what a coach costs",
    cta: "Get Outreach Season",
    popular: false,
    giftable: true,
    applicationsLabel: "Everything in Pro, plus the outreach",
    features: ["Everything in Pro, for 4 months", `Verified contacts at ${OUTREACH_COMPANIES_PER_MONTH} companies a month, alumni from your school first`, "A full sequence for each person: the first email and two follow-ups, timed for you", "Parents can give it as a gift", "Never renews, so nothing to cancel"],
  },
];

/** The cents behind a plan's labels, so a checkout can never charge something the page didn't say. */
export const PLAN_CENTS = { pro_semester: 9900, pro: 2999, outreach: 19900 } as const;

/** Shown next to the public plans. Schools buy seats for their students; pricing is by conversation. */
export const ENTERPRISE_PLAN = {
  name: "Enterprise",
  blurb: "Buy for your school",
  priceLabel: "Custom",
  features: ["Unnepo for students across your school", "Credits sized to your number of students", "Pricing set with you"],
  contactEmail: CONTACT_EMAIL,
};
