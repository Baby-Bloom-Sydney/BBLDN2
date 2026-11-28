/**
 * The calls page client with JustCall logging on (plan 05 §5 B6; D1): 04's `CallsClient` with brief 05's two slots —
 * the Unmatched JustCall calls in the Calls tab, and the JustCall lines and Add outcome under each past attempt in the
 * drawer. A save or a change refreshes the page.
 */
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const nav = vi.hoisted(() => ({ push: vi.fn(), refresh: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => nav, useSearchParams: () => new URLSearchParams() }));
vi.mock("./actions", () => ({
  holdCallForFamily: vi.fn(),
  confirmCallForFamily: vi.fn(),
  cancelCallForFamily: vi.fn(),
  reloadFamilySlots: vi.fn(),
  recordCallOutcomeAction: vi.fn(),
  saveCallSettingsAction: vi.fn(),
  saveWeeklyHoursAction: vi.fn(),
  addCallBlockAction: vi.fn(),
  removeCallBlockAction: vi.fn(),
  startCallBookingAction: vi.fn(),
}));
const jc = vi.hoisted(() => ({
  saveJustCallOutcomeAction: vi.fn(),
  attachJustCallAction: vi.fn(),
  dismissJustCallAction: vi.fn(),
  searchFamiliesForCallAction: vi.fn(),
  nextFamilyToCallAction: vi.fn(),
}));
vi.mock("./justcall-actions", () => jc);
// 05b: the dialer hook is a fake whose state each test sets (the SDK never loads here).
const dial = vi.hoisted(() => ({ state: { status: "off", agent: null, call: { kind: "idle" } } as DialerState, dial: vi.fn(), enabledWith: [] as boolean[] }));
vi.mock("@/components/calls/justcall/use-justcall-dialer", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/components/calls/justcall/use-justcall-dialer")>()),
  useJustCallDialer: (enabled: boolean) => {
    dial.enabledWith.push(enabled);
    return { state: enabled ? dial.state : { status: "off", agent: null, call: { kind: "idle" } }, dial: dial.dial };
  },
}));

import type { DialerState } from "@/components/calls/justcall/use-justcall-dialer";
import type { FamilyPanel } from "@/lib/calls/family-panel";
import type { UnmatchedList } from "@/lib/justcall/types";
import { JustCallCallsClient } from "./JustCallCallsClient";
import { AVA, DASHBOARD, PANEL } from "./calls-fixtures.test-util";

const UNMATCHED: UnmatchedList = {
  total: 1,
  calls: [{ callSid: "CAun0001", number: "+44 (0) 7700 900 599", when: "Tue 9 Feb, 14:03 (London time)", direction: "Outgoing", result: "Answered", duration: "6 min 12 s", reason: "No family with this number", resultCode: "answered", matchNote: "none" }],
};
const WITH_JUSTCALL: FamilyPanel = {
  ...PANEL,
  attempts: [
    {
      key: "e3", when: "Tue 9 Feb, 14:03 (London time)", what: "JustCall · Outgoing · Answered — outcome needed · 6 min 12 s", note: null, by: null, callBack: null,
      justcall: { callSid: "CAtest0001", needsOutcome: true, what: "JustCall · Outgoing · Answered — outcome needed · 6 min 12 s", lines: ["JustCall notes: wants Tuesdays"], summary: "JustCall · Outgoing · 6 min 12 s · Ref CAtest0001" },
    },
    ...PANEL.attempts,
  ],
};

beforeEach(() => {
  nav.refresh.mockReset();
  jc.saveJustCallOutcomeAction.mockReset().mockResolvedValue({ ok: true, value: { entryId: "e3" } });
  jc.dismissJustCallAction.mockReset().mockResolvedValue({ ok: true, value: { replay: false } });
});

