/**
 * usage-weekly-check pure core (4e brief step 3; offer §7.4, SOP 16, O-18). BB-LDN-4e-151026.
 */
import { describe, expect, it } from "vitest";
import { USAGE_LOW_THRESHOLD_PER_CHILD_PER_WEEK as T } from "@/config/offer";
import { findLowFamilies, hasUsageAccess } from "./low-usage";

const LATER = "2999-01-01T00:00:00Z";
const EARLIER = "2000-01-01T00:00:00Z";

describe("hasUsageAccess — the families the check looks at", () => {
  it("a trial or paid period that has ended is not access, even before the status flips", () => {
    expect(hasUsageAccess({ status: "trial", access_toggled_on: null, trial_ends_at: EARLIER })).toBe(false);
    expect(hasUsageAccess({ status: "trial", access_toggled_on: null, trial_ends_at: null })).toBe(false);
    expect(hasUsageAccess({ status: "active_monthly", access_toggled_on: null, paid_period_ends_at: EARLIER })).toBe(false);
    expect(hasUsageAccess({ status: "active_upfront", access_toggled_on: null, paid_period_ends_at: null })).toBe(false);
  });

  it.each([
    ["placed", null, true],
    ["trial", null, true],
    ["active_monthly", null, true],
    ["active_upfront", null, true],
    ["deposit_paid", null, false],
    ["past_due", null, false],
    ["cancelled", null, false],
    ["lapsed", null, false],
    ["deposit_paid", true, true],
    ["lapsed", true, true],
    ["placed", false, false],
  ] as const)("%s, toggle %s → %s", (status, toggle, want) => {
    expect(
      hasUsageAccess({ status, access_toggled_on: toggle, trial_ends_at: LATER, paid_period_ends_at: LATER }),
    ).toBe(want);
  });
});

describe("findLowFamilies", () => {
  const children = [
    { id: "c1", parent_user_id: "p1", first_name: "Mila" },
    { id: "c2", parent_user_id: "p1", first_name: "Leo" },
    { id: "c3", parent_user_id: "p2", first_name: "Ada" },
  ];

  it("a family is low when any linked child is below the threshold; details list every child", () => {
    const counts = new Map([["c1", T], ["c3", T]]);
    const low = findLowFamilies(["p1", "p2"], children, counts);
    expect(low).toEqual([
      {
        parentUserId: "p1",
        children: [
          { childId: "c1", firstName: "Mila", posts: T },
          { childId: "c2", firstName: "Leo", posts: 0 },
        ],
      },
    ]);
  });

  it("no child, no verdict: a family without linked children is not low", () => {
    expect(findLowFamilies(["p3"], children, new Map())).toEqual([]);
  });

  it("only the families passed in are considered", () => {
    expect(findLowFamilies(["p2"], children, new Map())).toEqual([
      { parentUserId: "p2", children: [{ childId: "c3", firstName: "Ada", posts: 0 }] },
    ]);
  });
});
