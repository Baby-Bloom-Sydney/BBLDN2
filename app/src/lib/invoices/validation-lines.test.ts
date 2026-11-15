/**
 * An invoice draft is a family and its lines (plan 06 §14.1, b2.3; 06b-4 rework, BAI 2026-11-12: no week, no kind):
 * the shared zod schema the form, the actions and the store all parse with. Quarter-hour steps; at most 24 h a shift
 * and a date; the typo ceilings; the counts (100 shifts, 40 expenses, at least one line); each shift on its own real
 * date, never in the future; the five expense types; one-line descriptions of 120 characters or fewer. No message
 * ever echoes what was typed. The period is the earliest to the latest shift date, or the send date with none.
 *
 * BB-wave1-041126/06b2-build, 2026-11-06; BB-wave1-041126/06b4-server, 2026-11-12.
 */
import { describe, expect, it } from "vitest";
import { hasTooManyLines, invoiceDraftSchema, invoiceLineSchema, invoicePeriodOf, LINE_MESSAGES as M, type InvoiceLine } from "./validation-lines";

const NOW = new Date("2027-02-15T10:00:00Z"); // Monday 15 Feb 2027, London
const DAY = "2027-02-08";
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
  targetId: "0b6a0000-0000-4000-8000-000000000411",
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

  it("is a family, its lines and any correction: no kind and no period (they are worked out)", () => {
    const parsed = schema.parse({ ...DRAFT, kind: "trial_shift", periodStart: "2027-02-01" });
    expect(Object.keys(parsed).sort()).toEqual(["invoiceId", "lines", "replacesInvoiceId", "targetId"]);
  });

  it("allows two shifts on one date at different rates, and today", () => {
    expect(schema.safeParse({ ...DRAFT, lines: [shift("2027-02-10", 6, 1800), shift("2027-02-10", 2, 2200)] }).success).toBe(true);
    expect(schema.safeParse({ ...DRAFT, lines: [shift("2027-02-15", 8, 1800)] }).success).toBe(true);
  });

  it("takes shifts over any length of time, in any order (BAI: 'there is no reason to limit this')", () => {
    const lines = [shift("2027-02-15", 8, 1800), shift("2026-01-05", 4, 1800), shift("2026-11-30", 6, 1800)];
    expect(schema.safeParse({ ...DRAFT, lines }).success).toBe(true);
  });

  it("takes an invoice of expenses only (BAI: 'at least one shift/expense')", () => {
    expect(schema.safeParse({ ...DRAFT, lines: [expense("travel", 640)] }).success).toBe(true);
  });
});

describe("invoiceDraftSchema — the header", () => {
  it.each([
    ["no family", { targetId: "hartley" }, M.family],
    ["a bad correction link", { replacesInvoiceId: "BB-SophieTaylor-270215-0001" }, M.invalid],
    ["no invoice id", { invoiceId: undefined }, M.invalid],
    ["no lines at all", { lines: undefined }, M.noLine],
    ["an empty invoice", { lines: [] }, M.noLine],
  ])("refuses %s", (_label, change, message) => {
    expect(messagesOf({ ...DRAFT, ...change })).toContain(message);
  });

  it("0 hours is one message, not two", () => {
    expect(messagesOf({ ...DRAFT, lines: [shift(DAY, 0, 1800)] })).toEqual([M.hours]);
  });

  it("141 lines say how many lines an invoice can hold", () => {
    expect(messagesOf({ ...DRAFT, lines: Array.from({ length: 141 }, () => expense("food", 100)) })).toContain(M.tooManyLines);
  });
});