describe("JustCallCallsClient", () => {
  it("the Calls tab ends with the Unmatched JustCall calls", () => {
    render(<JustCallCallsClient dashboard={DASHBOARD} openCallId={null} panel={null} panelFailed={false} unmatched={UNMATCHED} />);
    const tab = screen.getByRole("tabpanel", { name: "Calls" });
    expect(within(tab).getByRole("heading", { level: 2, name: "Unmatched JustCall calls (1)" })).toBeInTheDocument();
    expect(within(tab).getByRole("heading", { level: 2, name: /History/ })).toBeInTheDocument();
  });

  it("an Unmatched list that couldn't be read says so; the rest of the page stands", () => {
    render(<JustCallCallsClient dashboard={DASHBOARD} openCallId={null} panel={null} panelFailed={false} unmatched={null} />);
    expect(screen.getByRole("alert")).toHaveTextContent("The JustCall calls could not be read — reload to try again.");
    expect(screen.getByText("Calls still to make this week: 4 (2 booked · 2 not booked)")).toBeInTheDocument();
  });

  it("dismissing refreshes the page", async () => {
    const user = userEvent.setup();
    render(<JustCallCallsClient dashboard={DASHBOARD} openCallId={null} panel={null} panelFailed={false} unmatched={UNMATCHED} />);
    await user.click(screen.getByRole("button", { name: "Dismiss: +44 (0) 7700 900 599" }));
    await user.click(screen.getByRole("button", { name: "Dismiss" }));
    expect(nav.refresh).toHaveBeenCalled();
  });

  it("in her drawer: the JustCall lines and Add outcome, saving with her id, her booked call and the sid; then a refresh", async () => {
    const user = userEvent.setup();
    render(<JustCallCallsClient dashboard={DASHBOARD} openCallId={AVA} panel={WITH_JUSTCALL} panelFailed={false} unmatched={UNMATCHED} />);
    const drawer = screen.getByRole("dialog");
    expect(within(drawer).getByText("JustCall notes: wants Tuesdays")).toBeInTheDocument();
    await user.click(within(drawer).getByRole("button", { name: "Add outcome: Tue 9 Feb, 14:03 (London time)" }));
    const forms = within(drawer).getAllByRole("button", { name: "Save outcome" });
    await user.click(forms[forms.length - 1]);
    expect(jc.saveJustCallOutcomeAction).toHaveBeenCalledWith(expect.objectContaining({ parentUserId: AVA, bookingId: PANEL.booking?.bookingId, callSid: "CAtest0001", result: "answered" }));
    expect(nav.refresh).toHaveBeenCalled();
  });
});

