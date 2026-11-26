/**
 * The calls page client with JustCall logging on (plan 05 §5 B6; D1): 04's `CallsClient` with brief 05's two slots —
 * the Unmatched JustCall calls in the Calls tab, and the JustCall lines and Add outcome under each past attempt in the
 * drawer. A save or a change refreshes the page.
 */
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

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
}));
vi.mock("./justcall-actions", () => jc);

import type { FamilyPanel } from "@/lib/calls/family-panel";
import { JustCallCallsClient } from "./JustCallCallsClient";
import { AVA, DASHBOARD, PANEL } from "./calls-fixtures.test-util";

const UNMATCHED = {
  total: 1,
  calls: [{ callSid: "CAun0001", number: "+44 (0) 7700 900 599", when: "Tue 9 Feb, 14:03 (London time)", direction: "Outgoing", result: "Answered", duration: "6 min 12 s", reason: "No family with this number" }],
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
    await user.click(within(drawer).getByRole("button", { name: "Add outcome" }));
    const forms = within(drawer).getAllByRole("button", { name: "Save outcome" });
    await user.click(forms[forms.length - 1]);
    expect(jc.saveJustCallOutcomeAction).toHaveBeenCalledWith(expect.objectContaining({ parentUserId: AVA, bookingId: PANEL.booking?.bookingId, callSid: "CAtest0001", result: "answered" }));
    expect(nav.refresh).toHaveBeenCalled();
  });
});
