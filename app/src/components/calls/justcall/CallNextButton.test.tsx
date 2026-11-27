/**
 * Call next (plan 05 §5 PR 05b C6; §9 row 4; brief §0.3, §3.5): one press asks the flow; busy while it asks; not while
 * a call is live; its last word ("No one left to call right now.") announced. BB-wave2-231126/05-build.
 */
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { CallNextButton } from "./CallNextButton";
import { DialerFlowContext, type DialerFlow } from "./use-dialer-flow";

function flowWith(over: Partial<DialerFlow> = {}): DialerFlow {
  return {
    dialer: { state: { status: "signed_in", agent: null, call: { kind: "idle" } }, dial: vi.fn() },
    live: false,
    call: vi.fn(),
    callNext: vi.fn().mockResolvedValue(undefined),
    nextLine: "",
    nextBusy: false,
    afterCall: () => null,
    ...over,
  };
}

describe("CallNextButton", () => {
  it("a press asks the flow for the next family", async () => {
    const user = userEvent.setup();
    const flow = flowWith();
    render(<DialerFlowContext.Provider value={flow}><CallNextButton /></DialerFlowContext.Provider>);
    await user.click(screen.getByRole("button", { name: "Call next" }));
    expect(flow.callNext).toHaveBeenCalledTimes(1);
  });

  it("busy while asking; says so", () => {
    render(<DialerFlowContext.Provider value={flowWith({ nextBusy: true })}><CallNextButton /></DialerFlowContext.Provider>);
    expect(screen.getByRole("button", { name: "Call next" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Call next" })).toHaveAttribute("aria-busy", "true");
  });

  it("not while a call is live", () => {
    render(<DialerFlowContext.Provider value={flowWith({ live: true })}><CallNextButton /></DialerFlowContext.Provider>);
    expect(screen.getByRole("button", { name: "Call next" })).toBeDisabled();
  });

  it("its last word is announced", () => {
    render(<DialerFlowContext.Provider value={flowWith({ nextLine: "No one left to call right now." })}><CallNextButton /></DialerFlowContext.Provider>);
    expect(screen.getByRole("status")).toHaveTextContent("No one left to call right now.");
  });

  it("no flow: nothing", () => {
    const { container } = render(<CallNextButton />);
    expect(container).toBeEmptyDOMElement();
  });
});
