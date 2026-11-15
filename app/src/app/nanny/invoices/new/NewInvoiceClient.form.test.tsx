/**
 * The new-invoice form (plan 06 old step 14, §14.3, §14.6 b4.4; brief §0a A, §3 nanny 3–5; A5; 06b-4 rework, BAI
 * 2026-11-12: "start off with a short and simple, button underneath the family selector to add shift or add expense,
 * side by side. Without them being able to see or click 'review' until they have at least entered one shift/expense"):
 * - **The picker:** one "Family" select — "Choose a family", her families, then "Add family" (to her hub's Children tab
 *   with the add-child sheet open). No Regular week / Trial Shift, no week, no trial date. Choosing a family is the
 *   form's own; another family starts the lines afresh (rates belong to a family).
 * - **Starts empty:** with a family chosen, "Add shift" and "Add expense" side by side and nothing else; lines appear
 *   above them under "Childcare" and "Expenses" (each heading once it has a line); the totals and Review only once
 *   there is a line, and gone again when every line is removed.
 * - **A shift:** a date input from the family's earliest date to today, blank until chosen; hours blank; the family's
 *   rate; a description; "Add another shift this day" and "Remove". Live totals count complete rows only.
 * - **Review:** the shared schema and the earliest date first (each problem under its field, nothing sent), then
 *   `previewInvoice` with the draft only — the family's link id, the lines, any correction; never a kind or a period.
 *
 * BB-wave1-041126/06b4, 2026-11-12; BB-wave1-041126/06b4-ui, 2026-11-12 (rework).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const calls = vi.hoisted(() => ({ previewInvoice: vi.fn(), sendInvoice: vi.fn(), saveBusinessSettings: vi.fn(), push: vi.fn(), refresh: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: calls.push, refresh: calls.refresh }) }));
vi.mock("@/lib/invoices/actions/preview-invoice", () => ({ previewInvoice: calls.previewInvoice }));
vi.mock("@/lib/invoices/actions/send-invoice", () => ({ sendInvoice: calls.sendInvoice }));
vi.mock("@/lib/invoices/actions/save-business-settings", () => ({ saveBusinessSettings: calls.saveBusinessSettings }));

import { LINE_MESSAGES } from "@/lib/invoices/validation-lines";
import { NewInvoiceClient, type NewInvoiceClientProps } from "./NewInvoiceClient";

const PLACEMENT = "b0600000-0000-4000-8000-000000000411";
const CONNECTION = "b0600000-0000-4000-8000-000000000511";
const OLD = "b0600000-0000-4000-8000-000000007001";
const RATE = 1800;
const ADD_FAMILY = "/nanny?tab=children&add=child";
const FAMILIES: NewInvoiceClientProps["families"] = [
  { key: "0", familyName: "Olivia Hartley", area: "Islington", targetId: PLACEMENT, earliest: "2027-01-25", ratePence: RATE },
  { key: "1", familyName: "Priya Patel", area: null, targetId: CONNECTION, earliest: "2027-02-03", ratePence: null },
];
const row = (date: string, hours: string, rate = "18.00", description = "") => ({ date, hours, rate, description });
const OLIVIA: NonNullable<NewInvoiceClientProps["target"]> = { familyKey: "0", shifts: [], expenses: [], replaces: null };
const LINED: NonNullable<NewInvoiceClientProps["target"]> = { ...OLIVIA, shifts: [row("2027-02-15", "8.5"), row("2027-02-17", "8.25")] };
const BASE: NewInvoiceClientProps = { families: FAMILIES, target: null, vat: { mode: "none", rateBp: null }, today: "2027-02-17", loadFailed: false };

beforeEach(() => {
  for (const fn of Object.values(calls)) fn.mockReset();
  calls.previewInvoice.mockResolvedValue({ ok: false, error: "error", message: "Something went wrong. Please try again." });
});
afterEach(cleanup);

const familySelect = () => screen.getByLabelText("Family") as HTMLSelectElement;
const shiftCards = () => screen.queryAllByRole("group", { name: /^Shift \d+$/ });
const expenseCards = () => screen.queryAllByRole("group", { name: /^Expense \d+$/ });
const button = (name: string) => screen.getByRole("button", { name });
const totals = () => screen.queryByRole("region", { name: "Totals" });
const total = () => within(screen.getByRole("region", { name: "Totals" })).getByText("Total").nextElementSibling?.textContent;
const dateOf = (card: HTMLElement) => within(card).getByLabelText("Date") as HTMLInputElement;
const setDate = (card: HTMLElement, date: string) => fireEvent.change(dateOf(card), { target: { value: date } });

/** "Add shift", then her date and hours on the new card. */
async function addShift(date: string, hours: string) {
  await userEvent.click(button("Add shift"));
  const card = shiftCards().at(-1)!;
  setDate(card, date);
  await userEvent.type(within(card).getByLabelText("Hours"), hours);
  return card;
}

