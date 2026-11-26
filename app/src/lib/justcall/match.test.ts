/**
 * Matching a call to a parent (plan 05 §5 A6, R7; brief §0.9, §0.10, §3 edges): her mobile only — JustCall's
 * `contact_number` normalised to E.164 — against parents' stored mobiles. One → matched; none or several → Unmatched,
 * never guessed. Our own JustCall number is never an input, so moving from the mobile to the 020 number changes nothing.
 */
import { describe, expect, it, vi } from "vitest";
import { matchParent, type ParentsByMobile } from "./match";

const reader = (ids: readonly string[]): ParentsByMobile => vi.fn(async () => ({ ok: true as const, value: ids }));

describe("matchParent", () => {
  it("one parent with that mobile → matched", async () => {
    const read = reader(["parent-1"]);
    expect(await matchParent("447700900517", read)).toEqual({ ok: true, value: { kind: "one", parentUserId: "parent-1" } });
    expect(read).toHaveBeenCalledWith("+447700900517");
  });

  it.each(["447700900517", "+447700900517", "07700 900517", "+44 (0) 7700 900 517", "00447700900517", "7700900517"])(
    "normalises %j to E.164 before reading",
    async (raw) => {
      const read = reader(["parent-1"]);
      await matchParent(raw, read);
      expect(read).toHaveBeenCalledWith("+447700900517");
    },
  );

  it("no parent → none", async () => {
    expect(await matchParent("447700900517", reader([]))).toEqual({ ok: true, value: { kind: "none" } });
  });

  it("the same number on two parents → several (never guessed)", async () => {
    expect(await matchParent("447700900123", reader(["parent-1", "parent-2"]))).toEqual({ ok: true, value: { kind: "several" } });
  });

  it("one parent listed twice is still one", async () => {
    expect(await matchParent("447700900517", reader(["parent-1", "parent-1"]))).toEqual({ ok: true, value: { kind: "one", parentUserId: "parent-1" } });
  });

  it.each([null, "", "   ", "12025550123", "442079460000", "abc"])("%j is no UK mobile → none, with no read", async (raw) => {
    const read = reader(["parent-1"]);
    expect(await matchParent(raw, read)).toEqual({ ok: true, value: { kind: "none" } });
    expect(read).not.toHaveBeenCalled();
  });

  it("a failed read → error (the event stays unresolved)", async () => {
    const read: ParentsByMobile = vi.fn(async () => ({ ok: false as const }));
    expect(await matchParent("447700900517", read)).toEqual({ ok: false });
  });

  it("takes her number only — there is no input for our own JustCall number (§9 row 11)", () => {
    expect(matchParent.length).toBe(2);
  });
});
