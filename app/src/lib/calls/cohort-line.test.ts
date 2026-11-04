/**
 * The reverse direction of the 02 ↔ 04 seam (plan 04 §7, plan 02 §8, §12 R1): /admin/calls' "Current cohort: 2 of 5
 * places left". 02 merges second, so 02's PR wires 04's stub to `readCurrentCohortSummary`: null while
 * COHORTS_ENABLED is off (nothing read), or when there's no current cohort or its numbers can't be read.
 */
import { afterEach, describe, expect, expectTypeOf, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  summary: { kind: "off" } as unknown,
  created: 0,
  throwOnCreate: false,
}));
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => {
    h.created += 1;
    if (h.throwOnCreate) throw new Error("Missing Supabase admin credentials");
    return {};
  },
}));
vi.mock("@/lib/cohorts/read", () => ({ readCurrentCohortSummary: async () => h.summary }));

import { placesLeftLine } from "@/lib/cohorts/copy";
import { readCurrentCohortLine, type CohortLine } from "./cohort-line";

const VIEW = { start: "2027-02-01", places: 5, taken: 3, beingPaid: 0, left: 2, overBy: 0 };

afterEach(() => {
  vi.unstubAllEnvs();
  h.created = 0;
  h.throwOnCreate = false;
  vi.restoreAllMocks();
});

describe("readCurrentCohortLine (wired by 02)", () => {
  it("null while COHORTS_ENABLED is off, before any client is made", async () => {
    vi.stubEnv("COHORTS_ENABLED", "");
    h.summary = { kind: "current", view: VIEW };
    expect(await readCurrentCohortLine()).toBeNull();
    expect(h.created).toBe(0);
  });

  it("on: the current cohort's places and left, which 02's placesLeftLine words", async () => {
    vi.stubEnv("COHORTS_ENABLED", "true");
    h.summary = { kind: "current", view: VIEW };
    const line = await readCurrentCohortLine(new Date("2027-02-03T10:00:00Z"));
    expect(line).toEqual({ places: 5, left: 2 });
    expect(placesLeftLine(VIEW)).toBe("Current cohort: 2 of 5 places left");
  });

  it.each([[{ kind: "first_ahead", first: "2027-02-01" }], [{ kind: "not_set_up" }], [{ kind: "error" }]])("null for %o", async (summary) => {
    vi.stubEnv("COHORTS_ENABLED", "true");
    h.summary = summary;
    expect(await readCurrentCohortLine()).toBeNull();
  });

  it("null (logged) when the client can't be made", async () => {
    vi.stubEnv("COHORTS_ENABLED", "true");
    h.throwOnCreate = true;
    vi.spyOn(console, "error").mockImplementation(() => {});
    expect(await readCurrentCohortLine()).toBeNull();
    expect(console.error).toHaveBeenCalledWith("[calls/cohort-line] the cohort line could not be read", { name: "Error" });
  });

  it("keeps the shape plan §7 fixes", () => {
    expectTypeOf<CohortLine>().toEqualTypeOf<{ readonly places: number; readonly left: number }>();
    expectTypeOf(readCurrentCohortLine).returns.resolves.toEqualTypeOf<CohortLine | null>();
  });
});