describe("invoiceDraftSchema — the lines", () => {
  it.each([
    ["a day that doesn't exist", [shift("2027-02-30", 6, 1800)], M.date],
    ["a date that isn't one", [shift("15/02/2027", 6, 1800)], M.date],
    ["0 hours", [shift(DAY, 0, 1800)], M.hours],
    ["0.1 hours", [shift(DAY, 0.1, 1800)], M.hourStep],
    ["24.25 hours", [shift(DAY, 24.25, 1800)], M.shiftHoursMax],
    ["hours as text", [{ ...shift(DAY, 6, 1800), hours: "6" }], M.hours],
    ["two shifts on one date over 24 hours", [shift(DAY, 12, 1800), shift(DAY, 12.25, 1800)], M.dayHoursMax],
    ["a rate of nothing", [shift(DAY, 6, 0)], M.rate],
    ["a rate over the typo ceiling", [shift(DAY, 6, 25_001)], M.rate],
    ["a rate in part pence", [shift(DAY, 6, 1800.5)], M.rate],
    ["an expense of nothing", [shift(DAY, 6, 1800), expense("food", 0)], M.expenseAmount],
    ["an expense over the typo ceiling", [shift(DAY, 6, 1800), expense("food", 100_001)], M.expenseAmount],
    ["an unknown expense type", [shift(DAY, 6, 1800), expense("toys", 500)], M.expenseType],
    ["an unknown kind", [shift(DAY, 6, 1800), { kind: "bonus", amountPence: 500 }], M.invalid],
    ["a description of 121 characters", [shift(DAY, 6, 1800, "d".repeat(121))], M.tooLong],
    ["a description with a line break", [shift(DAY, 6, 1800, "lunch\npark")], M.oneLine],
    ["a description with a control character", [shift(DAY, 6, 1800, `lunch${String.fromCodePoint(7)}`)], M.oneLine],
    ["a description with a zero-width space", [shift(DAY, 6, 1800, `lunch${String.fromCodePoint(0x200b)}park`)], M.oneLine],
  ])("refuses %s", (_label, lines, message) => {
    expect(messagesOf({ ...DRAFT, lines })).toContain(message);
  });

  it("refuses a shift dated after today, on its own date's path, with the `future` issue code", () => {
    const result = schema.safeParse({ ...DRAFT, lines: [shift("2027-02-15", 6, 1800), shift("2027-02-16", 6, 1800)] });
    expect(result.success).toBe(false);
    const issue = result.error?.issues.find((i) => i.message === M.future);
    expect(issue?.path).toEqual(["lines", 1, "date"]);
    expect(issue?.code === "custom" ? issue.params?.issue : null).toBe("future");
  });

  it("a date that isn't one is refused as a date, never as a spurious 'future' (review TS H1)", () => {
    for (const date of ["2027-02-31", "2027-13-01", "9999-99-99"]) {
      const messages = messagesOf({ ...DRAFT, lines: [shift(date, 6, 1800)] });
      expect(messages).toContain(M.date);
      expect(messages).not.toContain(M.future);
    }
  });

  it("'today' is London's: 23:30 on Sunday in summer is still Sunday", () => {
    const sundayLateBst = new Date("2027-06-13T22:30:00Z");
    expect(invoiceDraftSchema(sundayLateBst).safeParse({ ...DRAFT, lines: [shift("2027-06-13", 6, 1800)] }).success).toBe(true);
    expect(invoiceDraftSchema(sundayLateBst).safeParse({ ...DRAFT, lines: [shift("2027-06-14", 6, 1800)] }).success).toBe(false);
  });

  it("puts a date's 24-hour message on the shift that goes over", () => {
    const result = schema.safeParse({ ...DRAFT, lines: [shift(DAY, 12, 1800), shift("2027-02-09", 12, 1800), shift(DAY, 12.25, 1800)] });
    expect(result.error?.issues.map((i) => [i.path.join("."), i.message])).toEqual([["lines.2.hours", M.dayHoursMax]]);
  });

  it("allows the edges: 0.25 h, 24 h, 1 p, 25,000 p an hour; an expense of 1 p or 100,000 p", () => {
    for (const lines of [[shift(DAY, 0.25, 1800)], [shift(DAY, 24, 1800)], [shift(DAY, 6, 1)], [shift(DAY, 6, 25_000)],
      [shift(DAY, 6, 1800), expense("other", 1)], [shift(DAY, 6, 1800), expense("supplies", 100_000)], [shift(DAY, 12, 1800), shift(DAY, 12, 1800)]]) {
      expect(schema.safeParse({ ...DRAFT, lines }).success).toBe(true);
    }
  });

  it("counts: at most 100 shifts and 40 expenses (a page-size bound); exactly that many is allowed", () => {
    const dates = Array.from({ length: 100 }, (_, i) => new Date(Date.UTC(2026, 10, 7 + i)).toISOString().slice(0, 10));
    const shifts = (n: number) => Array.from({ length: n }, (_, i) => shift(dates[i % 100] ?? DAY, 24, 1800));
    const expenses = (n: number) => Array.from({ length: n }, () => expense("food", 100));
    expect(dates.at(-1)).toBe("2027-02-14");
    expect(schema.safeParse({ ...DRAFT, lines: [...shifts(100), ...expenses(40)] }).success).toBe(true);
    expect(messagesOf({ ...DRAFT, lines: [...shifts(100).map((s) => ({ ...s, hours: 0.25 })), shift(DAY, 0.25, 1800)] })).toContain(M.tooManyShifts);
    expect(messagesOf({ ...DRAFT, lines: [...shifts(1), ...expenses(41)] })).toContain(M.tooManyExpenses);
    expect(messagesOf({ ...DRAFT, lines: expenses(41) })).toContain(M.tooManyExpenses);
  });

  it("takes each of the five expense types", () => {
    for (const type of ["food", "activities", "travel", "supplies", "other"]) {
      expect(schema.safeParse({ ...DRAFT, lines: [shift(DAY, 6, 1800), expense(type, 500)] }).success).toBe(true);
    }
  });

  it("keeps quarter hours exact: 0.1 + 0.15 is 0.25; a sum that drifts off a quarter is refused", () => {
    const parsed = schema.parse({ ...DRAFT, lines: [shift(DAY, 0.1 + 0.15, 1800)] });
    expect(parsed.lines[0]).toMatchObject({ hours: 0.25 });
    expect(messagesOf({ ...DRAFT, lines: [shift(DAY, 0.7 * 3, 1800)] })).toContain(M.hourStep); // 2.0999…
  });

  it("never echoes what was typed in any message", () => {
    const typed = [shift("2027-13-45", 999.123, 987_654, "Secret note 8765"), expense("toys", 123_456_789, "Hidden 4321")];
    const all = messagesOf({ ...DRAFT, lines: typed }).join(" | ");
    expect(all).not.toMatch(/999|987|654|Secret|8765|toys|123|456|789|Hidden|4321|2027-13/);
  });

  it("the messages name the limits from config and never a week or a Trial Shift", () => {
    expect(M.tooManyShifts).toBe("An invoice can have at most 100 shifts");
    expect(M.tooManyExpenses).toBe("An invoice can have at most 40 expenses");
    expect(M.tooManyLines).toBe("An invoice can have at most 140 lines");
    expect(Object.values(M).join(" ")).not.toMatch(/week|Trial Shift|Monday/i);
  });
});

