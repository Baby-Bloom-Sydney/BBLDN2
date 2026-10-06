/**
 * Unit 3a (BB-LDN-3a-061026) — 00-RULINGS #33 (G4): `activity_logs` gains `dbs_status_check` and
 * `dbs_page2_requested` and drops the two expiry-era types with the expiry SQL. The lead timeline shows the new two
 * as verification events. The retired types are named by the gate's identity rule, never spelled out here
 * (LEDGER/2-0.md §8(3)).
 */
import { describe, it, expect, vi } from "vitest";

vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: vi.fn() }));

import { OPERATOR_RELEVANT_ACTIONS, activityCategory } from "./timeline";
import { DBS_ACTIVITY } from "@/lib/verification";
import { RULES } from "../../../scripts/ci/london-sweep.mjs";

const identityRules = (RULES as Array<{ rule: string; pattern: RegExp }>).filter(({ rule }) => rule === "identity");

describe("lead timeline — DBS activity types", () => {
  it("treats dbs_status_check and dbs_page2_requested as operator-relevant and no longer lists the retired expiry-era types", () => {
    expect(OPERATOR_RELEVANT_ACTIONS.has(DBS_ACTIVITY.STATUS_CHECK)).toBe(true);
    expect(OPERATOR_RELEVANT_ACTIONS.has(DBS_ACTIVITY.PAGE2_REQUESTED)).toBe(true);
    const flagged = [...OPERATOR_RELEVANT_ACTIONS].filter((t) => identityRules.some(({ pattern }) => pattern.test(t)));
    // The rule also flags the money stage's payout-tax types (admin / payout events). No verification event may be
    // flagged: the expiry-era types are gone with the expiry SQL.
    expect(flagged.filter((t) => activityCategory(t) === "verification")).toEqual([]);
  });

  it("files both DBS activity types under verification", () => {
    expect(activityCategory(DBS_ACTIVITY.STATUS_CHECK)).toBe("verification");
    expect(activityCategory(DBS_ACTIVITY.PAGE2_REQUESTED)).toBe("verification");
    expect(activityCategory("verification_approved")).toBe("verification");
  });
});
