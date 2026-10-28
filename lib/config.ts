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
    packPriceCents: intEnv("PACK_PRICE_CENTS", 6000),
    packCredits: intEnv("PACK_CREDITS", 75),
    proPriceCents: intEnv("PRO_PRICE_CENTS", 3000),
    proMonthlyCredits: intEnv("PRO_MONTHLY_CREDITS", 25),
    premiumPriceCents: intEnv("PREMIUM_PRICE_CENTS", 6000),
    premiumMonthlyCredits: intEnv("PREMIUM_MONTHLY_CREDITS", 60),
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

/** One credit finds this many contacts, each with a verified work email. Matches the search quote in lib/credits/quote.ts. */
export const PEOPLE_PER_CREDIT = 25;

export function peopleFromCredits(credits: number) {
  return credits * PEOPLE_PER_CREDIT;
}

/** "5 credits = 125 contacts" */
export function creditMath(credits: number) {
  return `${credits} credits = ${peopleFromCredits(credits).toLocaleString("en-US")} contacts`;
}

export const PUBLIC_PLANS = [
  {
    id: "free" as const,
    name: "Free",
    priceLabel: "$0",
    cadence: "When you join",
    blurb: "Start here",
    cta: "Get started free",
    popular: false,
    monthly: false,
    credits: 5,
    people: peopleFromCredits(5),
    peopleLabel: `${peopleFromCredits(5)} contacts to start`,
    features: ["Verified work emails included", "AI email drafts", "Send from Gmail or Outlook"],
  },
  {
    id: "pro" as const,
    name: "Pro",
    priceLabel: "$30",
    cadence: "Billed monthly",
    blurb: "For an active search",
    cta: "Choose Pro",
    popular: true,
    monthly: true,
    credits: 25,
    people: peopleFromCredits(25),
    peopleLabel: `${peopleFromCredits(25).toLocaleString("en-US")} contacts each month`,
    features: ["Verified work emails included", "AI email drafts", "Everything in Free"],
  },
  {
    id: "premium" as const,
    name: "Premium",
    priceLabel: "$60",
    cadence: "Billed monthly",
    blurb: "For a full search",
    cta: "Choose Premium",
    popular: false,
    monthly: true,
    credits: 60,
    people: peopleFromCredits(60),
    peopleLabel: `${peopleFromCredits(60).toLocaleString("en-US")} contacts each month`,
    features: ["Verified work emails included", "AI email drafts", "Everything in Pro"],
  },
];

/** Shown next to the public plans. Schools buy seats for their students; pricing is by conversation. */
export const ENTERPRISE_PLAN = {
  name: "Enterprise",
  blurb: "Buy for your school",
  priceLabel: "Custom",
  features: ["Unnepo for students across your school", "Credits sized to your number of students", "Pricing set with you"],
  contactEmail: process.env.NEXT_PUBLIC_SALES_EMAIL ?? "",
};
