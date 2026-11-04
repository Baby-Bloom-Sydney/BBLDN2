/**
 * /parent/request with a picked call time (04b rework W11; brief §0a.6): the page checks `callAt` (an instant with an
 * offset) and hands it to the flow; anything else is ignored, so the flow is today's.
 */
import { describe, expect, it, vi } from "vitest";

vi.mock("./TypeformFlow", () => ({ TypeformFlow: () => null }));

import ParentRequestPage from "./page";

const AT = "2027-02-09T14:00:00.000Z";

describe("ParentRequestPage", () => {
  it("a valid callAt is handed to the flow", () => {
    const tree = ParentRequestPage({ searchParams: { callAt: AT } }) as { props: Record<string, unknown> };
    expect(tree.props).toEqual({ callAt: AT });
  });

  it.each([[undefined], ["tomorrow"], ["2027-02-09"], [[AT, AT]]])("%s → no callAt (today's flow)", (callAt) => {
    const tree = ParentRequestPage({ searchParams: { callAt: callAt as string | string[] | undefined } }) as { props: Record<string, unknown> };
    expect(tree.props).toEqual({});
  });
});
