import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { POST } from "@/app/api/[...slug]/route";
import { repo } from "@/lib/db/file-store";
import { applyVerifiedStripeEvent, checkoutKind, createBillingPortal, createStripeCheckout } from "@/lib/services/billing";
import { login, signUp, verifyEmail } from "@/lib/services/auth";
import { useTempDb } from "./helpers";

const api = vi.hoisted(() => ({
  checkout: vi.fn(),
  portal: vi.fn(),
  cancel: vi.fn(),
  retrieve: vi.fn(),
  search: vi.fn(),
  price: vi.fn(),
  invoicePayments: vi.fn(),
  webhooks: null as null | { generateTestHeaderString: (input: { payload: string; secret: string }) => string },
}));

// Everything that would reach Stripe is faked, except signature checks, which run for real.
vi.mock("stripe", async (importOriginal) => {
  const Real = (await importOriginal<typeof import("stripe")>()).default;
  const signing = new Real("sk_test_signing").webhooks;
  api.webhooks = signing;
  return {
    default: class {
      checkout = { sessions: { create: api.checkout } };
      billingPortal = { sessions: { create: api.portal } };
      subscriptions = { cancel: api.cancel, retrieve: api.retrieve, search: api.search };
      prices = { retrieve: api.price };
      invoicePayments = { list: api.invoicePayments };
      webhooks = signing;
    },
  };
});

const ORIGIN = "https://unnepo.test";
let eventCount = 0;

async function student(email = "alex@colby.edu") {
  const signed = await signUp({ email, password: "password123", name: "Alex Chen" });
  await verifyEmail(signed.verifyToken!);
  const session = await login(email, "password123");
  return { id: session.user.id, email };
}

/** An invoice.paid event the way the current Stripe API sends it. */
function paidInvoice(userId: string, options: { invoice?: string; subscription?: string; reason?: string; plan?: string; kind?: string; credits?: string; amount?: number; replaces?: string } = {}) {
  const metadata = { userId, plan: options.plan ?? "pro", kind: options.kind ?? "pro", credits: options.credits ?? "25", ...(options.replaces ? { replaces: options.replaces } : {}) };
  return {
    id: `evt_${++eventCount}`,
    type: "invoice.paid",
    data: {
      object: {
        id: options.invoice ?? `in_${eventCount}`,
        billing_reason: options.reason ?? "subscription_create",
        customer: "cus_1",
        amount_paid: options.amount ?? 1500,
        currency: "usd",
        parent: { type: "subscription_details", subscription_details: { subscription: options.subscription ?? "sub_1", metadata } },
      },
    },
  };
}

const ended = (userId: string, subscription = "sub_1") => ({ id: `evt_${++eventCount}`, type: "customer.subscription.deleted", data: { object: { id: subscription, metadata: { userId } } } });

beforeEach(() => {
  useTempDb();
  vi.clearAllMocks();
  process.env.STRIPE_SECRET_KEY = "sk_test_fake";
  api.checkout.mockResolvedValue({ url: "https://checkout.stripe.test/session" });
  api.portal.mockResolvedValue({ url: "https://billing.stripe.test/portal" });
  api.search.mockResolvedValue({ data: [] });
  api.invoicePayments.mockResolvedValue({ data: [{ payment: { payment_intent: "pi_invoice" } }] });
});

afterEach(() => {
  for (const key of ["STRIPE_SECRET_KEY", "STRIPE_WEBHOOK_SECRET", "PRO_PRICE_CENTS", "STRIPE_PRICE_PRO"]) delete process.env[key];
  vi.restoreAllMocks();
});

