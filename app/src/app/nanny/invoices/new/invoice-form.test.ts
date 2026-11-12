/**
 * The new-invoice form's model (plan 06 §14.3, §14.5, §14.6 b4.4; brief §0a A, §3 nanny 3–5). Pure, client-safe:
 * - **Money as she types it** ("18", "18.5", "£18.50", "1,250") in whole pence with no float maths; anything else is
 *   NaN, so the shared schema refuses it with its plain message. Pence back to the field's text ("18.00").
 * - **The draft** the actions take: shifts then expenses, in her order; hours and amounts as numbers.
 * - **Live totals** from `totals.ts` over the rows that are complete, with her VAT setting; a line's amount.
 * - **Weeks** she can pick: this London week back to the placement's first week, at most 26, newest first (a
 *   correction's week always included); a week's seven days.
 * - **Pre-fill for any week:** the usual pattern (weekday, hours, rate, description) laid on the week chosen; days after
 *   today dropped; none left → one row on the Monday, hours blank, her rate (`weekPrefill`'s rule).
 * - **Refusals by path** ("lines.2.hours") mapped onto her rows ("expenses.0.amount") and the form.
 *
 * BB-wave1-041126/06b4, 2026-11-12.
 */
import { describe, expect, it } from "vitest";
import {
  draftOf,
  formIssues,
  lineAmountText,
  liveTotals,
  localCheck,
  patternOf,
  penceOfPounds,
  poundsOfPence,
  shiftsForWeek,
  weekDays,
  weekOptions,
  WEEKS_SHOWN,
  type InvoiceFormValues,
} from "./invoice-form";

const RATE = 1800;
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
  it("shifts then expenses, in her order, as the actions take them", () => {
    const draft = draftOf(
      { kind: "regular_week", targetId: "t", periodStart: "2027-02-08", replacesInvoiceId: null },
      values({
        shifts: [shiftRow("2027-02-08", "6"), shiftRow("2027-02-10", " 2 ", "22", "evening, agreed rate")],
        expenses: [{ expenseType: "activities", amount: "12.50", description: "" }],
      }),
    );
    expect(draft).toEqual({
      kind: "regular_week", targetId: "t", periodStart: "2027-02-08", replacesInvoiceId: null,
      lines: [
        { kind: "shift", date: "2027-02-08", hours: 6, ratePence: RATE, description: "" },
        { kind: "shift", date: "2027-02-10", hours: 2, ratePence: 2200, description: "evening, agreed rate" },
        { kind: "expense", expenseType: "activities", amountPence: 1250, description: "" },
      ],
    });
  });

  it("blank or unreadable hours and amounts are NaN (the schema's plain messages refuse them)", () => {
    const draft = draftOf({ kind: "regular_week", targetId: "t", periodStart: "2027-02-08", replacesInvoiceId: null },
      values({ shifts: [shiftRow("2027-02-08", "", "x")], expenses: [{ expenseType: "", amount: "", description: "" }] }));
    expect(draft.lines[0]).toMatchObject({ hours: Number.NaN, ratePence: Number.NaN });
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

  it("rows not complete yet count as nothing (no throw while she types)", () => {
    const typing = values({ shifts: [shiftRow("2027-02-08", "6"), shiftRow("2027-02-09", "7.1"), shiftRow("2027-02-10", "", "")], expenses: [{ expenseType: "food", amount: "4.", description: "" }] });
    expect(liveTotals(typing, { mode: "none", rateBp: null })).toMatchObject({ hours: 6, shiftsPence: 10800, expensesPence: 0, totalPence: 10800 });
  });

  it("a line's amount, or a dash while it isn't complete", () => {
    expect(lineAmountText(shiftRow("2027-02-08", "0.75", "18.01"))).toBe("£13.51");
    expect(lineAmountText(shiftRow("2027-02-08", "", "18"))).toBe("—");
    expect(lineAmountText(shiftRow("2027-02-08", "25", "18"))).toBe("—");
  });
});

describe("weeks", () => {
  it("this week back to the placement's first week, newest first", () => {
    expect(weekOptions({ today: "2027-02-17", startDate: "2027-02-02", include: null })).toEqual(["2027-02-15", "2027-02-08", "2027-02-01"]);
  });

  it("no start date: 26 weeks; a long placement is cut at 26", () => {
    const weeks = weekOptions({ today: "2027-02-17", startDate: null, include: null });
    expect(weeks).toHaveLength(WEEKS_SHOWN);
    expect(WEEKS_SHOWN).toBe(26);
    expect(weeks[0]).toBe("2027-02-15");
    expect(weekOptions({ today: "2027-02-17", startDate: "2020-01-01", include: null })).toHaveLength(WEEKS_SHOWN);
  });

  it("a start in the future: this week only; a correction's week is always there", () => {
    expect(weekOptions({ today: "2027-02-17", startDate: "2027-03-01", include: null })).toEqual(["2027-02-15"]);
    expect(weekOptions({ today: "2027-02-17", startDate: "2027-02-10", include: "2026-11-02" })).toEqual(["2027-02-15", "2027-02-08", "2026-11-02"]);
    expect(weekOptions({ today: "2027-02-17", startDate: null, include: "2027-03-01" })).not.toContain("2027-03-01");
  });

  it("a week's seven days, across a month and a clock change", () => {
    expect(weekDays("2027-03-22")).toEqual(["2027-03-22", "2027-03-23", "2027-03-24", "2027-03-25", "2027-03-26", "2027-03-27", "2027-03-28"]);
  });
});

