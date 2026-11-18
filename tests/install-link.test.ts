import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { POST, GET } from "@/app/api/[...slug]/route";
import { CHROME_STORE_URL } from "@/lib/config";
import { installEmailForTests } from "@/lib/email/transactional";
import { listInstallLinks, reminderDue, REMINDER_AFTER_MS, REMINDER_GIVE_UP_MS, requestInstallLink, sendDueReminders, SENDS_PER_EMAIL_PER_DAY } from "@/lib/install-link";
import { installView } from "@/lib/install-view";
import { signUp } from "@/lib/services/auth";
import { useTempDb } from "./helpers";

const HOUR = 60 * 60 * 1000;
let ipCounter = 0;
const freshIp = () => `10.0.${Math.floor(++ipCounter / 250)}.${ipCounter % 250}`;

type Sent = { to: string[]; subject: string; html: string; text: string; headers?: Record<string, string> };

function stubResend(ok = true) {
  const sent: Sent[] = [];
  vi.stubGlobal("fetch", vi.fn(async (url: string, init: RequestInit) => {
    if (String(url).includes("api.resend.com")) {
      sent.push(JSON.parse(String(init.body)));
      return new Response(ok ? "{}" : "nope", { status: ok ? 200 : 500 });
    }
    throw new Error(`unexpected fetch ${url}`);
  }));
  return sent;
}

function apiPost(slug: string[], body: unknown, ip = freshIp()) {
  const request = new Request(`http://localhost/api/${slug.join("/")}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-forwarded-for": ip, "sec-fetch-site": "same-origin" },
    body: JSON.stringify(body),
  });
  return POST(request, { params: Promise.resolve({ slug }) });
}

function apiGet(path: string, headers: Record<string, string> = {}) {
  const url = new URL(`http://localhost/api/${path}`);
  const slug = url.pathname.replace("/api/", "").split("/");
  return GET(new Request(url, { headers }), { params: Promise.resolve({ slug }) });
}

describe("/get install link sign-up", () => {
  beforeEach(() => {
    useTempDb();
    process.env.RESEND_API_KEY = "re_test";
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    delete process.env.RESEND_API_KEY;
    delete process.env.CRON_SECRET;
  });

  it("saves the sign-up and emails the install link right away, with an unsubscribe link", async () => {
    const sent = stubResend();
    const response = await apiPost(["install-link", "request"], { email: "  Jo.Lee@Gmail.com ", source: "ig-fall" });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true, email: "Jo.Lee@Gmail.com", alreadySent: false });

    expect(sent).toHaveLength(1);
    expect(sent[0].to).toEqual(["Jo.Lee@Gmail.com"]);
    expect(sent[0].subject).toMatch(/install link/i);
    expect(sent[0].html).toContain(CHROME_STORE_URL);
    expect(sent[0].text).toContain(CHROME_STORE_URL);
    expect(sent[0].html).toMatch(/http:\/\/localhost\/api\/install-link\/unsubscribe\?token=\w+/);
    expect(sent[0].headers?.["List-Unsubscribe"]).toMatch(/^<http:\/\/localhost\/api\/install-link\/unsubscribe\?token=/);

    const [row] = await listInstallLinks();
    expect(row).toMatchObject({ email: "Jo.Lee@Gmail.com", emailNormalized: "jo.lee@gmail.com", source: "ig-fall", sends: [expect.any(String)] });
  });

  it("rejects an address that isn't one, without sending", async () => {
    const sent = stubResend();
    for (const email of ["", "jo", "jo@", "@gmail.com", "jo@gmail", "jo lee@gmail.com", 42]) {
      const response = await apiPost(["install-link", "request"], { email });
      expect(response.status).toBe(400);
      expect((await response.json()).error).toMatch(/real email/);
    }
    expect(sent).toHaveLength(0);
    expect(await listInstallLinks()).toEqual([]);
  });

  it("rate-limits by IP", async () => {
    stubResend();
    const ip = freshIp();
    const statuses: number[] = [];
    for (let i = 0; i < 9; i++) statuses.push((await apiPost(["install-link", "request"], { email: `student${i}@gmail.com` }, ip)).status);
    expect(statuses.slice(0, 8).every((status) => status === 200)).toBe(true);
    expect(statuses[8]).toBe(429);
  });

  it("rate-limits by email: a quick repeat isn't resent, and a few a day at most", async () => {
    const sent = stubResend();
    const start = Date.UTC(2026, 10, 18, 12);
    const ask = (minutes: number) => requestInstallLink({ email: "pat@gmail.com", ip: freshIp(), origin: "https://www.unnepo.com", now: start + minutes * 60_000 });

    expect(await ask(0)).toMatchObject({ alreadySent: false });
    expect(await ask(1)).toMatchObject({ ok: true, alreadySent: true });
    expect(sent).toHaveLength(1);
    // Plus-addressing is the same inbox.
    expect(await requestInstallLink({ email: "pat+ig@gmail.com", ip: freshIp(), origin: "https://www.unnepo.com", now: start + 90_000 })).toMatchObject({ alreadySent: true });

    for (let i = 1; i < SENDS_PER_EMAIL_PER_DAY; i++) expect(await ask(i * 10)).toMatchObject({ alreadySent: false });
    expect(sent).toHaveLength(SENDS_PER_EMAIL_PER_DAY);
    await expect(ask(60)).rejects.toMatchObject({ status: 429 });
    // A day later it works again, still one sign-up.
    expect(await ask(25 * 60)).toMatchObject({ alreadySent: false });
    expect(await listInstallLinks()).toHaveLength(1);
  });

  it("says so when the email can't be sent, and doesn't count it", async () => {
    stubResend(false);
    const response = await apiPost(["install-link", "request"], { email: "sam@gmail.com" });
    expect(response.status).toBe(503);
    const [row] = await listInstallLinks();
    expect(row.sends).toEqual([]);
  });
});

