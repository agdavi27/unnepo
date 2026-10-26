import { createReadStream, existsSync } from "node:fs";
import { Readable } from "node:stream";
import { assertSameOrigin, clearSessionCookie, errorResponse, json, publicOrigin, rateLimit, readSession, requireUser, setSessionCookie } from "@/lib/http";
import { isAdminEmail, login, logout, publicUser, requestPasswordReset, resendVerification, resetPassword, signUp, verifyEmail } from "@/lib/services/auth";
import { persistenceMode, repo } from "@/lib/db/file-store";
import { runSearch, unlockContact } from "@/lib/services/contacts";
import { composerContext, generateEmail } from "@/lib/services/composer";
import { outreachSummary, saveDraft, sendOutreach, syncReplies } from "@/lib/services/outreach";
import { storeResume } from "@/lib/services/resume";
import { listJobPostings } from "@/lib/services/jobs";
import { confirmDemoPurchase, createStripeCheckout, applyVerifiedStripeEvent } from "@/lib/services/billing";
import { applyReferralCode } from "@/lib/services/referrals";
import { profitability } from "@/lib/services/admin";
import { dashboard } from "@/lib/services/dashboard";
import { beginOAuth, finishOAuth, oauthReady } from "@/lib/services/oauth";
import { ServiceError } from "@/lib/errors";
import { nowIso } from "@/lib/db/file-store";
import type { OutreachStatus } from "@/lib/db/types";
import { serverConfig } from "@/lib/config";
import { usingDefaultSecret } from "@/lib/security";

