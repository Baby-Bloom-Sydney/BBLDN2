/**
 * The new-invoice form's model (plan 06 §14.3, §14.5, §14.6 b4.4; brief §0a A, §3 nanny 3–5; 06b-4 rework, BAI
 * 2026-11-12: no week, no kind, start empty). Pure, client-safe:
 * - **Money as she types it** ("18", "18.5", "£18.50", "1,250") in whole pence with no float maths; anything else is
 *   NaN, so the shared schema refuses it with its plain message. Pence back to the field's text ("18.00").
 * - **The draft** the actions take: the family's link id, shifts then expenses in her order, and any correction — no
 *   kind and no period; hours and amounts as numbers.
 * - **Live totals** from `totals.ts` over the rows that are complete, with her VAT setting; a line's amount.
 * - **A new shift row:** the date given (blank from "Add shift"; the same date from "Add another shift this day"),
 *   hours blank, the family's rate. **A correction's rows:** its stored lines, each with its own date.
 * - **Refusals by path** ("lines.2.hours") mapped onto her rows ("expenses.0.amount") and the form.
 * - **The local check:** the shared schema, then a date before the family's earliest date (`tooEarly`), by field.
 *
 * BB-wave1-041126/06b4, 2026-11-12; BB-wave1-041126/06b4-ui, 2026-11-12 (rework).
 */
import { describe, expect, it } from "vitest";
import { LINE_MESSAGES } from "@/lib/invoices/validation-lines";
import {
  correctionRows,
  draftOf,
  formIssues,
  lineAmountText,
  liveTotals,
  localCheck,
  newShiftRow,
  penceOfPounds,
  poundsOfPence,
  type InvoiceFormValues,
} from "./invoice-form";

const RATE = 1800;
const TARGET = "b0600000-0000-4000-8000-000000000411";
const HEADER = { targetId: TARGET, replacesInvoiceId: null };
const shiftRow = (date: string, hours: string, rate = "18.00", description = "") => ({ date, hours, rate, description });
const values = (over: Partial<InvoiceFormValues> = {}): InvoiceFormValues => ({ shifts: [shiftRow("2027-02-08", "6")], expenses: [], ...over });

describe("money as she types it", () => {
  it.each([["18", 1800], ["18.5", 1850], ["18.50", 1850], ["0.01", 1], [" £18.00 ", 1800], ["1,250", 125000], ["250", 25000]])("%j → %i pence", (text, pence) => {
    expect(penceOfPounds(text)).toBe(pence);
  });
  it.each(["", " ", "18.505", "-1", "18.", ".5", "abc", "1e3", "18,50", "£", "18 00"])("%j → NaN", (text) => {
    expect(penceOfPounds(text)).toBeNaN();
  });
  it("pence back to the field's text, no float drift", () => {
    expect(poundsOfPence(1800)).toBe("18.00");
    expect(poundsOfPence(1)).toBe("0.01");
    expect(poundsOfPence(2055)).toBe("20.55");
    expect(poundsOfPence(null)).toBe("");
  });
});

describe("draftOf", () => {
  it("the family's link id, shifts then expenses in her order, any correction — no kind, no period", () => {
    const draft = draftOf(
      { targetId: "t", replacesInvoiceId: "r" },
      values({
        shifts: [shiftRow("2027-02-10", "6"), shiftRow("2027-01-29", " 2 ", "22", "evening, agreed rate")],
        expenses: [{ expenseType: "activities", amount: "12.50", description: "" }],
      }),
    );
    expect(draft).toEqual({
      targetId: "t", replacesInvoiceId: "r",
      lines: [
        { kind: "shift", date: "2027-02-10", hours: 6, ratePence: RATE, description: "" },
        { kind: "shift", date: "2027-01-29", hours: 2, ratePence: 2200, description: "evening, agreed rate" },
        { kind: "expense", expenseType: "activities", amountPence: 1250, description: "" },
      ],
    });
  });

  it("hours: plain decimals only — not exponents, hex or binary (code review L)", () => {
    const hoursOf = (text: string) => draftOf(HEADER, values({ shifts: [shiftRow("2027-02-08", text)] })).lines[0];
    for (const text of ["1e1", "0x10", "0b11", "7.5e0", "+7", "-7", "7.", ".", "Infinity", "7 5"]) expect(hoursOf(text)).toMatchObject({ hours: Number.NaN });
    expect(hoursOf(" 7.75 ")).toMatchObject({ hours: 7.75 });
    expect(hoursOf(".25")).toMatchObject({ hours: 0.25 });
    expect(hoursOf("8")).toMatchObject({ hours: 8 });
  });

  it("blank or unreadable hours and amounts are NaN (the schema's plain messages refuse them)", () => {
    const draft = draftOf(HEADER, values({ shifts: [shiftRow("", "", "x")], expenses: [{ expenseType: "", amount: "", description: "" }] }));
    expect(draft.lines[0]).toMatchObject({ date: "", hours: Number.NaN, ratePence: Number.NaN });
    expect(draft.lines[1]).toMatchObject({ amountPence: Number.NaN, expenseType: "" });
  });
});

