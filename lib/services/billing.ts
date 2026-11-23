import { randomBytes } from "node:crypto";
import { OUTREACH_SEASON_DAYS, PLAN_CENTS, SEMESTER_MONTHS, YEAR_MONTHS, serverConfig } from "@/lib/config";
import { id, nowIso, repo } from "@/lib/db/file-store";
import { appOrigin, sendGiftEmail } from "@/lib/email/transactional";
import { ServiceError } from "@/lib/errors";

type StripeObject = Record<string, unknown>;

async function stripeClient() {
  const secret = process.env.STRIPE_SECRET_KEY;
  if (!secret) return null;
  const Stripe = (await import("stripe")).default;
  return new Stripe(secret);
}

/** Stripe sends a linked record as its id or, when expanded, as the whole object. */
function idOf(value: unknown) {
  if (typeof value === "string") return value;
  return value && typeof value === "object" ? String((value as StripeObject).id ?? "") : "";
}

export type StripeEvent = {
  id: string;
  type: string;
  data: { object: StripeObject };
};

export async function applyVerifiedStripeEvent(event: StripeEvent) {
  const first = await repo.recordWebhook("stripe", event.id);
  if (!first) return { duplicate: true, granted: 0 };

  try {
    if (event.type === "checkout.session.completed") {
      return await grantFromCheckout(event.data.object, event.id);
    }
    if (event.type === "invoice.paid") {
      return await grantFromInvoice(event.data.object, event.id);
    }
    if (event.type === "customer.subscription.deleted") {
      const subscriptionId = String(event.data.object.id ?? "");
      if (subscriptionId) {
        const stored = (await repo.listSubscriptions()).find((item) => item.stripeSubscriptionId === subscriptionId);
        const userId = String((event.data.object.metadata as StripeObject | undefined)?.userId ?? stored?.userId ?? "");
        await repo.upsertSubscription({
          id: id(),
          priceCents: serverConfig().grindPriceCents,
          currentPeriodEnd: null,
          createdAt: nowIso(),
          ...stored,
          userId,
          stripeSubscriptionId: subscriptionId,
          status: "canceled",
        });
        if (userId) await endPaidPlan(userId);
      }
      return { duplicate: false, granted: 0 };
    }
    if (event.type === "customer.subscription.updated") {
      const subscriptionId = String(event.data.object.id ?? "");
      const stored = (await repo.listSubscriptions()).find((item) => item.stripeSubscriptionId === subscriptionId);
      const status = String(event.data.object.status ?? "");
      const next = status === "active" || status === "trialing" ? "active" : status === "past_due" || status === "unpaid" ? "past_due" : null;
      if (stored && next) await repo.upsertSubscription({ ...stored, status: next });
      return { duplicate: false, granted: 0 };
    }
    if (event.type === "charge.refunded") {
      // A partial refund leaves what was bought in place.
      if (event.data.object.refunded === false) return { duplicate: false, granted: 0 };
      const paymentIntent = String(event.data.object.payment_intent ?? "");
      const payments = await repo.listPayments();
      const payment = payments.find((item) => item.status === "paid" && ((paymentIntent && item.stripePaymentIntent === paymentIntent) || item.stripeCheckoutId === String(event.data.object.id ?? "")));
      if (payment && !payment.demo && payment.kind === "pass") {
        await refundPass(payment);
        await repo.insertPayment({ ...payment, id: id(), stripeEventId: `refund:${event.id}`, status: "refunded", amountCents: -Math.abs(payment.amountCents), creditsGranted: 0, createdAt: nowIso() });
      } else if (payment && !payment.demo) {
        await repo.clawbackCredits({
          userId: payment.userId,
          amount: payment.creditsGranted,
          bucket: payment.kind === "subscription" ? "allowance" : "purchased",
          idempotencyKey: `refund:${event.id}`,
          note: "Stripe refund",
        });
        await repo.insertPayment({
          ...payment,
          id: id(),
          stripeEventId: `refund:${event.id}`,
          status: "refunded",
          amountCents: -Math.abs(payment.amountCents),
          creditsGranted: 0,
          createdAt: nowIso(),
        });
      }
      return { duplicate: false, granted: 0 };
    }
    return { duplicate: false, granted: 0 };
  } catch (error) {
    // Stripe retries a failed delivery, and the retry has to run rather than look like a duplicate.
    await repo.forgetWebhook("stripe", event.id);
    throw error;
  }
}