describe("checkout", () => {
  it("only sells what's on the plan cards", () => {
    expect(checkoutKind("pro", "monthly")).toBe("pro");
    expect(checkoutKind("pro", undefined)).toBe("pro");
    expect(checkoutKind("premium", "semester")).toBe("premium_semester");
    expect(checkoutKind("pack", undefined)).toBe("pack");
    for (const plan of ["grind", "free", "", undefined, { plan: "pro" }]) expect(() => checkoutKind(plan, "monthly")).toThrow("Choose Pro or Premium.");
  });

  it("charges Pro at the monthly price and returns to the app it came from", async () => {
    const user = await student();
    expect(await createStripeCheckout(user, "pro", ORIGIN)).toEqual({ demo: false, url: "https://checkout.stripe.test/session" });
    const session = api.checkout.mock.calls[0][0];
    expect(session.mode).toBe("subscription");
    expect(session.customer_email).toBe(user.email);
    expect(session.success_url).toBe(`${ORIGIN}/home?billing=success`);
    expect(session.cancel_url).toBe(`${ORIGIN}/home?billing=cancelled`);
    expect(session.line_items[0].price_data).toMatchObject({ unit_amount: 1500, recurring: { interval: "month", interval_count: 1 } });
    expect(session.subscription_data.metadata).toMatchObject({ userId: user.id, kind: "pro", plan: "pro", credits: "25" });
  });

  it("bills a semester every four months with four months of credits", async () => {
    const user = await student();
    await createStripeCheckout(user, "pro_semester", ORIGIN);
    await createStripeCheckout(user, "premium_semester", ORIGIN);
    const [pro, premium] = api.checkout.mock.calls.map((call) => call[0]);
    expect(pro.line_items[0].price_data).toMatchObject({ unit_amount: 4500, recurring: { interval: "month", interval_count: 4 } });
    expect(pro.metadata.credits).toBe("100");
    expect(premium.line_items[0].price_data).toMatchObject({ unit_amount: 11700, recurring: { interval: "month", interval_count: 4 } });
    expect(premium.metadata.credits).toBe("300");
  });

  it("won't charge a price that differs from the page", async () => {
    const user = await student();
    process.env.PRO_PRICE_CENTS = "2400";
    await expect(createStripeCheckout(user, "pro", ORIGIN)).rejects.toThrow("price is being updated");
    delete process.env.PRO_PRICE_CENTS;
    process.env.STRIPE_PRICE_PRO = "price_old";
    api.price.mockResolvedValueOnce({ unit_amount: 2400 });
    await expect(createStripeCheckout(user, "pro", ORIGIN)).rejects.toThrow("price is being updated");
    expect(api.checkout).not.toHaveBeenCalled();
    api.price.mockResolvedValueOnce({ unit_amount: 1500 });
    await createStripeCheckout(user, "pro", ORIGIN);
    expect(api.checkout.mock.calls[0][0].line_items).toEqual([{ price: "price_old", quantity: 1 }]);
  });

  it("refuses the plan they already have, and a switch names the subscription it replaces", async () => {
    const user = await student();
    await applyVerifiedStripeEvent(paidInvoice(user.id));
    await expect(createStripeCheckout(user, "pro", ORIGIN)).rejects.toThrow("already on this plan");
    await createStripeCheckout(user, "premium", ORIGIN);
    const session = api.checkout.mock.calls[0][0];
    expect(session.customer).toBe("cus_1");
    expect(session.customer_email).toBeUndefined();
    expect(session.subscription_data.metadata.replaces).toBe("sub_1");
  });

  it("finds a subscription that was never recorded, so nobody is billed twice", async () => {
    const user = await student();
    api.search.mockResolvedValue({ data: [{ id: "sub_old", customer: "cus_old", metadata: { plan: "grind", kind: "grind" } }] });
    await createStripeCheckout(user, "pro", ORIGIN);
    expect(api.search.mock.calls[0][0].query).toContain(user.id);
    expect(api.checkout.mock.calls[0][0].subscription_data.metadata.replaces).toBe("sub_old");
  });

  it("keeps extra companies for paid plans, without touching the subscription", async () => {
    const user = await student();
    await expect(createStripeCheckout(user, "pack", ORIGIN)).rejects.toThrow("Extra people are for Pro and Premium");
    await applyVerifiedStripeEvent(paidInvoice(user.id));
    await createStripeCheckout(user, "pack", ORIGIN);
    const session = api.checkout.mock.calls[0][0];
    expect(session.mode).toBe("payment");
    expect(session.metadata.replaces).toBeUndefined();
  });
});

