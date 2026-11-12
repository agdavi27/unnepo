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
    /** Pro's people have no limit; this hidden monthly guard (companies, about 30¢ each) only stops scripts. */
    proPeopleLimit: intEnv("PRO_PEOPLE_LIMIT", 100),
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
 * Pricing. Free gets FREE_LIMITS each day (cover letters, answers, and full autofills that answer the questions
 * too; after those, autofill still fills the basic details) and FREE_PEOPLE_PER_WEEK companies' names and emails
 * a week, plus whatever the 7-day trial's SIGNUP_CREDITS left. Pro has no limits: only hidden monthly guards
 * against scripts (PRO_AI_LIMIT for writing and autofill, PRO_PEOPLE_LIMIT for companies, about 30¢ each), which a
 * real student never meets. `balance` on an account counts people searches left from the trial or a pack.
 */
export const FREE_LIMITS = { letters: 5, answers: 5, autofills: 5 };
/** Companies a week whose people Free sees with names and emails (1 = everyone found at one job's company). */
export const FREE_PEOPLE_PER_WEEK = 1;
export const CREDIT_COST = { letters: 2, answers: 1, autofills: 1, people: 5 };
/** What Free gets each day, in credits. */
export const FREE_CREDITS = FREE_LIMITS.letters * CREDIT_COST.letters + FREE_LIMITS.answers * CREDIT_COST.answers;

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
    credits: FREE_PEOPLE_PER_WEEK,
    semesterCredits: null,
    applicationsLabel: "Free every day",
    features: ["7 days of Pro free, no card", `${FREE_LIMITS.letters} cover letters a day`, `${FREE_LIMITS.answers} question answers a day`, `${FREE_LIMITS.autofills} autofills a day`, `Names and emails at ${FREE_PEOPLE_PER_WEEK} company a week`, "Tracker and job matches"],
  },
  {
    id: "pro" as const,
    name: "Pro",
    priceLabel: "$25",
    semesterLabel: "or $75 a semester",
    cadence: "Billed monthly or each semester",
    blurb: "Unlimited everything",
    cta: "Choose Pro",
    popular: true,
    monthly: true,
    credits: 20,
    semesterCredits: 70,
    applicationsLabel: "Unlimited everything",
    features: ["Unlimited cover letters, tailored to each job", "Unlimited answers, every question on a page at once", "Unlimited autofill that answers the questions too", "Names and emails at every company you apply to", "Follow-up emails written for you", "Email updates the moment they arrive"],
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