describe("invoicePeriodOf (ledger readings 3, 7; spec d, g)", () => {
  const TODAY = "2027-02-15";
  const lines = (...ls: readonly unknown[]): InvoiceLine[] => ls.map((l) => invoiceLineSchema.parse(l));

  it("is the earliest to the latest shift date, whatever her order", () => {
    const mixed = lines(shift("2027-02-10", 6, 1800), shift("2027-01-29", 6, 1800), expense("food", 100), shift("2027-02-02", 6, 1800));
    expect(invoicePeriodOf(mixed, TODAY)).toEqual({ start: "2027-01-29", end: "2027-02-10" });
  });

  it("is one day for shifts on one date", () => {
    expect(invoicePeriodOf(lines(shift(DAY, 6, 1800), shift(DAY, 2, 2200)), TODAY)).toEqual({ start: DAY, end: DAY });
  });

  it("is today for an invoice of expenses only (its send date)", () => {
    expect(invoicePeriodOf(lines(expense("travel", 640)), TODAY)).toEqual({ start: TODAY, end: TODAY });
  });

  it("refuses a 'today' that isn't a date", () => {
    expect(() => invoicePeriodOf([], "15/02/2027")).toThrow(RangeError);
  });
});

describe("hasTooManyLines (checked before the schema, so a huge payload is never parsed line by line: security review M)", () => {
  it("true only for an object whose lines are an array of more than 140", () => {
    expect(hasTooManyLines({ lines: Array.from({ length: 141 }, () => null) })).toBe(true);
    expect(hasTooManyLines({ lines: Array.from({ length: 10_000 }, () => "junk") })).toBe(true);
    expect(hasTooManyLines({ lines: Array.from({ length: 140 }, () => null) })).toBe(false);
    for (const input of [{ lines: "x".repeat(200) }, { lines: undefined }, {}, null, "lines", [], 42]) expect(hasTooManyLines(input)).toBe(false);
  });
});

describe("invoiceLineSchema", () => {
  it("is one line, by kind", () => {
    expect(invoiceLineSchema.parse(shift(DAY, 8.75, 1800))).toEqual({ kind: "shift", date: DAY, hours: 8.75, ratePence: 1800, description: null });
    expect(invoiceLineSchema.safeParse({ kind: "shift" }).success).toBe(false);
    expect(invoiceLineSchema.safeParse("a line").success).toBe(false);
  });
});
