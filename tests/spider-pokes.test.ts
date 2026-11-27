import { describe, expect, it } from "vitest";
import { pokeLine, pokeMs } from "@/lib/spider-pokes";

describe("poking the spider", () => {
  it("starts polite, then swears (bleeped), and never says the same thing twice in a row", () => {
    for (const seed of [0, 0.31, 0.77]) {
      expect(pokeLine(1, seed)).not.toMatch(/\*/);
      for (let poke = 1; poke < 30; poke += 1) expect(pokeLine(poke + 1, seed)).not.toBe(pokeLine(poke, seed));
    }
    // Only bleeped swearing, never the real word.
    const said = Array.from({ length: 40 }, (_, at) => pokeLine(at + 1, 0.5)).join(" ");
    expect(said).not.toMatch(/\b(shit|fuck|damn|hell|bitch|asshole|pissed)\b/i);
    expect(said).toMatch(/f\*ck|sh\*t/i);
  });

  it("stays mad long enough to read a long line", () => {
    expect(pokeMs("Ouch!")).toBe(2200);
    expect(pokeMs("x".repeat(80))).toBeGreaterThan(4000);
  });
});
