/**
 * BAppLayout — S4 lapsed-state FAB behaviour tests.
 *
 * Spec: `system/APP/PAYMENTS/FRONTEND/03-build-spec.md` §S4.
 *
 * Default behaviour (familyHasAccess undefined or true) is to expand
 * the FAB into the Design / Observation / Diary action sheet. Test
 * the new lapsed-state branch:
 *
 * - AC-S4.1: FAB click in lapsed state → SubscribeModal opens, NO
 *            action sheet renders.
 * - AC-S4.2: FAB click in active state → action sheet renders as
 *            before (default behavior preserved).
 * - AC-S4.3: Nanny variant of the modal is rendered for role=nanny.
 *
 * Also: LapsedBanner renders above content when familyHasAccess is
 * false (S3 integration).
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createElement } from "react";

beforeEach(() => {
  vi.clearAllMocks();
});

vi.mock("next/navigation", () => ({
  usePathname: () => "/parent/development/child-1",
  useRouter: () => ({ push: vi.fn() }),
}));

vi.mock("./sheets/ObservationSheet", () => ({
  ObservationSheet: () => null,
}));
vi.mock("./sheets/DiarySheet", () => ({
  DiarySheet: () => null,
}));
vi.mock("./sheets/PlanSheet", () => ({
  PlanSheet: () => null,
}));
vi.mock("./ChildAvatarEditor", () => ({
  ChildAvatarEditor: () => null,
}));
vi.mock("./ChildDetailsEditor", () => ({
  ChildDetailsEditor: () => null,
}));

import { BAppLayout } from "./BAppLayout";
import type { ChildClient } from "@/types/bapp";
import { SITE_URL } from "@/lib/constants";

const child: ChildClient = {
  id: "child-1",
  first_name: "Lily",
  date_of_birth: "2024-01-15",
  age_months_approx: 24,
  gender: "female",
  parent_user_id: "parent-uuid",
  nanny_user_id: "nanny-uuid",
  status: "active_nanny",
  feed_locked_for_nanny: false,
  feed_locked_at: null,
  created_at: "2024-01-01T00:00:00Z",
  updated_at: "2024-01-01T00:00:00Z",
} as unknown as ChildClient;

/** Render helper — keeps tests free of multiline JSX with children
 *  that the test transformer mis-parses. */
function renderLayout(
  overrides: {
    role?: "parent" | "nanny";
    familyHasAccess?: boolean;
    lapseReason?: "trial_ended" | "subscription_lapsed";
    parentFirstName?: string;
    nannyFirstName?: string;
    nannyShareUrl?: string;
    nannyShareText?: string;
  } = {},
) {
  const props = {
    child,
    role: "parent" as "parent" | "nanny",
    children: createElement("div", null, "page content"),
    ...overrides,
  };
  return render(createElement(BAppLayout, props));
}

describe("BAppLayout — default state (family has access)", () => {
  it("FAB expansion reveals the three action buttons (AC-S4.2)", async () => {
    const user = userEvent.setup();
    renderLayout();
    const fab = screen.getByRole("button", { name: /open menu/i });
    await user.click(fab);
    expect(
      screen.getByRole("button", { name: /design activity/i }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /observation/i }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /diary entry/i }),
    ).toBeInTheDocument();
  });

  it("does NOT render the lapsed banner", () => {
    renderLayout();
    expect(
      screen.queryByText(/subscription required/i),
    ).not.toBeInTheDocument();
  });
});

describe("BAppLayout — lapsed state, parent role (AC-S4.1)", () => {
  it("FAB click opens SubscribeModal instead of action sheet", async () => {
    const user = userEvent.setup();
    renderLayout({
      familyHasAccess: false,
      lapseReason: "subscription_lapsed",
    });
    const fab = screen.getByRole("button", { name: /open menu/i });
    await user.click(fab);
    expect(
      screen.getByRole("heading", {
        level: 2,
        name: /continue following Lily/i,
      }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /design activity/i }),
    ).not.toBeInTheDocument();
  });

  it("renders the LapsedBanner above content", () => {
    renderLayout({
      familyHasAccess: false,
      lapseReason: "subscription_lapsed",
    });
    expect(screen.getByText(/subscription required/i)).toBeInTheDocument();
  });

  it("Subscribe button in lapsed banner opens the modal", async () => {
    const user = userEvent.setup();
    renderLayout({
      familyHasAccess: false,
      lapseReason: "subscription_lapsed",
    });
    await user.click(screen.getByRole("button", { name: /^subscribe$/i }));
    expect(
      screen.getByRole("heading", {
        level: 2,
        name: /continue following Lily/i,
      }),
    ).toBeInTheDocument();
  });
});

describe("BAppLayout — lapsed state, nanny role (AC-S4.3)", () => {
  it("FAB click opens nanny-variant modal", async () => {
    const user = userEvent.setup();
    renderLayout({
      role: "nanny",
      familyHasAccess: false,
      lapseReason: "subscription_lapsed",
      parentFirstName: "Sarah",
      nannyShareUrl: `${SITE_URL}/subscribe-for/AAAA-1111`,
      nannyShareText: "Hi Sarah — share text",
    });
    const fab = screen.getByRole("button", { name: /open menu/i });
    await user.click(fab);
    expect(
      screen.getByRole("heading", {
        level: 2,
        name: /Lily's family doesn't have an active subscription/i,
      }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /share .* with Sarah/i }),
    ).toBeInTheDocument();
  });
});