describe("live totals and line amounts", () => {
  const worked = values({
    shifts: ["08", "09", "10", "11", "12"].map((d) => shiftRow(`2027-02-${d}`, "6")).concat([shiftRow("2027-02-10", "2", "22", "evening")]),
    expenses: [{ expenseType: "activities", amount: "12.50", description: "" }],
  });

  it("the worked example (14.5): no VAT £596.50; VAT added £713.30; VAT included £596.50 with £97.33 inside", () => {
    expect(liveTotals(worked, { mode: "none", rateBp: null })).toMatchObject({ hours: 32, shiftsPence: 58400, expensesPence: 1250, vatPence: 0, totalPence: 59650 });
    expect(liveTotals(worked, { mode: "added", rateBp: 2000 })).toMatchObject({ vatPence: 11680, totalPence: 71330 });
    expect(liveTotals(worked, { mode: "included", rateBp: 2000 })).toMatchObject({ vatPence: 9733, totalPence: 59650 });
  });

  it("rows not complete yet count as nothing (no throw while she types); a blank date isn't complete", () => {
    const typing = values({
      shifts: [shiftRow("2027-02-08", "6"), shiftRow("2027-02-09", "7.1"), shiftRow("2027-02-10", "", ""), shiftRow("", "4")],
      expenses: [{ expenseType: "food", amount: "4.", description: "" }],
    });
    expect(liveTotals(typing, { mode: "none", rateBp: null })).toMatchObject({ hours: 6, shiftsPence: 10800, expensesPence: 0, totalPence: 10800 });
  });

  it("expenses only: no hours, no childcare", () => {
    const only = values({ shifts: [], expenses: [{ expenseType: "travel", amount: "8.40", description: "" }] });
    expect(liveTotals(only, { mode: "added", rateBp: 2000 })).toMatchObject({ hours: 0, shiftsPence: 0, vatPence: 0, expensesPence: 840, totalPence: 840 });
  });

  it("a line's amount, or a dash while it isn't complete", () => {
    expect(lineAmountText(shiftRow("2027-02-08", "0.75", "18.01"))).toBe("£13.51");
    expect(lineAmountText(shiftRow("2027-02-08", "", "18"))).toBe("—");
    expect(lineAmountText(shiftRow("2027-02-08", "25", "18"))).toBe("—");
  });
});

describe("new rows and a correction's rows", () => {
  it("a new shift: the date given, hours blank, the family's rate (blank when it has none)", () => {
    expect(newShiftRow("", RATE)).toEqual(shiftRow("", ""));
    expect(newShiftRow("2027-02-10", RATE)).toEqual(shiftRow("2027-02-10", ""));
    expect(newShiftRow("", null)).toEqual(shiftRow("", "", ""));
  });

  it("a correction: its shifts with their own dates, hours, rates and descriptions; its expenses", () => {
    expect(correctionRows({
      shifts: [
        { date: "2027-02-08", hours: 7.75, ratePence: RATE, description: null },
        { date: "2027-01-29", hours: 2, ratePence: 2200, description: "evening" },
        { date: "2027-01-30", hours: null, ratePence: null, description: null },
      ],
      expenses: [{ expenseType: "activities", amountPence: 1250, description: null }, { expenseType: "travel", amountPence: 840, description: "bus" }],
    })).toEqual({
      shifts: [shiftRow("2027-02-08", "7.75"), shiftRow("2027-01-29", "2", "22.00", "evening"), shiftRow("2027-01-30", "", "")],
      expenses: [{ expenseType: "activities", amount: "12.50", description: "" }, { expenseType: "travel", amount: "8.40", description: "bus" }],
    });
  });
});

