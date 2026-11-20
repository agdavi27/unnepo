import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { emptyDatabase } from "@/lib/db/types";

const remote = vi.hoisted(() => ({
  version: 1,
  loads: 0,
  versionChecks: 0,
  saves: 0,
}));

vi.mock("@/lib/db/remote", () => {
  class VersionConflict extends Error {}
  return {
    VersionConflict,
    remoteKind: () => "supabase",
    loadRemote: async () => {
      remote.loads++;
      return { db: emptyDatabase(), version: remote.version };
    },
    loadRemoteVersion: async () => {
      remote.versionChecks++;
      return remote.version;
    },
    saveRemote: async (_db: unknown, version: number) => {
      remote.saves++;
      if (version !== remote.version) throw new VersionConflict();
      remote.version++;
    },
  };
});

const { repo, resetMemory } = await import("@/lib/db/file-store");

describe("remote cache", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    Object.assign(remote, { version: 1, loads: 0, versionChecks: 0, saves: 0 });
    resetMemory();
  });
  afterEach(() => vi.useRealTimers());

  it("skips the full download when the stored version has not changed", async () => {
    await repo.snapshot();
    vi.advanceTimersByTime(60_000);
    await repo.snapshot();
    expect(remote.loads).toBe(1);
    expect(remote.versionChecks).toBe(1);
  });

  it("downloads again when another server wrote a newer version", async () => {
    await repo.snapshot();
    remote.version = 2;
    vi.advanceTimersByTime(60_000);
    await repo.snapshot();
    expect(remote.loads).toBe(2);
  });

  it("keeps using its copy after its own write", async () => {
    await repo.setCompanyDomains("Acme", ["acme.com"]);
    vi.advanceTimersByTime(60_000);
    const domains = await repo.getCompanyDomains(["Acme"]);
    expect(domains.acme).toEqual(["acme.com"]);
    expect(remote.saves).toBe(1);
    expect(remote.loads).toBe(1);
  });
});
