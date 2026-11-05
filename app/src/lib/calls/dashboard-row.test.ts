/**
 * The words on one /admin/calls row (plan C3; brief §0.9, §3 admin 1, 2, 6; BB-wave1-041126/04c1-build). Pure.
 *
 * Every time is labelled London (brief §3 admin 1: staff are not in London; the parent-side "no London time" ruling,
 * §0a.10, is for parents). The four links, the sign-up type, the position summary with "N nannies contacted · N
 * replied", a quick-match family's "No position yet" (no Position link), and the four tags.
 */
import { describe, expect, it } from "vitest";
import {
  ageWords,
  attemptWords,
  contactWords,
  depositStateOf,
  londonDayWords,
  londonLabel,
  positionSummaryOf,
  rowLinks,
  signupTypeOf,
  tagLabel,
  tagsOf,
  type PositionFacts,
} from "./dashboard-row";

const PARENT = "b0400000-0000-4000-8000-000000000001";
const POSITION = "d0400000-0000-4000-8000-000000000001";

const facts = (over: Partial<PositionFacts> = {}): PositionFacts => ({
  id: POSITION,
  parentUserId: PARENT,
  area: "Islington",
  hoursPerWeek: 30,
  daysRequired: ["Monday", "Tuesday", "Thursday"],
  startDate: "2027-03-01",
  createdAt: "2027-02-01T09:00:00.000Z",
  childAgesMonths: [8, 30],
  nanniesContacted: 6,
  nanniesReplied: 2,
  ...over,
});

describe("London labels", () => {
  it("every time reads London, GMT and BST alike, whatever the machine's zone", () => {
    expect(londonLabel("2027-02-09T14:00:00.000Z")).toBe("Tue 9 Feb, 14:00 (London time)");
    expect(londonLabel("2027-07-01T13:00:00.000Z")).toBe("Thu 1 Jul, 14:00 (London time)");
    // 23:30Z in July is 00:30 the next London day.
    expect(londonLabel("2027-07-01T23:30:00.000Z")).toBe("Fri 2 Jul, 00:30 (London time)");
  });

  it("a London date in words", () => {
    expect(londonDayWords("2027-03-01")).toBe("1 March 2027");
    expect(londonDayWords("2027-07-01T23:30:00.000Z")).toBe("2 July 2027");
  });
});

describe("the family", () => {
  it("sign-up type: Quick match, Advanced, or Direct (a cold sign-up, or none recorded)", () => {
    expect(signupTypeOf("standard_match")).toBe("Quick match");
    expect(signupTypeOf("advanced_match")).toBe("Advanced");
    expect(signupTypeOf("direct")).toBe("Direct");
    expect(signupTypeOf(null)).toBe("Direct");
  });

  it("contact: the name, the email, and the mobile in +44 form with a tel: link in E.164", () => {
    const words = contactWords({ userId: PARENT, firstName: "Jane", lastName: "Smith", email: "jane@example.test", mobile: "+447700900123", isTestUser: false });
    expect(words).toEqual({ name: "Jane Smith", email: "jane@example.test", mobile: { href: "tel:+447700900123", text: "+44 (0) 7700 900 123" } });
  });

  it("contact: a national mobile still dials in E.164; no mobile → none; a missing profile → Unknown family", () => {
    expect(contactWords({ userId: PARENT, firstName: "Jane", lastName: "", email: "j@example.test", mobile: "07700900123", isTestUser: false }).mobile).toEqual({
      href: "tel:+447700900123",
      text: "+44 (0) 7700 900 123",
    });
    expect(contactWords({ userId: PARENT, firstName: " ", lastName: "", email: "j@example.test", mobile: null, isTestUser: false })).toEqual({
      name: "j@example.test",
      email: "j@example.test",
      mobile: null,
    });
    expect(contactWords(null)).toEqual({ name: "Unknown family", email: null, mobile: null });
  });

  it("an unusual stored number is shown as stored and dialled without spaces", () => {
    expect(contactWords({ userId: PARENT, firstName: "A", lastName: "B", email: "a@example.test", mobile: "+33 6 12 34 56 78", isTestUser: false }).mobile).toEqual({
      href: "tel:+33612345678",
      text: "+33 6 12 34 56 78",
    });
  });
});

