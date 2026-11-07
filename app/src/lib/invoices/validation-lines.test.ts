/**
 * An invoice draft is a header plus lines (plan 06 §14.1, b2.3): the shared zod schema the form (06b-4), the actions
 * and the store all parse with. Kinds; quarter-hour steps; at most 24 h a shift and a date; the typo ceilings; the
 * counts; at least one shift; dates in the week (or on the trial date), never in the future; the five expense types;
 * one-line descriptions of 120 characters or fewer. No message ever echoes what was typed. Rates positionally.
 *
 * BB-wave1-041126/06b2-build, 2026-11-06.
 */
import { describe, expect, it } from "vitest";
import { invoiceDraftSchema, invoiceLineSchema, LINE_MESSAGES as M } from "./validation-lines";

const NOW = new Date("2027-02-15T10:00:00Z"); // Monday 15 Feb 2027, London
const WEEK = "2027-02-08";
const shift = (date: string, hours: number, ratePence: number, description?: string | null) =>
  ({ kind: "shift", date, hours, ratePence, ...(description === undefined ? {} : { description }) });
const expense = (expenseType: string, amountPence: number, description?: string | null) =>
  ({ kind: "expense", expenseType, amountPence, ...(description === undefined ? {} : { description }) });
const EXAMPLE = [
  shift("2027-02-08", 6, 1800), shift("2027-02-09", 6, 1800), shift("2027-02-10", 6, 1800), shift("2027-02-11", 6, 1800),
  shift("2027-02-12", 6, 1800), shift("2027-02-10", 2, 2200, "evening, agreed rate"), expense("activities", 1250, "Soft play"),
];
const DRAFT = {
  invoiceId: "0b6a0000-0000-4000-8000-000000000001",
  kind: "regular_week",
  targetId: "0b6a0000-0000-4000-8000-000000000411",
  periodStart: WEEK,
  lines: EXAMPLE,
  replacesInvoiceId: null,
};
const schema = invoiceDraftSchema(NOW);

function messagesOf(value: unknown): string[] {
  const result = schema.safeParse(value);
  return result.success ? [] : result.error.issues.map((i) => i.message);
}

describe("invoiceDraftSchema — the worked example", () => {
  it("accepts it, keeping the lines in her order, descriptions trimmed and blanks as null", () => {
    const parsed = schema.parse({ ...DRAFT, lines: [...EXAMPLE.slice(0, 5), shift("2027-02-10", 2, 2200, "  evening, agreed rate  "), expense("activities", 1250, "   ")] });
    expect(parsed.lines.map((l) => l.kind)).toEqual(["shift", "shift", "shift", "shift", "shift", "shift", "expense"]);
    expect(parsed.lines[0]).toEqual({ kind: "shift", date: "2027-02-08", hours: 6, ratePence: 1800, description: null });
    expect(parsed.lines[5]).toEqual({ kind: "shift", date: "2027-02-10", hours: 2, ratePence: 2200, description: "evening, agreed rate" });
    expect(parsed.lines[6]).toEqual({ kind: "expense", expenseType: "activities", amountPence: 1250, description: null });
  });

  it("allows two shifts on one date at different rates, and the current week up to today", () => {
    expect(schema.safeParse({ ...DRAFT, lines: [shift("2027-02-10", 6, 1800), shift("2027-02-10", 2, 2200)] }).success).toBe(true);
    expect(schema.safeParse({ ...DRAFT, periodStart: "2027-02-15", lines: [shift("2027-02-15", 8, 1800)] }).success).toBe(true);
  });

  it("a Trial Shift is invoiced on its date", () => {
    const trial = { ...DRAFT, kind: "trial_shift", periodStart: "2027-02-03", lines: [shift("2027-02-03", 4, 1800), expense("travel", 640)] };
    expect(schema.safeParse(trial).success).toBe(true);
    expect(messagesOf({ ...trial, lines: [shift("2027-02-04", 4, 1800)] })).toContain(M.trialDate);
  });
});

