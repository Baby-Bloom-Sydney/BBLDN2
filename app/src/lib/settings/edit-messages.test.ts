/**
 * The three messages every Settings edit page shares (ledger B06 §9.1 R1), exactly as agreed.
 *
 * BB-wave1-041126/06b3-rework, 2026-11-09.
 */
import { describe, expect, it } from "vitest";
import { EDIT_MESSAGES } from "./edit-messages";
import { checkProfileInput, PROFILE_MESSAGES as M } from "./nanny-profile-rules";

describe("EDIT_MESSAGES", () => {
  it("are BAI's wording", () => {
    expect(EDIT_MESSAGES).toEqual({
      checkMarked: "Please check the details marked below.",
      stale: "These details were changed elsewhere. The latest are now showing.",
      gaveUp: "We couldn't save that. Please try again.",
      discardTitle: "Discard your changes?",
    });
  });
});

describe("checkProfileInput (what the page and the action both run)", () => {
  it("checks only the fields sent, by field", () => {
    expect(checkProfileInput({})).toEqual({});
    expect(checkProfileInput({ mobile_number: "x" })).toEqual({ mobile: M.mobile });
    expect(checkProfileInput({ first_name: "Sophie", last_name: "", date_of_birth: "1995-02-30", address: null })).toEqual({
      lastName: M.lastName, dateOfBirth: M.dateOfBirth, address: M.address,
    });
  });
});
