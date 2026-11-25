/**
 * Brief 03 (plan 03 row B3; brief §0.10, §0.11): with the deposit panel read (switch on) the Done-for-you panel
 * shows the deposit block under the cohort line and no Deposit preset — also when the read failed. Without it
 * (switch off) the panel is exactly as today, Deposit preset included. The block itself is DepositBlock's spec.
 *
 * BB-wave2-231126/03-build, 2026-11-25.
 */
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock("@/lib/actions/admin/dfy", () => ({ createDfyPaymentLink: vi.fn(), setFamilyAccess: vi.fn() }));
vi.mock("@/app/admin/users/UserDetailDrawer", () => ({ UserDetailDrawer: () => null }));
vi.mock("./DepositBlock", () => ({
  DepositBlock: ({ parentUserId, deposit }: { parentUserId: string; deposit: { ok: boolean } }) => (
    <div data-testid="deposit-block">{`${parentUserId} ${deposit.ok ? "read" : "unavailable"}`}</div>
  ),
}));

import type { UserData } from "@/app/admin/users/page";
import type { DepositPanel, DepositPanelResult } from "@/lib/deposit/panel";
import { SubscriptionDetailHeader } from "./SubscriptionDetailHeader";

const PARENT = { user_id: "b0200000-0000-4000-8000-000000000001", first_name: "Sarah", last_name: "Jones", email: "s@example.test" } as unknown as UserData;
const VIEW = { start: "2027-02-01", places: 5, taken: 3, beingPaid: 0, left: 2, overBy: 0 };
const READ: DepositPanelResult = { ok: true, value: { parentUserId: PARENT.user_id } as unknown as DepositPanel };

const renderWith = (deposit?: DepositPanelResult | null) =>
  render(
    <SubscriptionDetailHeader
      parentUserData={PARENT}
      parentIsTestUser={false}
      nannyUserData={null}
      sub={null}
      cohort={{ kind: "current", view: VIEW }}
      deposit={deposit}
    />,
  );

const depositPreset = () => screen.queryByRole("button", { name: /^Deposit/ });

describe("the deposit block in the Done-for-you panel", () => {
  it.each([[undefined], [null]])("no deposit (%o, switch off): no block, the Deposit preset exactly as today", (deposit) => {
    renderWith(deposit);
    expect(screen.queryByTestId("deposit-block")).toBeNull();
    expect(depositPreset()).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^Balance after week 1/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^Custom/ })).toBeInTheDocument();
  });

  it.each([
    [READ, "read"],
    [{ ok: false, status: "error" } as const, "unavailable"],
  ])("deposit given: the block under the cohort line, and no Deposit preset (%#)", (deposit, word) => {
    renderWith(deposit);
    const block = screen.getByTestId("deposit-block");
    expect(block).toHaveTextContent(`${PARENT.user_id} ${word}`);
    expect(screen.getByTestId("dfy-cohort-line").compareDocumentPosition(block) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(block.compareDocumentPosition(screen.getByTestId("dfy-links")) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(depositPreset()).toBeNull();
    expect(screen.getByRole("button", { name: /^Balance after week 1/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^Custom/ })).toBeInTheDocument();
  });
});