/** A subscription ended. Its monthly credits end with it; credits the student bought stay. Another active subscription keeps the plan. */
async function endPaidPlan(userId: string) {
  const others = (await repo.listSubscriptions()).filter((item) => item.userId === userId && item.status === "active");
  if (others.length) return;
  const account = await repo.getAccount(userId);
  // An Outreach Season pass was paid for apart from any subscription, and runs to its own end date.
  if (!account || !["grind", "pro", "premium"].includes(account.plan)) return;
  await repo.replaceAllowance(userId, 0);
  await repo.setAccountForTests(userId, { plan: account.purchasedBalance > 0 ? "pack" : "free", includedAllowance: serverConfig().signupCredits });
}

/** The payment behind an invoice. Newer Stripe API versions list it under the invoice's payments instead of on the invoice. */
async function invoicePaymentIntent(object: StripeObject) {
  const direct = idOf(object.payment_intent);
  if (direct) return direct;
  const listed = ((object.payments as StripeObject | undefined)?.data ?? []) as Array<{ payment?: { payment_intent?: unknown } }>;
  const fromList = idOf(listed[0]?.payment?.payment_intent);
  if (fromList) return fromList;
  try {
    const stripe = await stripeClient();
    const payments = await stripe?.invoicePayments.list({ invoice: String(object.id), limit: 1 });
    return idOf(payments?.data[0]?.payment?.payment_intent) || null;
  } catch (error) {
    // The student still gets what they paid for. Only matching a later refund is affected.
    console.error("stripe_invoice_payment_lookup_failed", String(object.id), error instanceof Error ? error.message : error);
    return null;
  }
}

async function grantFromCheckout(object: StripeObject, eventId: string) {
  if (object.mode !== "payment" || object.payment_status !== "paid") return { duplicate: false, granted: 0 };
  const metadata = (object.metadata ?? {}) as StripeObject;
  if (metadata.kind === "outreach_gift") return grantGift(object, metadata, eventId);
  if (metadata.kind === "outreach") return grantPass(object, metadata, eventId);
  const userId = String(metadata.userId ?? object.client_reference_id ?? "");
  const credits = Number(metadata.credits ?? serverConfig().packCredits);
  if (!userId) return { duplicate: false, granted: 0 };
  const grant = await repo.grantCreditsOnce({
    userId,
    entryType: "purchase_grant",
    amount: credits,
    bucket: "purchased",
    idempotencyKey: `checkout:${String(object.id)}`,
    referenceType: "stripe_checkout",
    referenceId: String(object.id),
    note: "One-time credit pack",
  });
  await repo.insertPayment({
    id: id(),
    userId,
    stripeEventId: eventId,
    stripeCheckoutId: String(object.id),
    stripePaymentIntent: object.payment_intent ? String(object.payment_intent) : null,
    amountCents: Number(object.amount_total ?? serverConfig().packPriceCents),
    currency: String(object.currency ?? "usd"),
    kind: "pack",
    status: "paid",
    creditsGranted: grant.granted ? credits : 0,
    demo: false,
    createdAt: nowIso(),
  });
  // Extra people on a paid plan keep that plan.
  if (grant.granted && (await repo.getAccount(userId))?.plan === "free") await repo.setAccountForTests(userId, { plan: "pack" });
  return { duplicate: false, granted: grant.granted ? credits : 0 };
}

