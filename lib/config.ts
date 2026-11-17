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
export const CHROME_STORE_URL = process.env.NEXT_PUBLIC_CHROME_EXTENSION_URL || "https://chromewebstore.google.com/detail/loheheacekocdbngdoehppjhdmdcingb";

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
export const FREE_LIMITS = { letters: 3, answers: 3, autofills: 3, emails: 3 };
/** People Free unlocks each day: one person at each of two companies, with a checked email. */
export const FREE_UNLOCKS_PER_DAY = 2;
/** Companies Pro finds people at each month: up to 3 people at each, with verified emails. Shown on the plan. */
export const PRO_COMPANIES_PER_MONTH = 100;
export const CREDIT_COST = { letters: 2, answers: 1, autofills: 1, emails: 1, people: 5 };
/** What Free gets each day, in credits. */
export const FREE_CREDITS = FREE_LIMITS.letters * CREDIT_COST.letters + FREE_LIMITS.answers * CREDIT_COST.answers + FREE_LIMITS.emails * CREDIT_COST.emails;

/** A semester plan (no longer sold; students already on one keep it): four months paid up front. */
export const SEMESTER_MONTHS = 4;
/** The yearly plan: twelve months paid up front, renewing each year until cancelled. */
export const YEAR_MONTHS = 12;

/**
 * When a Pro semester (no longer sold) ends: May 31 (end of day, Eastern), the next one to come. PRO_SEMESTER_ENDS_AT (an ISO date)
 * overrides it while it's still in the future. A semester bought in the summer runs to the following May.
 */
export function semesterEndsAt(now = Date.now()) {
  const set = typeof process !== "undefined" ? Date.parse(process.env.PRO_SEMESTER_ENDS_AT ?? "") : NaN;
  if (!Number.isNaN(set) && set > now) return new Date(set);
  const year = new Date(now).getUTCFullYear();
  // 23:59:59 on May 31 in New York (EDT) is 03:59:59 UTC on June 1.
  const thisMay = Date.UTC(year, 5, 1, 3, 59, 59);
  return new Date(thisMay > now ? thisMay : Date.UTC(year + 1, 5, 1, 3, 59, 59));
}

/** "40 jobs' people lists" */
export function creditMath(credits: number) {
  return credits === 1 ? "People at 1 company" : `People at ${credits} companies`;
}

export const PUBLIC_PLANS = [
  {
    id: "free" as const,
    name: "Free",
    priceLabel: "$0",
    yearLabel: null,
    cadence: "Free for students, no card",
    blurb: "Everything you need to start",
    cta: "Start free",
    popular: false,
    monthly: false,
    credits: FREE_UNLOCKS_PER_DAY,
    yearCredits: null,
    applicationsLabel: "Free every day",
    features: ["Unlimited autofill that answers the questions too", `${FREE_LIMITS.letters} cover letters a day`, `${FREE_LIMITS.answers} question answers a day`, `${FREE_LIMITS.emails} emails written for you a day`, `${FREE_UNLOCKS_PER_DAY} people to email a day, each at a different company`, "Compete with friends", "Tracker and job matches"],
  },
  {
    id: "pro" as const,
    name: "Pro",
    priceLabel: "$29.99",
    yearLabel: "or $199 a year (save 45%)",
    cadence: "Billed monthly or yearly",
    blurb: "Unlimited writing and autofill, verified contacts every month",
    cta: "Choose Pro",
    popular: true,
    monthly: true,
    credits: 20,
    yearCredits: 240,
    applicationsLabel: "Unlimited writing and autofill",
    features: ["Unlimited autofill that answers the questions too", "Unlimited cover letters, tailored to each job", "Unlimited answers, every question on a page at once", `Verified contacts at ${PRO_COMPANIES_PER_MONTH} companies a month: up to 3 people at each, with verified emails`, "Unlimited emails and follow-ups written for you", "Email updates the moment they arrive", "Compete with friends"],
  },
];

/** Shown next to the public plans. Schools buy seats for their students; pricing is by conversation. */
export const ENTERPRISE_PLAN = {
  name: "Enterprise",
  blurb: "Buy for your school",
  priceLabel: "Custom",
  features: ["Unnepo for students across your school", "Credits sized to your number of students", "Pricing set with you"],
  contactEmail: CONTACT_EMAIL,
};
