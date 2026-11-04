/**
 * Brief 02 §3 "Admin, elsewhere" (plan 02 step 10): the family's Done-for-you panel shows "Current cohort: starts
 * Mon 1 Feb · 2 of 5 left" (and the no-current / not-set-up variants). No cohort prop (switch off) → no line.
 * BB-wave1-041126/02-build.
 */
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock("@/lib/actions/admin/dfy", () => ({ createDfyPaymentLink: vi.fn(), setFamilyAccess: vi.fn() }));
vi.mock("@/app/admin/users/UserDetailDrawer", () => ({ UserDetailDrawer: () => null }));

import type { UserData } from "@/app/admin/users/page";
import type { CurrentCohortSummary } from "@/lib/cohorts/types";
import { SubscriptionDetailHeader } from "./SubscriptionDetailHeader";

const PARENT = { user_id: "b0200000-0000-4000-8000-000000000001", first_name: "Sarah", last_name: "Jones", email: "s@example.test" } as unknown as UserData;
const VIEW = { start: "2027-02-01", places: 5, taken: 3, beingPaid: 0, left: 2, overBy: 0 };

const renderWith = (cohort?: CurrentCohortSummary | null) =>
  render(<SubscriptionDetailHeader parentUserData={PARENT} parentIsTestUser={false} nannyUserData={null} sub={null} cohort={cohort} />);

describe("the Current cohort line in the Done-for-you panel", () => {
  it.each([
    [{ kind: "current", view: VIEW } as const, "Current cohort: starts Mon 1 Feb · 2 of 5 left"],
    [{ kind: "first_ahead", first: "2027-02-01" } as const, "Current cohort: none yet · the first starts Mon 1 Feb"],
    [{ kind: "not_set_up" } as const, "Current cohort: not set up yet"],
    [{ kind: "error" } as const, "Current cohort: could not be read"],
  ])("%o", (cohort, line) => {
    renderWith(cohort);
    expect(screen.getByTestId("dfy-cohort-line")).toHaveTextContent(line);
  });

  it.each([[undefined], [null], [{ kind: "off" } as const]])("no line for %o (switch off)", (cohort) => {
    renderWith(cohort);
    expect(screen.queryByTestId("dfy-cohort-line")).toBeNull();
    expect(screen.queryByText(/Current cohort/)).toBeNull();
  });
});
