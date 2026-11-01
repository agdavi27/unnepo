import { describe, expect, it } from "vitest";
import { SKINS, nextSkin, schoolStyle, spiderArt, wornSkin } from "@/lib/spiders";

describe("spiders to collect", () => {
  it("unlocks at 50, 150, 300, 500 and 1,000 applications, with the school spider from the start", () => {
    expect(SKINS.map((skin) => skin.unlockAt)).toEqual([0, 50, 150, 300, 500, 1000]);
    expect(wornSkin("blue", 49)).toBe("school");
    expect(wornSkin("blue", 50)).toBe("blue");
    expect(wornSkin("nonsense", 900)).toBe("school");
    expect(nextSkin(120)).toMatchObject({ skin: { id: "green" }, left: 30 });
    expect(nextSkin(1000)).toBeNull();
  });

  it("dresses the school spider in its colors and letters", () => {
    expect(schoolStyle("Colby College")).toMatchObject({ color: "#002169", letters: "C" });
    expect(schoolStyle("University of Vermont")?.letters).toBe("UVM");
    expect(schoolStyle("University of Southern Maine")?.letters).toBe("USM");
    expect(schoolStyle("Bard College")?.letters).toBe("B");
    expect(schoolStyle("")).toBeNull();
    // The letters are drawn on the sweater.
    expect(spiderArt(false, { skin: "school", school: "Colby College" }).flat()).toContain("t");
    expect(spiderArt(false, { skin: "blue" }).flat()).not.toContain("t");
  });
});
