import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GET } from "@/app/api/[...slug]/route";
import { repo } from "@/lib/db/file-store";
import { loginWithOAuth, signUp } from "@/lib/services/auth";
import { useTempDb } from "./helpers";

const jar = vi.hoisted(() => new Map<string, string>());
vi.mock("next/headers", () => ({
  cookies: async () => ({ get: (name: string) => (jar.has(name) ? { value: jar.get(name) } : undefined), set: (name: string, value: string) => jar.set(name, value), delete: (name: string) => jar.delete(name) }),
}));

const get = (url: string, headers: Record<string, string> = {}) => {
  const slug = new URL(url).pathname.replace(/^\/api\//, "").split("/");
  return GET(new Request(url, { headers }), { params: Promise.resolve({ slug }) });
};

/** Where a redirect goes, and the message it carries back to the sign-up page. */
const landing = (response: Response) => {
  const url = new URL(response.headers.get("location") ?? "");
  return { origin: url.origin, path: url.pathname, error: url.searchParams.get("error") };
};

beforeEach(() => {
  useTempDb();
  jar.clear();
  process.env.GOOGLE_CLIENT_ID = "test-client";
  process.env.GOOGLE_CLIENT_SECRET = "test-secret";
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  delete process.env.GOOGLE_CLIENT_ID;
  delete process.env.GOOGLE_CLIENT_SECRET;
});

describe("sign-up with any email", () => {
  it("takes a Gmail address with a password, and still rejects a malformed one", async () => {
    const { user } = await signUp({ email: "Jo.Smith@gmail.com", password: "password123", name: "Jo Smith" });
    expect(user.email).toBe("jo.smith@gmail.com");
    await expect(signUp({ email: "not-an-email", password: "password123", name: "Jo" })).rejects.toThrow("doesn't look right");
  });

  it("makes an account from a personal Google account", async () => {
    const result = await loginWithOAuth({ email: "jo.smith@gmail.com", name: "Jo Smith", provider: "google", emailVerified: true });
    expect(result.user.email).toBe("jo.smith@gmail.com");
    expect(result.token).toBeTruthy();
  });
});

describe("Google sign-in", () => {
  it("finishes a Gmail sign-in and lands on onboarding", async () => {
    const start = await get("http://localhost:43123/api/oauth/google");
    const state = new URL(start.headers.get("location")!).searchParams.get("state")!;
    vi.stubGlobal("fetch", async (url: string) => {
      if (url.includes("oauth2.googleapis.com/token")) return Response.json({ access_token: "at" });
      return Response.json({ email: "jo.smith@gmail.com", name: "Jo Smith", email_verified: true });
    });
    const done = await get(`http://localhost:43123/api/oauth/google/callback?code=abc&state=${state}`);
    expect(landing(done).path).toBe("/onboarding");
    expect(jar.get("unnepo_session")).toBeTruthy();
    expect(await repo.getUserByEmail("jo.smith@gmail.com")).toBeTruthy();
  });

  it("sends anyone back to sign up with a try-another-time message when Google fails", async () => {
    const start = await get("http://localhost:43123/api/oauth/google");
    const state = new URL(start.headers.get("location")!).searchParams.get("state")!;
    vi.stubGlobal("fetch", async () => new Response("nope", { status: 500 }));
    const failed = landing(await get(`http://localhost:43123/api/oauth/google/callback?code=abc&state=${state}`));
    expect(failed.path).toBe("/signup");
    expect(failed.error).toBe("Google sign-in isn't working right now. Try again another time, or sign up with your email and a password below.");

    // Even an unexpected crash, not just a refused code, ends on that page rather than an error screen.
    const again = new URL((await get("http://localhost:43123/api/oauth/google")).headers.get("location")!).searchParams.get("state")!;
    vi.stubGlobal("fetch", async () => { throw new Error("network down"); });
    expect(landing(await get(`http://localhost:43123/api/oauth/google/callback?code=abc&state=${again}`)).error).toContain("Try again another time");
  });

  it("says when Google itself reported a problem or the student canceled", async () => {
    expect(landing(await get("http://localhost:43123/api/oauth/google/callback?error=server_error")).error).toContain("isn't working right now");
    expect(landing(await get("http://localhost:43123/api/oauth/google/callback?error=access_denied")).error).toBe("Google sign-in was canceled. Try again another time, or sign up with your email and a password below.");
  });

  it("says try another time when Google sign-in isn't set up", async () => {
    delete process.env.GOOGLE_CLIENT_SECRET;
    expect(landing(await get("http://localhost:43123/api/oauth/google")).error).toContain("isn't working right now");
  });

  it("in production, starts on www.unnepo.com when opened from a Vercel address", async () => {
    vi.stubEnv("NODE_ENV", "production");
    const hop = await get("https://unneponew.vercel.app/api/oauth/google", { "x-forwarded-host": "unneponew.vercel.app", "x-forwarded-proto": "https" });
    expect(hop.headers.get("location")).toBe("https://www.unnepo.com/api/oauth/google");
    const real = await get("https://www.unnepo.com/api/oauth/google", { "x-forwarded-host": "www.unnepo.com", "x-forwarded-proto": "https" });
    expect(new URL(real.headers.get("location")!).searchParams.get("redirect_uri")).toBe("https://www.unnepo.com/api/oauth/google/callback");
  });
});