describe("subscription webhooks", () => {
  it("reads the current invoice shape: credits, the subscription record and its payment", async () => {
    const user = await student();
    const result = await applyVerifiedStripeEvent(paidInvoice(user.id));
    expect(result.granted).toBe(25);
    const account = await repo.getAccount(user.id);
    expect(account?.plan).toBe("pro");
    expect(account?.allowanceBalance).toBe(28); // On top of the 3 signup credits.
    expect(await repo.listSubscriptions()).toMatchObject([{ userId: user.id, stripeSubscriptionId: "sub_1", status: "active", plan: "pro", kind: "pro", stripeCustomerId: "cus_1" }]);
    expect((await repo.listPayments(user.id))[0].stripePaymentIntent).toBe("pi_invoice");
  });

  it("still reads the older invoice shape", async () => {
    const user = await student();
    await applyVerifiedStripeEvent({
      id: "evt_old",
      type: "invoice.paid",
      data: { object: { id: "in_old", billing_reason: "subscription_create", subscription: "sub_old", payment_intent: "pi_old", customer: "cus_old", amount_paid: 1500, subscription_details: { metadata: { userId: user.id, plan: "pro", credits: "25" } } } },
    });
    expect(await repo.listSubscriptions()).toMatchObject([{ stripeSubscriptionId: "sub_old", stripeCustomerId: "cus_old" }]);
    expect((await repo.listPayments(user.id))[0].stripePaymentIntent).toBe("pi_old");
    expect(api.invoicePayments).not.toHaveBeenCalled();
  });

  it("resets the allowance on renewal instead of stacking it", async () => {
    const user = await student();
    await applyVerifiedStripeEvent(paidInvoice(user.id));
    await applyVerifiedStripeEvent(paidInvoice(user.id, { reason: "subscription_cycle" }));
    expect((await repo.getAccount(user.id))?.allowanceBalance).toBe(25);
  });

  it("moves a cancelled subscriber to Free, keeping only the credits they bought", async () => {
    const user = await student();
    await applyVerifiedStripeEvent(paidInvoice(user.id));
    await applyVerifiedStripeEvent(ended(user.id));
    const account = await repo.getAccount(user.id);
    expect(account?.plan).toBe("free");
    expect(account?.allowanceBalance).toBe(0);
    expect((await repo.listSubscriptions())[0]).toMatchObject({ status: "canceled", priceCents: 1500, stripeCustomerId: "cus_1" });
  });

  it("finds who cancelled from the record when Stripe's event doesn't say", async () => {
    const user = await student();
    await applyVerifiedStripeEvent(paidInvoice(user.id));
    await applyVerifiedStripeEvent({ id: "evt_no_metadata", type: "customer.subscription.deleted", data: { object: { id: "sub_1" } } });
    expect((await repo.getAccount(user.id))?.plan).toBe("free");
  });

  it("keeps bought credits after cancelling", async () => {
    const user = await student();
    await applyVerifiedStripeEvent(paidInvoice(user.id));
    await applyVerifiedStripeEvent({ id: "evt_pack", type: "checkout.session.completed", data: { object: { id: "cs_1", mode: "payment", payment_status: "paid", amount_total: 1000, metadata: { userId: user.id, credits: "20" } } } });
    await applyVerifiedStripeEvent(ended(user.id));
    const account = await repo.getAccount(user.id);
    expect(account?.plan).toBe("pack");
    expect(account?.purchasedBalance).toBe(20);
    expect(account?.allowanceBalance).toBe(0);
  });

  it("cancels the old subscription after a switch and keeps the new plan", async () => {
    const user = await student();
    await applyVerifiedStripeEvent(paidInvoice(user.id));
    await applyVerifiedStripeEvent(paidInvoice(user.id, { subscription: "sub_2", plan: "premium", kind: "premium", credits: "75", amount: 3900, replaces: "sub_1" }));
    expect(api.cancel).toHaveBeenCalledWith("sub_1");
    await applyVerifiedStripeEvent(ended(user.id, "sub_1"));
    expect((await repo.getAccount(user.id))?.plan).toBe("premium");
  });

  it("doesn't cancel anything again when a switched plan renews", async () => {
    const user = await student();
    await applyVerifiedStripeEvent(paidInvoice(user.id, { subscription: "sub_2", reason: "subscription_cycle", replaces: "sub_1" }));
    expect(api.cancel).not.toHaveBeenCalled();
  });

  it("marks a failed renewal past due, then active again", async () => {
    const user = await student();
    await applyVerifiedStripeEvent(paidInvoice(user.id));
    await applyVerifiedStripeEvent({ id: "evt_due", type: "customer.subscription.updated", data: { object: { id: "sub_1", status: "past_due" } } });
    expect((await repo.listSubscriptions())[0].status).toBe("past_due");
    await applyVerifiedStripeEvent({ id: "evt_ok", type: "customer.subscription.updated", data: { object: { id: "sub_1", status: "active" } } });
    expect((await repo.listSubscriptions())[0].status).toBe("active");
  });

  it("takes back a subscription's credits on a full refund, not a partial one", async () => {
    const user = await student();
    await applyVerifiedStripeEvent(paidInvoice(user.id));
    await applyVerifiedStripeEvent({ id: "evt_partial", type: "charge.refunded", data: { object: { id: "ch_1", payment_intent: "pi_invoice", refunded: false } } });
    expect((await repo.getAccount(user.id))?.allowanceBalance).toBe(28);
    await applyVerifiedStripeEvent({ id: "evt_full", type: "charge.refunded", data: { object: { id: "ch_1", payment_intent: "pi_invoice", refunded: true } } });
    const account = await repo.getAccount(user.id);
    expect(account?.allowanceBalance).toBe(3); // The 3 signup credits weren't paid for.
    expect(account?.purchasedBalance).toBe(0);
    expect((await repo.listPayments(user.id)).map((payment) => payment.status)).toEqual(["paid", "refunded"]);
  });

  it("grants credits on Stripe's retry after a delivery fails partway", async () => {
    const user = await student();
    const event = paidInvoice(user.id);
    vi.spyOn(repo, "grantCreditsOnce").mockRejectedValueOnce(new Error("database hiccup"));
    await expect(applyVerifiedStripeEvent(event)).rejects.toThrow("database hiccup");
    const retry = await applyVerifiedStripeEvent(event);
    expect(retry).toEqual({ duplicate: false, granted: 25 });
    expect(await applyVerifiedStripeEvent(event)).toEqual({ duplicate: true, granted: 0 });
  });
});