async function handle(request: Request, slug: string[]) {
  const [root, action] = slug;
  if (request.method !== "GET") assertSameOrigin(request);

  if (root === "health" && request.method === "GET") {
    const ready = oauthReady();
    return json({
      ok: true,
      database: persistenceMode(),
      persistence: persistenceMode(),
      providers: {
        apollo: Boolean(process.env.APOLLO_API_KEY),
        anthropic: Boolean(process.env.ANTHROPIC_API_KEY),
        stripe: Boolean(process.env.STRIPE_SECRET_KEY),
        gmail: ready.google,
        microsoft: ready.microsoft,
        inngest: Boolean(process.env.INNGEST_EVENT_KEY),
        resend: Boolean(process.env.RESEND_API_KEY),
        posthog: Boolean(process.env.POSTHOG_KEY),
        sentry: Boolean(process.env.SENTRY_DSN),
      },
      sampleDirectory: serverConfig().sampleDirectory,
      defaultSecret: usingDefaultSecret(),
    });
  }

  if (root === "auth" && action === "signup" && request.method === "POST") {
    if (!rateLimit(`signup:${request.headers.get("x-forwarded-for") || "local"}`, 10, 60 * 60 * 1000)) {
      throw new ServiceError("Too many signup attempts. Try again later.", "rate", 429);
    }
    const contentType = request.headers.get("content-type") || "";
    const formPost = contentType.includes("application/x-www-form-urlencoded") || contentType.includes("multipart/form-data");
    const raw = formPost ? Object.fromEntries(await request.formData()) : await request.json();
    const body = {
      name: String(raw.name || ""),
      email: String(raw.email || ""),
      password: String(raw.password || ""),
      referralCode: raw.referralCode ? String(raw.referralCode) : undefined,
    };
    try {
      const result = await signUp(body);
      if (!formPost) return json(result);
      if (result.verifyToken) {
        await verifyEmail(result.verifyToken);
        const loggedIn = await login(body.email, body.password);
        await setSessionCookie(loggedIn.token);
        return Response.redirect(new URL("/onboarding", publicOrigin(request)), 303);
      }
      return Response.redirect(new URL("/login?check=1", publicOrigin(request)), 303);
    } catch (error) {
      if (!formPost) throw error;
      const back = new URL("/signup", publicOrigin(request));
      back.searchParams.set("error", error instanceof ServiceError ? error.message : "Could not create the account.");
      if (body.email) back.searchParams.set("email", body.email);
      return Response.redirect(back, 303);
    }
  }
  if (root === "auth" && action === "login" && request.method === "POST") {
    const body = await request.json();
    const result = await login(body.email, body.password);
    await setSessionCookie(result.token);
    return json({ user: result.user });
  }
  if (root === "auth" && action === "logout" && request.method === "POST") {
    const cookie = request.headers.get("cookie") ?? "";
    const match = cookie.match(/(?:^|;\s*)unnepo_session=([^;]+)/);
    await logout(match?.[1] ? decodeURIComponent(match[1]) : null);
    await clearSessionCookie();
    return json({ ok: true });
  }
  if (root === "auth" && action === "verify" && request.method === "POST") {
    const body = await request.json();
    const user = await verifyEmail(body.token);
    return json({ user });
  }
  if (root === "auth" && action === "resend" && request.method === "POST") {
    const body = await request.json();
    return json(await resendVerification(body.email || ""));
  }
  if (root === "auth" && action === "forgot" && request.method === "POST") {
    const body = await request.json();
    return json(await requestPasswordReset(body.email, publicOrigin(request)));
  }
  if (root === "auth" && action === "reset" && request.method === "POST") {
    const body = await request.json();
    await resetPassword(body.token, body.password);
    return json({ ok: true });
  }

  if (root === "oauth" && request.method === "GET" && action && slug[2] !== "callback") {
    const session = await readSession();
    if ((action === "gmail" || action === "outlook") && !session?.user) {
      return Response.redirect(new URL("/login?next=/settings", request.url));
    }
    const url = await beginOAuth(action as "google" | "microsoft" | "gmail" | "outlook", session?.user.id ?? null, publicOrigin(request));
    return Response.redirect(url);
  }
  if (root === "oauth" && slug[2] === "callback" && request.method === "GET") {
    const url = new URL(request.url);
    const providerError = url.searchParams.get("error_description") || url.searchParams.get("error");
    if (providerError) return Response.redirect(oauthReturnUrl(request, "Sign-in was canceled. Try Google or Microsoft again."));
    const result = await finishOAuth(action as "gmail" | "google" | "microsoft" | "outlook", url.searchParams.get("code") || "", url.searchParams.get("state") || "", publicOrigin(request));
    if ("token" in result && result.token) {
      await setSessionCookie(result.token);
      const step = result.user.onboardingStep;
      const dest = step === "profile" || step === "goals" || step === "resume" ? "/onboarding" : "/home";
      return Response.redirect(new URL(dest, request.url));
    }
    return Response.redirect(new URL("/settings?tab=integrations", request.url));
  }

  if (root === "billing" && action === "webhook" && request.method === "POST") {
    const secret = process.env.STRIPE_WEBHOOK_SECRET;
    const signature = request.headers.get("stripe-signature");
    if (!secret || !signature || !process.env.STRIPE_SECRET_KEY) throw new ServiceError("Stripe webhook is not configured.", "stripe", 400);
    const Stripe = (await import("stripe")).default;
    const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
    const event = stripe.webhooks.constructEvent(await request.text(), signature, secret);
    const result = await applyVerifiedStripeEvent({ id: event.id, type: event.type, data: { object: event.data.object as unknown as Record<string, unknown> } });
    return json(result);
  }

  const user = await requireUser();

  if (root === "me" && request.method === "GET") {
    const [profile, credits, mailboxes, resume, followups] = await Promise.all([
      repo.getProfile(user.id),
      repo.getAccount(user.id),
      repo.listMailboxes(user.id),
      repo.getLatestResume(user.id),
      repo.listFollowUps(user.id),
    ]);
    return json({
      user: publicUser(user),
      profile,
      credits,
      mailboxes,
      resume: resume ? { id: resume.id, fileName: resume.fileName, byteSize: resume.byteSize, createdAt: resume.createdAt } : null,
      followups: followups.filter((item) => item.status === "open").length,
      admin: await isAdminEmail(user),
    });
  }

  if (root === "dashboard" && request.method === "GET") return json(await dashboard(user.id));

  if (root === "profile" && request.method === "PUT") {
    const body = await request.json();
    const profile = await repo.upsertProfile({
      userId: user.id,
      name: body.name || user.name,
      school: body.school || "",
      major: body.major || "",
      graduationYear: body.graduationYear || "",
      bio: (body.bio || "").slice(0, 300),
      avatarPath: null,
      updatedAt: nowIso(),
    });
    if (body.name) await repo.updateUser(user.id, { name: body.name, onboardingStep: body.onboardingStep || user.onboardingStep });
    return json({ profile });
  }

  if (root === "goals" && request.method === "PUT") {
    const body = await request.json();
    const current = await repo.getGoals(user.id);
    const goals = await repo.upsertGoals({
      userId: user.id,
      roles: body.roles ?? current?.roles ?? [],
      industries: body.industries ?? current?.industries ?? [],
      locations: body.locations ?? current?.locations ?? [],
      companies: body.companies ?? current?.companies ?? [],
      tracks: body.tracks ?? current?.tracks ?? [],
      timing: body.timing ?? current?.timing ?? "",
      updatedAt: nowIso(),
    });
    if (body.onboardingStep) await repo.updateUser(user.id, { onboardingStep: body.onboardingStep });
    return json({ goals });
  }

  if (root === "resume" && request.method === "POST") {
    const form = await request.formData();
    const file = form.get("file");
    if (!(file instanceof File)) throw new ServiceError("Choose a resume file.", "file");
    const bytes = new Uint8Array(await file.arrayBuffer());
    const result = await storeResume(user.id, file.name, file.type || "application/octet-stream", bytes);
    await repo.updateUser(user.id, { onboardingStep: "mailbox" });
    return json({ resume: { id: result.resume.id, fileName: result.resume.fileName, byteSize: result.resume.byteSize }, facts: result.facts, cached: result.cached });
  }

  if (root === "facts" && request.method === "GET") return json({ facts: await repo.getFacts(user.id) });
  if (root === "facts" && request.method === "PATCH") {
    const body = await request.json();
    const fact = await repo.updateFact(user.id, body.id, { detail: body.detail, label: body.label });
    if (!fact) throw new ServiceError("Fact not found.", "not_found", 404);
    return json({ fact });
  }

  if (root === "contacts" && action === "search" && request.method === "POST") {
    if (!rateLimit(`search:${user.id}`, 30, 60 * 1000)) throw new ServiceError("Search a little slower — limit is 30 a minute.", "rate", 429);
    const body = await request.json();
    const page = Number(body.page) || 1;
    const pageSize = Math.min(20, Math.max(1, Number(body.pageSize) || 20));
    if (page === 1) {
      const account = await repo.getAccount(user.id);
      if (!account || account.balance < 1) {
        return json({ error: "You need 1 credit to see these people.", code: "insufficient_credits" }, 402);
      }
    }
    const result = await runSearch(user.id, {
      titles: body.titles ?? [],
      industries: body.industries ?? [],
      locations: body.locations ?? [],
      schools: body.schools ?? [],
      includeSimilarSchools: body.includeSimilarSchools !== false,
      companies: body.companies ?? [],
      seniorities: body.seniorities ?? [],
      departments: body.departments ?? [],
      companySizes: body.companySizes ?? [],
      query: body.query,
    }, page, pageSize);
    if (page !== 1 || result.people.length === 0) {
      const account = await repo.getAccount(user.id);
      return json({ ...result, charged: 0, balance: account?.balance ?? 0 });
    }
    const spent = await repo.spendCredits({
      userId: user.id,
      amount: 1,
      idempotencyKey: typeof body.idempotencyKey === "string" && body.idempotencyKey ? body.idempotencyKey : `search:${user.id}:${Date.now()}`,
      note: "Show up to 20 people",
      entryType: "search_debit",
    });
    if (spent.insufficient) return json({ error: "You need 1 credit to see these people.", code: "insufficient_credits" }, 402);
    return json({ ...result, charged: spent.duplicate ? 0 : spent.charged, balance: spent.balance });
  }

  if (root === "contacts" && action === "unlock" && request.method === "POST") {
    const body = await request.json();
    const result = await unlockContact(user.id, body.contactId, body.idempotencyKey || `unlock:${user.id}:${body.contactId}`);
    return json(result, result.ok ? 200 : result.code === "insufficient_credits" ? 402 : 422);
  }

  if (root === "saved" && action === "export" && request.method === "GET") {
    const rows = await repo.listSavedDetailed(user.id);
    const header = "name,title,company,location,school,email,phone,status,notes,list,unlocked_at";
    const lines = rows.map(({ saved, contact }) => [contact?.fullName, contact?.title, contact?.company, contact?.location, contact?.school, contact?.email, contact?.phone, saved.status, saved.notes, saved.listName, saved.unlockedAt].map((value) => `"${String(value ?? "").replaceAll('"', '""')}"`).join(","));
    return new Response([header, ...lines].join("\n"), { headers: { "Content-Type": "text/csv", "Content-Disposition": "attachment; filename=unnepo-contacts.csv" } });
  }
  if (root === "saved" && request.method === "GET") return json({ rows: await repo.listSavedDetailed(user.id) });
  if (root === "saved" && request.method === "PATCH") {
    const body = await request.json();
    const saved = await repo.updateSaved(user.id, body.id, {
      status: body.status as OutreachStatus | undefined,
      notes: body.notes,
      listName: body.listName,
      followUpAt: body.followUpAt,
    });
    if (!saved) throw new ServiceError("Saved contact not found.", "not_found", 404);
    if (body.followUpAt) {
      await repo.insertFollowUp({ id: crypto.randomUUID(), userId: user.id, savedContactId: saved.id, dueAt: body.followUpAt, note: body.notes || "Follow up", status: "open", autoSend: false, createdAt: nowIso() });
    }
    return json({ saved });
  }

  if (root === "email" && action === "context" && request.method === "POST") {
    const body = await request.json();
    const context = await composerContext(user.id, body.contactId);
    return json({
      saved: context.saved,
      email: context.email,
      you: context.you,
      lead: context.lead,
      contact: { id: context.contact.id, fullName: context.contact.fullName, title: context.contact.title, company: context.contact.company, savedId: context.saved.id },
    });
  }
  if (root === "email" && action === "generate" && request.method === "POST") {
    const body = await request.json();
    return json(await generateEmail(user.id, body));
  }
  if (root === "email" && action === "send" && request.method === "POST") {
    const body = await request.json();
    if (body.action === "draft") return json({ draft: await saveDraft(user.id, body) });
    const result = await sendOutreach(user.id, body);
    return json(result);
  }
  if (root === "email" && action === "sync" && request.method === "POST") return json(await syncReplies(user.id));

  if (root === "outreach" && request.method === "GET") {
    const [saved, messages, followups] = await Promise.all([repo.listSaved(user.id), repo.listMessages(user.id), repo.listFollowUps(user.id)]);
    const summary = outreachSummary(messages, saved.length, saved.map((item) => item.status));
    const chart = Array.from({ length: 8 }, (_, index) => {
      const start = new Date();
      start.setDate(start.getDate() - (7 - index) * 7);
      const end = new Date(start);
      end.setDate(end.getDate() + 7);
      const sent = messages.filter((message) => message.deliveryConfirmed && message.sentAt && message.sentAt >= start.toISOString() && message.sentAt < end.toISOString()).length;
      const replies = messages.filter((message) => message.direction === "inbound" && message.createdAt >= start.toISOString() && message.createdAt < end.toISOString()).length;
      return { week: `${start.getMonth() + 1}/${start.getDate()}`, sent, replies };
    });
    return json({ summary, followups: followups.filter((item) => item.status === "open"), messages, chart });
  }

  if (root === "jobs" && action === "save" && request.method === "POST") {
    const body = await request.json();
    return json({ saved: await repo.saveJob(user.id, body.jobId) });
  }
  if (root === "jobs" && action === "save" && request.method === "DELETE") {
    const body = await request.json();
    await repo.unsaveJob(user.id, body.jobId);
    return json({ ok: true });
  }
  if (root === "jobs" && request.method === "GET") {
    const [goals, facts] = await Promise.all([repo.getGoals(user.id), repo.getFacts(user.id)]);
    const result = await listJobPostings(goals, facts);
    const saved = await repo.listSavedJobs(user.id);
    return json({ ...result, savedJobs: saved, savedIds: saved.map((job) => job.id) });
  }

  if (root === "billing" && action === "referral" && request.method === "POST") {
    const body = await request.json();
    return json(await applyReferralCode(user.id, String(body.code || "")));
  }
  if (root === "billing" && action === "checkout" && request.method === "POST") {
    const body = await request.json();
    return json(await createStripeCheckout(user.id, body.kind));
  }
  if (root === "billing" && action === "demo" && request.method === "POST") {
    const body = await request.json();
    return json(await confirmDemoPurchase(user.id, body.kind));
  }
  if (root === "billing" && action === "history" && request.method === "GET") return json({ payments: await repo.listPayments(user.id) });

  if (root === "admin" && action === "metrics" && request.method === "GET") {
    if (!(await isAdminEmail(user))) throw new ServiceError("This page is limited to Unnepo operators.", "forbidden", 403);
    return json(await profitability());
  }

  if (root === "account" && action === "export" && request.method === "GET") {
    return json(await repo.exportUser(user.id));
  }
  if (root === "account" && request.method === "DELETE") {
    await repo.deleteUser(user.id);
    await clearSessionCookie();
    return json({ ok: true });
  }

  if (root === "resume-file" && request.method === "GET") {
    const resume = await repo.getLatestResume(user.id);
    if (!resume || !existsSync(resume.storagePath)) throw new ServiceError("No resume file.", "not_found", 404);
    const stream = createReadStream(resume.storagePath);
    return new Response(Readable.toWeb(stream) as ReadableStream, { headers: { "Content-Type": resume.mime, "Content-Disposition": `attachment; filename="${resume.fileName}"` } });
  }

  throw new ServiceError("Not found.", "not_found", 404);
}

