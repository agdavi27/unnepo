function intEnv(name: string, fallback: number) {
  const raw = process.env[name];
  if (!raw) return fallback;
  const value = Number(raw);
  return Number.isFinite(value) ? value : fallback;
}

/** Pricing, credit rules, and spend caps. All of these are environment-configurable. */
export function serverConfig() {
  return {
    signupCredits: intEnv("SIGNUP_CREDITS", 5),
    unlockCreditCost: intEnv("UNLOCK_CREDIT_COST", 1),
    referralCredits: intEnv("REFERRAL_CREDITS", 25),
    referralDailyCap: intEnv("REFERRAL_DAILY_CAP", 10),
    grindPriceCents: intEnv("GRIND_PRICE_CENTS", 2900),
    grindMonthlyCredits: intEnv("GRIND_MONTHLY_CREDITS", 30),
    packPriceCents: intEnv("PACK_PRICE_CENTS", 1000),
    packCredits: intEnv("PACK_CREDITS", 20),
    proPriceCents: intEnv("PRO_PRICE_CENTS", 1500),
    proMonthlyCredits: intEnv("PRO_MONTHLY_CREDITS", 25),
    proSemesterPriceCents: intEnv("PRO_SEMESTER_PRICE_CENTS", 4500),
    premiumPriceCents: intEnv("PREMIUM_PRICE_CENTS", 3900),
    premiumMonthlyCredits: intEnv("PREMIUM_MONTHLY_CREDITS", 75),
    premiumSemesterPriceCents: intEnv("PREMIUM_SEMESTER_PRICE_CENTS", 11700),
    proAiLimit: intEnv("PRO_AI_LIMIT", 150),
    premiumAiLimit: intEnv("PREMIUM_AI_LIMIT", 300),
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
 * Pricing: Free is a one-time allowance, kept in separate buckets so its cost stays capped: FREE_LIMITS, plus
 * people at FREE_PEOPLE companies. Pro and Premium have no limit on writing or autofill beyond a monthly fair-use
 * cap. What costs real money is finding people, so that's what separates the plans. `balance` on an account counts
 * people searches (1 = the list of people at the company for one job, charged only when someone is found); students
 * see it in credits, at CREDIT_COST.people each.
 */
export const FREE_LIMITS = { letters: 5, answers: 10, autofills: 10 };
export const FREE_PEOPLE = 5;
export const CREDIT_COST = { letters: 2, answers: 1, autofills: 1, people: 5 };
/** What Free starts with, in credits: 10 for cover letters, 10 for chat answers, 10 for autofills, 25 for people. */
export const FREE_CREDITS = FREE_LIMITS.letters * CREDIT_COST.letters + FREE_LIMITS.answers * CREDIT_COST.answers + FREE_LIMITS.autofills * CREDIT_COST.autofills + FREE_PEOPLE * CREDIT_COST.people;

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
    blurb: "Try it out",
    cta: "Get started free",
    popular: false,
    monthly: false,
    credits: FREE_PEOPLE,
    semesterCredits: null,
    applicationsLabel: `${FREE_CREDITS} credits to start`,
    features: [`${FREE_LIMITS.letters} cover letters`, `${FREE_LIMITS.answers} chat answers`, `${FREE_LIMITS.autofills} successful autofills`, `People at ${FREE_PEOPLE} companies`, "Tracker and job matches"],
  },
  {
    id: "pro" as const,
    name: "Pro",
    priceLabel: "$15",
    semesterLabel: "or $45 a semester",
    cadence: "Billed monthly or each semester",
    blurb: "About 6 companies a week",
    cta: "Choose Pro",
    popular: true,
    monthly: true,
    credits: 25,
    semesterCredits: 100,
    applicationsLabel: "Unlimited autofill and writing",
    features: ["Unlimited cover letters, chat answers and autofills", "People at 25 companies a month, or 100 a semester", "Tracker and job matches", "20 more companies for $10"],
  },
  {
    id: "premium" as const,
    name: "Premium",
    priceLabel: "$39",
    semesterLabel: "or $117 a semester",
    cadence: "Billed monthly or each semester",
    blurb: "About 20 companies a week",
    cta: "Choose Premium",
    popular: false,
    monthly: true,
    credits: 75,
    semesterCredits: 300,
    applicationsLabel: "Unlimited autofill and writing",
    features: ["Everything in Pro", "People at 75 companies a month, or 300 a semester", "20 more companies for $10"],
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