async function grantFromInvoice(object: StripeObject, eventId: string) {
  const billingReason = String(object.billing_reason ?? "");
  if (billingReason && !["subscription_create", "subscription_cycle"].includes(billingReason)) {
    return { duplicate: false, granted: 0 };
  }
  const metadata = (object.metadata ?? {}) as StripeObject;
  const parent = (object.parent ?? object.subscription_details ?? {}) as StripeObject;
  const details = (parent.subscription_details ?? {}) as StripeObject;
  const nested = (parent.metadata ?? details.metadata ?? {}) as StripeObject;
  const userId = String(metadata.userId ?? nested.userId ?? object.client_reference_id ?? "");
  // Older Stripe API versions put the subscription on the invoice, newer ones under parent.subscription_details.
  const subscriptionId = idOf(object.subscription) || idOf(details.subscription);
  if (!userId) return { duplicate: false, granted: 0 };
  const planName = String(metadata.plan ?? nested.plan ?? "grind");
  const plan = planName === "pro" || planName === "premium" || planName === "grind" ? planName : "grind";
  const config = serverConfig();
  const fallback = plan === "premium" ? config.premiumMonthlyCredits : plan === "pro" ? config.proMonthlyCredits : config.grindMonthlyCredits;
  const credits = Number(metadata.credits ?? nested.credits ?? fallback) || fallback;
  if ((plan === "pro" || plan === "premium") && billingReason === "subscription_cycle") {
    await repo.replaceAllowance(userId, 0);
  }
  const grant = await repo.grantCreditsOnce({
    userId,
    entryType: "subscription_grant",
    amount: credits,
    bucket: "allowance",
    idempotencyKey: `invoice:${String(object.id)}`,
    referenceType: "stripe_invoice",
    referenceId: String(object.id),
    includedAllowance: credits,
    plan,
    note: plan === "grind" ? "Legacy monthly allowance" : "Monthly allowance",
  });
  await repo.insertPayment({
    id: id(),
    userId,
    stripeEventId: eventId,
    stripeCheckoutId: null,
    stripePaymentIntent: await invoicePaymentIntent(object),
    amountCents: Number(object.amount_paid ?? serverConfig().grindPriceCents),
    currency: String(object.currency ?? "usd"),
    kind: "subscription",
    status: "paid",
    creditsGranted: grant.granted ? credits : 0,
    demo: false,
    createdAt: nowIso(),
  });
  if (subscriptionId) {
    await repo.upsertSubscription({
      id: id(),
      userId,
      stripeSubscriptionId: subscriptionId,
      status: "active",
      priceCents: Number(object.amount_paid ?? config.grindPriceCents),
      currentPeriodEnd: null,
      createdAt: nowIso(),
      plan,
      kind: String(metadata.kind ?? nested.kind ?? "") || undefined,
      stripeCustomerId: idOf(object.customer) || undefined,
    });
    // Switching plans: the new one is paid for, so the old one stops billing.
    const replaces = String(metadata.replaces ?? nested.replaces ?? "");
    if (billingReason === "subscription_create" && replaces && replaces !== subscriptionId) {
      try {
        const stripe = await stripeClient();
        await stripe?.subscriptions.cancel(replaces);
      } catch (error) {
        console.error("stripe_replaced_subscription_not_canceled", replaces, error instanceof Error ? error.message : error);
      }
    }
  }
  return { duplicate: false, granted: grant.granted ? credits : 0 };
}

export async function confirmDemoPurchase(userId: string, kind: CheckoutKind) {
  if (process.env.STRIPE_SECRET_KEY) {
    throw new ServiceError("Stripe is configured. Use Checkout instead of demo billing.", "stripe_live", 409);
  }
  const config = serverConfig();
  const offer = checkoutOffer(kind, config);
  const grant = await repo.grantCreditsOnce({
    userId,
    entryType: "demo_grant",
    amount: offer.credits,
    bucket: offer.bucket,
    idempotencyKey: `demo:${userId}:${kind}`,
    demo: true,
    includedAllowance: offer.bucket === "allowance" ? offer.credits : undefined,
    plan: offer.plan,
    note: "Demo checkout. No card was charged.",
  });
  if (grant.granted) {
    await repo.insertPayment({
      id: id(),
      userId,
      stripeEventId: `demo:${userId}:${kind}`,
      stripeCheckoutId: null,
      stripePaymentIntent: null,
      amountCents: offer.amount,
      currency: "usd",
      kind: offer.bucket === "allowance" ? "subscription" : "pack",
      status: "demo",
      creditsGranted: offer.credits,
      demo: true,
      createdAt: nowIso(),
    });
    if (offer.bucket === "allowance") {
      await repo.upsertSubscription({
        id: id(),
        userId,
        stripeSubscriptionId: `demo_${userId}`,
        status: "demo",
        priceCents: offer.amount,
        currentPeriodEnd: null,
        createdAt: nowIso(),
      });
    }
  }
  return { granted: grant.granted, credits: grant.granted ? offer.credits : 0, demo: true };
}

