/**
 * `/admin/invoices`, the client half (plan 06 step 17, §14.6 c.1; brief §0.11, §3 admin 2–3; A14):
 * - The table: number, kind and period, family, nanny, hours, total with "incl. £x expenses" and the VAT mode, status
 *   with the reason and "Replaced by …" / "Replaces …", both recipients' deliveries, and "View PDF" (a new tab, through
 *   the admin PDF route).
 * - Filters (client-side over what was read): family, nanny, kind ("Hired" / "Trial"), status; a live count.
 * - "By family": each family's summary line, or only the chosen family's.
 * - Read-only: no button, no Cancel / Resend / Edit / New control, no text field, no bank field.
 * - A failed read: one plain message and no table; nothing read: "No invoices yet."; at the limit: "the newest 500".
 *
 * BB-wave1-041126/06c, 2026-11-23.
 */
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { AdminInvoicesClient } from "./AdminInvoicesClient";
import type { AdminInvoiceRow, AdminInvoicesView } from "./types";

const ID = (n: number) => `b0600000-0000-4000-8000-00000000900${n}`;

const row = (n: number, over: Partial<AdminInvoiceRow> = {}): AdminInvoiceRow => ({
  invoiceId: ID(n), number: `BB-SophieTaylor-270215-000${n}`, familyKey: "family-2", familyName: "Olivia Hartley", nannyKey: "nanny-1",
  nannyName: "Sophie Taylor", kind: "regular_week", kindLabel: "Hired", period: "8–12 Feb 2027", hours: "30 h", expenses: null, vat: "No VAT",
  total: "£540.00", status: "sent", statusLabel: "Sent", replacesNumber: null, replacedByNumber: null,
  deliveries: [{ text: "Emailed to the family", delivered: true }, { text: "Copy emailed to the nanny", delivered: true }],
  ...over,
});

const VIEW: AdminInvoicesView = {
  rows: [
    row(3, { hours: "28 h", total: "£516.50", expenses: "incl. £12.50 expenses", period: "8–13 Feb 2027", replacesNumber: "BB-SophieTaylor-270215-0001" }),
    row(2, {
      familyKey: "family-1", familyName: "Amira Ahmed", nannyKey: "nanny-2", nannyName: "Łucja Wiśniewska", number: "BB-LucjaWisniewska-270215-0001",
      kind: "trial_shift", kindLabel: "Trial", period: "3 Feb 2027", hours: "4 h", total: "£86.40", vat: "VAT added",
      deliveries: [{ text: "Not delivered to the family", delivered: false }, { text: "Copy emailed to the nanny", delivered: true }],
    }),
    row(1, {
      status: "cancelled", statusLabel: "Cancelled · Wrong hours", replacedByNumber: "BB-SophieTaylor-270215-0003",
      deliveries: [{ text: "Emailed to the family", delivered: true }, { text: "Cancellation not delivered to the nanny", delivered: false }],
    }),
  ],
  families: [
    { key: "family-1", name: "Amira Ahmed", summary: "1 invoice · 0 cancelled · 4 h · £86.40 (excluding cancelled)" },
    { key: "family-2", name: "Olivia Hartley", summary: "2 invoices · 1 cancelled · 28 h · £516.50 (excluding cancelled)" },
  ],
  nannies: [{ key: "nanny-1", name: "Sophie Taylor" }, { key: "nanny-2", name: "Łucja Wiśniewska" }],
  atLimit: false,
};

afterEach(cleanup);

const show = (view: AdminInvoicesView = VIEW, loadFailed = false) => render(<AdminInvoicesClient {...view} loadFailed={loadFailed} />);
const table = () => screen.getByRole("table", { name: "Invoices, newest first" });
const bodyRows = () => within(table()).getAllByRole("row").slice(1);
const summaries = () => within(screen.getByRole("region", { name: "By family" })).getAllByRole("listitem").map((li) => li.textContent);

