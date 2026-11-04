/**
 * Every line brief 02 fixes, word for word (§0.1–§0.12, §3), plus the singular forms. Pure.
 */
import { describe, expect, it } from "vitest";
import {
  belowTakenMessage,
  callsSentence,
  cardHeadline,
  EMPTY_STATE,
  familyStateLine,
  firstAheadLine,
  goodwillLine,
  panelLine,
  paidByLabel,
  placesLeftLine,
  preBookedLine,
  rowLine,
  beingPaidLine,
  overByLine,
  warningLine,
  actionErrorMessage,
} from "./copy";
import type { CohortView, FamilyRow } from "./types";

const VIEW: CohortView = { start: "2027-02-01", places: 5, taken: 3, beingPaid: 0, left: 2, overBy: 0 };

describe("the admin page lines", () => {
  it("§0.1 empty state", () => {
    expect(EMPTY_STATE).toBe("No cohorts yet. Set the first start date to begin.");
  });
  it("§3.2 first date still ahead", () => {
    expect(firstAheadLine("2027-02-01")).toBe("No current cohort. The first cohort opens Mon 1 Feb 2027.");
  });
  it("§0.3 the card", () => {
    expect(cardHeadline(VIEW)).toBe("Cohort starting Mon 1 Feb 2027 · 5 places · 3 taken · 2 left");
    expect(cardHeadline({ ...VIEW, places: 1, taken: 0, left: 1 })).toBe("Cohort starting Mon 1 Feb 2027 · 1 place · 0 taken · 1 left");
  });
  it("§0.2 an upcoming row", () => {
    expect(rowLine({ ...VIEW, taken: 0, left: 5 })).toBe("5 places · 0 taken · 5 left");
  });
  it("§0.6 being paid, §0.10 over by", () => {
    expect(beingPaidLine(1)).toBe("1 being paid now");
    expect(overByLine(1)).toBe("Over by 1");
  });
});

describe("callsSentence — brief §0.3, §0.12", () => {
  it("the exact sentence with 04's counts {8 booked, 4 not booked}", () => {
    expect(callsSentence(2, { kind: "counts", counts: { booked: 8, notBooked: 4 } })).toBe(
      "2 places left and 12 more families to call this week (8 booked · 4 not booked).",
    );
  });
  it("singular forms", () => {
    expect(callsSentence(1, { kind: "counts", counts: { booked: 1, notBooked: 0 } })).toBe(
      "1 place left and 1 more family to call this week (1 booked · 0 not booked).",
    );
  });
  it("not connected: never a stand-in 0", () => {
    const line = callsSentence(2, { kind: "not_connected" });
    expect(line).toBe("Calls: not connected yet");
    expect(line).not.toMatch(/0 more families/);
  });
  it("a read that failed says so, never 0", () => {
    expect(callsSentence(2, { kind: "unavailable" })).toBe("Calls: could not be read");
  });
});

describe("the next cohort's card — brief §0.11", () => {
  it("pre-booked calls", () => {
    expect(preBookedLine({ kind: "count", count: 2 })).toBe("2 pre-booked calls");
    expect(preBookedLine({ kind: "count", count: 1 })).toBe("1 pre-booked call");
    expect(preBookedLine({ kind: "not_connected" })).toBe("Pre-booked calls: not connected yet");
    expect(preBookedLine({ kind: "unavailable" })).toBe("Pre-booked calls: could not be read");
  });
  it("goodwill places taken", () => {
    expect(goodwillLine(2)).toBe("2 goodwill places taken");
    expect(goodwillLine(1)).toBe("1 goodwill place taken");
  });
});

describe("the refusal — brief §0.4", () => {
  it("plural and singular", () => {
    expect(belowTakenMessage(3)).toBe("3 places are already taken or being paid for. Set at least 3.");
    expect(belowTakenMessage(1)).toBe("1 place is already taken or being paid for. Set at least 1.");
  });
});

describe("lines other screens read", () => {
  it("04's call page: placesLeftLine", () => {
    expect(placesLeftLine(VIEW)).toBe("Current cohort: 2 of 5 places left");
  });
  it("the family panel: panelLine for every state", () => {
    expect(panelLine({ kind: "current", view: VIEW })).toBe("Current cohort: starts Mon 1 Feb · 2 of 5 left");
    expect(panelLine({ kind: "first_ahead", first: "2027-02-01" })).toBe("Current cohort: none yet · the first starts Mon 1 Feb");
    expect(panelLine({ kind: "not_set_up" })).toBe("Current cohort: not set up yet");
    expect(panelLine({ kind: "error" })).toBe("Current cohort: could not be read");
    expect(panelLine({ kind: "off" })).toBeNull();
  });
});

describe("a family's row — brief §0.5, §0.8", () => {
  const row = (fields: Partial<FamilyRow>): FamilyRow => ({
    placeId: "p", parentUserId: "u", name: "Sarah Jones", state: "taken", paidBy: "card", isGoodwill: false,
    takenAt: "2027-02-03T10:00:00Z", reopenedAt: null, reopenReason: null, ...fields,
  });
  it("how they paid", () => {
    expect(paidByLabel("card")).toBe("Card");
    expect(paidByLabel("bank_transfer")).toBe("Bank transfer");
    expect(paidByLabel(null)).toBe("—");
  });
  it("its state", () => {
    expect(familyStateLine(row({}))).toBe("Taken");
    expect(familyStateLine(row({ state: "held", paidBy: null }))).toBe("Being paid now");
    expect(familyStateLine(row({ state: "reopened", reopenedAt: "2027-02-03T15:00:00Z", reopenReason: "moved abroad" }))).toBe(
      "Re-opened 3 Feb — moved abroad",
    );
  });
});

describe("the warnings box — brief §0.9, §3.8", () => {
  it("each kind", () => {
    expect(warningLine({ kind: "refunded_but_held", placeId: "p", parentUserId: "u", name: "Sarah Jones", cohortStartDate: "2027-02-01" })).toBe(
      "Deposit refunded but place still held: Sarah Jones",
    );
    expect(warningLine({ kind: "paid_without_place", parentUserId: "u", name: "Sarah Jones" })).toBe("Deposit paid but no place: Sarah Jones");
    expect(warningLine({ kind: "over_capacity", cohortStartDate: "2027-02-01", overBy: 1 })).toBe("Over by 1: cohort starting Mon 1 Feb 2027");
  });
});

describe("action refusals shown on the page", () => {
  it.each([
    ["already_reopened", "Already re-opened"],
    ["cohorts_disabled", "Cohorts are switched off."],
    ["not_authorized", "Admins only."],
    ["past_cohort", "A past cohort can't be changed."],
    ["save_failed", "That didn't save — try again."],
    ["something_new", "That didn't save — try again."],
  ])("%s → %s", (code, message) => {
    expect(actionErrorMessage(code)).toBe(message);
  });
});
