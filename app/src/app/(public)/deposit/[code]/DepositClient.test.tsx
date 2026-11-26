/**
 * The parent's deposit page, drawn (plan 03 row C1, §3 "Page state", "Pay"; brief 03 §0.2, §3 parent 1–9, §7). Each
 * state shows its own words from `copy.ts` — the amount only ever through the formatter (`PRICES`, stubbed here to
 * prove the page follows it). Pay calls the action with the code, is disabled while pending (a double tap sends one
 * request), and on a session goes to Stripe with a full navigation; any other answer shows its state or line.
 */
import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const price = vi.hoisted(() => ({ depositPence: null as number | null }));
vi.mock("@/config/prices", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/config/prices")>();
  return {
    ...actual,
    PRICES: {
      ...actual.PRICES,
      get dfy() {
        return { ...actual.PRICES.dfy, depositPence: price.depositPence ?? actual.PRICES.dfy.depositPence };
      },
    },
  };
});
const h = vi.hoisted(() => ({ payDeposit: vi.fn(), panels: [] as Array<Record<string, unknown>> }));
vi.mock("./actions", () => ({ payDeposit: h.payDeposit }));
vi.mock("./PrebookPanel", () => ({
  PrebookPanel: (props: Record<string, unknown>) => {
    h.panels.push(props);
    return <div data-testid="prebook-panel" />;
  },
}));

import { PRICES } from "@/config/prices";
import { SITE_URL } from "@/lib/constants";
import { bookableIntro, depositAmount, PAGE_COPY, payButtonLabel, placeHeading } from "@/lib/deposit/copy";
import type { DepositPageState } from "@/lib/deposit/types";
import { DepositClient } from "./DepositClient";

const CODE = "Dc0_-".repeat(8) + "xyz";
const BOOKABLE: DepositPageState = { kind: "bookable", start: "2027-02-01", goodwill: false };
const SESSION_URL = "https://checkout.stripe.com/c/pay/cs_test_dep101";
const POUND = "£";

const originalLocation = window.location;
let assign: ReturnType<typeof vi.fn>;

function draw(initialState: DepositPageState = BOOKABLE, firstName: string | null = "Sarah", prebooked = false) {
  return render(<DepositClient code={CODE} initialState={initialState} firstName={firstName} prebooked={prebooked} />);
}
const payButton = () => screen.getByRole("button", { name: payButtonLabel() });
const stateBox = () => screen.getByTestId("deposit-state");

beforeEach(() => {
  price.depositPence = null;
  h.payDeposit.mockReset();
  h.panels = [];
  assign = vi.fn();
  Object.defineProperty(window, "location", { configurable: true, writable: true, value: { ...originalLocation, assign } });
});
afterEach(() => {
  Object.defineProperty(window, "location", { configurable: true, writable: true, value: originalLocation });
});