describe("invoiceDraftSchema — the header", () => {
  it.each([
    ["a Wednesday week", { periodStart: "2027-02-10", lines: [shift("2027-02-10", 6, 1800)] }, M.monday],
    ["next week", { periodStart: "2027-02-22", lines: [shift("2027-02-22", 6, 1800)] }, M.future],
    ["not a date", { periodStart: "2027-02-30" }, M.date],
    ["a meet-and-greet", { kind: "meet_and_greet" }, M.kind],
    ["no family", { targetId: "hartley" }, M.family],
    ["a bad correction link", { replacesInvoiceId: "BB-SophieTaylor-270215-0001" }, M.invalid],
    ["no invoice id", { invoiceId: undefined }, M.invalid],
    ["no lines at all", { lines: undefined }, M.noShift],
  ])("refuses %s", (_label, change, message) => {
    expect(messagesOf({ ...DRAFT, ...change })).toContain(message);
  });
});

describe("invoiceDraftSchema — a malformed week never throws (review: TS H1, code M1)", () => {
  it.each(["", "x", "15/02/2027", "2027-2-8"])("a period of %j is refused as a date, for both kinds, without a spurious 'future'", (periodStart) => {
    for (const kind of ["regular_week", "trial_shift"]) {
      const messages = messagesOf({ ...DRAFT, kind, periodStart });
      expect(messages).toContain(M.date);
      expect(messages).not.toContain(M.future);
    }
  });

  it("0 hours is one message, not two", () => {
    expect(messagesOf({ ...DRAFT, lines: [shift(WEEK, 0, 1800)] })).toEqual([M.hours]);
  });

  it("49 lines say how many lines an invoice can hold", () => {
    expect(messagesOf({ ...DRAFT, lines: Array.from({ length: 49 }, () => expense("food", 100)) })).toContain(M.tooManyLines);
  });
});

