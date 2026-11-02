function intEnv(name: string, fallback: number) {
  const raw = process.env[name];
  if (!raw) return fallback;
  const value = Number(raw);
  return Number.isFinite(value) ? value : fallback;
}

/** Pricing, credit rules, and spend caps. All of these are environment-configurable. */
export function serverConfig() {
  return {
    signupCredits: intEnv("SIGNUP_CREDITS", 3),
    unlockCreditCost: intEnv("UNLOCK_CREDIT_COST", 1),
    referralCredits: intEnv("REFERRAL_CREDITS", 25),
    referralDailyCap: intEnv("REFERRAL_DAILY_CAP", 10),
    grindPriceCents: intEnv("GRIND_PRICE_CENTS", 2900),
    grindMonthlyCredits: intEnv("GRIND_MONTHLY_CREDITS", 30),
    packPriceCents: intEnv("PACK_PRICE_CENTS", 500),
    packCredits: intEnv("PACK_CREDITS", 25),
    proPriceCents: intEnv("PRO_PRICE_CENTS", 2400),
    proMonthlyCredits: intEnv("PRO_MONTHLY_CREDITS", 40),
    proSemesterPriceCents: intEnv("PRO_SEMESTER_PRICE_CENTS", 6900),
    premiumPriceCents: intEnv("PREMIUM_PRICE_CENTS", 4400),
    premiumMonthlyCredits: intEnv("PREMIUM_MONTHLY_CREDITS", 100),
    premiumSemesterPriceCents: intEnv("PREMIUM_SEMESTER_PRICE_CENTS", 11900),
    proAiLimit: intEnv("PRO_AI_LIMIT", 200),
    premiumAiLimit: intEnv("PREMIUM_AI_LIMIT", 600),
    dailyGlobalSpendCents: intEnv("DAILY_GLOBAL_SPEND_CENTS", 25000),
    dailyUserSpendCents: intEnv("DAILY_USER_SPEND_CENTS", 2500),
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
 * Pricing: autofill is cheap to run, so applications aren't metered by credits. Free covers
 * FREE_APPLICATIONS of them; Pro and Premium have no limit beyond a daily fair-use cap on AI. What costs
 * real money is finding people, so 1 credit = the list of people at the company for one job, charged only when
 * one is found.
 */
export const FREE_APPLICATIONS = 25;

/** Cover letters Free writes each month. Paid plans have no limit. */
export const FREE_COVER_LETTERS = 5;

/** A semester plan: four months paid up front, with four months of credits at once. */
export const SEMESTER_MONTHS = 4;

/** "40 jobs' people lists" */
export function creditMath(credits: number) {
  return credits === 1 ? "People at 1 company" : `People at ${credits} companies`;
}

export const PUBLIC_PLANS = [
  {
    id: "free" as const,
    name: "Free",
    priceLabel: "$0",
    semesterLabel: null,
    cadence: "When you join",
    blurb: "Start here",
    cta: "Get started free",
    popular: false,
    monthly: false,
    credits: 3,
    applicationsLabel: `${FREE_APPLICATIONS} applications`,
    features: [`Autofill ${FREE_APPLICATIONS} applications`, "People to reach at 3 companies", `${FREE_COVER_LETTERS} cover letters a month, and the tracker`],
  },
  {
    id: "pro" as const,
    name: "Pro",
    priceLabel: "$24",
    semesterLabel: "or $69 a semester",
    cadence: "Billed monthly or each semester",
    blurb: "For an active search",
    cta: "Choose Pro",
    popular: true,
    monthly: true,
    credits: 40,
    applicationsLabel: "Unlimited applications",
    features: ["Unlimited autofill and cover letters", "People to reach at 40 companies a month", "Everything in Free"],
  },
  {
    id: "premium" as const,
    name: "Premium",
    priceLabel: "$44",
    semesterLabel: "or $119 a semester",
    cadence: "Billed monthly or each semester",
    blurb: "For a full search",
    cta: "Choose Premium",
    popular: false,
    monthly: true,
    credits: 100,
    applicationsLabel: "Unlimited applications",
    features: ["People to reach at 100 companies a month", "More any time: 25 companies for $5", "Everything in Pro"],
  },
];

/** Shown next to the public plans. Schools buy seats for their students; pricing is by conversation. */
export const ENTERPRISE_PLAN = {
  name: "Enterprise",
  blurb: "Buy for your school",
  priceLabel: "Custom",
  features: ["Unnepo for students across your school", "Credits sized to your number of students", "Pricing set with you"],
  contactEmail: process.env.NEXT_PUBLIC_SALES_EMAIL || "contactus@unnepo.io",
};