type CheckoutKind = "grind" | "pack" | "pro" | "pro_semester" | "pro_year" | "premium" | "premium_semester" | "outreach" | "outreach_gift";

/** A semester plan bills every SEMESTER_MONTHS months and grants that many months of credits each time. */
function checkoutOffer(kind: CheckoutKind, config: ReturnType<typeof serverConfig>) {
  if (kind === "premium_semester") return { credits: config.premiumMonthlyCredits * SEMESTER_MONTHS, amount: config.premiumSemesterPriceCents, bucket: "allowance" as const, plan: "premium" as const, name: "Unnepo Premium (semester)", priceId: process.env.STRIPE_PRICE_PREMIUM_SEMESTER, recurring: true, months: SEMESTER_MONTHS };
  // Pro by the semester, the default: $99 every four months until cancelled. Priced here, not by a Stripe price id.
  if (kind === "pro_semester") return { credits: config.proMonthlyCredits * SEMESTER_MONTHS, amount: config.proSemesterPriceCents, bucket: "allowance" as const, plan: "pro" as const, name: "Unnepo Pro (semester, every 4 months)", priceId: undefined, recurring: true, months: SEMESTER_MONTHS };
  // Outreach Season: paid once, never renewed. Bought for yourself or, without an account, as a gift.
  if (kind === "outreach" || kind === "outreach_gift") return { credits: 0, amount: config.outreachPriceCents, bucket: "purchased" as const, plan: "outreach" as const, name: kind === "outreach_gift" ? "Unnepo Outreach Season (gift)" : "Unnepo Outreach Season", priceId: undefined, recurring: false };
  // Pro for a year (no longer sold; a checkout opened before could still finish).
  if (kind === "pro_year") return { credits: config.proYearCredits, amount: config.proYearPriceCents, bucket: "allowance" as const, plan: "pro" as const, name: "Unnepo Pro (yearly)", priceId: process.env.STRIPE_PRICE_PRO_YEAR, recurring: true, months: YEAR_MONTHS };
  if (kind === "premium") return { credits: config.premiumMonthlyCredits, amount: config.premiumPriceCents, bucket: "allowance" as const, plan: "premium" as const, name: "Unnepo Premium", priceId: process.env.STRIPE_PRICE_PREMIUM, recurring: true };
  if (kind === "pro") return { credits: config.proMonthlyCredits, amount: config.proPriceCents, bucket: "allowance" as const, plan: "pro" as const, name: "Unnepo Pro", priceId: process.env.STRIPE_PRICE_PRO, recurring: true };
  if (kind === "grind") return { credits: config.grindMonthlyCredits, amount: config.grindPriceCents, bucket: "allowance" as const, plan: "grind" as const, name: "Unnepo The Grind", priceId: process.env.STRIPE_PRICE_GRIND, recurring: true };
  return { credits: config.packCredits, amount: config.packPriceCents, bucket: "purchased" as const, plan: "pack" as const, name: `Unnepo: people at ${config.packCredits} more companies`, priceId: process.env.STRIPE_PRICE_PACK, recurring: false };
}

/**
 * What a student can buy today, from what the upgrade buttons send: Pro by the semester (the default) or by the
 * month, Outreach Season, or more companies. Pro by the year, Premium and the legacy Grind can't be bought any more;
 * students already on them keep them.
 */
export function checkoutKind(plan: unknown, billing: unknown): CheckoutKind {
  if (plan === "pack") return "pack";
  if (plan === "outreach") return "outreach";
  if (plan !== "pro") throw new ServiceError("Choose a plan.", "plan", 400);
  // Anything but "monthly" (older pages send "year") is the semester, the default.
  return billing === "monthly" ? "pro" : "pro_semester";
}

/** The price the plan cards show, in cents. Null for what they don't list. */
function advertisedCents(kind: CheckoutKind) {
  if (kind === "pro_semester") return PLAN_CENTS.pro_semester;
  if (kind === "pro") return PLAN_CENTS.pro;
  if (kind === "outreach" || kind === "outreach_gift") return PLAN_CENTS.outreach;
  return null;
}