describe("the next-day reminder", () => {
  const origin = "https://www.unnepo.com";
  const signedUp = Date.UTC(2026, 10, 18, 2); // 9pm Eastern

  beforeEach(() => {
    useTempDb();
    process.env.RESEND_API_KEY = "re_test";
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    delete process.env.RESEND_API_KEY;
    delete process.env.CRON_SECRET;
  });

  it("is due from 10 hours after sign-up, for a week, once", () => {
    const row = { id: "1", email: "a@b.co", emailNormalized: "a@b.co", token: "t", createdAt: new Date(signedUp).toISOString(), sends: [] };
    expect(reminderDue(row, signedUp + REMINDER_AFTER_MS - 1)).toBe(false);
    expect(reminderDue(row, signedUp + REMINDER_AFTER_MS)).toBe(true);
    // The daily run at 15:00 UTC the next day is 13 hours later: the next morning in the US.
    expect(reminderDue(row, Date.UTC(2026, 10, 18, 15))).toBe(true);
    expect(reminderDue(row, signedUp + REMINDER_GIVE_UP_MS + 1)).toBe(false);
    expect(reminderDue({ ...row, reminderSentAt: "x" }, signedUp + 20 * HOUR)).toBe(false);
    expect(reminderDue({ ...row, unsubscribedAt: "x" }, signedUp + 20 * HOUR)).toBe(false);
  });

  it("sends one reminder on the next daily run, and never a second", async () => {
    const sent = stubResend();
    await requestInstallLink({ email: "kim@gmail.com", ip: freshIp(), origin, now: signedUp });
    expect(sent).toHaveLength(1);

    expect(await sendDueReminders(origin, signedUp + 5 * HOUR)).toEqual({ sent: 0, skipped: 0, failed: 0 });
    expect(await sendDueReminders(origin, signedUp + 13 * HOUR)).toEqual({ sent: 1, skipped: 0, failed: 0 });
    expect(sent).toHaveLength(2);
    expect(sent[1].to).toEqual(["kim@gmail.com"]);
    expect(sent[1].subject).not.toEqual(sent[0].subject);
    expect(sent[1].html).toContain(CHROME_STORE_URL);
    expect(sent[1].html).toContain(`${origin}/api/install-link/unsubscribe?token=`);
    expect(await sendDueReminders(origin, signedUp + 37 * HOUR)).toEqual({ sent: 0, skipped: 0, failed: 0 });
    expect(sent).toHaveLength(2);
  });

  it("skips anyone who has since made an account", async () => {
    const sent = stubResend();
    await requestInstallLink({ email: "Ana.Ruiz@colby.edu", ip: freshIp(), origin, now: signedUp });
    vi.unstubAllGlobals();
    delete process.env.RESEND_API_KEY;
    await signUp({ email: "ana.ruiz@colby.edu", password: "password123", name: "Ana Ruiz" });
    process.env.RESEND_API_KEY = "re_test";
    const later = stubResend();
    expect(await sendDueReminders(origin, signedUp + 13 * HOUR)).toEqual({ sent: 0, skipped: 1, failed: 0 });
    expect(sent).toHaveLength(1);
    expect(later).toHaveLength(0);
    expect((await listInstallLinks())[0].reminderSkipped).toBe("signed_up");
  });

  it("skips anyone who unsubscribed, from the link or the mail app's one-click", async () => {
    const sent = stubResend();
    await requestInstallLink({ email: "lee@gmail.com", ip: freshIp(), origin, now: signedUp });
    await requestInstallLink({ email: "max@gmail.com", ip: freshIp(), origin, now: signedUp });
    const [lee, max] = await listInstallLinks();

    const link = await apiGet(`install-link/unsubscribe?token=${lee.token}`);
    expect(link.status).toBe(303);
    expect(link.headers.get("location")).toBe("http://localhost/get?unsubscribed=1");
    const oneClick = await POST(new Request(`http://mail.example/api/install-link/unsubscribe?token=${max.token}`, { method: "POST", headers: { origin: "https://mail.google.com" }, body: "List-Unsubscribe=One-Click" }), { params: Promise.resolve({ slug: ["install-link", "unsubscribe"] }) });
    expect(await oneClick.json()).toEqual({ ok: true });
    expect((await apiGet("install-link/unsubscribe?token=nope")).headers.get("location")).toBe("http://localhost/get?unsubscribed=0");

    expect(await sendDueReminders(origin, signedUp + 13 * HOUR)).toEqual({ sent: 0, skipped: 0, failed: 0 });
    expect(sent).toHaveLength(2);
  });

  it("tries again on the next run when the reminder fails to send", async () => {
    stubResend();
    await requestInstallLink({ email: "ola@gmail.com", ip: freshIp(), origin, now: signedUp });
    stubResend(false);
    expect(await sendDueReminders(origin, signedUp + 13 * HOUR)).toEqual({ sent: 0, skipped: 0, failed: 1 });
    const sent = stubResend();
    expect(await sendDueReminders(origin, signedUp + 37 * HOUR)).toEqual({ sent: 1, skipped: 0, failed: 0 });
    expect(sent).toHaveLength(1);
  });

  it("runs from Vercel's schedule only with the CRON_SECRET", async () => {
    const sent = stubResend();
    await requestInstallLink({ email: "eve@gmail.com", ip: freshIp(), origin, now: Date.now() - 13 * HOUR });
    expect((await apiGet("cron/install-reminders")).status).toBe(401);
    process.env.CRON_SECRET = "s3cret";
    expect((await apiGet("cron/install-reminders", { authorization: "Bearer wrong" })).status).toBe(401);
    const ok = await apiGet("cron/install-reminders", { authorization: "Bearer s3cret" });
    expect(await ok.json()).toEqual({ sent: 1, skipped: 0, failed: 0 });
    expect(sent).toHaveLength(2);
    expect(sent[1].html).toContain("https://www.unnepo.com/api/install-link/unsubscribe?token=");
  });
});

