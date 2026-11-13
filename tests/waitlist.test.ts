import { beforeEach, describe, expect, it } from "vitest";
import { repo } from "@/lib/db/file-store";
import { joinWaitlist } from "@/lib/waitlist";
import { useTempDb } from "./helpers";

describe("waitlist", () => {
  beforeEach(() => { useTempDb(); });

  it("saves a name and email, with an optional phone number, once per email", async () => {
    expect(await joinWaitlist({ name: "  Pat   Doe ", email: "Pat@Colby.edu" })).toEqual({ ok: true, firstName: "Pat" });
    await joinWaitlist({ name: "Pat Doe", email: "pat@colby.edu", phone: "(207) 555-0100" });
    await joinWaitlist({ name: "Sam Lee", email: "sam@colby.edu" });
    const list = await repo.listWaitlist();
    expect(list.map(({ name, email, phone }) => ({ name, email, phone }))).toEqual([
      { name: "Pat Doe", email: "pat@colby.edu", phone: "(207) 555-0100" },
      { name: "Sam Lee", email: "sam@colby.edu", phone: undefined },
    ]);
  });

  it("asks for a name and a real email, and rejects a phone number that isn't one", async () => {
    await expect(joinWaitlist({ name: "", email: "pat@colby.edu" })).rejects.toThrow("Add your name.");
    await expect(joinWaitlist({ name: "Pat", email: "pat" })).rejects.toThrow("doesn't look right");
    await expect(joinWaitlist({ name: "Pat", email: "pat@colby.edu", phone: "call me" })).rejects.toThrow("phone number");
    expect(await repo.listWaitlist()).toEqual([]);
  });
});