describe("refusals by path, onto her rows", () => {
  it("lines → shifts or expenses by index; whole-draft issues → the form", () => {
    expect(formIssues({
      "lines.1.hours": "Enter the hours in quarter-hour steps, like 7.75",
      "lines.0.ratePence": "rate message",
      "lines.0.date": LINE_MESSAGES.tooEarly,
      "lines.2.amountPence": "amount message",
      "lines.2.expenseType": "type message",
      "lines.3": "whole expense",
      "lines.0.description": "desc",
      lines: LINE_MESSAGES.noLine,
      targetId: LINE_MESSAGES.family,
    }, 2)).toEqual({
      form: LINE_MESSAGES.noLine,
      fields: {
        "shifts.1.hours": "Enter the hours in quarter-hour steps, like 7.75",
        "shifts.0.rate": "rate message",
        "shifts.0.date": LINE_MESSAGES.tooEarly,
        "shifts.0.description": "desc",
        "expenses.0.amount": "amount message",
        "expenses.0.expenseType": "type message",
        "expenses.1.expenseType": "whole expense",
      },
    });
  });

  it("only an issue that names no line: it's the form's message", () => {
    expect(formIssues({ targetId: LINE_MESSAGES.family }, 1)).toEqual({ form: LINE_MESSAGES.family, fields: {} });
  });
});

describe("localCheck (the shared schema and the family's earliest date, before the server is asked)", () => {
  const draft = (over: Partial<InvoiceFormValues>) => draftOf(HEADER, values(over));
  const NOW = new Date("2027-02-15T10:00:00Z");
  const EARLIEST = "2027-01-25";

  it("a complete draft passes, its dates from the earliest to today", () => {
    expect(localCheck(draft({ shifts: [shiftRow("2027-01-25", "6"), shiftRow("2027-02-15", "6")] }), NOW, EARLIEST)).toBeNull();
  });

  it("expenses only pass", () => {
    expect(localCheck(draft({ shifts: [], expenses: [{ expenseType: "food", amount: "4.50", description: "" }] }), NOW, EARLIEST)).toBeNull();
  });

  it("refused by field, with the schema's plain messages, never what she typed", () => {
    const refusal = localCheck(draft({ shifts: [shiftRow("2027-02-08", "7.1", "abc")], expenses: [{ expenseType: "", amount: "999999", description: "" }] }), NOW, EARLIEST);
    expect(refusal?.fields).toEqual({
      "lines.0.hours": "Enter the hours in quarter-hour steps, like 7.75",
      "lines.0.ratePence": "Enter a rate of up to £250.00 an hour",
      "lines.1.expenseType": "Choose what the expense was for",
      "lines.1.amountPence": "Enter an amount of up to £1,000.00",
    });
    expect(JSON.stringify(refusal)).not.toContain("abc");
  });

  it("no date chosen → Choose a date; a date after today → the future message, by field", () => {
    expect(localCheck(draft({ shifts: [shiftRow("", "6")] }), NOW, EARLIEST)?.fields).toEqual({ "lines.0.date": LINE_MESSAGES.date });
    const future = localCheck(draft({ shifts: [shiftRow("2027-02-15", "6"), shiftRow("2027-02-16", "6")] }), NOW, EARLIEST);
    expect(future).toMatchObject({ error: "future", fields: { "lines.1.date": LINE_MESSAGES.future } });
  });

  it("a date before the family's earliest → tooEarly, by field (as the server answers too_early)", () => {
    const refusal = localCheck(draft({ shifts: [shiftRow("2027-01-25", "6"), shiftRow("2027-01-24", "6"), shiftRow("2026-12-01", "2")] }), NOW, EARLIEST);
    expect(refusal).toEqual({
      ok: false, error: "too_early", message: LINE_MESSAGES.tooEarly,
      fields: { "lines.1.date": LINE_MESSAGES.tooEarly, "lines.2.date": LINE_MESSAGES.tooEarly },
    });
  });

  it("too early alongside other problems: each under its own field, the schema's message first", () => {
    const refusal = localCheck(draft({ shifts: [shiftRow("2027-01-24", "7.1"), shiftRow("", "6")] }), NOW, EARLIEST);
    expect(refusal?.message).toBe("Please check the details marked below.");
    expect(refusal?.fields).toEqual({
      "lines.0.hours": "Enter the hours in quarter-hour steps, like 7.75",
      "lines.0.date": LINE_MESSAGES.tooEarly,
      "lines.1.date": LINE_MESSAGES.date,
    });
  });

  it("no line at all → Add a shift or an expense", () => {
    expect(localCheck(draft({ shifts: [] }), NOW, EARLIEST)?.fields).toEqual({ lines: LINE_MESSAGES.noLine });
  });
});
