import { serverConfig } from "@/lib/config";
import { repo } from "@/lib/db/file-store";
import { applications } from "@/lib/apply/store";
import type { FillAttempt } from "@/lib/apply/types";

export async function profitability() {
  const db = await repo.snapshot();
  const realPayments = db.payments.filter((payment) => payment.status === "paid" && !payment.demo);
  const refunds = db.payments.filter((payment) => payment.status === "refunded" && !payment.demo);
  const revenueCents = realPayments.reduce((sum, payment) => sum + payment.amountCents, 0) + refunds.reduce((sum, payment) => sum + payment.amountCents, 0);
  const activeSubs = db.subscriptions.filter((subscription) => subscription.status === "active");
  const mrrCents = activeSubs.reduce((sum, subscription) => sum + subscription.priceCents, 0);
  const payingUsers = new Set([...realPayments.map((payment) => payment.userId), ...activeSubs.map((subscription) => subscription.userId)]);
  const users = db.users.filter((user) => !user.deletedAt);
  const contactCosts = db.usage.filter((item) => item.provider === "apollo");
  const contactCostCents = contactCosts.reduce((sum, item) => sum + item.costCents, 0);
  const aiCostCents = db.generations.reduce((sum, item) => sum + item.costCents, 0) + db.usage.filter((item) => item.provider === "anthropic").reduce((sum, item) => sum + item.costCents, 0);
  const stripeFeeCents = realPayments.reduce((sum, payment) => sum + Math.round(payment.amountCents * 0.029 + 30), 0);
  const config = serverConfig();
  const hostingCents = config.hostingMonthlyCents;
  const emailInfraCents = config.emailInfraMonthlyCents;
  const variableCents = contactCostCents + aiCostCents + stripeFeeCents + emailInfraCents;
  const unlocks = db.ledger.filter((entry) => entry.entryType === "unlock_debit" || entry.entryType === "search_debit");
  const successfulUnlocks = db.saved.filter((item) => item.creditCharged).length;
  const creditsRedeemed = unlocks.reduce((sum, entry) => sum + Math.abs(entry.amount), 0);
  const grossProfitCents = revenueCents - variableCents;
  const grossMargin = revenueCents > 0 ? grossProfitCents / revenueCents : 0;

  const providers = ["apollo", "anthropic", "sample"].map((provider) => {
    const rows = db.usage.filter((item) => item.provider === provider);
    const success = rows.filter((item) => item.success).length;
    const cost = rows.reduce((sum, item) => sum + item.costCents, 0);
    const latency = rows.length ? rows.reduce((sum, item) => sum + item.latencyMs, 0) / rows.length : 0;
    return {
      provider,
      calls: rows.length,
      successRate: rows.length ? success / rows.length : 0,
      failureRate: rows.length ? (rows.length - success) / rows.length : 0,
      costCents: cost,
      costPerSuccessCents: success ? cost / success : 0,
      averageLatencyMs: Math.round(latency),
      estimated: rows.every((item) => item.estimated),
    };
  });

  const today = new Date();
  today.setUTCHours(0, 0, 0, 0);
  const todaySpend = db.usage.filter((item) => item.createdAt >= today.toISOString() && item.provider !== "sample").reduce((sum, item) => sum + item.costCents, 0);
  const alerts: Array<{ level: "info" | "warning"; message: string }> = [];
  if (todaySpend > config.dailyGlobalSpendCents * 0.8) {
    alerts.push({ level: "warning", message: `Provider spend today is ${todaySpend.toFixed(2)}¢, near the daily cap.` });
  }
  const recentFailures = db.usage.filter((item) => !item.success && item.provider !== "sample").slice(-20);
  if (recentFailures.length >= 5) alerts.push({ level: "warning", message: `${recentFailures.length} recent provider failures.` });
  const heavy = users.filter((user) => db.saved.filter((item) => item.userId === user.id && item.unlockedAt >= new Date(Date.now() - 3600000).toISOString()).length > 25);
  if (heavy.length) alerts.push({ level: "warning", message: `${heavy.length} account(s) unlocked more than 25 contacts in the last hour.` });
  if (contactCosts.some((item) => item.estimated) || true) {
    alerts.push({ level: "info", message: "API costs are estimates from configured unit prices, not invoices, unless a provider returns a billed amount." });
  }

  return {
    revenue: {
      totalCents: revenueCents,
      mrrCents,
      payingCustomers: payingUsers.size,
      arpuCents: users.length ? revenueCents / users.length : 0,
      refundCents: refunds.reduce((sum, payment) => sum + Math.abs(payment.amountCents), 0),
      cancellations: db.subscriptions.filter((subscription) => subscription.status === "canceled").length,
      demoRevenueExcluded: true,
    },
    expenses: {
      contactApiCents: contactCostCents,
      aiApiCents: aiCostCents,
      emailInfraCents,
      stripeFeeCents,
      hostingCents,
      contactEstimated: true,
      aiEstimated: true,
      stripeEstimated: true,
      hostingEstimated: true,
    },
    unit: {
      costPerUnlockCents: successfulUnlocks ? contactCostCents / successfulUnlocks : 0,
      costPerEmailCents: db.generations.length ? aiCostCents / db.generations.length : 0,
      revenuePerCreditCents: creditsRedeemed ? revenueCents / creditsRedeemed : 0,
      variableCostPerCustomerCents: payingUsers.size ? variableCents / payingUsers.size : 0,
      grossMargin,
      grossProfitCents,
    },
    providers,
    alerts,
    counts: { users: users.length, unlocks: successfulUnlocks, generations: db.generations.length },
  };
}