describe("pre-fill for any week", () => {
  const LAST = "2027-02-08";
  const pattern = patternOf([
    { date: "2027-02-08", hours: 8.5, ratePence: RATE, description: null },
    { date: "2027-02-10", hours: 8.25, ratePence: RATE, description: null },
    { date: "2027-02-12", hours: 8.25, ratePence: RATE, description: "late finish" },
  ], LAST);

  it("the pattern is weekday offsets with their hours, rate and description", () => {
    expect(pattern).toEqual([
      { offset: 0, hours: 8.5, ratePence: RATE, description: null },
      { offset: 2, hours: 8.25, ratePence: RATE, description: null },
      { offset: 4, hours: 8.25, ratePence: RATE, description: "late finish" },
    ]);
  });

  it("laid on a past week whole", () => {
    expect(shiftsForWeek(pattern, "2027-01-25", "2027-02-17", RATE)).toEqual([
      shiftRow("2027-01-25", "8.5"), shiftRow("2027-01-27", "8.25"), shiftRow("2027-01-29", "8.25", "18.00", "late finish"),
    ]);
  });

  it("this week: days after today dropped", () => {
    expect(shiftsForWeek(pattern, "2027-02-15", "2027-02-17", RATE)).toEqual([shiftRow("2027-02-15", "8.5"), shiftRow("2027-02-17", "8.25")]);
  });

  it("none left (or no usual days): one row on the Monday, hours blank, her rate", () => {
    expect(shiftsForWeek(patternOf([{ date: "2027-02-12", hours: 6, ratePence: RATE, description: null }], LAST), "2027-02-15", "2027-02-16", RATE))
      .toEqual([shiftRow("2027-02-15", "")]);
    expect(shiftsForWeek([], "2027-02-15", "2027-02-16", null)).toEqual([shiftRow("2027-02-15", "", "")]);
  });

  it("a Trial Shift: its one date", () => {
    const trial = patternOf([{ date: "2027-02-03", hours: null, ratePence: RATE, description: null }], "2027-02-03");
    expect(shiftsForWeek(trial, "2027-02-03", "2027-02-17", RATE)).toEqual([shiftRow("2027-02-03", "")]);
  });
});

describe("refusals by path, onto her rows", () => {
  it("lines → shifts or expenses by index; whole-draft issues → the form", () => {
    expect(formIssues({
      "lines.1.hours": "Enter the hours in quarter-hour steps, like 7.75",
      "lines.0.ratePence": "rate message",
      "lines.2.amountPence": "amount message",
      "lines.2.expenseType": "type message",
      "lines.3": "whole expense",
      "lines.0.description": "desc",
      lines: "Add at least one shift",
      periodStart: "Choose the Monday the week starts on",
    }, 2)).toEqual({
      form: "Add at least one shift",
      fields: {
        "shifts.1.hours": "Enter the hours in quarter-hour steps, like 7.75",
        "shifts.0.rate": "rate message",
        "shifts.0.description": "desc",
        "expenses.0.amount": "amount message",
        "expenses.0.expenseType": "type message",
        "expenses.1.expenseType": "whole expense",
      },
    });
  });

  it("only a period issue: it's the form's message", () => {
    expect(formIssues({ periodStart: "You can't invoice a week or date that hasn't happened yet" }, 1)).toEqual({
      form: "You can't invoice a week or date that hasn't happened yet", fields: {},
    });
  });
});

describe("localCheck (the shared schema, before the server is asked)", () => {
  const draft = (over: Partial<InvoiceFormValues>) =>
    draftOf({ kind: "regular_week", targetId: "b0600000-0000-4000-8000-000000000411", periodStart: "2027-02-08", replacesInvoiceId: null }, values(over));
  const NOW = new Date("2027-02-15T10:00:00Z");

  it("a complete draft passes", () => {
    expect(localCheck(draft({}), NOW)).toBeNull();
  });

  it("refused by field, with the schema's plain messages, never what she typed", () => {
    const refusal = localCheck(draft({ shifts: [shiftRow("2027-02-08", "7.1", "abc")], expenses: [{ expenseType: "", amount: "999999", description: "" }] }), NOW);
    expect(refusal?.fields).toEqual({
      "lines.0.hours": "Enter the hours in quarter-hour steps, like 7.75",
      "lines.0.ratePence": "Enter a rate of up to £250.00 an hour",
      "lines.1.expenseType": "Choose what the expense was for",
      "lines.1.amountPence": "Enter an amount of up to £1,000.00",
    });
    expect(JSON.stringify(refusal)).not.toContain("abc");
  });

  it("no shift → Add at least one shift", () => {
    expect(localCheck(draft({ shifts: [] }), NOW)?.fields).toEqual({ lines: "Add at least one shift" });
  });
});
