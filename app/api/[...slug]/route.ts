import { assertSameOrigin, clearSessionCookie, errorResponse, json, publicOrigin, rateLimit, readSession, requireUser, setSessionCookie } from "@/lib/http";
import { isAdminEmail, login, logout, publicUser, requestPasswordReset, resendVerification, resetPassword, signUp, verifyEmail } from "@/lib/services/auth";
import { persistenceMode, readAnthropicKey, readApolloKey, repo } from "@/lib/db/file-store";
import { composerContext } from "@/lib/services/composer";
import { outreachSummary, saveDraft } from "@/lib/services/outreach";
import { readStoredResume, storeResume } from "@/lib/services/resume";
import { applyVerifiedStripeEvent } from "@/lib/services/billing";
import { applyReferralCode } from "@/lib/services/referrals";
import { profitability } from "@/lib/services/admin";
import { dashboard } from "@/lib/services/dashboard";
import { beginOAuth, finishOAuth, oauthReady } from "@/lib/services/oauth";
import { ServiceError } from "@/lib/errors";
import { nowIso } from "@/lib/db/file-store";
import type { OutreachStatus } from "@/lib/db/types";
import { serverConfig } from "@/lib/config";
import { usingDefaultSecret } from "@/lib/security";
import { filtersFromProfile, interpretPrompt } from "@/lib/search/interpret";
import { integrations } from "@/lib/integrations/flags";
import { deleteWorkspaceContacts, disconnectWorkspaceMailbox, generateWorkspaceCoverLetter, listRecommendedJobs, sendWorkspaceEmail, generateWorkspaceEmail, recordPeopleSearch, refreshProfileHighlights, updateWorkspaceContact, resetStructuredProfile, saveManualEmailDraft, saveStructuredProfile, unlockWorkspaceEmail, workspaceState } from "@/lib/services/workspace";

import { applyState, approveAndSubmit, checkSubmission, createApplication, deleteApplication, markApplied, retryContacts, saveApplicationProfile, startAutofill, updateAnswers, updateOutreach } from "@/lib/apply/service";

/** Autofill keeps a browser connection open while it fills or submits a form. */
export const maxDuration = 300;

