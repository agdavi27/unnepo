function intEnv(name: string, fallback: number) {
  const raw = process.env[name];
  if (!raw) return fallback;
  const value = Number(raw);
  return Number.isFinite(value) ? value : fallback;
}

/** Where students, schools and anyone else can reach Unnepo. */
export const CONTACT_EMAIL = "contact@unnepo.com";

/** Pricing, credit rules, and spend caps. All of these are environment-configurable. */
export function serverConfig() {
  return {
    // People searches a new account starts with: the trial's people (3 companies), kept after it ends.
    signupCredits: intEnv("SIGNUP_CREDITS", 3),
    unlockCreditCost: intEnv("UNLOCK_CREDIT_COST", 1),
    referralCredits: intEnv("REFERRAL_CREDITS", 25),
    referralDailyCap: intEnv("REFERRAL_DAILY_CAP", 10),
    grindPriceCents: intEnv("GRIND_PRICE_CENTS", 2900),
    grindMonthlyCredits: intEnv("GRIND_MONTHLY_CREDITS", 30),
    packPriceCents: intEnv("PACK_PRICE_CENTS", 1500),
    packCredits: intEnv("PACK_CREDITS", 15),
    proPriceCents: intEnv("PRO_PRICE_CENTS", 2500),
    proMonthlyCredits: intEnv("PRO_MONTHLY_CREDITS", 20),
    /** People searches a Pro semester (4 months, paid up front) comes with: fewer than 4 months, since it costs less a month. */
    proSemesterCredits: intEnv("PRO_SEMESTER_CREDITS", 70),
    proSemesterPriceCents: intEnv("PRO_SEMESTER_PRICE_CENTS", 7500),
    premiumPriceCents: intEnv("PREMIUM_PRICE_CENTS", 3900),
    premiumMonthlyCredits: intEnv("PREMIUM_MONTHLY_CREDITS", 75),
    premiumSemesterPriceCents: intEnv("PREMIUM_SEMESTER_PRICE_CENTS", 11700),
    // Pro's writing and autofill are unlimited; this is a hidden fair-use guard against scripts, never shown as a number.
    proAiLimit: intEnv("PRO_AI_LIMIT", 1000),
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
 * Pricing, built to keep 60%+ margins. Writing and autofill cost under a cent or two each, so Pro has no limit on
 * them (only a hidden fair-use guard, PRO_AI_LIMIT). Finding people costs about 30¢ a company, so that's what's
 * counted on every plan: Pro gets PRO_MONTHLY_CREDITS companies a month (PRO_SEMESTER_CREDITS a semester), more in
 * packs of PACK_CREDITS. Free, after the 7-day trial, gets FREE_LIMITS each month (general letters and single
 * answers; the basic autofill has no limit) and sees who works at each company, with names and emails on Pro. The
 * trial's people are SIGNUP_CREDITS companies. `balance` on an account counts people searches (1 = the people at
 * the company for one job, charged only when someone is found); students see it in credits, at CREDIT_COST.people.
 */
export const FREE_LIMITS = { letters: 3, answers: 5, autofills: 10 };
/** People searches with names and emails on Free: none beyond what the trial left. Free sees who's there without names. */
export const FREE_PEOPLE = 0;
export const CREDIT_COST = { letters: 2, answers: 1, autofills: 1, people: 5 };
/** What Free gets each month, in credits: 6 for cover letters and 5 for answers. Free's autofill (the basic fields) has no limit. */
export const FREE_CREDITS = FREE_LIMITS.letters * CREDIT_COST.letters + FREE_LIMITS.answers * CREDIT_COST.answers + FREE_PEOPLE * CREDIT_COST.people;

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
    cadence: "After 7 days of Pro free",
    blurb: "Start with Pro, free for 7 days",
    cta: "Start 7 days of Pro free",
    popular: false,
    monthly: false,
    credits: FREE_PEOPLE,
    semesterCredits: null,
    applicationsLabel: "Free every month",
    features: ["7 days of Pro free, no card", "Autofill for your basic details, no limit", `${FREE_LIMITS.letters} general cover letters a month`, `${FREE_LIMITS.answers} question answers a month`, "See who works at each company", "Tracker and job matches"],
  },
  {
    id: "pro" as const,
    name: "Pro",
    priceLabel: "$25",
    semesterLabel: "or $75 a semester",
    cadence: "Billed monthly or each semester",
    blurb: "Unlimited writing and autofill",
    cta: "Choose Pro",
    popular: true,
    monthly: true,
    credits: 20,
    semesterCredits: 70,
    applicationsLabel: "Unlimited autofill and writing",
    features: ["Unlimited autofill that answers the questions too", "Unlimited cover letters, tailored to each job", "Unlimited answers, every question on a page at once", "Unlimited follow-up emails written for you", "Email updates the moment they arrive", "Names and emails at 20 companies a month, or 70 a semester", "15 more companies for $15 when you need them"],
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
