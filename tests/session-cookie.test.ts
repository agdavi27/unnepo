import { beforeEach, describe, expect, it, vi } from "vitest";
import { requireUser } from "@/lib/http";
import { useTempDb } from "./helpers";

const jar = vi.hoisted(() => ({ token: undefined as string | undefined, deleted: [] as string[] }));
vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: () => (jar.token ? { value: jar.token } : undefined),
    delete: (name: string) => jar.deleted.push(name),
  }),
}));

describe("a session cookie that no longer works", () => {
  beforeEach(() => {
    useTempDb();
    jar.token = undefined;
    jar.deleted = [];
  });

  it("is removed, so /login stops redirecting to a dashboard that can't load", async () => {
    jar.token = "a-session-that-does-not-exist";
    await expect(requireUser()).rejects.toThrow(/Sign in/);
    expect(jar.deleted).toEqual(["unnepo_session"]);
  });

  it("isn't touched when there's no cookie at all", async () => {
    await expect(requireUser()).rejects.toThrow(/Sign in/);
    expect(jar.deleted).toEqual([]);
  });
});