describe("the position", () => {
  it("area, hours a week, days, children's ages, start date, and the nannies line", () => {
    expect(positionSummaryOf(facts())).toEqual({
      positionId: POSITION,
      area: "Islington",
      hours: "30 hours a week",
      days: "Monday, Tuesday, Thursday",
      children: "8 months, 2 years 6 months",
      starts: "Starts 1 March 2027",
      nannies: "6 nannies contacted · 2 replied",
    });
  });

  it("missing facts are left out, never invented", () => {
    expect(positionSummaryOf(facts({ area: null, hoursPerWeek: null, daysRequired: [], startDate: null, childAgesMonths: [], nanniesContacted: 0, nanniesReplied: 0 }))).toEqual({
      positionId: POSITION,
      area: "—",
      hours: null,
      days: null,
      children: null,
      starts: null,
      nannies: "0 nannies contacted · 0 replied",
    });
  });

  it("a quick-match family has no position: null (the row says No position yet)", () => {
    expect(positionSummaryOf(null)).toBeNull();
  });

  it("ages in months and years", () => {
    expect(ageWords(0)).toBe("Under 1 month");
    expect(ageWords(1)).toBe("1 month");
    expect(ageWords(11)).toBe("11 months");
    expect(ageWords(12)).toBe("1 year");
    expect(ageWords(13)).toBe("1 year 1 month");
    expect(ageWords(48)).toBe("4 years");
  });
});

describe("the four links (brief §0.9)", () => {
  it("Profile, Account, Money and Position", () => {
    expect(rowLinks(PARENT, POSITION)).toEqual({
      profile: `/admin/viewer/${PARENT}`,
      account: `/admin/users?openUser=${PARENT}`,
      money: `/admin/users/${PARENT}/subscription`,
      position: `/admin/positions?openPosition=${POSITION}`,
    });
  });

  it("no position → no Position link", () => {
    expect(rowLinks(PARENT, null).position).toBeNull();
  });

  it("ids are encoded", () => {
    expect(rowLinks("a b", "c/d")).toMatchObject({ profile: "/admin/viewer/a%20b", position: "/admin/positions?openPosition=c%2Fd" });
  });
});

describe("the tags (brief §3 admin 6)", () => {
  it("in a fixed order, only those that apply", () => {
    expect(tagsOf({ blockedOver: true, overdue: true, cohortPrebook: true, test: true })).toEqual(["blocked_over", "overdue", "cohort_prebook", "test"]);
    expect(tagsOf({ blockedOver: false, overdue: false, cohortPrebook: true, test: false })).toEqual(["cohort_prebook"]);
    expect(tagsOf({ blockedOver: false, overdue: false, cohortPrebook: false, test: false })).toEqual([]);
  });

  it("their words", () => {
    expect(["blocked_over", "overdue", "cohort_prebook", "test"].map((t) => tagLabel(t as Parameters<typeof tagLabel>[0]))).toEqual([
      "Blocked over — move or cancel",
      "Overdue",
      "Cohort pre-book",
      "Test",
    ]);
  });
});

describe("an attempt in words", () => {
  it("the result, with the outcome when answered; Stop calling alone", () => {
    expect(attemptWords({ result: "no_answer", outcome: null })).toBe("No answer");
    expect(attemptWords({ result: "voicemail", outcome: null })).toBe("Voicemail left");
    expect(attemptWords({ result: "answered", outcome: "deposit_taken" })).toBe("Answered · Deposit taken");
    expect(attemptWords({ result: "answered", outcome: null })).toBe("Answered");
    expect(attemptWords({ result: null, outcome: "stop_calling" })).toBe("Stop calling");
    expect(attemptWords({ result: "wrong_number", outcome: "stop_calling" })).toBe("Wrong number · Stop calling");
  });
});

describe("the deposit (read-only, brief §3 admin 2)", () => {
  it("none, paid, refunded, placed", () => {
    expect(depositStateOf(null)).toEqual({ kind: "none" });
    expect(depositStateOf({ status: "trial", depositPaidAt: null, depositRefundedAt: null })).toEqual({ kind: "none" });
    expect(depositStateOf({ status: "deposit_paid", depositPaidAt: "2027-02-03T10:00:00.000Z", depositRefundedAt: null })).toEqual({ kind: "paid", on: "3 February 2027" });
    expect(depositStateOf({ status: "deposit_paid", depositPaidAt: "2027-02-03T10:00:00.000Z", depositRefundedAt: "2027-02-05T10:00:00.000Z" })).toEqual({
      kind: "refunded",
      on: "5 February 2027",
    });
    expect(depositStateOf({ status: "placed", depositPaidAt: "2027-02-03T10:00:00.000Z", depositRefundedAt: null })).toEqual({ kind: "placed" });
  });
});