describe("AdminInvoicesClient — the list", () => {
  it("shows every row with its number, kind and period, names, hours, total, expenses, VAT, status and deliveries", () => {
    show();
    expect(screen.getByRole("heading", { level: 1, name: "Invoices" })).toBeTruthy();
    expect(bodyRows()).toHaveLength(3);
    const first = within(bodyRows()[0] as HTMLElement);
    for (const text of ["BB-SophieTaylor-270215-0003", "Hired · 8–13 Feb 2027", "Olivia Hartley", "Sophie Taylor", "28 h", "£516.50", "incl. £12.50 expenses", "No VAT", "Sent", "Replaces BB-SophieTaylor-270215-0001", "Emailed to the family"]) {
      expect(first.getByText(text)).toBeTruthy();
    }
    const cancelled = within(bodyRows()[2] as HTMLElement);
    expect(cancelled.getByText("Cancelled · Wrong hours")).toBeTruthy();
    expect(cancelled.getByText("Replaced by BB-SophieTaylor-270215-0003")).toBeTruthy();
    expect(cancelled.getByText("Cancellation not delivered to the nanny")).toBeTruthy();
    expect(within(bodyRows()[1] as HTMLElement).getByText("Not delivered to the family")).toBeTruthy();
    expect(screen.getByRole("status").textContent).toBe("Showing 3 of 3 invoices");
  });

  it("'View PDF' opens the admin PDF route for that invoice in a new tab", () => {
    show();
    const link = within(bodyRows()[0] as HTMLElement).getByRole("link", { name: "View PDF of BB-SophieTaylor-270215-0003" });
    expect(link.getAttribute("href")).toBe(`/admin/invoices/${ID(3)}/pdf`);
    expect(link.getAttribute("target")).toBe("_blank");
    expect(link.getAttribute("rel")).toBe("noopener noreferrer");
    expect(screen.getAllByRole("link", { name: /^View PDF/ })).toHaveLength(3);
  });

  it("is read-only: no button, no write control, no text field, no bank field", () => {
    show();
    expect(screen.queryAllByRole("button")).toEqual([]);
    expect(screen.queryAllByRole("textbox")).toEqual([]);
    expect(screen.queryByText(/cancel invoice|resend|edit|new invoice|sort code|account/i)).toBeNull();
    expect(screen.getAllByRole("link").every((a) => /\/admin\/invoices\/[^/]+\/pdf$/.test(a.getAttribute("href") ?? ""))).toBe(true);
  });

  it("'By family' lists every family's summary line", () => {
    show();
    expect(summaries()).toEqual([
      "Amira Ahmed1 invoice · 0 cancelled · 4 h · £86.40 (excluding cancelled)",
      "Olivia Hartley2 invoices · 1 cancelled · 28 h · £516.50 (excluding cancelled)",
    ]);
  });
});

describe("AdminInvoicesClient — filters", () => {
  it("offers each family, nanny, kind and status, with an 'All' choice first", () => {
    show();
    const options = (name: string) => within(screen.getByRole("combobox", { name })).getAllByRole("option").map((o) => o.textContent);
    expect(options("Family")).toEqual(["All families", "Amira Ahmed", "Olivia Hartley"]);
    expect(options("Nanny")).toEqual(["All nannies", "Sophie Taylor", "Łucja Wiśniewska"]);
    expect(options("Kind")).toEqual(["All kinds", "Hired", "Trial"]);
    expect(options("Status")).toEqual(["All statuses", "Sent", "Cancelled"]);
  });

  it("a family: its rows and only its summary", async () => {
    show();
    await userEvent.selectOptions(screen.getByRole("combobox", { name: "Family" }), "Olivia Hartley");
    expect(bodyRows().map((r) => within(r).getByRole("rowheader").textContent)).toEqual([
      expect.stringContaining("BB-SophieTaylor-270215-0003"), expect.stringContaining("BB-SophieTaylor-270215-0001"),
    ]);
    expect(summaries()).toEqual(["Olivia Hartley2 invoices · 1 cancelled · 28 h · £516.50 (excluding cancelled)"]);
    expect(screen.getByRole("status").textContent).toBe("Showing 2 of 3 invoices");
  });

  it("nanny, kind and status narrow together; nothing left says so", async () => {
    show();
    await userEvent.selectOptions(screen.getByRole("combobox", { name: "Nanny" }), "Sophie Taylor");
    expect(bodyRows()).toHaveLength(2);
    await userEvent.selectOptions(screen.getByRole("combobox", { name: "Status" }), "Cancelled");
    expect(bodyRows()).toHaveLength(1);
    expect(within(bodyRows()[0] as HTMLElement).getByText("Cancelled · Wrong hours")).toBeTruthy();
    await userEvent.selectOptions(screen.getByRole("combobox", { name: "Kind" }), "Trial");
    expect(screen.queryByRole("table")).toBeNull();
    expect(screen.getByText("No invoices match these filters.")).toBeTruthy();
    expect(screen.getByRole("status").textContent).toBe("Showing 0 of 3 invoices");
    await userEvent.selectOptions(screen.getByRole("combobox", { name: "Nanny" }), "All nannies");
    await userEvent.selectOptions(screen.getByRole("combobox", { name: "Status" }), "All statuses");
    expect(bodyRows()).toHaveLength(1);
    expect(within(bodyRows()[0] as HTMLElement).getByText("Trial · 3 Feb 2027")).toBeTruthy();
  });
});

describe("AdminInvoicesClient — empty, failed, at the limit", () => {
  it("a failed read: one plain message, no table and no filters", () => {
    show({ rows: [], families: [], nannies: [], atLimit: false }, true);
    expect(screen.getByRole("alert").textContent).toBe("The invoices could not be read — try again.");
    expect(screen.queryByRole("table")).toBeNull();
    expect(screen.queryAllByRole("combobox")).toEqual([]);
  });

  it("nothing yet: 'No invoices yet.'", () => {
    show({ rows: [], families: [], nannies: [], atLimit: false });
    expect(screen.getByText("No invoices yet.")).toBeTruthy();
    expect(screen.queryByRole("table")).toBeNull();
  });

  it("at the limit: says only the newest are shown", () => {
    show({ ...VIEW, atLimit: true });
    expect(screen.getByText(/Showing the newest 3 only\./)).toBeTruthy();
  });
});
