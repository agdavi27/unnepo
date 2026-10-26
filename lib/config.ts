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
    referralCredits: intEnv("REFERRAL_CREDITS", 5),
    referralDailyCap: intEnv("REFERRAL_DAILY_CAP", 10),
    grindPriceCents: intEnv("GRIND_PRICE_CENTS", 2900),
    grindMonthlyCredits: intEnv("GRIND_MONTHLY_CREDITS", 30),
    packPriceCents: intEnv("PACK_PRICE_CENTS", 6000),
    packCredits: intEnv("PACK_CREDITS", 75),
    dailyGlobalSpendCents: intEnv("DAILY_GLOBAL_SPEND_CENTS", 2500),
    dailyUserSpendCents: intEnv("DAILY_USER_SPEND_CENTS", 200),
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
    sampleDirectory: process.env.UNNEPO_SAMPLE_DIRECTORY !== "false",
    appUrl: process.env.APP_URL || process.env.NEXT_PUBLIC_APP_URL || "http://127.0.0.1:43123",
  };
}

export const PEOPLE_PER_CREDIT = 10;

export function peopleFromCredits(credits: number) {
  return credits * PEOPLE_PER_CREDIT;
}

export const PUBLIC_PLANS = [
  {
    id: "free" as const,
    name: "The First Step",
    priceLabel: "$0",
    cadence: "Free forever",
    blurb: "Get started",
    cta: "Get started free",
    popular: false,
    credits: 3,
    people: 30,
    peopleLabel: "Reach 30 people",
    features: ["3 credits", "Find professional contacts", "Personalized AI emails", "Basic outreach tracking"],
  },
  {
    id: "grind" as const,
    name: "The Grind",
    priceLabel: "$29",
    cadence: "Billed monthly",
    blurb: "For a few job hunters",
    cta: "Choose monthly",
    popular: false,
    credits: 30,
    people: 300,
    peopleLabel: "Reach 300 people every month",
    features: ["30 credits every month", "Everything in Free", "AI-powered outreach", "Full analytics and tracking", "Priority support"],
  },
  {
    id: "pack" as const,
    name: "I Hate Subscriptions",
    priceLabel: "$60",
    cadence: "One-time payment. That's it.",
    blurb: "Most popular",
    cta: "Get 75 credits",
    popular: true,
    credits: 75,
    people: 750,
    peopleLabel: "Reach 750 people",
    features: [
      "75 credits",
      "Everything in The Grind",
      "No recurring charges",
      "Use credits at your own pace",
      "Great for internships & one-time searches",
    ],
  },
];