describe("invoiceDraftSchema — the lines", () => {
  it.each([
    ["only an expense", [expense("food", 500)], M.noShift],
    ["a date after the week", [shift("2027-02-15", 6, 1800)], M.shiftDate],
    ["a date before the week", [shift("2027-02-07", 6, 1800)], M.shiftDate],
    ["a day that doesn't exist", [shift("2027-02-30", 6, 1800)], M.date],
    ["0 hours", [shift(WEEK, 0, 1800)], M.hours],
    ["0.1 hours", [shift(WEEK, 0.1, 1800)], M.hourStep],
    ["24.25 hours", [shift(WEEK, 24.25, 1800)], M.shiftHoursMax],
    ["hours as text", [{ ...shift(WEEK, 6, 1800), hours: "6" }], M.hours],
    ["two shifts on one date over 24 hours", [shift(WEEK, 12, 1800), shift(WEEK, 12.25, 1800)], M.dayHoursMax],
    ["a rate of nothing", [shift(WEEK, 6, 0)], M.rate],
    ["a rate over the typo ceiling", [shift(WEEK, 6, 25_001)], M.rate],
    ["a rate in part pence", [shift(WEEK, 6, 1800.5)], M.rate],
    ["an expense of nothing", [shift(WEEK, 6, 1800), expense("food", 0)], M.expenseAmount],
    ["an expense over the typo ceiling", [shift(WEEK, 6, 1800), expense("food", 100_001)], M.expenseAmount],
    ["an unknown expense type", [shift(WEEK, 6, 1800), expense("toys", 500)], M.expenseType],
    ["an unknown kind", [shift(WEEK, 6, 1800), { kind: "bonus", amountPence: 500 }], M.invalid],
    ["a description of 121 characters", [shift(WEEK, 6, 1800, "d".repeat(121))], M.tooLong],
    ["a description with a line break", [shift(WEEK, 6, 1800, "lunch\npark")], M.oneLine],
    ["a description with a control character", [shift(WEEK, 6, 1800, `lunch${String.fromCodePoint(7)}`)], M.oneLine],
    ["a description with a zero-width space", [shift(WEEK, 6, 1800, `lunch${String.fromCodePoint(0x200b)}park`)], M.oneLine],
  ])("refuses %s", (_label, lines, message) => {
    expect(messagesOf({ ...DRAFT, lines })).toContain(message);
  });

  it("refuses a shift later this week than today, and a Trial Shift dated tomorrow", () => {
    const wednesday = new Date("2027-02-17T10:00:00Z");
    const thisWeek = { ...DRAFT, periodStart: "2027-02-15", lines: [shift("2027-02-15", 6, 1800), shift("2027-02-18", 6, 1800)] };
    expect(invoiceDraftSchema(wednesday).safeParse(thisWeek).error?.issues.map((i) => i.message)).toContain(M.future);
    const trial = { ...DRAFT, kind: "trial_shift", periodStart: "2027-02-18", lines: [shift("2027-02-18", 4, 1800)] };
    expect(invoiceDraftSchema(wednesday).safeParse(trial).error?.issues.map((i) => i.message)).toContain(M.future);
  });

  it("allows the edges: 0.25 h, 24 h, 1 p, 25,000 p an hour; an expense of 1 p or 100,000 p", () => {
    for (const lines of [[shift(WEEK, 0.25, 1800)], [shift(WEEK, 24, 1800)], [shift(WEEK, 6, 1)], [shift(WEEK, 6, 25_000)],
      [shift(WEEK, 6, 1800), expense("other", 1)], [shift(WEEK, 6, 1800), expense("supplies", 100_000)], [shift(WEEK, 12, 1800), shift(WEEK, 12, 1800)]]) {
      expect(schema.safeParse({ ...DRAFT, lines }).success).toBe(true);
    }
  });

  it("counts: at most 28 shifts and 20 expenses (two PDF pages); exactly that many is allowed", () => {
    const days = ["2027-02-08", "2027-02-09", "2027-02-10", "2027-02-11", "2027-02-12", "2027-02-13", "2027-02-14"];
    const shifts = (n: number) => Array.from({ length: n }, (_, i) => shift(days[i % 7], 6, 1800));
    const expenses = (n: number) => Array.from({ length: n }, () => expense("food", 100));
    expect(schema.safeParse({ ...DRAFT, lines: [...shifts(28), ...expenses(20)] }).success).toBe(true);
    expect(messagesOf({ ...DRAFT, lines: [...shifts(28).map((s) => ({ ...s, hours: 0.25 })), shift(WEEK, 0.25, 1800)] })).toContain(M.tooManyShifts);
    expect(messagesOf({ ...DRAFT, lines: [...shifts(1), ...expenses(21)] })).toContain(M.tooManyExpenses);
  });

  it("takes each of the five expense types", () => {
    for (const type of ["food", "activities", "travel", "supplies", "other"]) {
      expect(schema.safeParse({ ...DRAFT, lines: [shift(WEEK, 6, 1800), expense(type, 500)] }).success).toBe(true);
    }
  });

  it("keeps quarter hours exact: 0.1 + 0.15 is 0.25; a sum that drifts off a quarter is refused", () => {
    const parsed = schema.parse({ ...DRAFT, lines: [shift(WEEK, 0.1 + 0.15, 1800)] });
    expect(parsed.lines[0]).toMatchObject({ hours: 0.25 });
    expect(messagesOf({ ...DRAFT, lines: [shift(WEEK, 0.7 * 3, 1800)] })).toContain(M.hourStep); // 2.0999…
  });

  it("never echoes what was typed in any message", () => {
    const typed = [shift("2027-13-45", 999.123, 987_654, "Secret note 8765"), expense("toys", 123_456_789, "Hidden 4321")];
    const all = messagesOf({ ...DRAFT, lines: typed }).join(" | ");
    expect(all).not.toMatch(/999|987|654|Secret|8765|toys|123|456|789|Hidden|4321|2027-13/);
  });
});

describe("invoiceLineSchema", () => {
  it("is one line, by kind", () => {
    expect(invoiceLineSchema.parse(shift(WEEK, 8.75, 1800))).toEqual({ kind: "shift", date: WEEK, hours: 8.75, ratePence: 1800, description: null });
    expect(invoiceLineSchema.safeParse({ kind: "shift" }).success).toBe(false);
    expect(invoiceLineSchema.safeParse("a line").success).toBe(false);
  });
});