function oauthReturnUrl(request: Request, message: string) {
  const current = new URL(request.url);
  const provider = current.pathname.split("/").filter(Boolean)[2] || "";
  const mailbox = provider === "gmail" || provider === "outlook";
  let path = mailbox ? "/settings" : "/signup";
  const referer = request.headers.get("referer");
  if (referer) {
    try {
      const from = new URL(referer);
      const local = new Set(["localhost", "127.0.0.1"]);
      const sameSite = from.origin === current.origin || (local.has(from.hostname) && local.has(current.hostname) && from.port === current.port);
      if (sameSite && (from.pathname === "/login" || from.pathname === "/signup" || from.pathname === "/" || from.pathname === "/settings")) {
        path = from.pathname;
      }
    } catch {
      /* keep the default screen */
    }
  }
  const back = new URL(path, publicOrigin(request));
  if (path === "/settings") back.searchParams.set("tab", "integrations");
  back.searchParams.set("error", message);
  return back;
}

export async function GET(request: Request, context: { params: Promise<{ slug: string[] }> }) {
  const slug = (await context.params).slug;
  try {
    return await handle(request, slug);
  } catch (error) {
    if (slug[0] === "oauth" && error instanceof ServiceError) {
      if (error.code === "oauth_unconfigured") {
        const provider = new URL(request.url).pathname.split("/").filter(Boolean)[2] || "google";
        const which = provider === "microsoft" || provider === "outlook" ? "microsoft" : "google";
        const back = new URL("/connect", publicOrigin(request));
        back.searchParams.set("provider", which);
        return Response.redirect(back);
      }
      return Response.redirect(oauthReturnUrl(request, error.message));
    }
    return errorResponse(error);
  }
}

export async function POST(request: Request, context: { params: Promise<{ slug: string[] }> }) {
  try {
    return await handle(request, (await context.params).slug);
  } catch (error) {
    return errorResponse(error);
  }
}

export async function PUT(request: Request, context: { params: Promise<{ slug: string[] }> }) {
  try {
    return await handle(request, (await context.params).slug);
  } catch (error) {
    return errorResponse(error);
  }
}

export async function PATCH(request: Request, context: { params: Promise<{ slug: string[] }> }) {
  try {
    return await handle(request, (await context.params).slug);
  } catch (error) {
    return errorResponse(error);
  }
}

export async function DELETE(request: Request, context: { params: Promise<{ slug: string[] }> }) {
  try {
    return await handle(request, (await context.params).slug);
  } catch (error) {
    return errorResponse(error);
  }
}