/** The student's live Stripe subscription: the one on record, else one Stripe has under their account id. */
async function liveSubscription(stripe: NonNullable<Awaited<ReturnType<typeof stripeClient>>>, userId: string) {
  const stored = (await repo.listSubscriptions()).filter((item) => item.userId === userId && item.status !== "canceled" && item.status !== "demo").at(-1);
  if (stored) return { id: stored.stripeSubscriptionId, customer: stored.stripeCustomerId ?? null, kind: stored.kind ?? null, plan: stored.plan ?? null };
  try {
    const found = await stripe.subscriptions.search({ query: `metadata['userId']:'${userId.replace(/[^\w-]/g, "")}' AND status:'active'`, limit: 1 });
    const subscription = found.data[0];
    return subscription ? { id: subscription.id, customer: idOf(subscription.customer) || null, kind: subscription.metadata.kind ?? null, plan: subscription.metadata.plan ?? null } : null;
  } catch (error) {
    console.error("stripe_subscription_search_failed", error instanceof Error ? error.message : error);
    return null;
  }
}

export async function createStripeCheckout(user: { id: string; email: string }, kind: CheckoutKind, origin: string) {
  const userId = user.id;
  const config = serverConfig();
  const offer = checkoutOffer(kind, config);
  if (kind === "pack" && (await repo.getAccount(userId))?.plan === "free") throw new ServiceError("Extra companies are for Pro.", "plan", 409);
  const stripe = await stripeClient();
  if (!stripe) throw new ServiceError("Checkout isn't set up.", "stripe", 409);
  // Nobody pays a different price from the one on the page, whatever a price id or setting says.
  const advertised = advertisedCents(kind);
  const charged = offer.priceId ? (await stripe.prices.retrieve(offer.priceId)).unit_amount : offer.amount;
  if (charged !== offer.amount || (advertised !== null && charged !== advertised)) {
    console.error("stripe_price_mismatch", { kind, advertised, configured: offer.amount, charged });
    throw new ServiceError("This plan's price is being updated. Try again soon.", "stripe_price", 409);
  }
  const current = offer.recurring ? await liveSubscription(stripe, userId) : null;
  if (current && (current.kind === kind || (!current.kind && current.plan === offer.plan))) {
    throw new ServiceError("You're already on this plan. Use Manage subscription to change it.", "plan", 409);
  }
  const metadata = { userId, kind, plan: offer.plan, credits: String(offer.credits), ...(current ? { replaces: current.id } : {}) };
  const session = await stripe.checkout.sessions.create({
    mode: offer.recurring ? "subscription" : "payment",
    client_reference_id: userId,
    ...(current?.customer ? { customer: current.customer } : { customer_email: user.email }),
    success_url: `${origin}/home?billing=success`,
    cancel_url: `${origin}/home?billing=cancelled`,
    metadata,
    subscription_data: offer.recurring ? { metadata } : undefined,
    line_items: offer.priceId
      ? [{ price: offer.priceId, quantity: 1 }]
      : [
          {
            quantity: 1,
            price_data: {
              currency: "usd",
              unit_amount: offer.amount,
              recurring: offer.recurring ? { interval: "month", interval_count: "months" in offer ? offer.months : 1 } : undefined,
              product_data: { name: offer.name },
            },
          },
        ],
  });
  if (!session.url) throw new ServiceError("Stripe did not return a checkout URL.", "stripe", 502);
  return { demo: false as const, url: session.url };
}

/** Stripe's page for cancelling a subscription, changing the card, and seeing invoices. */
export async function createBillingPortal(userId: string, origin: string) {
  const stripe = await stripeClient();
  if (!stripe) throw new ServiceError("Billing isn't set up.", "stripe", 409);
  const current = await liveSubscription(stripe, userId);
  if (!current) throw new ServiceError("There's no subscription to manage on this account.", "no_subscription", 404);
  const customer = current.customer ?? idOf((await stripe.subscriptions.retrieve(current.id)).customer);
  try {
    const session = await stripe.billingPortal.sessions.create({ customer, return_url: `${origin}/home` });
    return { url: session.url };
  } catch (error) {
    console.error("stripe_portal_failed", error instanceof Error ? error.message : error);
    throw new ServiceError("Couldn't open subscription settings right now. Try again in a bit.", "stripe", 502);
  }
}