describe("the webhook endpoint", () => {
  const SECRET = "whsec_test";
  const deliver = (payload: string, signature: string) =>
    POST(new Request(`${ORIGIN}/api/billing/webhook`, { method: "POST", body: payload, headers: { "stripe-signature": signature } }), { params: Promise.resolve({ slug: ["billing", "webhook"] }) });

  it("applies a correctly signed event", async () => {
    process.env.STRIPE_WEBHOOK_SECRET = SECRET;
    const user = await student();
    const payload = JSON.stringify({ object: "event", ...paidInvoice(user.id) });
    const response = await deliver(payload, api.webhooks!.generateTestHeaderString({ payload, secret: SECRET }));
    expect(response.status).toBe(200);
    expect((await response.json()).granted).toBe(25);
    expect((await repo.getAccount(user.id))?.plan).toBe("pro");
  });

  it("refuses a forged event with a 400 and grants nothing", async () => {
    process.env.STRIPE_WEBHOOK_SECRET = SECRET;
    const user = await student();
    const payload = JSON.stringify({ object: "event", ...paidInvoice(user.id) });
    const response = await deliver(payload, api.webhooks!.generateTestHeaderString({ payload, secret: "whsec_someone_else" }));
    expect(response.status).toBe(400);
    expect((await repo.getAccount(user.id))?.plan).toBe("free");
  });
});

describe("managing a subscription", () => {
  it("opens Stripe's portal for the customer on record", async () => {
    const user = await student();
    await applyVerifiedStripeEvent(paidInvoice(user.id));
    expect(await createBillingPortal(user.id, ORIGIN)).toEqual({ url: "https://billing.stripe.test/portal" });
    expect(api.portal).toHaveBeenCalledWith({ customer: "cus_1", return_url: `${ORIGIN}/home` });
  });

  it("asks Stripe for the customer on an older record", async () => {
    const user = await student();
    await repo.upsertSubscription({ id: "row", userId: user.id, stripeSubscriptionId: "sub_legacy", status: "active", priceCents: 2900, currentPeriodEnd: null, createdAt: new Date().toISOString() });
    api.retrieve.mockResolvedValue({ customer: "cus_legacy" });
    await createBillingPortal(user.id, ORIGIN);
    expect(api.portal.mock.calls[0][0].customer).toBe("cus_legacy");
  });

  it("says so when there's nothing to manage, including after cancelling", async () => {
    const user = await student();
    await expect(createBillingPortal(user.id, ORIGIN)).rejects.toThrow("no subscription to manage");
    await applyVerifiedStripeEvent(paidInvoice(user.id));
    await applyVerifiedStripeEvent(ended(user.id));
    await expect(createBillingPortal(user.id, ORIGIN)).rejects.toThrow("no subscription to manage");
  });

  it("explains a portal that isn't set up instead of failing silently", async () => {
    const user = await student();
    await applyVerifiedStripeEvent(paidInvoice(user.id));
    api.portal.mockRejectedValue(new Error("No configuration provided"));
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    await expect(createBillingPortal(user.id, ORIGIN)).rejects.toThrow("Couldn't open subscription settings");
  });
});