describe("DepositClient — each state's words", () => {
  it("bookable: her name, the cohort date, the intro, the consent and footnote, and Pay <amount>", () => {
    draw();
    expect(stateBox()).toHaveAttribute("data-state", "bookable");
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent(placeHeading("2027-02-01"));
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("Your place in the cohort starting Monday 1 February");
    expect(screen.getByText(bookableIntro("Sarah", "2027-02-01"))).toBeInTheDocument();
    expect(screen.getByText(/^Hi Sarah\./)).toBeInTheDocument();
    expect(screen.getByText(PAGE_COPY.consent)).toBeInTheDocument();
    expect(screen.getByText(PAGE_COPY.footnote)).toBeInTheDocument();
    expect(payButton()).toHaveTextContent(`Pay ${depositAmount()}`);
    expect(screen.getByTestId("deposit-pay")).toBe(payButton());
  });

  it("the amount follows PRICES: a different deposit, a different page", () => {
    const base = PRICES.dfy.depositPence;
    price.depositPence = base * 2;
    draw();
    const doubled = `${POUND}${((base * 2) / 100).toLocaleString("en-GB")}`;
    expect(doubled).not.toBe(`${POUND}${(base / 100).toLocaleString("en-GB")}`);
    expect(payButton()).toHaveTextContent(`Pay ${doubled}`);
    expect(screen.getByText(new RegExp(`Your ${doubled.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")} deposit`))).toBeInTheDocument();
  });

  it("no first name → \"Hello.\"", () => {
    draw(BOOKABLE, null);
    expect(screen.getByText(/^Hello\. Your/)).toBeInTheDocument();
  });

  it("a goodwill link names its pinned next cohort", () => {
    draw({ kind: "bookable", start: "2027-02-08", goodwill: true });
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("Your place in the cohort starting Monday 8 February");
  });

  it("paid: \"Your deposit is paid. Thank you.\" and no Pay", () => {
    draw({ kind: "paid" });
    expect(stateBox()).toHaveAttribute("data-state", "paid");
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent(PAGE_COPY.paid);
    expect(screen.queryByTestId("deposit-pay")).toBeNull();
    expect(screen.queryByTestId("prebook-panel")).toBeNull();
  });

  it("full: \"This cohort is full\" and Pre-book (the panel), no Pay", () => {
    draw({ kind: "full", nextAvailable: "2027-02-08" }, "Sarah", true);
    expect(stateBox()).toHaveAttribute("data-state", "full");
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent(PAGE_COPY.full);
    expect(screen.getByTestId("prebook-panel")).toBeInTheDocument();
    expect(h.panels[0]).toMatchObject({ code: CODE, prebooked: true });
    expect(screen.queryByTestId("deposit-pay")).toBeNull();
  });

  it("being paid: the being-paid line and Pre-book, no Pay", () => {
    draw({ kind: "being_paid", nextAvailable: null });
    expect(stateBox()).toHaveAttribute("data-state", "being_paid");
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent(PAGE_COPY.beingPaid);
    expect(screen.getByTestId("prebook-panel")).toBeInTheDocument();
    expect(h.panels[0]).toMatchObject({ prebooked: false });
    expect(screen.queryByTestId("deposit-pay")).toBeNull();
  });

  it("invalid: the one invalid page", () => {
    draw({ kind: "invalid" });
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent(PAGE_COPY.invalid);
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("the pre-book panel can move focus to the page heading", () => {
    draw({ kind: "full", nextAvailable: null });
    const onFocusHeading = h.panels[0].onFocusHeading as () => void;
    act(() => onFocusHeading());
    expect(screen.getByRole("heading", { level: 1 })).toHaveFocus();
  });

  it("the pre-book panel can turn the page into the invalid page (a link cancelled meanwhile)", async () => {
    draw({ kind: "full", nextAvailable: null });
    const onInvalid = h.panels[0].onInvalid as () => void;
    act(() => onInvalid());
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent(PAGE_COPY.invalid);
  });
});

describe("DepositClient — Pay", () => {
  it("sends the code; a session → a full navigation to it; Pay stays disabled", async () => {
    h.payDeposit.mockResolvedValue({ ok: true, kind: "redirect", url: SESSION_URL });
    const user = userEvent.setup();
    draw();
    await user.click(payButton());
    await waitFor(() => expect(assign).toHaveBeenCalledWith(SESSION_URL));
    expect(h.payDeposit).toHaveBeenCalledWith(CODE);
    expect(payButton()).toBeDisabled();
  });

  it("disabled while pending: a double tap sends one request", async () => {
    let answer: (value: unknown) => void = () => {};
    h.payDeposit.mockImplementation(() => new Promise((resolve) => { answer = resolve; }));
    const user = userEvent.setup();
    draw();
    await user.click(payButton());
    expect(payButton()).toBeDisabled();
    expect(payButton()).toHaveAttribute("aria-busy", "true");
    await user.click(payButton());
    expect(h.payDeposit).toHaveBeenCalledTimes(1);
    await act(async () => answer({ ok: false, error: "try_again" }));
    expect(payButton()).toBeEnabled();
  });

  it.each([
    [{ kind: "full", nextAvailable: "2027-02-08" }, PAGE_COPY.full],
    [{ kind: "being_paid", nextAvailable: "2027-02-08" }, PAGE_COPY.beingPaid],
    [{ kind: "paid" }, PAGE_COPY.paid],
  ] as const)("the answer is a state (%o) → that state", async (state, line) => {
    h.payDeposit.mockResolvedValue({ ok: true, kind: "state", state });
    const user = userEvent.setup();
    draw();
    await user.click(payButton());
    await waitFor(() => expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent(line));
    expect(assign).not.toHaveBeenCalled();
  });

  it.each([
    ["try_again", PAGE_COPY.tryAgain],
    ["try_again_soon", PAGE_COPY.tryAgainSoon],
  ] as const)("%s → its line as an alert; Pay works again", async (error, line) => {
    h.payDeposit.mockResolvedValue({ ok: false, error });
    const user = userEvent.setup();
    draw();
    await user.click(payButton());
    expect(await screen.findByRole("alert")).toHaveTextContent(line);
    expect(payButton()).toBeEnabled();
  });

  it.each(["invalid", "deposit_disabled"] as const)("%s → the invalid page", async (error) => {
    h.payDeposit.mockResolvedValue({ ok: false, error });
    const user = userEvent.setup();
    draw();
    await user.click(payButton());
    await waitFor(() => expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent(PAGE_COPY.invalid));
  });

  it("a throw (the network) → try again, never stuck", async () => {
    h.payDeposit.mockRejectedValue(new Error("offline"));
    const user = userEvent.setup();
    draw();
    await user.click(payButton());
    expect(await screen.findByRole("alert")).toHaveTextContent(PAGE_COPY.tryAgain);
    expect(payButton()).toBeEnabled();
  });

  it("a new press clears the last line", async () => {
    h.payDeposit.mockResolvedValueOnce({ ok: false, error: "try_again" }).mockImplementationOnce(() => new Promise(() => {}));
    const user = userEvent.setup();
    draw();
    await user.click(payButton());
    await screen.findByRole("alert");
    await user.click(payButton());
    expect(screen.queryByRole("alert")).toBeNull();
  });
});

describe("DepositClient — the server's state wins (03c review H1: router.refresh after not_offered)", () => {
  it("new props from the server replace what the page shows, even after Pay showed another state", async () => {
    h.payDeposit.mockResolvedValue({ ok: true, kind: "state", state: { kind: "full", nextAvailable: null } });
    const user = userEvent.setup();
    const view = draw();
    await user.click(payButton());
    await waitFor(() => expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent(PAGE_COPY.full));
    // The refresh renders the page again: a NEW state object from the server, here bookable once more.
    view.rerender(<DepositClient code={CODE} initialState={{ ...BOOKABLE }} firstName="Sarah" prebooked={false} />);
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent(placeHeading("2027-02-01"));
    expect(payButton()).toBeEnabled();
  });

  it("a new paid state from the server shows paid", () => {
    const view = draw({ kind: "full", nextAvailable: null });
    view.rerender(<DepositClient code={CODE} initialState={{ kind: "paid" }} firstName={null} prebooked={false} />);
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent(PAGE_COPY.paid);
  });

  it("a re-render with the same state object (no new server state) keeps what Pay showed", async () => {
    h.payDeposit.mockResolvedValue({ ok: true, kind: "state", state: { kind: "paid" } });
    const user = userEvent.setup();
    const view = draw(BOOKABLE);
    await user.click(payButton());
    await waitFor(() => expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent(PAGE_COPY.paid));
    view.rerender(<DepositClient code={CODE} initialState={BOOKABLE} firstName="Sarah" prebooked={false} />);
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent(PAGE_COPY.paid);
  });
});

describe("DepositClient — focus follows a change of state (03c review M3)", () => {
  it("not on the first render", () => {
    draw();
    expect(screen.getByRole("heading", { level: 1 })).not.toHaveFocus();
  });

  it.each([
    [{ kind: "full", nextAvailable: null }],
    [{ kind: "paid" }],
  ] as const)("Pay → %o: focus on the new heading", async (state) => {
    h.payDeposit.mockResolvedValue({ ok: true, kind: "state", state });
    const user = userEvent.setup();
    draw();
    await user.click(payButton());
    await waitFor(() => expect(screen.getByRole("heading", { level: 1 })).toHaveFocus());
  });

  it("Pay → invalid: focus on the invalid page's heading", async () => {
    h.payDeposit.mockResolvedValue({ ok: false, error: "invalid" });
    const user = userEvent.setup();
    draw();
    await user.click(payButton());
    await waitFor(() => expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent(PAGE_COPY.invalid));
    expect(screen.getByRole("heading", { level: 1 })).toHaveFocus();
  });
});

describe("DepositClient — back from Stripe through the browser's cache (03c review H2)", () => {
  async function payAndLeave() {
    h.payDeposit.mockResolvedValue({ ok: true, kind: "redirect", url: SESSION_URL });
    const user = userEvent.setup();
    const view = draw();
    await user.click(payButton());
    await waitFor(() => expect(assign).toHaveBeenCalledWith(SESSION_URL));
    expect(payButton()).toBeDisabled();
    return { user, view };
  }
  const pageshow = (persisted: boolean) => act(() => {
    window.dispatchEvent(Object.assign(new Event("pageshow"), { persisted }));
  });

  it("a page restored from the cache (pageshow, persisted) gets Pay back: not pending, no line", async () => {
    const { user } = await payAndLeave();
    pageshow(true);
    expect(payButton()).toBeEnabled();
    expect(payButton()).not.toHaveAttribute("aria-busy", "true");
    expect(screen.queryByRole("alert")).toBeNull();
    await user.click(payButton());
    expect(h.payDeposit).toHaveBeenCalledTimes(2);
  });

  it("a fresh pageshow (not from the cache) changes nothing", async () => {
    await payAndLeave();
    pageshow(false);
    expect(payButton()).toBeDisabled();
  });

  it("the listener goes with the page", async () => {
    const remove = vi.spyOn(window, "removeEventListener");
    const { view } = await payAndLeave();
    view.unmount();
    expect(remove).toHaveBeenCalledWith("pageshow", expect.any(Function));
    remove.mockRestore();
  });
});

describe("DepositClient — Pay leaves only for Stripe's page or this site's own done page (03c review L)", () => {
  it.each([
    "https://evil.example/c/pay/cs_test_1",
    "http://checkout.stripe.com/c/pay/cs_test_1",
    "https://checkout.stripe.com.evil.example/c/pay",
    "javascript:alert(1)",
  ])("%s → try again, no navigation", async (url) => {
    h.payDeposit.mockResolvedValue({ ok: true, kind: "redirect", url });
    const user = userEvent.setup();
    draw();
    await user.click(payButton());
    expect(await screen.findByRole("alert")).toHaveTextContent(PAGE_COPY.tryAgain);
    expect(assign).not.toHaveBeenCalled();
    expect(payButton()).toBeEnabled();
  });

  it("a session already complete → 03a's own done page on this site", async () => {
    const done = `${SITE_URL}/deposit/${CODE}/done?session=cs_test_done1`;
    h.payDeposit.mockResolvedValue({ ok: true, kind: "redirect", url: done });
    const user = userEvent.setup();
    draw();
    await user.click(payButton());
    await waitFor(() => expect(assign).toHaveBeenCalledWith(done));
  });
});
