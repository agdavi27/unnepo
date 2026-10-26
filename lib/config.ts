function intEnv(name: string, fallback: number) {
  const raw = process.env[name];
  if (!raw) return fallback;
  const value = Number(raw);
  return Number.isFinite(value) ? value : fallback;
}

/** Pricing, credit rules, and spend caps. All of these are environment-configurable. */
export function serverConfig() {
  return {
    signupCredits: intEnv("SIGNUP_CREDITS", 25),
    unlockCreditCost: intEnv("UNLOCK_CREDIT_COST", 1),
    referralCredits: intEnv("REFERRAL_CREDITS", 50),
    referralDailyCap: intEnv("REFERRAL_DAILY_CAP", 10),
    grindPriceCents: intEnv("GRIND_PRICE_CENTS", 1900),
    grindMonthlyCredits: intEnv("GRIND_MONTHLY_CREDITS", 200),
    packPriceCents: intEnv("PACK_PRICE_CENTS", 5000),
    packCredits: intEnv("PACK_CREDITS", 500),
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

export const PUBLIC_PLANS = [
  {
    id: "free" as const,
    name: "The First Step",
    priceLabel: "$0",
    cadence: "Free forever",
    blurb: "Get started",
    cta: "Get started free",
    popular: false,
    features: ["25 credits", "Find professional contacts", "Personalized AI emails", "Basic outreach tracking"],
  },
  {
    id: "grind" as const,
    name: "The Grind",
    priceLabel: "$19",
    cadence: "Billed monthly",
    blurb: "For a few job hunters",
    cta: "Choose monthly",
    popular: false,
    features: ["200 credits every month", "Everything in Free", "AI-powered outreach", "Full analytics and tracking", "Priority support"],
  },
  {
    id: "pack" as const,
    name: "I Hate Subscriptions",
    priceLabel: "$50",
    cadence: "One-time payment. That's it.",
    blurb: "Most popular",
    cta: "Get 500 credits",
    popular: true,
    features: [
      "500 credits",
      "Everything in The Grind",
      "No recurring charges",
      "Use credits at your own pace",
      "Great for internships & one-time searches",
    ],
  },
];