describe("JustCallCallsClient — the dialer (05b; §9 rows 1–5)", () => {
  const SIGNED_IN: DialerState = { status: "signed_in", agent: "agent@example.test", call: { kind: "idle" } };
  const stubScreen = (wide: boolean) => vi.stubGlobal("matchMedia", vi.fn().mockReturnValue({ matches: wide, addEventListener: vi.fn(), removeEventListener: vi.fn() }));

  beforeEach(() => {
    nav.push.mockReset();
    dial.state = SIGNED_IN;
    dial.dial.mockReset().mockReturnValue(true);
    dial.enabledWith.length = 0;
    jc.nextFamilyToCallAction.mockReset().mockResolvedValue({ ok: true, value: { parentUserId: AVA, mobile: "+447700900111" } });
  });
  afterEach(() => vi.unstubAllGlobals());

  it("dialer off (row 1): no Call next, no panel, no dialer started; 04's phone links", () => {
    stubScreen(true);
    render(<JustCallCallsClient dashboard={DASHBOARD} openCallId={null} panel={null} panelFailed={false} unmatched={UNMATCHED} />);
    expect(screen.queryByRole("button", { name: "Call next" })).toBeNull();
    expect(screen.queryByRole("complementary", { name: "JustCall dialer" })).toBeNull();
    expect(dial.enabledWith.every((on) => !on)).toBe(true);
    expect(screen.getAllByRole("link", { name: /Call Ava Overdue/ })[0]).toHaveAttribute("href", "tel:+447700900111");
  });

  it("dialer on, wide (row 2): Call next, the panel on the right, the dialer started", async () => {
    stubScreen(true);
    render(<JustCallCallsClient dashboard={DASHBOARD} openCallId={null} panel={null} panelFailed={false} unmatched={UNMATCHED} dialer />);
    expect(await screen.findByRole("complementary", { name: "JustCall dialer" })).toHaveTextContent("JustCall: signed in as agent@example.test");
    expect(screen.getByRole("button", { name: "Call next" })).toBeInTheDocument();
    expect(dial.enabledWith.at(-1)).toBe(true);
  });

  it("dialer on, narrow: the phone line, no panel, the dialer not started; 04's phone links", () => {
    stubScreen(false);
    render(<JustCallCallsClient dashboard={DASHBOARD} openCallId={null} panel={null} panelFailed={false} unmatched={UNMATCHED} dialer />);
    expect(screen.getByText("On a phone, use the JustCall app — your calls still log here")).toBeInTheDocument();
    expect(screen.queryByRole("complementary")).toBeNull();
    expect(dial.enabledWith.every((on) => !on)).toBe(true);
    expect(screen.getAllByRole("link", { name: /Call Ava Overdue/ })[0]).toHaveAttribute("href", "tel:+447700900111");
  });

  it("Call in a row (row 3): her E.164 into the dialer, her drawer opened", async () => {
    stubScreen(true);
    const user = userEvent.setup();
    render(<JustCallCallsClient dashboard={DASHBOARD} openCallId={null} panel={null} panelFailed={false} unmatched={UNMATCHED} dialer />);
    await user.click((await screen.findAllByRole("button", { name: /Call Ava Overdue/ }))[0]);
    expect(dial.dial).toHaveBeenCalledWith("+447700900111");
    expect(nav.push).toHaveBeenCalledWith(`/admin/calls?openCall=${AVA}`, { scroll: false });
  });

  it("Call next (row 4): the server's next family, dialled and opened", async () => {
    stubScreen(true);
    const user = userEvent.setup();
    render(<JustCallCallsClient dashboard={DASHBOARD} openCallId={null} panel={null} panelFailed={false} unmatched={UNMATCHED} dialer />);
    await user.click(await screen.findByRole("button", { name: "Call next" }));
    await waitFor(() => expect(nav.push).toHaveBeenCalledWith(`/admin/calls?openCall=${AVA}`, { scroll: false }));
    expect(dial.dial).toHaveBeenCalledWith("+447700900111");
  });

  it("her drawer beside the dialer: not modal, clear of it; while live her links open in a new tab", async () => {
    stubScreen(true);
    dial.state = { ...SIGNED_IN, call: { kind: "on_call", callSid: "CAab12", outbound: true, number: "+447700900111" } };
    render(<JustCallCallsClient dashboard={DASHBOARD} openCallId={AVA} panel={PANEL} panelFailed={false} unmatched={UNMATCHED} dialer />);
    const drawer = await screen.findByRole("dialog");
    await waitFor(() => expect(drawer.className).toContain("lg:right-[380px]"));
    expect(within(drawer).getByRole("link", { name: "Money (opens in a new tab)" })).toHaveAttribute("target", "_blank");
    expect(within(drawer).getByRole("link", { name: "Money (opens in a new tab)" })).toHaveAttribute("rel", "noopener noreferrer");
  });

  it("after the call (row 5): her form has the JustCall line; Save and call next saves with the sid and loads the next family", async () => {
    stubScreen(true);
    const user = userEvent.setup();
    const view = render(<JustCallCallsClient dashboard={DASHBOARD} openCallId={AVA} panel={PANEL} panelFailed={false} unmatched={UNMATCHED} dialer />);
    const drawer = await screen.findByRole("dialog");
    await user.click(within(drawer).getByRole("button", { name: /Call Ava Overdue/ }));
    dial.state = { ...SIGNED_IN, call: { kind: "ended", callSid: "CAab12", outbound: true, number: "+447700900111", seconds: 372 } };
    view.rerender(<JustCallCallsClient dashboard={DASHBOARD} openCallId={AVA} panel={PANEL} panelFailed={false} unmatched={UNMATCHED} dialer />);
    const form = within(screen.getByRole("dialog")).getByRole("region", { name: "Record outcome" });
    expect(within(form).getByText("JustCall · Outgoing · 6 min 12 s · Ref CAab12")).toBeInTheDocument();
    await user.click(within(form).getByRole("button", { name: "No answer" }));
    nav.push.mockReset();
    jc.nextFamilyToCallAction.mockResolvedValue({ ok: true, value: { parentUserId: "b0400000-0000-4000-8000-000000000666", mobile: "+447700900666" } });
    await user.click(within(form).getByRole("button", { name: "Save and call next" }));
    await waitFor(() => expect(nav.push).toHaveBeenCalledWith("/admin/calls?openCall=b0400000-0000-4000-8000-000000000666", { scroll: false }));
    expect(jc.saveJustCallOutcomeAction).toHaveBeenCalledWith(expect.objectContaining({ parentUserId: AVA, callSid: "CAab12", result: "no_answer" }));
  });

  it("the panel comes after the page's content (keyboard order, React L12); nothing before the width is known", async () => {
    stubScreen(true);
    render(<JustCallCallsClient dashboard={DASHBOARD} openCallId={null} panel={null} panelFailed={false} unmatched={UNMATCHED} dialer />);
    const panel = await screen.findByRole("complementary", { name: "JustCall dialer" });
    const tabs = screen.getByRole("tablist");
    expect(tabs.compareDocumentPosition(panel) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("logging off, dialer on: no Unmatched list, no after-call form (its save is logging's)", async () => {
    stubScreen(true);
    dial.state = { ...SIGNED_IN, call: { kind: "ended", callSid: "CAab12", outbound: true, number: "+447700900111", seconds: 372 } };
    render(<JustCallCallsClient dashboard={DASHBOARD} openCallId={AVA} panel={PANEL} panelFailed={false} logging={false} dialer />);
    expect(screen.queryByRole("heading", { name: /Unmatched JustCall calls/ })).toBeNull();
    expect(await screen.findByRole("button", { name: "Call next" })).toBeInTheDocument();
    expect(within(screen.getByRole("dialog")).queryByText(/Ref CAab12/)).toBeNull();
  });
});