describe("install emails", () => {
  const input = { to: "a@b.co", installUrl: CHROME_STORE_URL, unsubscribeUrl: "https://www.unnepo.com/api/install-link/unsubscribe?token=abc", gifUrl: "https://www.unnepo.com/get/demo.gif" };

  it("both carry the install button, the GIF when there is one, and an unsubscribe link", () => {
    for (const kind of ["now", "reminder"] as const) {
      const email = installEmailForTests(kind, input);
      expect(email.html).toContain(`href="${CHROME_STORE_URL}"`);
      expect(email.html).toContain('src="https://www.unnepo.com/get/demo.gif"');
      expect(email.html).toContain(`href="${input.unsubscribeUrl}"`);
      expect(email.text).toContain(input.unsubscribeUrl);
      expect(email.headers["List-Unsubscribe-Post"]).toBe("List-Unsubscribe=One-Click");
    }
    expect(installEmailForTests("now", input).text).toMatch(/one reminder tomorrow/);
    expect(installEmailForTests("reminder", input).text).toMatch(/last email/);
    expect(installEmailForTests("now", { ...input, gifUrl: null }).html).not.toContain("<img");
  });
});

describe("which /get a visitor sees", () => {
  const UA = {
    iphone: "Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 Instagram 350.0.0.0 (iPhone15,2; iOS 18_1; en_US)",
    android: "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Mobile Safari/537.36",
    macChrome: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
    winEdge: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36 Edg/131.0.0.0",
    macSafari: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Safari/605.1.15",
    firefox: "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:132.0) Gecko/20100101 Firefox/132.0",
  };

  it("gives Chrome on a computer the button and everyone else the email form", () => {
    expect(installView(UA.macChrome)).toBe("chrome");
    expect(installView(UA.winEdge)).toBe("chrome");
    expect(installView(UA.iphone)).toBe("email");
    expect(installView(UA.android)).toBe("email");
    expect(installView(UA.macSafari)).toBe("email");
    expect(installView(UA.firefox)).toBe("email");
    expect(installView(null)).toBe("email");
    expect(installView(UA.iphone, "chrome")).toBe("chrome");
    expect(installView(UA.macChrome, "email")).toBe("email");
  });
});
