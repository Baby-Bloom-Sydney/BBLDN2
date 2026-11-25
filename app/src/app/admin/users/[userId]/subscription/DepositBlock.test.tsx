/**
 * The deposit block in the family's Done-for-you panel (plan 03 row B3; brief 03 §3 Admin 1–7, D10, D15). The six
 * actions are B2's (`./deposit-actions`, contract-03b) and are mocked here: this spec pins what the panel shows and
 * what it asks the server for, never what the server does. Amounts are built from the price, never written.
 *
 * BB-wave2-231126/03-build, 2026-11-25.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const actions = vi.hoisted(() => ({
  sendDepositLink: vi.fn(),
  copyDepositLink: vi.fn(),
  takeDepositPaymentNow: vi.fn(),
  cancelDepositLink: vi.fn(),
  markDepositPaid: vi.fn(),
  recordDepositBankRefund: vi.fn(),
}));
const refresh = vi.hoisted(() => vi.fn());
vi.mock("./deposit-actions", () => actions);
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));

import { PRICES } from "@/config/prices";
import { depositAmount } from "@/lib/deposit/copy";
import type { DepositPanel, DepositPanelResult, PanelLink } from "@/lib/deposit/panel";
import { DepositBlock } from "./DepositBlock";

const PARENT = "b0300000-0000-4000-8000-000000000001";
const URL_ = "https://example.test/deposit/" + "Ab0_-".repeat(8) + "xyz";
const PAID_AT = "2027-02-03T09:00:00.000Z";
const CARD = Object.freeze({ brand: "visa", last4: "4242", expMonth: 12, expYear: 2030 });
const TAKEN = Object.freeze({ cohortStartDate: "2027-02-01", isGoodwill: false, state: "taken" as const });
const CURRENT = Object.freeze({ start: "2027-02-01", places: 5, taken: 5, beingPaid: 0, left: 0, overBy: 0 });
const NEXT = Object.freeze({ start: "2027-02-08", places: 5, taken: 0, beingPaid: 0, left: 5, overBy: 0 });
const LINK: PanelLink = Object.freeze({
  id: "d0300000-0000-4000-8000-000000000001",
  code: "Ab0_-".repeat(8) + "xyz",
  target: "current",
  goodwillStartDate: null,
  createdAt: "2027-02-03T08:59:00.000Z",
  lastEmailedAt: "2027-02-03T09:02:00.000Z",
  lastEmailedTo: "sarah@gmail.com",
});
const UNSENT: PanelLink = Object.freeze({ ...LINK, lastEmailedAt: null, lastEmailedTo: null });

const panelOf = (over: Partial<DepositPanel> = {}): DepositPanel => ({
  parentUserId: PARENT,
  today: "2027-02-03",
  state: "not_paid",
  payment: null,
  card: null,
  bankTransfer: null,
  place: null,
  link: null,
  prebooking: null,
  duplicatePayments: 0,
  warnings: [],
  cohorts: { current: CURRENT, next: NEXT, canOfferGoodwill: false },
  canTakeDeposit: true,
  canRecordBankRefund: false,
  ...over,
});
const paid = (method: "card" | "bank_transfer" | null, refundedAt: string | null = null) => ({
  pence: PRICES.dfy.depositPence,
  paidAt: PAID_AT,
  refundedAt,
  method,
  paymentIntentId: method === "card" ? "pi_3Test" : null,
});
const paidPanel = (over: Partial<DepositPanel>): DepositPanel => panelOf({ canTakeDeposit: false, ...over });

const renderBlock = (deposit: DepositPanelResult) => render(<DepositBlock parentUserId={PARENT} deposit={deposit} />);
const renderPanel = (over: Partial<DepositPanel> = {}) => renderBlock({ ok: true, value: panelOf(over) });
const button = (name: string | RegExp) => screen.getByRole("button", { name });
const noButton = (name: string | RegExp) => expect(screen.queryByRole("button", { name })).toBeNull();
const stateLine = () => screen.getByTestId("deposit-state-line");
const alerts = () => screen.queryAllByRole("alert").map((a) => a.textContent);
const writeText = vi.fn();

beforeEach(() => {
  for (const fn of Object.values(actions)) fn.mockReset();
  refresh.mockReset();
  writeText.mockReset().mockResolvedValue(undefined);
  Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
});
afterEach(() => vi.restoreAllMocks());

const amount = () => depositAmount();

describe("the state lines (brief §3 Admin 1)", () => {
  it("not paid: the state, no link yet, and every way to take the deposit", () => {
    renderPanel();
    expect(stateLine()).toHaveTextContent("Not paid");
    expect(screen.getByTestId("deposit-link-line")).toHaveTextContent("No deposit link yet");
    for (const name of ["Email deposit link", "Copy link", "Take payment now", "Mark deposit paid (bank transfer)"]) expect(button(name)).toBeEnabled();
    noButton("Cancel link");
    noButton("Record refund (bank transfer)");
    expect(alerts()).toEqual([]);
  });

  it.each([
    ["paid by card, card saved", { state: "paid_card", payment: paid("card"), card: CARD, place: TAKEN }, (): string => `Paid ${amount()} by card, 3 Feb · Card saved Visa •••• 4242 (12/30) · Cohort Mon 1 Feb`],
    ["paid by card, card not recorded", { state: "paid_card", payment: paid("card") }, (): string => `Paid ${amount()} by card, 3 Feb · Card: not recorded`],
    ["paid by bank transfer", { state: "paid_bank_transfer", payment: paid("bank_transfer"), canRecordBankRefund: true }, (): string => `Paid ${amount()} by bank transfer · no card saved`],
    ["an old preset payment", { state: "paid_preset", payment: paid(null) }, (): string => `Paid ${amount()}, 3 Feb (old payment link) · no card saved`],
    ["refunded", { state: "refunded", payment: paid("card", "2027-02-10T12:00:00.000Z") }, (): string => "Refunded 10 Feb"],
  ] as const)("%s: its line, and Send, Copy, Take payment, Cancel and the target choice are hidden", (_name, over, line) => {
    renderBlock({ ok: true, value: paidPanel({ ...over, link: LINK, cohorts: { current: CURRENT, next: NEXT, canOfferGoodwill: true } }) });
    expect(stateLine()).toHaveTextContent(line());
    for (const name of ["Email deposit link", "Copy link", "Take payment now", "Cancel link", "Mark deposit paid (bank transfer)"]) noButton(name);
    expect(screen.queryByRole("radio")).toBeNull();
    expect(screen.queryByTestId("deposit-link-line")).toBeNull();
  });

  it("Record refund (bank transfer) only for a bank-transfer deposit not yet refunded", () => {
    renderBlock({ ok: true, value: paidPanel({ state: "paid_bank_transfer", payment: paid("bank_transfer"), canRecordBankRefund: true }) });
    expect(button("Record refund (bank transfer)")).toBeEnabled();
  });

  it("pre-booked: its line", () => {
    renderPanel({ prebooking: { id: "e0300000-0000-4000-8000-000000000001", parentUserId: PARENT, cohortStartDate: "2027-02-08", callBookingId: null, createdAt: PAID_AT } });
    expect(screen.getByText("Pre-booked for Mon 8 Feb")).toBeInTheDocument();
  });

  it.each([
    [LINK, "Sent 09:02 to s•••@gmail.com"],
    [UNSENT, "Link made, not emailed yet"],
    [null, "No deposit link yet"],
  ])("the link line for %j", (link, line) => {
    renderPanel({ link });
    expect(screen.getByTestId("deposit-link-line")).toHaveTextContent(line);
  });

  it("the warnings, in the amber alert style (brief §3 Admin 7)", () => {
    renderPanel({ warnings: ["duplicate_payment", "refunded_but_held"] });
    expect(alerts()).toEqual(["Second deposit received. Refund one in Stripe", "Deposit refunded but place still held"]);
    for (const alert of screen.getAllByRole("alert")) expect(alert).toHaveClass("text-amber-700");
  });

  it("{ ok: false }: one line, no deposit controls", () => {
    renderBlock({ ok: false, status: "error" });
    expect(alerts()).toEqual(["Deposit: could not be read"]);
    expect(screen.queryAllByRole("button")).toEqual([]);
    expect(screen.queryByTestId("deposit-state-line")).toBeNull();
  });
});

describe("the target choice (D10)", () => {
  it("not offered: no choice, and the link is for the current cohort", async () => {
    actions.sendDepositLink.mockResolvedValue({ ok: true, sentAt: PAID_AT, to: "s•••@gmail.com" });
    renderPanel();
    expect(screen.queryByRole("radio")).toBeNull();
    expect(screen.queryByText(/Next cohort, goodwill/)).toBeNull();
    await userEvent.click(button("Email deposit link"));
    expect(actions.sendDepositLink).toHaveBeenCalledWith(PARENT, { target: "current" });
  });

  it("offered: Current cohort by default, goodwill names next week; picking it sends goodwill", async () => {
    actions.copyDepositLink.mockResolvedValue({ ok: true, url: URL_ });
    renderPanel({ cohorts: { current: CURRENT, next: NEXT, canOfferGoodwill: true } });
    expect(screen.getByRole("radio", { name: "Current cohort" })).toBeChecked();
    const goodwill = screen.getByRole("radio", { name: "Next cohort, goodwill (Mon 8 Feb · 5 left)" });
    expect(goodwill).not.toBeChecked();
    await userEvent.click(button("Copy link"));
    expect(actions.copyDepositLink).toHaveBeenLastCalledWith(PARENT, { target: "current" });
    await userEvent.click(goodwill);
    await userEvent.click(button("Copy link"));
    expect(actions.copyDepositLink).toHaveBeenLastCalledWith(PARENT, { target: "goodwill" });
  });

  it("offered with no next cohort read → no choice", () => {
    renderPanel({ cohorts: { current: CURRENT, next: null, canOfferGoodwill: true } });
    expect(screen.queryByRole("radio")).toBeNull();
  });
});

describe("Email deposit link (brief §3 Admin 3)", () => {
  it("first send: the action, then the page refreshes", async () => {
    actions.sendDepositLink.mockResolvedValue({ ok: true, sentAt: PAID_AT, to: "s•••@gmail.com" });
    renderPanel({ link: UNSENT });
    await userEvent.click(button("Email deposit link"));
    expect(actions.sendDepositLink).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(refresh).toHaveBeenCalledTimes(1));
    expect(alerts()).toEqual([]);
  });

  it("disabled while sending; one request at a time", async () => {
    let resolve: (v: unknown) => void = () => undefined;
    actions.sendDepositLink.mockReturnValue(new Promise((r) => (resolve = r)));
    renderPanel();
    await userEvent.click(button("Email deposit link"));
    expect(button("Email deposit link")).toBeDisabled();
    expect(button("Copy link")).toBeDisabled();
    expect(button("Take payment now")).toBeDisabled();
    resolve({ ok: true, sentAt: PAID_AT, to: "s•••@gmail.com" });
    await waitFor(() => expect(button("Email deposit link")).toBeEnabled());
    expect(actions.sendDepositLink).toHaveBeenCalledTimes(1);
  });

  it("a second send asks first: 'Sent at 09:02. Send again?'; Not now sends nothing", async () => {
    renderPanel({ link: LINK });
    await userEvent.click(button("Email deposit link"));
    expect(screen.getByText("Sent at 09:02. Send again?")).toBeInTheDocument();
    expect(actions.sendDepositLink).not.toHaveBeenCalled();
    await userEvent.click(button("Not now"));
    expect(screen.queryByText("Sent at 09:02. Send again?")).toBeNull();
    expect(actions.sendDepositLink).not.toHaveBeenCalled();
  });

  it("Send again → the action with confirmResend", async () => {
    actions.sendDepositLink.mockResolvedValue({ ok: true, sentAt: PAID_AT, to: "s•••@gmail.com" });
    renderPanel({ link: LINK });
    await userEvent.click(button("Email deposit link"));
    await userEvent.click(button("Send again"));
    expect(actions.sendDepositLink).toHaveBeenCalledWith(PARENT, { target: "current", confirmResend: true });
    await waitFor(() => expect(refresh).toHaveBeenCalled());
  });

  it("the server's confirm_resend (the page was stale) asks with its time, then resends", async () => {
    actions.sendDepositLink
      .mockResolvedValueOnce({ ok: false, error: "confirm_resend", sentAt: "2027-02-03T09:30:00.000Z" })
      .mockResolvedValueOnce({ ok: true, sentAt: PAID_AT, to: "s•••@gmail.com" });
    renderPanel({ link: UNSENT });
    await userEvent.click(button("Email deposit link"));
    expect(await screen.findByText("Sent at 09:30. Send again?")).toBeInTheDocument();
    await userEvent.click(button("Send again"));
    expect(actions.sendDepositLink).toHaveBeenLastCalledWith(PARENT, { target: "current", confirmResend: true });
  });

  it("email_failed: the copy-link line in the alert, and the link with the Copy control", async () => {
    actions.sendDepositLink.mockResolvedValue({ ok: false, error: "email_failed", url: URL_ });
    renderPanel();
    await userEvent.click(button("Email deposit link"));
    expect(await screen.findByRole("alert")).toHaveTextContent("Email didn't send. Copy the link instead.");
    expect(screen.getByRole("textbox", { name: "Deposit link" })).toHaveValue(URL_);
    await userEvent.click(button("Copy"));
    expect(writeText).toHaveBeenCalledWith(URL_);
  });

  it.each([
    ["no_email", "This family has no email address. Copy the link instead."],
    ["already_paid", "The deposit is already paid."],
    ["goodwill_not_offered", "Goodwill isn't on offer now. Reload the page."],
    ["something_new", "Something went wrong. Try again."],
  ])("a refusal (%s) → its plain line in role=alert; no refresh", async (error, line) => {
    actions.sendDepositLink.mockResolvedValue({ ok: false, error });
    renderPanel();
    await userEvent.click(button("Email deposit link"));
    expect(await screen.findByRole("alert")).toHaveTextContent(line);
    expect(refresh).not.toHaveBeenCalled();
  });

  it("an action that throws → the generic line, and the button works again", async () => {
    actions.sendDepositLink.mockRejectedValue(new Error("offline"));
    renderPanel();
    await userEvent.click(button("Email deposit link"));
    expect(await screen.findByRole("alert")).toHaveTextContent("Something went wrong. Try again.");
    expect(button("Email deposit link")).toBeEnabled();
  });
});

describe("target_differs (03a handoff): nothing happens until BAI picks", () => {
  const DIFFERS = { ok: false, error: "target_differs", openTarget: "goodwill", openGoodwillStartDate: "2027-02-08" } as const;
  const LINE = "The open link is for the goodwill cohort Mon 8 Feb. Use it as it is, or cancel it and make a new one?";

  it.each([
    ["Send as is", "send_as_is"],
    ["Cancel and send again", "replace"],
  ])("send → the prompt; %s → onTargetDiffers %s", async (choice, value) => {
    actions.sendDepositLink.mockResolvedValueOnce(DIFFERS).mockResolvedValueOnce({ ok: true, sentAt: PAID_AT, to: "s•••@gmail.com" });
    renderPanel();
    await userEvent.click(button("Email deposit link"));
    expect(await screen.findByText(LINE)).toBeInTheDocument();
    expect(button("Send as is")).toBeEnabled();
    expect(button("Cancel and send again")).toBeEnabled();
    expect(actions.sendDepositLink).toHaveBeenCalledTimes(1);
    expect(refresh).not.toHaveBeenCalled();
    await userEvent.click(button(choice));
    expect(actions.sendDepositLink).toHaveBeenLastCalledWith(PARENT, { target: "current", onTargetDiffers: value });
  });

  it("a confirmed resend keeps its confirmation through the target choice", async () => {
    actions.sendDepositLink.mockResolvedValueOnce(DIFFERS).mockResolvedValueOnce({ ok: true, sentAt: PAID_AT, to: "s•••@gmail.com" });
    renderPanel({ link: LINK });
    await userEvent.click(button("Email deposit link"));
    await userEvent.click(button("Send again"));
    await userEvent.click(await screen.findByRole("button", { name: "Send as is" }));
    expect(actions.sendDepositLink).toHaveBeenLastCalledWith(PARENT, { target: "current", confirmResend: true, onTargetDiffers: "send_as_is" });
  });

  it.each([
    ["Copy as is", "send_as_is"],
    ["Cancel and copy a new one", "replace"],
  ])("copy → the prompt for the current cohort; %s → onTargetDiffers %s", async (choice, value) => {
    actions.copyDepositLink
      .mockResolvedValueOnce({ ok: false, error: "target_differs", openTarget: "current", openGoodwillStartDate: null })
      .mockResolvedValueOnce({ ok: true, url: URL_ });
    renderPanel();
    await userEvent.click(button("Copy link"));
    expect(await screen.findByText("The open link is for the current cohort. Use it as it is, or cancel it and make a new one?")).toBeInTheDocument();
    expect(screen.queryByRole("textbox", { name: "Deposit link" })).toBeNull();
    await userEvent.click(button(choice));
    expect(actions.copyDepositLink).toHaveBeenLastCalledWith(PARENT, { target: "current", onTargetDiffers: value });
    expect(await screen.findByRole("textbox", { name: "Deposit link" })).toHaveValue(URL_);
  });
});

describe("Copy link and Take payment now (brief §3 Admin 4; D15)", () => {
  it("Copy link: the action, the URL with the Copy control, a refresh; no email", async () => {
    actions.copyDepositLink.mockResolvedValue({ ok: true, url: URL_ });
    renderPanel();
    await userEvent.click(button("Copy link"));
    expect(await screen.findByRole("textbox", { name: "Deposit link" })).toHaveValue(URL_);
    await userEvent.click(button("Copy"));
    expect(writeText).toHaveBeenCalledWith(URL_);
    expect(refresh).toHaveBeenCalledTimes(1);
    expect(actions.sendDepositLink).not.toHaveBeenCalled();
  });

  it("a Copy the browser refuses selects the link instead", async () => {
    writeText.mockRejectedValue(new Error("denied"));
    actions.copyDepositLink.mockResolvedValue({ ok: true, url: URL_ });
    renderPanel();
    await userEvent.click(button("Copy link"));
    const box = (await screen.findByRole("textbox", { name: "Deposit link" })) as HTMLInputElement;
    await userEvent.click(button("Copy"));
    await waitFor(() => expect(document.activeElement).toBe(box));
  });

  it("Take payment now: opens the link in a new tab with noopener/noreferrer, offers the link too; no email", async () => {
    const open = vi.spyOn(window, "open").mockImplementation(() => null);
    actions.takeDepositPaymentNow.mockResolvedValue({ ok: true, url: URL_ });
    renderPanel();
    await userEvent.click(button("Take payment now"));
    await waitFor(() => expect(open).toHaveBeenCalledWith(URL_, "_blank", "noopener,noreferrer"));
    expect(actions.takeDepositPaymentNow).toHaveBeenCalledWith(PARENT);
    const page = screen.getByRole("link", { name: "Open the payment page" });
    expect(page).toHaveAttribute("href", URL_);
    expect(page).toHaveAttribute("target", "_blank");
    expect(page).toHaveAttribute("rel", "noopener noreferrer");
    expect(actions.sendDepositLink).not.toHaveBeenCalled();
    expect(alerts()).toEqual([]);
  });

  it("Take payment now refused (paid meanwhile) → the line, no tab", async () => {
    const open = vi.spyOn(window, "open").mockImplementation(() => null);
    actions.takeDepositPaymentNow.mockResolvedValue({ ok: false, error: "already_paid" });
    renderPanel();
    await userEvent.click(button("Take payment now"));
    expect(await screen.findByRole("alert")).toHaveTextContent("The deposit is already paid.");
    expect(open).not.toHaveBeenCalled();
    expect(screen.queryByRole("link", { name: "Open the payment page" })).toBeNull();
  });
});

describe("Cancel link (brief §3 Admin 4)", () => {
  const QUESTION = "Cancel this link? It stops working, but a payment page already open can still be paid.";

  it("only while a link is open", () => {
    renderPanel();
    noButton("Cancel link");
  });

  it("asks first, with wording that never promises to close an open payment page; Not now does nothing", async () => {
    renderPanel({ link: LINK });
    await userEvent.click(button("Cancel link"));
    expect(screen.getByText(QUESTION)).toBeInTheDocument();
    await userEvent.click(button("Not now"));
    expect(actions.cancelDepositLink).not.toHaveBeenCalled();
    expect(screen.queryByText(QUESTION)).toBeNull();
  });

  it("confirmed → the action, then a refresh", async () => {
    actions.cancelDepositLink.mockResolvedValue({ ok: true, cancelled: true });
    renderPanel({ link: LINK });
    await userEvent.click(button("Cancel link"));
    await userEvent.click(button("Yes, cancel link"));
    expect(actions.cancelDepositLink).toHaveBeenCalledWith(PARENT);
    await waitFor(() => expect(refresh).toHaveBeenCalledTimes(1));
    expect(alerts()).toEqual([]);
  });

  it("nothing was open any more → says so; a refusal → its line", async () => {
    actions.cancelDepositLink.mockResolvedValueOnce({ ok: true, cancelled: false }).mockResolvedValueOnce({ ok: false, error: "not_admin" });
    renderPanel({ link: LINK });
    await userEvent.click(button("Cancel link"));
    await userEvent.click(button("Yes, cancel link"));
    expect(await screen.findByText("There was no open link to cancel.")).toBeInTheDocument();
    await userEvent.click(button("Cancel link"));
    await userEvent.click(button("Yes, cancel link"));
    expect(await screen.findByRole("alert")).toHaveTextContent("Only an admin can do this. Sign in again.");
  });
});

describe("the dialogs' buttons sit in the block", () => {
  it("Mark paid opens its dialog from the block", async () => {
    renderPanel();
    await userEvent.click(button("Mark deposit paid (bank transfer)"));
    const dialog = within(await screen.findByRole("dialog"));
    expect(dialog.getByRole("heading", { name: "Mark deposit paid (bank transfer)" })).toBeInTheDocument();
  });
});
