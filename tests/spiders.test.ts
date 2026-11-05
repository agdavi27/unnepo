import { describe, expect, it } from "vitest";
import { SKINS, crawlerColors, nextSkin, schoolStyle, spiderArt, wornSkin } from "@/lib/spiders";

describe("spiders to collect", () => {
  it("unlocks at 50, 150, 300, 500 and 1,000 applications, with the school spider from the start", () => {
    expect(SKINS.map((skin) => skin.unlockAt)).toEqual([0, 0, 50, 150, 300, 500, 1000]);
    expect(wornSkin("blue", 49)).toBe("classic");
    expect(wornSkin("blue", 50)).toBe("blue");
    expect(wornSkin("nonsense", 900)).toBe("classic");
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
    // The small spider on job sites and Home keeps its own dark colors unless another spider is picked.
    expect(crawlerColors({ skin: "classic" })).toEqual({});
    expect(crawlerColors({ skin: "blue" }).b).toBe("#3D8BFF");
  });
});
