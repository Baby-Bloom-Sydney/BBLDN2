/**
 * Settings-page card for destructive child-management actions:
 * - Parent: Remove Nanny (per child with a linked nanny) + Delete Child
 * - Nanny:  Leave Child (per child where the caller is the nanny)
 *
 * Inline two-tap confirmation pattern (matching InviteBanner) — no
 * separate dialog component needed.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import type { ChildClient } from "@/types/bapp";

const state = vi.hoisted(() => ({
  removeNannyResult: { success: true, error: null as string | null },
  nannyLeaveResult: { success: true, error: null as string | null },
  deleteChildResult: { success: true, error: null as string | null },
  refreshCalls: 0,
  removeNannyCalls: [] as string[],
  nannyLeaveCalls: [] as string[],
  deleteChildCalls: [] as string[],
}));

beforeEach(() => {
  state.removeNannyResult = { success: true, error: null };
  state.nannyLeaveResult = { success: true, error: null };
  state.deleteChildResult = { success: true, error: null };
  state.refreshCalls = 0;
  state.removeNannyCalls = [];
  state.nannyLeaveCalls = [];
  state.deleteChildCalls = [];
});

vi.mock("next/navigation", () => ({
  useRouter: () => ({
    refresh: () => {
      state.refreshCalls += 1;
    },
  }),
}));

vi.mock("@/lib/actions/bapp/child-clients", () => ({
  removeNannyFromChild: vi.fn(async (id: string) => {
    state.removeNannyCalls.push(id);
    return state.removeNannyResult;
  }),
  nannyLeaveChild: vi.fn(async (id: string) => {
    state.nannyLeaveCalls.push(id);
    return state.nannyLeaveResult;
  }),
  deleteChild: vi.fn(async (id: string) => {
    state.deleteChildCalls.push(id);
    return state.deleteChildResult;
  }),
}));

import { ChildManagementCard } from "./ChildManagementCard";

const oliver: ChildClient = {
  id: "child-1",
  first_name: "Oliver",
  date_of_birth: "2024-03-15",
  gender: "Boy",
  age_months_approx: null,
  parent_user_id: "parent-1",
  nanny_user_id: "nanny-1",
  parent_lead_email: null,
  onboarded: true,
  under_three: true,
  status: "active_nanny",
  orphaned_at: null,
  created_at: "2026-01-01",
} as ChildClient;

const mia: ChildClient = {
  ...oliver,
  id: "child-2",
  first_name: "Mia",
  nanny_user_id: null,
  status: "created_manual",
};

describe("ChildManagementCard — empty state", () => {
  it("renders nothing when there are no children", () => {
    const { container } = render(
      <ChildManagementCard items={[]} role="parent" />,
    );
    expect(container).toBeEmptyDOMElement();
  });
});

describe("ChildManagementCard — parent role", () => {
  it("shows Remove Nanny only when the child has a linked nanny", () => {
    render(<ChildManagementCard items={[oliver, mia]} role="parent" />);
    // Oliver has a nanny → Remove Nanny visible.
    const oliverButtons = screen
      .getByText("Oliver")
      .closest("[data-testid='child-row']");
    expect(oliverButtons).toBeTruthy();
    // Mia has no nanny → only Delete Child visible.
    const miaRow = screen.getByText("Mia").closest("[data-testid='child-row']");
    expect(miaRow?.textContent).not.toMatch(/remove nanny/i);
    expect(miaRow?.textContent).toMatch(/delete child/i);
  });

  it("requires confirmation before calling removeNannyFromChild", async () => {
    render(<ChildManagementCard items={[oliver]} role="parent" />);
    fireEvent.click(screen.getByRole("button", { name: /remove nanny/i }));
    // Confirmation panel appears, action not yet called.
    expect(await screen.findByRole("alertdialog")).toBeInTheDocument();
    expect(state.removeNannyCalls).toEqual([]);
    fireEvent.click(screen.getByRole("button", { name: /^remove$/i }));
    await waitFor(() => {
      expect(state.removeNannyCalls).toEqual(["child-1"]);
      expect(state.refreshCalls).toBe(1);
    });
  });

  it("cancel keeps the row intact and fires no action", async () => {
    render(<ChildManagementCard items={[oliver]} role="parent" />);
    fireEvent.click(screen.getByRole("button", { name: /remove nanny/i }));
    expect(await screen.findByRole("alertdialog")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /cancel/i }));
    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
    expect(state.removeNannyCalls).toEqual([]);
  });

  it("requires confirmation before calling deleteChild", async () => {
    render(<ChildManagementCard items={[mia]} role="parent" />);
    fireEvent.click(screen.getByRole("button", { name: /delete child/i }));
    expect(await screen.findByRole("alertdialog")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /^delete$/i }));
    await waitFor(() => {
      expect(state.deleteChildCalls).toEqual(["child-2"]);
      expect(state.refreshCalls).toBe(1);
    });
  });

  it("surfaces an error when the action fails AND keeps the dialog open for retry", async () => {
    state.removeNannyResult = { success: false, error: "not_parent" };
    render(<ChildManagementCard items={[oliver]} role="parent" />);
    fireEvent.click(screen.getByRole("button", { name: /remove nanny/i }));
    fireEvent.click(await screen.findByRole("button", { name: /^remove$/i }));
    await waitFor(() => {
      expect(screen.getByRole("alert")).toBeInTheDocument();
    });
    expect(state.refreshCalls).toBe(0);
    // Retry path — the alertdialog must still be available.
    expect(screen.getByRole("alertdialog")).toBeInTheDocument();
  });

  it("clears a stale error when the user opens a new confirmation on another row", async () => {
    state.removeNannyResult = { success: false, error: "not_parent" };
    render(<ChildManagementCard items={[oliver, mia]} role="parent" />);
    // Trigger an error on Oliver's row.
    fireEvent.click(screen.getByRole("button", { name: /remove nanny/i }));
    fireEvent.click(await screen.findByRole("button", { name: /^remove$/i }));
    await waitFor(() => {
      expect(screen.getByRole("alert")).toBeInTheDocument();
    });
    // Cancel back out of Oliver's confirm, then open Mia's delete confirm.
    fireEvent.click(screen.getByRole("button", { name: /cancel/i }));
    // Both rows have a Delete child button; scope to Mia's row.
    const miaRow = screen.getByText("Mia").closest("[data-testid='child-row']");
    expect(miaRow).not.toBeNull();
    const miaDelete = miaRow!.querySelector(
      'button[type="button"]',
    ) as HTMLButtonElement | null;
    // Find the Delete child button specifically inside Mia's row.
    const miaButtons = Array.from(
      miaRow!.querySelectorAll("button"),
    ) as HTMLButtonElement[];
    const miaDeleteBtn = miaButtons.find((b) =>
      /delete child/i.test(b.textContent ?? ""),
    );
    expect(miaDeleteBtn).toBeTruthy();
    void miaDelete;
    fireEvent.click(miaDeleteBtn!);
    await screen.findByRole("alertdialog");
    // Stale error from Oliver must be gone.
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });
});

describe("ChildManagementCard — nanny role", () => {
  it("shows Leave Child only on rows where the caller is the nanny", () => {
    render(<ChildManagementCard items={[oliver, mia]} role="nanny" />);
    expect(
      screen.getByRole("button", { name: /leave child/i }),
    ).toBeInTheDocument();
    // Mia row has no nanny linked + nanny role has nothing else to do
    // there → the row is filtered out entirely.
    expect(screen.queryByText("Mia")).not.toBeInTheDocument();
  });

  it("calls nannyLeaveChild after confirmation", async () => {
    render(<ChildManagementCard items={[oliver]} role="nanny" />);
    fireEvent.click(screen.getByRole("button", { name: /leave child/i }));
    fireEvent.click(await screen.findByRole("button", { name: /^leave$/i }));
    await waitFor(() => {
      expect(state.nannyLeaveCalls).toEqual(["child-1"]);
      expect(state.refreshCalls).toBe(1);
    });
  });
});

/**
 * LDN2 Stage 2, unit 2c (12.03) — London date rendering.
 *
 * This card's date-of-birth line was one of the nine formatter calls in the
 * tree that passed **no** locale argument, so it rendered in whatever locale
 * the runtime resolved. Node's default is `en-US`, i.e. Oliver's 15 March 2024
 * appeared as "3/15/2024". 2c pinned the call to `en-GB`.
 *
 * Falsifiable: drop the locale argument and the first assertion fails with the
 * American order — which is the reason for pinning it.
 *
 * `oliver.date_of_birth` is a date-only string (UTC midnight) in mid-March, so
 * the rendered calendar day is the same under the suite's current clock and
 * under Europe/London when 2b re-points `vitest.setup.ts` (12.02).
 */
describe("ChildManagementCard — London date rendering (2c, 12.03)", () => {
  it("renders the date of birth in day-month-year order", () => {
    render(<ChildManagementCard items={[oliver]} role="parent" />);
    expect(screen.getByText(/^Born /)).toHaveTextContent("Born 15/03/2024");
  });

  it("does not render the date in month-first order", () => {
    render(<ChildManagementCard items={[oliver]} role="parent" />);
    expect(document.body.textContent ?? "").not.toMatch(/3\/15\/2024/);
  });
});
