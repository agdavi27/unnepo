import { serverConfig } from "@/lib/config";
import { repo } from "@/lib/db/file-store";

export async function profitability() {
  const db = await repo.snapshot();
  const realPayments = db.payments.filter((payment) => payment.status === "paid" && !payment.demo);
  const refunds = db.payments.filter((payment) => payment.status === "refunded" && !payment.demo);
  const revenueCents = realPayments.reduce((sum, payment) => sum + payment.amountCents, 0) + refunds.reduce((sum, payment) => sum + payment.amountCents, 0);
  const activeSubs = db.subscriptions.filter((subscription) => subscription.status === "active");
  const mrrCents = activeSubs.reduce((sum, subscription) => sum + subscription.priceCents, 0);
  const payingUsers = new Set([...realPayments.map((payment) => payment.userId), ...activeSubs.map((subscription) => subscription.userId)]);
  const users = db.users.filter((user) => !user.deletedAt);
  const contactCosts = db.usage.filter((item) => item.provider === "apollo" || item.provider === "hunter");
  const contactCostCents = contactCosts.reduce((sum, item) => sum + item.costCents, 0);
  const aiCostCents = db.generations.reduce((sum, item) => sum + item.costCents, 0) + db.usage.filter((item) => item.provider === "anthropic").reduce((sum, item) => sum + item.costCents, 0);
  const stripeFeeCents = realPayments.reduce((sum, payment) => sum + Math.round(payment.amountCents * 0.029 + 30), 0);
  const config = serverConfig();
  const hostingCents = config.hostingMonthlyCents;
  const emailInfraCents = config.emailInfraMonthlyCents;
  const variableCents = contactCostCents + aiCostCents + stripeFeeCents + emailInfraCents;
  const unlocks = db.ledger.filter((entry) => entry.entryType === "unlock_debit");
  const successfulUnlocks = db.saved.filter((item) => item.creditCharged).length;
  const creditsRedeemed = unlocks.reduce((sum, entry) => sum + Math.abs(entry.amount), 0);
  const grossProfitCents = revenueCents - variableCents;
  const grossMargin = revenueCents > 0 ? grossProfitCents / revenueCents : 0;

  const providers = ["apollo", "hunter", "anthropic", "sample"].map((provider) => {
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