/** When a pass bought now ends: OUTREACH_SEASON_DAYS from today, or added on to a pass still running. */
export function passEndsAt(current: string | null | undefined, now = Date.now(), days = OUTREACH_SEASON_DAYS) {
  const from = Math.max(now, Date.parse(current ?? "") || 0);
  return new Date(from + days * 86_400_000).toISOString();
}

/** Outreach Season, bought by the student: the plan until its end date. A Pro subscription stops renewing (it's covered now). */
async function grantPass(object: StripeObject, metadata: StripeObject, eventId: string) {
  const userId = String(metadata.userId ?? object.client_reference_id ?? "");
  const checkoutId = String(object.id);
  if (!userId) return { duplicate: false, granted: 0 };
  // A webhook retry after the payment was recorded changes nothing.
  if ((await repo.listPayments(userId)).some((item) => item.stripeCheckoutId === checkoutId && item.kind === "pass")) return { duplicate: false, granted: 0 };
  const account = await repo.getAccount(userId);
  const endsAt = passEndsAt(account?.plan === "outreach" ? account.planEndsAt : null);
  await repo.setAccountForTests(userId, { plan: "outreach", planEndsAt: endsAt });
  await repo.insertPayment({
    id: id(), userId, stripeEventId: eventId, stripeCheckoutId: checkoutId,
    stripePaymentIntent: object.payment_intent ? String(object.payment_intent) : null,
    amountCents: Number(object.amount_total ?? serverConfig().outreachPriceCents), currency: String(object.currency ?? "usd"),
    kind: "pass", status: "paid", creditsGranted: 0, demo: false, createdAt: nowIso(),
  });
  await stopRenewing(userId);
  return { duplicate: false, granted: 0 };
}

/** A Pro subscription the pass now covers: it runs to the end of what's paid, then stops. */
async function stopRenewing(userId: string) {
  const stripe = await stripeClient();
  if (!stripe) return;
  const current = await liveSubscription(stripe, userId);
  if (!current) return;
  try {
    await stripe.subscriptions.update(current.id, { cancel_at_period_end: true });
  } catch (error) {
    console.error("stripe_pass_cancel_renewal_failed", current.id, error instanceof Error ? error.message : error);
  }
}

/** "UNN-7KQ2-M9XD": no 0/O or 1/I, so it can be read aloud or typed from a phone. */
function giftCode() {
  const letters = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const bytes = randomBytes(8);
  const chars = [...bytes].map((byte) => letters[byte % letters.length]).join("");
  return `UNN-${chars.slice(0, 4)}-${chars.slice(4)}`;
}

/** Outreach Season bought as a gift: a code, emailed to the buyer, that the student redeems on their account. */
async function grantGift(object: StripeObject, metadata: StripeObject, eventId: string) {
  const checkoutId = String(object.id);
  const details = (object.customer_details ?? {}) as StripeObject;
  const buyerEmail = String(details.email ?? object.customer_email ?? metadata.buyerEmail ?? "");
  const { gift, created } = await repo.createGift({
    code: giftCode(), plan: "outreach", days: OUTREACH_SEASON_DAYS, buyerEmail,
    recipientName: String(metadata.recipientName ?? "").slice(0, 80), message: String(metadata.message ?? "").slice(0, 300),
    stripeCheckoutId: checkoutId, amountCents: Number(object.amount_total ?? serverConfig().outreachPriceCents),
    createdAt: nowIso(), redeemedBy: null, redeemedAt: null,
  });
  if (!created) return { duplicate: false, granted: 0 };
  await repo.insertPayment({
    id: id(), userId: `gift:${gift.code}`, stripeEventId: eventId, stripeCheckoutId: checkoutId,
    stripePaymentIntent: object.payment_intent ? String(object.payment_intent) : null,
    amountCents: gift.amountCents, currency: String(object.currency ?? "usd"),
    kind: "pass", status: "paid", creditsGranted: 0, demo: false, createdAt: nowIso(),
  });
  if (buyerEmail) await sendGiftEmail({ to: buyerEmail, code: gift.code, recipientName: gift.recipientName, redeemUrl: giftRedeemUrl(gift.code), days: gift.days }).catch(() => false);
  return { duplicate: false, granted: 0 };
}

