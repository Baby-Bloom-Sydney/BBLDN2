/**
 * The row's four links (04's `LinksRow`) and brief 05's "call is live" switch (plan 05 §5 PR 05b; brief §3.3): while a
 * call is live they open in a new tab, so the drawer and the call stay put; otherwise exactly today's links.
 * BB-wave2-231126/05-build.
 */
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { CallLiveContext, useCallLive } from "@/components/calls/call-live-context";
import { LinksRow } from "./CallRowParts";

const LINKS = { profile: "/admin/users/u1", account: "/admin/users/u1/account", money: "/admin/users/u1/money", position: "/admin/positions/p1" };
const NAMES = ["Profile", "Account", "Money", "Position"];

describe("LinksRow", () => {
  it("today: the four links open in this tab", () => {
    render(<LinksRow links={LINKS} />);
    for (const name of NAMES) {
      const link = screen.getByRole("link", { name });
      expect(link).not.toHaveAttribute("target");
      expect(link).not.toHaveAttribute("rel");
    }
  });

  it("while a call is live: each opens in a new tab, with noopener noreferrer", () => {
    render(
      <CallLiveContext.Provider value={true}>
        <LinksRow links={LINKS} />
      </CallLiveContext.Provider>,
    );
    for (const name of NAMES) {
      const link = screen.getByRole("link", { name });
      expect(link).toHaveAttribute("target", "_blank");
      expect(link).toHaveAttribute("rel", "noopener noreferrer");
    }
  });

  it("no Position link without a position, live or not", () => {
    render(
      <CallLiveContext.Provider value={true}>
        <LinksRow links={{ ...LINKS, position: null }} />
      </CallLiveContext.Provider>,
    );
    expect(screen.queryByRole("link", { name: "Position" })).toBeNull();
  });
});

describe("call-live-context", () => {
  function Probe() {
    return <p>{useCallLive() ? "live" : "not live"}</p>;
  }
  it("is false with no provider (04's page never sets it)", () => {
    render(<Probe />);
    expect(screen.getByText("not live")).toBeInTheDocument();
  });
});
