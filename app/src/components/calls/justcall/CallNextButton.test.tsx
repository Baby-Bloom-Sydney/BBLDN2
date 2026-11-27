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
    announce: "",
    nextBusy: false,
    wide: true,
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

  it("busy while asking: unavailable but still focusable (React H2), says so; a press does nothing", async () => {
    const user = userEvent.setup();
    const flow = flowWith({ nextBusy: true });
    render(<DialerFlowContext.Provider value={flow}><CallNextButton /></DialerFlowContext.Provider>);
    const button = screen.getByRole("button", { name: "Call next" });
    expect(button).toHaveAttribute("aria-disabled", "true");
    expect(button).toHaveAttribute("aria-busy", "true");
    expect(button).not.toBeDisabled();
    await user.click(button);
    expect(flow.callNext).not.toHaveBeenCalled();
    expect(screen.getByRole("status")).toHaveTextContent("Finding the next family…");
  });

  it("not while a call is live: unavailable, saying why", async () => {
    const user = userEvent.setup();
    const flow = flowWith({ live: true });
    render(<DialerFlowContext.Provider value={flow}><CallNextButton /></DialerFlowContext.Provider>);
    const button = screen.getByRole("button", { name: "Call next" });
    expect(button).toHaveAttribute("aria-disabled", "true");
    expect(button).toHaveAccessibleDescription("On a call");
    await user.click(button);
    expect(flow.callNext).not.toHaveBeenCalled();
  });

  it("what it opened is announced", () => {
    render(<DialerFlowContext.Provider value={flowWith({ announce: "Opened the next family to call." })}><CallNextButton /></DialerFlowContext.Provider>);
    expect(screen.getByRole("status")).toHaveTextContent("Opened the next family to call.");
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