const SITES: Array<[RegExp, string]> = [
  [/myworkday(jobs|site)?\.com$|workday\.com$/, "Workday"],
  [/greenhouse\.io$/, "Greenhouse"],
  [/lever\.co$/, "Lever"],
  [/ashbyhq\.com$/, "Ashby"],
  [/icims\.com$/, "iCIMS"],
  [/smartrecruiters\.com$/, "SmartRecruiters"],
  [/joinhandshake\.com$/, "Handshake"],
  [/taleo\.net$/, "Taleo"],
  [/successfactors\.(com|eu)$/, "SuccessFactors"],
  [/jobvite\.com$/, "Jobvite"],
  [/paycomonline\.net$/, "Paycom"],
];

/** "acme.wd5.myworkdayjobs.com" is "Workday"; a company's own site keeps its name. */
export function siteName(host: string) {
  return SITES.find(([pattern]) => pattern.test(host))?.[1] ?? host.replace(/^(www|jobs|careers|apply)\./, "");
}

export const PROBLEM_NAMES: Record<string, string> = {
  not_on_page: "field went from the page",
  list_didnt_open: "list didn't open",
  no_option: "no option matching",
  more_choices: "second list, nothing fits",
  didnt_stick: "answer didn't stick",
  no_file: "no file for the upload",
  error: "other error",
};

/**
 * Autofill failures from students' recent applications, grouped by site, kind of field, and problem
 * ("Workday · combobox · list didn't open · 14 times"), most common first, with recent examples.
 */
export async function autofillProblems() {
  const all = (await applications.recentAttempts()).flat();
  const groups = new Map<string, { site: string; type: string; problem: string; count: number; lastAt: string; examples: Array<{ label: string; answer: string; method: string; reason: string }> }>();
  const sites = new Map<string, { site: string; tried: number; failed: number }>();
  const methods = new Map<string, { method: string; ok: number; tried: number }>();
  for (const attempt of all as FillAttempt[]) {
    const site = siteName(attempt.site || "unknown");
    const totals = sites.get(site) ?? { site, tried: 0, failed: 0 };
    totals.tried += 1;
    if (!attempt.ok) totals.failed += 1;
    sites.set(site, totals);
    // "click, then keyboard" counts for the way that finally worked.
    const way = (attempt.method || "none").split(", then ").pop()!;
    const byWay = methods.get(`${attempt.type}|${way}`) ?? { method: `${attempt.type} · ${way}`, ok: 0, tried: 0 };
    byWay.tried += 1;
    if (attempt.ok) byWay.ok += 1;
    methods.set(`${attempt.type}|${way}`, byWay);
    if (attempt.ok) continue;
    const problem = attempt.problem ?? "error";
    const key = `${site}|${attempt.type}|${problem}`;
    const group = groups.get(key) ?? { site, type: attempt.type, problem: PROBLEM_NAMES[problem] ?? problem, count: 0, lastAt: "", examples: [] };
    group.count += 1;
    if ((attempt.at ?? "") > group.lastAt) group.lastAt = attempt.at ?? "";
    if (group.examples.length < 5) group.examples.push({ label: attempt.label, answer: attempt.answer, method: attempt.method, reason: attempt.reason ?? "" });
    groups.set(key, group);
  }
  const searches = await applications.recentPeopleSearches();
  const people = {
    searched: searches.length,
    foundNobody: searches.filter((search) => !search.chosen).length,
    // Which group the person came from: school, recruiter, department.
    byGroup: Object.entries(searches.reduce<Record<string, number>>((counts, search) => {
      const group = search.chosen ? (search.chosen.role === "alumni" ? "From the school" : search.chosen.role === "team_member" ? "Department" : "Recruiter") : "No one";
      counts[group] = (counts[group] ?? 0) + 1;
      return counts;
    }, {})).map(([group, count]) => ({ group, count })),
    nobody: searches.filter((search) => !search.chosen).slice(0, 30).map((search) => ({
      at: search.at, company: search.company, domains: search.domains, school: search.school,
      steps: search.steps.map((step) => `${step.step} @ ${step.domain}: ${step.error ? `failed (${step.error})` : step.found}`),
    })),
  };
  return {
    people,
    tried: all.length,
    failed: all.filter((attempt) => !attempt.ok).length,
    problems: [...groups.values()].sort((a, b) => b.count - a.count || b.lastAt.localeCompare(a.lastAt)).slice(0, 100),
    sites: [...sites.values()].sort((a, b) => b.failed - a.failed || b.tried - a.tried).slice(0, 30),
    methods: [...methods.values()].sort((a, b) => b.tried - a.tried).slice(0, 30),
  };
}
