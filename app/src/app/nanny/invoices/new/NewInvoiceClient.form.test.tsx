/**
 * The new-invoice form (plan 06 old step 14, §14.3, §14.6 b4.4; brief §0a A, §3 nanny 3–5; A5):
 * - Choosing a family, the kind and the week: the family and kind go through the page's own parameters
 *   (`?placement=` / `?connection=`), so the server checks they're hers; the week is the form's.
 * - Shifts with react-hook-form's field arrays: pre-filled from her usual week; a date `<select>` of the week's seven
 *   days with the days after today disabled; a Trial Shift's date fixed; "Add shift", "Add another shift this day",
 *   "Remove"; expenses with a type, a description and an amount.
 * - Totals live from the calculator as she types.
 * - "Review": the shared schema first (each problem under its field, nothing sent), then `previewInvoice` with the
 *   draft only — never an id, a figure or an address of the client's choosing.
 *
 * BB-wave1-041126/06b4, 2026-11-12.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const calls = vi.hoisted(() => ({ previewInvoice: vi.fn(), sendInvoice: vi.fn(), saveBusinessSettings: vi.fn(), push: vi.fn(), refresh: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: calls.push, refresh: calls.refresh }) }));
vi.mock("@/lib/invoices/actions/preview-invoice", () => ({ previewInvoice: calls.previewInvoice }));
vi.mock("@/lib/invoices/actions/send-invoice", () => ({ sendInvoice: calls.sendInvoice }));
vi.mock("@/lib/invoices/actions/save-business-settings", () => ({ saveBusinessSettings: calls.saveBusinessSettings }));

import { NewInvoiceClient, type NewInvoiceClientProps } from "./NewInvoiceClient";

const PLACEMENT = "b0600000-0000-4000-8000-000000000411";
const CONNECTION = "b0600000-0000-4000-8000-000000000511";
const CONNECTION_2 = "b0600000-0000-4000-8000-000000000512";
const RATE = 1800;
const FAMILIES: NewInvoiceClientProps["families"] = [
  { key: "0", familyName: "Olivia Hartley", area: "Islington", placementId: PLACEMENT, trials: [{ connectionId: CONNECTION, date: "2027-02-03" }] },
  { key: "1", familyName: "Priya Patel", area: null, placementId: null, trials: [{ connectionId: CONNECTION_2, date: "2027-01-20" }] },
];
const WEEK_TARGET: NonNullable<NewInvoiceClientProps["target"]> = {
  kind: "regular_week", targetId: PLACEMENT, familyKey: "0", familyName: "Olivia Hartley", area: "Islington",
  weeks: ["2027-02-15", "2027-02-08", "2027-02-01"], periodStart: "2027-02-15",
  pattern: [
    { offset: 0, hours: 8.5, ratePence: RATE, description: null },
    { offset: 2, hours: 8.25, ratePence: RATE, description: null },
    { offset: 4, hours: 8.25, ratePence: RATE, description: null },
  ],
  expenses: [], ratePence: RATE, replaces: null,
};
const TRIAL_TARGET: NonNullable<NewInvoiceClientProps["target"]> = {
  ...WEEK_TARGET, kind: "trial_shift", targetId: CONNECTION, weeks: [], periodStart: "2027-02-03",
  pattern: [{ offset: 0, hours: null, ratePence: RATE, description: null }],
};
const BASE: NewInvoiceClientProps = { families: FAMILIES, target: WEEK_TARGET, vat: { mode: "none", rateBp: null }, today: "2027-02-17", loadFailed: false };

beforeEach(() => {
  for (const fn of Object.values(calls)) fn.mockReset();
  calls.previewInvoice.mockResolvedValue({ ok: false, error: "error", message: "Something went wrong. Please try again." });
});
afterEach(cleanup);

const shiftCards = () => screen.getAllByRole("group", { name: /^Shift \d+$/ });
const total = () => within(screen.getByRole("region", { name: "Totals" })).getByText("Total").nextElementSibling?.textContent;

describe("the page around the form", () => {
  it("no families yet → says so; a load failure → the general message", () => {
    render(<NewInvoiceClient {...BASE} families={[]} target={null} />);
    expect(screen.getByText("You have no families to invoice yet.")).toBeInTheDocument();
    cleanup();
    render(<NewInvoiceClient {...BASE} loadFailed target={null} />);
    expect(screen.getByText("Something went wrong. Please try again.")).toBeInTheDocument();
  });

  it("the plain page: choose a family → the form for its placement (or its trial when it has no placement)", async () => {
    render(<NewInvoiceClient {...BASE} target={null} />);
    expect(screen.queryByRole("button", { name: "Review" })).toBeNull();
    await userEvent.selectOptions(screen.getByLabelText("Family"), "0");
    expect(calls.push).toHaveBeenLastCalledWith(`/nanny/invoices/new?placement=${PLACEMENT}`);
    await userEvent.selectOptions(screen.getByLabelText("Family"), "1");
    expect(calls.push).toHaveBeenLastCalledWith(`/nanny/invoices/new?connection=${CONNECTION_2}`);
  });

  it("the kind: Regular week / Trial Shift as two buttons; the other goes to its own target", async () => {
    render(<NewInvoiceClient {...BASE} />);
    expect(screen.getByRole("button", { name: "Regular week" })).toHaveAttribute("aria-pressed", "true");
    await userEvent.click(screen.getByRole("button", { name: "Trial Shift" }));
    expect(calls.push).toHaveBeenLastCalledWith(`/nanny/invoices/new?connection=${CONNECTION}`);
  });

  it("a family with no placement can't pick Regular week", () => {
    render(<NewInvoiceClient {...BASE} target={{ ...TRIAL_TARGET, targetId: CONNECTION_2, familyKey: "1", familyName: "Priya Patel" }} />);
    expect(screen.getByRole("button", { name: "Regular week" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Trial Shift" })).toHaveAttribute("aria-pressed", "true");
  });
});

describe("shifts", () => {
  it("pre-filled from her usual week, this week first: days after today dropped", () => {
    render(<NewInvoiceClient {...BASE} />);
    const cards = shiftCards();
    expect(cards).toHaveLength(2);
    expect(within(cards[0]!).getByLabelText("Date")).toHaveValue("2027-02-15");
    expect(within(cards[0]!).getByLabelText("Hours")).toHaveValue("8.5");
    expect(within(cards[0]!).getByLabelText("Rate")).toHaveValue("18.00");
    expect(within(cards[1]!).getByLabelText("Date")).toHaveValue("2027-02-17");
  });

  it("the date is a select of the week's seven days, future days disabled", () => {
    render(<NewInvoiceClient {...BASE} />);
    const options = within(within(shiftCards()[0]!).getByLabelText("Date")).getAllByRole("option") as HTMLOptionElement[];
    expect(options.map((o) => o.textContent)).toEqual(["Mon 15 Feb", "Tue 16 Feb", "Wed 17 Feb", "Thu 18 Feb", "Fri 19 Feb", "Sat 20 Feb", "Sun 21 Feb"]);
    expect(options.map((o) => o.disabled)).toEqual([false, false, false, true, true, true, true]);
  });

  it("another week: her usual week laid on it, whole", async () => {
    render(<NewInvoiceClient {...BASE} />);
    await userEvent.selectOptions(screen.getByLabelText("Week"), "2027-02-08");
    expect(shiftCards().map((c) => (within(c).getByLabelText("Date") as HTMLSelectElement).value)).toEqual(["2027-02-08", "2027-02-10", "2027-02-12"]);
    expect(calls.push).not.toHaveBeenCalled();
  });

  it("Add shift, Add another shift this day (same date, after it), Remove", async () => {
    render(<NewInvoiceClient {...BASE} />);
    await userEvent.click(within(shiftCards()[0]!).getByRole("button", { name: "Add another shift this day" }));
    let dates = shiftCards().map((c) => (within(c).getByLabelText("Date") as HTMLSelectElement).value);
    expect(dates).toEqual(["2027-02-15", "2027-02-15", "2027-02-17"]);
    expect(within(shiftCards()[1]!).getByLabelText("Hours")).toHaveValue("");
    expect(within(shiftCards()[1]!).getByLabelText("Rate")).toHaveValue("18.00");
    await userEvent.click(screen.getByRole("button", { name: "Add shift" }));
    dates = shiftCards().map((c) => (within(c).getByLabelText("Date") as HTMLSelectElement).value);
    expect(dates).toHaveLength(4);
    expect(dates[3]).toBe("2027-02-17"); // the day after the last isn't over yet
    await userEvent.click(within(shiftCards()[1]!).getByRole("button", { name: "Remove" }));
    expect(shiftCards()).toHaveLength(3);
  });

  it("a Trial Shift's date is fixed (no select)", () => {
    render(<NewInvoiceClient {...BASE} target={TRIAL_TARGET} />);
    const card = shiftCards()[0]!;
    expect(within(card).queryByRole("combobox", { name: "Date" })).toBeNull();
    expect(within(card).getByText("Wed 3 Feb")).toBeInTheDocument();
    expect(screen.queryByLabelText("Week")).toBeNull();
    expect(screen.getByText("Trial Shift, Wed 3 Feb 2027")).toBeInTheDocument();
  });
});

describe("expenses and live totals", () => {
  it("totals update as she types; an expense adds to them", async () => {
    render(<NewInvoiceClient {...BASE} />);
    expect(total()).toBe("£301.50"); // 16.75 h × £18.00
    const hours = within(shiftCards()[1]!).getByLabelText("Hours");
    await userEvent.clear(hours);
    await userEvent.type(hours, "2");
    expect(total()).toBe("£189.00");
    await userEvent.click(screen.getByRole("button", { name: "Add expense" }));
    const expense = screen.getByRole("group", { name: "Expense 1" });
    await userEvent.selectOptions(within(expense).getByLabelText("Type"), "activities");
    await userEvent.type(within(expense).getByLabelText("Amount"), "12.50");
    expect(total()).toBe("£201.50");
    expect(within(screen.getByRole("region", { name: "Totals" })).getByText("Expenses")).toBeInTheDocument();
  });

  it("VAT added shows its own line (her Settings' VAT)", () => {
    render(<NewInvoiceClient {...BASE} vat={{ mode: "added", rateBp: 2000 }} />);
    const box = within(screen.getByRole("region", { name: "Totals" }));
    expect(box.getByText("VAT at 20%")).toBeInTheDocument();
    expect(total()).toBe("£361.80");
  });

  it("a shift's amount as it's typed", () => {
    render(<NewInvoiceClient {...BASE} />);
    expect(within(shiftCards()[0]!).getByText("£153.00")).toBeInTheDocument();
  });
});

describe("Review", () => {
  it("the shared schema first: each problem under its field, nothing sent", async () => {
    render(<NewInvoiceClient {...BASE} />);
    const hours = within(shiftCards()[0]!).getByLabelText("Hours");
    await userEvent.clear(hours);
    await userEvent.type(hours, "7.1");
    await userEvent.click(screen.getByRole("button", { name: "Review" }));
    expect(calls.previewInvoice).not.toHaveBeenCalled();
    expect(within(shiftCards()[0]!).getByText("Enter the hours in quarter-hour steps, like 7.75")).toBeInTheDocument();
    expect(within(shiftCards()[0]!).getByLabelText("Hours")).toHaveAttribute("aria-invalid", "true");
    expect(screen.getByRole("alert")).toHaveTextContent("Please check the details marked below.");
  });

  it("no shift at all → Add at least one shift", async () => {
    render(<NewInvoiceClient {...BASE} />);
    for (const card of shiftCards()) await userEvent.click(within(card).getByRole("button", { name: "Remove" }));
    await userEvent.click(screen.getByRole("button", { name: "Review" }));
    expect(screen.getByRole("alert")).toHaveTextContent("Add at least one shift");
  });

  it("asks the server with the draft only (kind, target, period, lines, the invoice it replaces)", async () => {
    render(<NewInvoiceClient {...BASE} />);
    await userEvent.click(screen.getByRole("button", { name: "Review" }));
    expect(calls.previewInvoice).toHaveBeenCalledWith({
      kind: "regular_week", targetId: PLACEMENT, periodStart: "2027-02-15", replacesInvoiceId: null,
      lines: [
        { kind: "shift", date: "2027-02-15", hours: 8.5, ratePence: RATE, description: "" },
        { kind: "shift", date: "2027-02-17", hours: 8.25, ratePence: RATE, description: "" },
      ],
    });
  });

  it("the server's refusal by field lands under her fields; any other refusal shows its message", async () => {
    calls.previewInvoice.mockResolvedValueOnce({ ok: false, error: "future", message: "You can't invoice a week or date that hasn't happened yet", fields: { "lines.1.date": "You can't invoice a week or date that hasn't happened yet" } });
    render(<NewInvoiceClient {...BASE} />);
    await userEvent.click(screen.getByRole("button", { name: "Review" }));
    expect(await within(shiftCards()[1]!).findByText("You can't invoice a week or date that hasn't happened yet")).toBeInTheDocument();
    calls.previewInvoice.mockResolvedValueOnce({ ok: false, error: "cap", message: "You can send up to 10 invoices a day. Please try again tomorrow." });
    await userEvent.click(screen.getByRole("button", { name: "Review" }));
    expect(await screen.findByText("You can send up to 10 invoices a day. Please try again tomorrow.")).toBeInTheDocument();
  });

  it("a correction: the family is fixed and the review sends the invoice it replaces", async () => {
    const OLD = "b0600000-0000-4000-8000-000000007001";
    render(<NewInvoiceClient {...BASE} target={{ ...WEEK_TARGET, periodStart: "2027-02-08", replaces: { invoiceId: OLD, number: "BB-SophieTaylor-270214-0001" },
      expenses: [{ expenseType: "activities", amount: "12.50", description: "" }] }} />);
    expect(screen.getByText("Replaces BB-SophieTaylor-270214-0001")).toBeInTheDocument();
    expect(screen.queryByLabelText("Family")).toBeNull();
    expect(screen.getByRole("group", { name: "Expense 1" })).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Review" }));
    expect(calls.previewInvoice.mock.calls[0]?.[0]).toMatchObject({ periodStart: "2027-02-08", replacesInvoiceId: OLD });
  });
});