const ONBOARDING_INCOMPLETE = new Set(["profile", "goals", "resume", "interests", "roles", "location", "employment", "timing", "contacts", "networking", "extra", "story"]);

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
        apollo: false,
        anthropic: false,
        stripe: false,
        gmail: false,
        microsoft: false,
        inngest: Boolean(process.env.INNGEST_EVENT_KEY),
        resend: Boolean(process.env.RESEND_API_KEY),
        posthog: Boolean(process.env.POSTHOG_KEY),
        sentry: Boolean(process.env.SENTRY_DSN),
      },
      configured: {
        apollo: Boolean(await readApolloKey()),
        anthropic: Boolean(await readAnthropicKey()),
        stripe: Boolean(process.env.STRIPE_SECRET_KEY),
        gmail: ready.google,
        microsoft: ready.microsoft,
      },
      enabled: integrations,
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

  if (root === "oauth" && request.method === "GET" && (action === "gmail" || action === "outlook") && !integrations[action]) {
    return Response.redirect(new URL("/home", request.url));
  }
  if (root === "oauth" && request.method === "GET" && action && slug[2] !== "callback") {
    const session = await readSession();
    if ((action === "gmail" || action === "outlook") && !session?.user) {
      return Response.redirect(new URL("/login?next=/home", request.url));
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
      const dest = ONBOARDING_INCOMPLETE.has(step) ? "/onboarding" : "/home";
      return Response.redirect(new URL(dest, request.url));
    }
    const connected = new URL("/home", request.url);
    connected.searchParams.set("mailbox", action === "outlook" ? "outlook" : "gmail");
    return Response.redirect(connected);
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

  if (root === "apply") {
    const method = request.method;
    if (!action && method === "GET") return json(await applyState(user.id));
    if (action === "applications" && method === "POST") {
      if (!rateLimit(`apply:${user.id}`, 30, 60 * 60 * 1000)) throw new ServiceError("That's a lot of jobs in an hour. Try again a bit later.", "rate_limited", 429);
      return json(await createApplication(user.id, await request.json()));
    }
    if (action === "applications" && method === "DELETE") return json(await deleteApplication(user.id, await request.json()));
    if (action === "answers" && method === "PATCH") return json(await updateAnswers(user.id, await request.json()));
    if (action === "profile" && method === "PUT") return json(await saveApplicationProfile(user.id, await request.json()));
    if (action === "autofill" && method === "POST") return json(await startAutofill(user.id, await request.json()));
    if (action === "submit" && method === "POST") return json(await approveAndSubmit(user.id, await request.json()));
    if (action === "check" && method === "POST") return json(await checkSubmission(user.id, await request.json()));
    if (action === "applied" && method === "POST") return json(await markApplied(user.id, await request.json()));
    if (action === "retry-contacts" && method === "POST") return json(await retryContacts(user.id, await request.json()));
    if (action === "contact" && method === "PATCH") return json(await updateOutreach(user.id, await request.json()));
  }

  if (root === "app" && action === "state" && request.method === "GET") {
    return json(await workspaceState(user.id));
  }
  if (root === "app" && action === "profile" && request.method === "PUT") {
    const body = await request.json();
    const saved = await saveStructuredProfile(user.id, body.profile ?? body, user.name);
    return json({ profile: saved.document, organization: saved.organization });
  }
  if (root === "app" && action === "profile" && request.method === "DELETE") {
    await resetStructuredProfile(user.id);
    return json({ ok: true });
  }
  if (root === "app" && action === "search" && request.method === "POST") {
    return json(await recordPeopleSearch(user.id, await request.json()));
  }
  if (root === "app" && action === "unlock" && request.method === "POST") {
    return json(await unlockWorkspaceEmail(user.id, await request.json()));
  }
  if (root === "app" && action === "jobs" && request.method === "GET") {
    return json(await listRecommendedJobs(user.id, { refresh: new URL(request.url).searchParams.get("refresh") === "1" }));
  }
  if (root === "app" && action === "cover-letter" && request.method === "POST") {
    return json(await generateWorkspaceCoverLetter(user.id, await request.json()));
  }
  if (root === "app" && action === "send" && request.method === "POST") {
    return json(await sendWorkspaceEmail(user.id, await request.json()));
  }
  if (root === "app" && action === "mailbox" && request.method === "DELETE") {
    return json(await disconnectWorkspaceMailbox(user.id, await request.json()));
  }
  if (root === "app" && action === "highlights" && request.method === "POST") {
    return json(await refreshProfileHighlights(user.id));
  }
  if (root === "app" && action === "contacts" && request.method === "PATCH") {
    return json(await updateWorkspaceContact(user.id, await request.json()));
  }
  if (root === "app" && action === "contacts" && request.method === "DELETE") {
    return json(await deleteWorkspaceContacts(user.id, await request.json()));
  }
  if (root === "app" && action === "generate" && request.method === "POST") {
    return json(await generateWorkspaceEmail(user.id, await request.json()));
  }
  if (root === "app" && action === "draft" && request.method === "POST") {
    return json({ draft: await saveManualEmailDraft(user.id, await request.json()) });
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
      workModes: body.workModes ?? current?.workModes ?? [],
      relocate: body.relocate ?? current?.relocate ?? false,
      contactTypes: body.contactTypes ?? current?.contactTypes ?? [],
      networkingGoals: body.networkingGoals ?? current?.networkingGoals ?? [],
      extraNote: body.extraNote ?? current?.extraNote ?? "",
      originStory: body.originStory ?? current?.originStory ?? "",
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
    if (!bytes.byteLength) throw new ServiceError("That file was empty. Choose the resume again.", "file");
    const result = await storeResume(user.id, file.name, file.type || "application/octet-stream", bytes);
    return json({ resume: { id: result.resume.id, fileName: result.resume.fileName, byteSize: result.resume.byteSize }, facts: result.facts, cached: result.cached });
  }

  if (root === "facts" && request.method === "GET") return json({ facts: await repo.getFacts(user.id) });
  if (root === "facts" && request.method === "PATCH") {
    const body = await request.json();
    const fact = await repo.updateFact(user.id, body.id, { detail: body.detail, label: body.label });
    if (!fact) throw new ServiceError("Fact not found.", "not_found", 404);
    return json({ fact });
  }

  if (root === "contacts" && action === "interpret" && request.method === "POST") {
    const body = await request.json();
    const prompt = String(body.prompt || "");
    if (body.mode === "profile") {
      const [goals, profile] = await Promise.all([repo.getGoals(user.id), repo.getProfile(user.id)]);
      const built = filtersFromProfile(goals, profile?.school || null, prompt);
      return json({ ...built, model: process.env.ANTHROPIC_API_KEY ? "profile" : "profile" });
    }
    const built = interpretPrompt(prompt);
    return json(built);
  }

  if (root === "contacts" && action === "search" && request.method === "POST") {
    return json({
      people: [],
      total: 0,
      source: "disabled",
      notice: "People search is not connected yet. No credits were used.",
      charged: 0,
      status: "not_connected",
    });
  }

  if (root === "contacts" && action === "unlock" && request.method === "POST") {
    return json({ ok: false, code: "not_connected", message: "Email unlock is not connected yet. No credits were used." }, 409);
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
    return json({ error: "AI email generation is not connected yet. Nothing was written for you." }, 409);
  }
  if (root === "email" && action === "send" && request.method === "POST") {
    const body = await request.json();
    if (body.action === "draft") return json({ draft: await saveDraft(user.id, body) });
    return json({ error: "Email sending is not connected yet. Nothing was sent." }, 409);
  }
  if (root === "email" && action === "sync" && request.method === "POST") {
    return json({ error: "Mailbox sync is not connected yet." }, 409);
  }

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

  if (root === "jobs") {
    return json({ error: "Job listings are not part of Unnepo.", jobs: [], savedJobs: [] }, 410);
  }

  if (root === "billing" && action === "referral" && request.method === "POST") {
    const body = await request.json();
    return json(await applyReferralCode(user.id, String(body.code || "")));
  }
  if (root === "billing" && action === "checkout" && request.method === "POST") {
    return json({ error: "New checkouts are paused. Existing subscriptions are unchanged." }, 409);
  }
  if (root === "billing" && action === "demo" && request.method === "POST") {
    return json({ error: "Demo credit purchases are paused. Existing balances are unchanged." }, 409);
  }
  if (root === "cover-letter") {
    return json({ error: "Cover letters are not part of Unnepo." }, 410);
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
    const bytes = resume ? await readStoredResume(resume.storagePath) : null;
    if (!resume || !bytes) throw new ServiceError("No resume file.", "not_found", 404);
    return new Response(Buffer.from(bytes), { headers: { "Content-Type": resume.mime, "Content-Disposition": `attachment; filename="${resume.fileName}"` } });
  }

  throw new ServiceError("Not found.", "not_found", 404);
}

function oauthReturnUrl(request: Request, message: string) {
  const current = new URL(request.url);
  const provider = current.pathname.split("/").filter(Boolean)[2] || "";
  const mailbox = provider === "gmail" || provider === "outlook";
  let path = mailbox ? "/home" : "/signup";
  const referer = request.headers.get("referer");
  if (referer) {
    try {
      const from = new URL(referer);
      const local = new Set(["localhost", "127.0.0.1"]);
      const sameSite = from.origin === current.origin || (local.has(from.hostname) && local.has(current.hostname) && from.port === current.port);
      if (!mailbox && sameSite && (from.pathname === "/login" || from.pathname === "/signup" || from.pathname === "/")) {
        path = from.pathname;
      }
    } catch {
      /* keep the default screen */
    }
  }
  const back = new URL(path, publicOrigin(request));
  back.searchParams.set(mailbox ? "mailbox_error" : "error", message);
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
