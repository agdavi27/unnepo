import { serverConfig } from "@/lib/config";
import { id, nowIso, repo } from "@/lib/db/file-store";
import { ServiceError } from "@/lib/errors";

type StripeObject = Record<string, unknown>;

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
      const userId = String((event.data.object.metadata as StripeObject | undefined)?.userId ?? "");
      if (subscriptionId) {
        await repo.upsertSubscription({
          id: id(),
          userId,
          stripeSubscriptionId: subscriptionId,
          status: "canceled",
          priceCents: serverConfig().grindPriceCents,
          currentPeriodEnd: null,
          createdAt: nowIso(),
        });
        if (userId) {
          const account = await repo.getAccount(userId);
          if (account?.plan === "grind") await repo.setAccountForTests(userId, { plan: "free", includedAllowance: serverConfig().signupCredits });
        }
      }
      return { duplicate: false, granted: 0 };
    }
    if (event.type === "charge.refunded") {
      const paymentIntent = String(event.data.object.payment_intent ?? "");
      const payments = await repo.listPayments();
      const payment = payments.find((item) => item.stripePaymentIntent === paymentIntent || item.stripeCheckoutId === String(event.data.object.id ?? ""));
      if (payment && !payment.demo) {
        await repo.clawbackPurchased({
          userId: payment.userId,
          amount: payment.creditsGranted,
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
    await repo.releaseIdempotency(`webhook-hold:${event.id}`);
    throw error;
  }
}

async function grantFromCheckout(object: StripeObject, eventId: string) {
  if (object.mode !== "payment" || object.payment_status !== "paid") return { duplicate: false, granted: 0 };
  const metadata = (object.metadata ?? {}) as StripeObject;
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
  if (grant.granted) await repo.setAccountForTests(userId, { plan: "pack" });
  return { duplicate: false, granted: grant.granted ? credits : 0 };
}

async function grantFromInvoice(object: StripeObject, eventId: string) {
  const billingReason = String(object.billing_reason ?? "");
  if (billingReason && !["subscription_create", "subscription_cycle"].includes(billingReason)) {
    return { duplicate: false, granted: 0 };
  }
  const metadata = (object.metadata ?? {}) as StripeObject;
  const parent = (object.parent ?? object.subscription_details ?? {}) as StripeObject;
  const nested = (parent.metadata ?? (parent.subscription_details as StripeObject | undefined)?.metadata ?? {}) as StripeObject;
  const userId = String(metadata.userId ?? nested.userId ?? object.client_reference_id ?? "");
  const subscriptionId = String(object.subscription ?? "");
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
    stripePaymentIntent: object.payment_intent ? String(object.payment_intent) : null,
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
    });
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

type CheckoutKind = "grind" | "pack" | "pro" | "premium";

function checkoutOffer(kind: CheckoutKind, config: ReturnType<typeof serverConfig>) {
  if (kind === "premium") return { credits: config.premiumMonthlyCredits, amount: config.premiumPriceCents, bucket: "allowance" as const, plan: "premium" as const, name: "Unnepo Premium", priceId: process.env.STRIPE_PRICE_PREMIUM, recurring: true };
  if (kind === "pro") return { credits: config.proMonthlyCredits, amount: config.proPriceCents, bucket: "allowance" as const, plan: "pro" as const, name: "Unnepo Pro", priceId: process.env.STRIPE_PRICE_PRO, recurring: true };
  if (kind === "grind") return { credits: config.grindMonthlyCredits, amount: config.grindPriceCents, bucket: "allowance" as const, plan: "grind" as const, name: "Unnepo The Grind", priceId: process.env.STRIPE_PRICE_GRIND, recurring: true };
  return { credits: config.packCredits, amount: config.packPriceCents, bucket: "purchased" as const, plan: "pack" as const, name: `Unnepo ${config.packCredits} credits`, priceId: process.env.STRIPE_PRICE_PACK, recurring: false };
}

export async function createStripeCheckout(userId: string, kind: CheckoutKind) {
  const secret = process.env.STRIPE_SECRET_KEY;
  const config = serverConfig();
  const offer = checkoutOffer(kind, config);
  if (!secret) throw new ServiceError("Checkout isn't set up.", "stripe", 409);
  const Stripe = (await import("stripe")).default;
  const stripe = new Stripe(secret);
  const session = await stripe.checkout.sessions.create({
    mode: offer.recurring ? "subscription" : "payment",
    client_reference_id: userId,
    success_url: `${config.appUrl}/settings?billing=success`,
    cancel_url: `${config.appUrl}/settings?billing=cancelled`,
    metadata: { userId, kind, plan: offer.plan, credits: String(offer.credits) },
    subscription_data: offer.recurring ? { metadata: { userId, kind, plan: offer.plan, credits: String(offer.credits) } } : undefined,
    line_items: offer.priceId
      ? [{ price: offer.priceId, quantity: 1 }]
      : [
          {
            quantity: 1,
            price_data: {
              currency: "usd",
              unit_amount: offer.amount,
              recurring: offer.recurring ? { interval: "month" } : undefined,
              product_data: { name: offer.name },
            },
          },
        ],
  });
  if (!session.url) throw new ServiceError("Stripe did not return a checkout URL.", "stripe", 502);
  return { demo: false as const, url: session.url };
}