async function addExpense(type: string, amount: string) {
  await userEvent.click(button("Add expense"));
  const card = expenseCards().at(-1)!;
  await userEvent.selectOptions(within(card).getByLabelText("Type"), type);
  await userEvent.type(within(card).getByLabelText("Amount"), amount);
  return card;
}

describe("the page around the form", () => {
  it("no families yet → says so, with Add family to her Children tab; a load failure → the general message", () => {
    render(<NewInvoiceClient {...BASE} families={[]} />);
    expect(screen.getByText("You have no families to invoice yet.")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Add family" })).toHaveAttribute("href", ADD_FAMILY);
    cleanup();
    render(<NewInvoiceClient {...BASE} loadFailed />);
    expect(screen.getByText("Something went wrong. Please try again.")).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Add family" })).toBeNull();
  });

  it("the picker only, to start: Choose a family, her families, Add family last — no week, no kind", () => {
    render(<NewInvoiceClient {...BASE} />);
    const options = within(familySelect()).getAllByRole("option") as HTMLOptionElement[];
    expect(options.map((o) => o.textContent)).toEqual(["Choose a family", "Olivia Hartley — Islington", "Priya Patel", "Add family"]);
    expect(options[0]?.disabled).toBe(true);
    expect(familySelect().value).toBe("");
    for (const name of ["Add shift", "Add expense", "Review", "Regular week", "Trial Shift"]) expect(screen.queryByRole("button", { name })).toBeNull();
    expect(screen.queryByLabelText("Week")).toBeNull();
    expect(screen.queryByLabelText("Date")).toBeNull();
  });

  it("choosing a family is the form's own (no page load): Add shift and Add expense side by side, nothing else", async () => {
    render(<NewInvoiceClient {...BASE} />);
    await userEvent.selectOptions(familySelect(), "0");
    expect(calls.push).not.toHaveBeenCalled();
    expect(familySelect().value).toBe("0");
    expect(button("Add shift").parentElement).toBe(button("Add expense").parentElement);
    expect(shiftCards()).toHaveLength(0);
    expect(expenseCards()).toHaveLength(0);
    expect(totals()).toBeNull();
    expect(screen.queryByRole("button", { name: "Review" })).toBeNull();
    expect(screen.queryByRole("heading", { name: "Childcare" })).toBeNull();
    expect(screen.queryByRole("heading", { name: "Expenses" })).toBeNull();
  });

  it("Add family → her Children tab with the add-child sheet, in the same tab; the picker keeps her choice", async () => {
    render(<NewInvoiceClient {...BASE} target={OLIVIA} />);
    await userEvent.selectOptions(familySelect(), screen.getByRole("option", { name: "Add family" }));
    expect(calls.push).toHaveBeenCalledWith(ADD_FAMILY);
    expect(familySelect().value).toBe("0");
  });

  it("opened on a family (?placement=, ?connection=): it's chosen, with the two buttons", () => {
    render(<NewInvoiceClient {...BASE} target={OLIVIA} />);
    expect(familySelect().value).toBe("0");
    expect(button("Add shift")).toBeInTheDocument();
    expect(shiftCards()).toHaveLength(0);
  });

  it("another family starts the lines afresh: rates belong to a family", async () => {
    render(<NewInvoiceClient {...BASE} target={OLIVIA} />);
    await addShift("2027-02-10", "6");
    await addExpense("food", "4.50");
    await userEvent.selectOptions(familySelect(), "1");
    expect(shiftCards()).toHaveLength(0);
    expect(expenseCards()).toHaveLength(0);
    expect(totals()).toBeNull();
    await userEvent.click(button("Add shift"));
    expect(within(shiftCards()[0]!).getByLabelText("Rate")).toHaveValue("");
    expect(dateOf(shiftCards()[0]!)).toHaveAttribute("min", "2027-02-03");
  });
});

describe("starts empty; lines above the two buttons", () => {
  it("a shift: under Childcare, above the buttons; then the totals and Review", async () => {
    render(<NewInvoiceClient {...BASE} target={OLIVIA} />);
    await userEvent.click(button("Add shift"));
    const [card] = shiftCards();
    expect(screen.getByRole("heading", { name: "Childcare" })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Expenses" })).toBeNull();
    expect(card!.compareDocumentPosition(button("Add shift")) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(dateOf(card!)).toHaveValue("");
    expect(within(card!).getByLabelText("Hours")).toHaveValue("");
    expect(within(card!).getByLabelText("Rate")).toHaveValue("18.00");
    expect(within(card!).getByLabelText("Description")).toHaveValue("");
    expect(totals()).toBeInTheDocument();
    expect(button("Review")).toBeInTheDocument();
  });

  it("an expense only: under Expenses, no Childcare; the totals without a Childcare line", async () => {
    render(<NewInvoiceClient {...BASE} target={OLIVIA} />);
    await addExpense("activities", "12.50");
    expect(screen.getByRole("heading", { name: "Expenses" })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Childcare" })).toBeNull();
    const box = within(screen.getByRole("region", { name: "Totals" }));
    expect(box.queryByText("Childcare")).toBeNull();
    expect(box.getByText("Expenses")).toBeInTheDocument();
    expect(total()).toBe("£12.50");
    expect(button("Review")).toBeInTheDocument();
  });

  it("removing every line takes the totals and Review away again", async () => {
    render(<NewInvoiceClient {...BASE} target={OLIVIA} />);
    await userEvent.click(button("Add shift"));
    await userEvent.click(button("Add expense"));
    await userEvent.click(within(shiftCards()[0]!).getByRole("button", { name: "Remove" }));
    expect(button("Review")).toBeInTheDocument();
    await userEvent.click(within(expenseCards()[0]!).getByRole("button", { name: "Remove" }));
    expect(totals()).toBeNull();
    expect(screen.queryByRole("button", { name: "Review" })).toBeNull();
    expect(screen.queryByRole("heading", { name: "Expenses" })).toBeNull();
  });
});

describe("focus (code review M2)", () => {
  it("picking a family keeps the picker mounted, so focus stays where she was", async () => {
    const view = render(<NewInvoiceClient {...BASE} target={OLIVIA} />);
    const select = familySelect();
    select.focus();
    await userEvent.selectOptions(select, "1");
    view.rerender(<NewInvoiceClient {...BASE} target={OLIVIA} />);
    expect(familySelect()).toBe(select);
    expect(document.activeElement).toBe(select);
  });

  it("Add shift: focus to the new shift's date", async () => {
    render(<NewInvoiceClient {...BASE} target={OLIVIA} />);
    await userEvent.click(button("Add shift"));
    await waitFor(() => expect(document.activeElement).toBe(dateOf(shiftCards()[0]!)));
  });

  it("Remove: focus to the next row's first field, else to Add shift / Add expense", async () => {
    render(<NewInvoiceClient {...BASE} target={LINED} />);
    await userEvent.click(within(shiftCards()[0]!).getByRole("button", { name: "Remove" }));
    await waitFor(() => expect(document.activeElement).toBe(dateOf(shiftCards()[0]!)));
    await userEvent.click(within(shiftCards()[0]!).getByRole("button", { name: "Remove" }));
    await waitFor(() => expect(document.activeElement).toBe(button("Add shift")));
    await userEvent.click(button("Add expense"));
    await userEvent.click(within(expenseCards()[0]!).getByRole("button", { name: "Remove" }));
    await waitFor(() => expect(document.activeElement).toBe(button("Add expense")));
  });
});

describe("a family whose first day is still to come (a hire starting later, no trial)", () => {
  const LATER = { key: "2", familyName: "Amara Okafor", area: "Hackney", targetId: "b0600000-0000-4000-8000-000000000413", earliest: "2027-03-01", ratePence: RATE };
  const NOTE = "You can add shifts from 1 Mar 2027";

  it("no date she could pick: Add shift is off, with a short note saying from when; an expense still works", async () => {
    render(<NewInvoiceClient {...BASE} families={[...FAMILIES, LATER]} target={{ ...OLIVIA, familyKey: "2" }} />);
    expect(button("Add shift")).toHaveAttribute("aria-disabled", "true");
    expect(screen.getByText(NOTE)).toBeInTheDocument();
    expect(button("Add shift")).toHaveAccessibleDescription(NOTE);
    await userEvent.click(button("Add shift"));
    expect(shiftCards()).toHaveLength(0);
    await addExpense("food", "4.50");
    expect(button("Review")).toBeInTheDocument();
  });

  it("off but still focusable (code review L), so the note is announced when she reaches it", async () => {
    render(<NewInvoiceClient {...BASE} families={[...FAMILIES, LATER]} target={{ ...OLIVIA, familyKey: "2" }} />);
    expect(button("Add shift")).not.toBeDisabled();
    familySelect().focus();
    await userEvent.tab();
    expect(document.activeElement).toBe(button("Add shift"));
    await userEvent.keyboard("{Enter}");
    expect(shiftCards()).toHaveLength(0);
  });

  it("a first day of today is fine: Add shift is on, no note", () => {
    render(<NewInvoiceClient {...BASE} families={[...FAMILIES, { ...LATER, earliest: "2027-02-17" }]} target={{ ...OLIVIA, familyKey: "2" }} />);
    expect(button("Add shift")).toBeEnabled();
    expect(button("Add shift")).not.toHaveAttribute("aria-disabled");
    expect(screen.queryByText(/You can add shifts from/)).toBeNull();
  });
});

describe("Add family by keyboard (code review M: a closed select reports each arrow as a change)", () => {
  const browseTo = (value: string, key = "ArrowDown") => {
    fireEvent.keyDown(familySelect(), { key });
    fireEvent.change(familySelect(), { target: { value } });
  };

  it.each(["ArrowDown", "ArrowRight", "End", "PageDown"])("%s onto Add family only shows it; Enter then goes", (key) => {
    render(<NewInvoiceClient {...BASE} target={OLIVIA} />);
    browseTo("add-family", key);
    expect(calls.push).not.toHaveBeenCalled();
    expect(familySelect().value).toBe("add-family");
    fireEvent.keyDown(familySelect(), { key: "Enter" });
    expect(calls.push).toHaveBeenCalledWith(ADD_FAMILY);
  });

  it("a change with no browsing key before it (mouse, touch, a picker's commit) goes at once", () => {
    render(<NewInvoiceClient {...BASE} target={OLIVIA} />);
    fireEvent.change(familySelect(), { target: { value: "add-family" } });
    expect(calls.push).toHaveBeenCalledWith(ADD_FAMILY);
  });

  it("a pointer press after browsing keys: the change is deliberate again", () => {
    render(<NewInvoiceClient {...BASE} target={OLIVIA} />);
    fireEvent.keyDown(familySelect(), { key: "ArrowDown" });
    fireEvent.pointerDown(familySelect());
    fireEvent.change(familySelect(), { target: { value: "add-family" } });
    expect(calls.push).toHaveBeenCalledWith(ADD_FAMILY);
  });

  it("leaving the select while browsing Add family: her family again, nowhere to go", () => {
    render(<NewInvoiceClient {...BASE} target={OLIVIA} />);
    browseTo("add-family");
    fireEvent.blur(familySelect());
    expect(familySelect().value).toBe("0");
    expect(calls.push).not.toHaveBeenCalled();
    fireEvent.keyDown(familySelect(), { key: "Enter" });
    expect(calls.push).not.toHaveBeenCalled();
  });

  it("arrowing onto a family chooses it, as before; Enter there goes nowhere", () => {
    render(<NewInvoiceClient {...BASE} target={OLIVIA} />);
    browseTo("add-family");
    browseTo("1", "ArrowUp");
    expect(familySelect().value).toBe("1");
    expect(button("Add shift")).toBeInTheDocument();
    fireEvent.keyDown(familySelect(), { key: "Enter" });
    expect(calls.push).not.toHaveBeenCalled();
  });
});

describe("shifts", () => {
  it("the date: a date input from the family's earliest date to today, blank until chosen", async () => {
    render(<NewInvoiceClient {...BASE} target={OLIVIA} />);
    await userEvent.click(button("Add shift"));
    const date = dateOf(shiftCards()[0]!);
    expect(date).toHaveAttribute("type", "date");
    expect(date).toHaveAttribute("min", "2027-01-25");
    expect(date).toHaveAttribute("max", "2027-02-17");
    expect(date).toHaveValue("");
  });

  it("Add another shift this day (same date, just after it), Add shift (no date), Remove", async () => {
    render(<NewInvoiceClient {...BASE} target={LINED} />);
    await userEvent.click(within(shiftCards()[0]!).getByRole("button", { name: "Add another shift this day" }));
    expect(shiftCards().map((c) => dateOf(c).value)).toEqual(["2027-02-15", "2027-02-15", "2027-02-17"]);
    expect(within(shiftCards()[1]!).getByLabelText("Hours")).toHaveValue("");
    expect(within(shiftCards()[1]!).getByLabelText("Rate")).toHaveValue("18.00");
    await userEvent.click(button("Add shift"));
    expect(shiftCards().map((c) => dateOf(c).value)).toEqual(["2027-02-15", "2027-02-15", "2027-02-17", ""]);
    await userEvent.click(within(shiftCards()[1]!).getByRole("button", { name: "Remove" }));
    expect(shiftCards()).toHaveLength(3);
  });
});

describe("expenses and live totals", () => {
  it("totals update as she types; an expense adds to them", async () => {
    render(<NewInvoiceClient {...BASE} target={LINED} />);
    expect(total()).toBe("£301.50"); // 16.75 h × £18.00
    const hours = within(shiftCards()[1]!).getByLabelText("Hours");
    await userEvent.clear(hours);
    await userEvent.type(hours, "2");
    expect(total()).toBe("£189.00");
    await addExpense("activities", "12.50");
    expect(total()).toBe("£201.50");
    expect(within(screen.getByRole("region", { name: "Totals" })).getByText("Expenses")).toBeInTheDocument();
  });

  it("VAT added shows its own line (her Settings' VAT)", () => {
    render(<NewInvoiceClient {...BASE} target={LINED} vat={{ mode: "added", rateBp: 2000 }} />);
    expect(within(screen.getByRole("region", { name: "Totals" })).getByText("VAT at 20%")).toBeInTheDocument();
    expect(total()).toBe("£361.80");
  });

  it("a shift's amount as it's typed; one with no date yet isn't counted", async () => {
    render(<NewInvoiceClient {...BASE} target={LINED} />);
    expect(within(shiftCards()[0]!).getByText("£153.00")).toBeInTheDocument();
    await userEvent.click(button("Add shift"));
    await userEvent.type(within(shiftCards()[2]!).getByLabelText("Hours"), "4");
    expect(within(shiftCards()[2]!).getByText("—")).toBeInTheDocument();
    expect(total()).toBe("£301.50");
    setDate(shiftCards()[2]!, "2027-02-16");
    expect(await within(shiftCards()[2]!).findByText("£72.00")).toBeInTheDocument();
    expect(total()).toBe("£373.50");
  });
});

describe("Review", () => {
  it("the shared schema first: each problem under its field, nothing sent", async () => {
    render(<NewInvoiceClient {...BASE} target={LINED} />);
    const hours = within(shiftCards()[0]!).getByLabelText("Hours");
    await userEvent.clear(hours);
    await userEvent.type(hours, "7.1");
    await userEvent.click(button("Review"));
    expect(calls.previewInvoice).not.toHaveBeenCalled();
    expect(within(shiftCards()[0]!).getByText("Enter the hours in quarter-hour steps, like 7.75")).toBeInTheDocument();
    expect(within(shiftCards()[0]!).getByLabelText("Hours")).toHaveAttribute("aria-invalid", "true");
    expect(screen.getByRole("alert")).toHaveTextContent("Please check the details marked below.");
  });

  it("a date before the family's first day: refused under the date, which gets focus; nothing sent", async () => {
    render(<NewInvoiceClient {...BASE} target={OLIVIA} />);
    const card = await addShift("2027-01-24", "6");
    await userEvent.click(button("Review"));
    expect(calls.previewInvoice).not.toHaveBeenCalled();
    expect(within(card).getByText(LINE_MESSAGES.tooEarly)).toBeInTheDocument();
    expect(dateOf(card)).toHaveAttribute("aria-invalid", "true");
    await waitFor(() => expect(document.activeElement).toBe(dateOf(card)));
  });

  it("no date chosen → Choose a date; a date after today → the future message", async () => {
    render(<NewInvoiceClient {...BASE} target={OLIVIA} />);
    await userEvent.click(button("Add shift"));
    await userEvent.type(within(shiftCards()[0]!).getByLabelText("Hours"), "6");
    await addShift("2027-02-18", "6");
    await userEvent.click(button("Review"));
    expect(within(shiftCards()[0]!).getByText(LINE_MESSAGES.date)).toBeInTheDocument();
    expect(within(shiftCards()[1]!).getByText(LINE_MESSAGES.future)).toBeInTheDocument();
    expect(calls.previewInvoice).not.toHaveBeenCalled();
  });

  it("a Review that throws (offline, a new deploy) says so on the form (code review M1)", async () => {
    calls.previewInvoice.mockRejectedValueOnce(new Error("Failed to find Server Action"));
    render(<NewInvoiceClient {...BASE} target={LINED} />);
    await userEvent.click(button("Review"));
    expect(await screen.findByRole("alert")).toHaveTextContent("Something went wrong. Please try again.");
    expect(button("Review")).toBeInTheDocument();
  });

  it("asks the server with the draft only: the family's link id, the lines, any correction — no kind, no period", async () => {
    render(<NewInvoiceClient {...BASE} target={LINED} />);
    await userEvent.click(button("Review"));
    expect(calls.previewInvoice).toHaveBeenCalledWith({
      targetId: PLACEMENT, replacesInvoiceId: null,
      lines: [
        { kind: "shift", date: "2027-02-15", hours: 8.5, ratePence: RATE, description: "" },
        { kind: "shift", date: "2027-02-17", hours: 8.25, ratePence: RATE, description: "" },
      ],
    });
  });

  it("expenses only through Review: the draft's one line is the expense", async () => {
    render(<NewInvoiceClient {...BASE} target={OLIVIA} />);
    await addExpense("travel", "8.40");
    await userEvent.click(button("Review"));
    expect(calls.previewInvoice).toHaveBeenCalledWith({
      targetId: PLACEMENT, replacesInvoiceId: null, lines: [{ kind: "expense", expenseType: "travel", amountPence: 840, description: "" }],
    });
  });

  it("the server's refusal by field lands under her fields; any other refusal shows its message", async () => {
    calls.previewInvoice.mockResolvedValueOnce({ ok: false, error: "too_early", message: LINE_MESSAGES.tooEarly, fields: { "lines.1.date": LINE_MESSAGES.tooEarly } });
    render(<NewInvoiceClient {...BASE} target={LINED} />);
    await userEvent.click(button("Review"));
    expect(await within(shiftCards()[1]!).findByText(LINE_MESSAGES.tooEarly)).toBeInTheDocument();
    calls.previewInvoice.mockResolvedValueOnce({ ok: false, error: "cap", message: "You can send up to 10 invoices a day. Please try again tomorrow." });
    await userEvent.click(button("Review"));
    expect(await screen.findByText("You can send up to 10 invoices a day. Please try again tomorrow.")).toBeInTheDocument();
  });

  it("a correction: the family is fixed, its lines keep their own dates, and the review sends what it replaces", async () => {
    render(<NewInvoiceClient {...BASE} target={{ ...OLIVIA, shifts: [row("2027-02-08", "6"), row("2027-01-29", "2", "22.00", "evening")],
      expenses: [{ expenseType: "activities", amount: "12.50", description: "" }], replaces: { invoiceId: OLD, number: "BB-SophieTaylor-270214-0001" } }} />);
    expect(screen.getByText("Olivia Hartley")).toBeInTheDocument();
    expect(screen.getByText("Replaces BB-SophieTaylor-270214-0001")).toBeInTheDocument();
    expect(screen.queryByLabelText("Family")).toBeNull();
    expect(shiftCards().map((c) => dateOf(c).value)).toEqual(["2027-02-08", "2027-01-29"]);
    expect(expenseCards()).toHaveLength(1);
    await userEvent.click(button("Review"));
    expect(calls.previewInvoice.mock.calls[0]?.[0]).toMatchObject({ targetId: PLACEMENT, replacesInvoiceId: OLD });
  });
});