export const giftRedeemUrl = (code: string, origin?: string) => `${appOrigin(origin)}/gift/redeem?code=${encodeURIComponent(code)}`;

/** A pass refunded in full: a gift can't be used any more (or, if it was, the student's pass ends); a student's own pass ends now. */
async function refundPass(payment: { userId: string; stripeCheckoutId: string | null }) {
  let userId = payment.userId;
  if (userId.startsWith("gift:")) {
    const gift = payment.stripeCheckoutId ? await repo.markGiftRefunded(payment.stripeCheckoutId) : null;
    if (!gift?.redeemedBy) return;
    userId = gift.redeemedBy;
  }
  const account = await repo.getAccount(userId);
  if (account?.plan === "outreach") await repo.setAccountForTests(userId, { plan: "free", planEndsAt: null });
}

/** Checkout for a gift: no account needed. The buyer's email comes from Stripe's own form. */
export async function createGiftCheckout(input: { recipientName?: unknown; message?: unknown }, origin: string) {
  const stripe = await stripeClient();
  if (!stripe) throw new ServiceError("Checkout isn't set up.", "stripe", 409);
  const config = serverConfig();
  const offer = checkoutOffer("outreach_gift", config);
  if (offer.amount !== advertisedCents("outreach_gift")) {
    console.error("stripe_price_mismatch", { kind: "outreach_gift", configured: offer.amount });
    throw new ServiceError("This plan's price is being updated. Try again soon.", "stripe_price", 409);
  }
  const metadata = {
    kind: "outreach_gift",
    plan: "outreach",
    recipientName: String(input.recipientName ?? "").replace(/\s+/g, " ").trim().slice(0, 80),
    message: String(input.message ?? "").replace(/\s+/g, " ").trim().slice(0, 300),
  };
  const session = await stripe.checkout.sessions.create({
    mode: "payment",
    success_url: `${origin}/gift/thanks?session={CHECKOUT_SESSION_ID}`,
    cancel_url: `${origin}/gift`,
    metadata,
    payment_intent_data: { metadata },
    line_items: [{ quantity: 1, price_data: { currency: "usd", unit_amount: offer.amount, product_data: { name: offer.name, description: `${Math.round(OUTREACH_SEASON_DAYS / 30)} months of Unnepo Outreach Season for a student, starting when they use the code. Paid once, never renews.` } } }],
  });
  if (!session.url) throw new ServiceError("Stripe did not return a checkout URL.", "stripe", 502);
  return { url: session.url };
}

/** The thank-you page after a gift checkout: the code, once Stripe's webhook has made it (usually seconds). */
export async function giftForCheckout(sessionId: string) {
  const gift = await repo.giftByCheckout(sessionId);
  return gift ? { code: gift.code, recipientName: gift.recipientName, redeemUrl: giftRedeemUrl(gift.code), days: gift.days } : null;
}

/** A student uses a gift code: Outreach Season on their account, added on to any pass still running. */
export async function redeemGift(userId: string, code: unknown) {
  const text = String(code ?? "").trim();
  if (!/^UNN-[A-Z0-9]{4}-[A-Z0-9]{4}$/i.test(text)) throw new ServiceError("That doesn't look like a gift code. It's like UNN-7KQ2-M9XD.", "gift_code", 400);
  const result = await repo.redeemGift(text, userId, (current) => passEndsAt(current));
  if (result.status === "missing") throw new ServiceError("That gift code wasn't found. Check it, or ask whoever gave it to you.", "gift_code", 404);
  if (result.status === "used") throw new ServiceError("That gift code was already used on another account.", "gift_code", 409);
  if (result.status === "redeemed") await stopRenewing(userId);
  const account = await repo.getAccount(userId);
  return { plan: "outreach" as const, endsAt: account?.planEndsAt ?? null, message: result.gift?.message ?? "" };
}
