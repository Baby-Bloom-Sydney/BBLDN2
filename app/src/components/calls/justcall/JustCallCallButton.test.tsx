/**
 * The JustCall Call control (plan 05 §5 PR 05b C5; §9 row 3; brief §0.2, §3.2): with the dialer ready and no call live,
 * a Call button that puts her E.164 into the dialer and opens her drawer; not ready, signed out, failed or on a call →
 * the reason and 04's phone link; no dialer here (a phone, the switch off) or no mobile → 04's control as it is.
 * Stateless: it reads the flow from its context. BB-wave2-231126/05-build.
 */
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";
import type { CallControlTarget } from "@/app/admin/calls/CallRowParts";
import { JustCallCallButton } from "./JustCallCallButton";
import { DialerFlowContext, type DialerFlow } from "./use-dialer-flow";
import type { DialerState } from "./use-justcall-dialer";

const P1 = "b0500000-0000-4000-8000-000000000017";
const TARGET: CallControlTarget = {
  parentUserId: P1,
  bookingId: null,
  contact: { name: "Ava Smith", email: "ava@example.test", emailHref: "mailto:ava@example.test", mobile: { href: "tel:+447700900517", text: "+44 (0) 7700 900 517" } },
};

function flowWith(state: Partial<DialerState>): DialerFlow {
  return {
    dialer: { state: { status: "signed_in", agent: null, call: { kind: "idle" }, ...state }, dial: vi.fn() },
    live: state.call !== undefined && (state.call.kind === "ringing" || state.call.kind === "on_call"),
    call: vi.fn(),
    callNext: vi.fn(),
    nextLine: "",
    announce: "",
    nextBusy: false,
    wide: true,
    afterCall: () => null,
  };
}
const inFlow = (flow: DialerFlow | null, node: ReactNode) => render(<DialerFlowContext.Provider value={flow}>{node}</DialerFlowContext.Provider>);

describe("JustCallCallButton", () => {
  it("ready: a Call button, named for her; it dials her E.164 and opens her drawer", async () => {
    const user = userEvent.setup();
    const flow = flowWith({});
    inFlow(flow, <JustCallCallButton target={TARGET} />);
    expect(screen.queryByRole("link")).toBeNull();
    await user.click(screen.getByRole("button", { name: /Call Ava Smith/ }));
    expect(flow.call).toHaveBeenCalledWith({ parentUserId: P1, mobile: "+447700900517" });
  });

  it.each([
    ["loading", { status: "loading" }, "JustCall is still loading"],
    ["signed out", { status: "signed_out" }, "Sign in to JustCall to call from here"],
    ["failed", { status: "failed" }, "JustCall didn't load"],
  ] as const)("%s: the reason, then 04's phone link", (_label, state, reason) => {
    const flow = flowWith(state);
    inFlow(flow, <JustCallCallButton target={TARGET} />);
    expect(screen.getByText(reason)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Call Ava Smith/ })).toHaveAttribute("href", "tel:+447700900517");
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("no dialer on this screen (a phone): 04's phone link, no reason", () => {
    inFlow(flowWith({ status: "off" }), <JustCallCallButton target={TARGET} />);
    expect(screen.getByRole("link", { name: /Call Ava Smith/ })).toHaveAttribute("href", "tel:+447700900517");
    expect(screen.queryByText(/JustCall/)).toBeNull();
  });

  it("no flow at all: 04's phone link", () => {
    inFlow(null, <JustCallCallButton target={TARGET} />);
    expect(screen.getByRole("link", { name: /Call Ava Smith/ })).toHaveAttribute("href", "tel:+447700900517");
  });

  it("no mobile: 04's 'No mobile', whatever the dialer says", () => {
    inFlow(flowWith({}), <JustCallCallButton target={{ ...TARGET, contact: { ...TARGET.contact, mobile: null } }} />);
    expect(screen.getByText("No mobile")).toBeInTheDocument();
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("stateless: drawn twice (table and card), both follow the one flow", () => {
    inFlow(flowWith({ status: "signed_out" }), <><JustCallCallButton target={TARGET} /><JustCallCallButton target={TARGET} /></>);
    expect(screen.getAllByText("Sign in to JustCall to call from here")).toHaveLength(2);
  });
});

describe("JustCallCallButton — a call goes live (React H2)", () => {
  it("the same button stays, unavailable and saying why; a press does nothing; no phone link appears", async () => {
    const user = userEvent.setup();
    const flow = flowWith({ call: { kind: "on_call", callSid: "CAab12", outbound: true, number: "+447700900111" } });
    inFlow(flow, <JustCallCallButton target={TARGET} />);
    const button = screen.getByRole("button", { name: /Call Ava Smith/ });
    expect(button).toHaveAttribute("aria-disabled", "true");
    expect(button).not.toBeDisabled();
    expect(button).toHaveAccessibleDescription("On a call");
    await user.click(button);
    expect(flow.call).not.toHaveBeenCalled();
    expect(screen.queryByRole("link")).toBeNull();
  });

  it("pressed and then live: focus stays on it", async () => {
    const user = userEvent.setup();
    const idle = flowWith({});
    const { rerender } = inFlow(idle, <JustCallCallButton target={TARGET} />);
    await user.click(screen.getByRole("button", { name: /Call Ava Smith/ }));
    const pressed = screen.getByRole("button", { name: /Call Ava Smith/ });
    expect(pressed).toHaveFocus();
    rerender(<DialerFlowContext.Provider value={flowWith({ call: { kind: "ringing", callSid: "CAab12", outbound: true, number: "+447700900517" } })}><JustCallCallButton target={TARGET} /></DialerFlowContext.Provider>);
    expect(screen.getByRole("button", { name: /Call Ava Smith/ })).toBe(pressed);
    expect(pressed).toHaveFocus();
  });
});
