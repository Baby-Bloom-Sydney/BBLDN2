import { describe, it, expect, beforeEach, vi } from "vitest";
import type { ModuleContext } from "./types";

vi.mock("@/lib/actions/parent", () => ({
  getPosition: vi.fn(),
}));

import { onboardingModule } from "./onboarding";
import { getPosition } from "@/lib/actions/parent";

function makeCtx(role: "nanny" | "parent" = "parent"): ModuleContext {
  return {
    botId: "bot-1",
    userId: "u-1",
    userRole: role,
    effectiveRole: role,
    children: [],
    currentSurface: null,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    supabase: { from: vi.fn() } as any,
  };
}

describe("onboarding module — role gate", () => {
  beforeEach(() => vi.clearAllMocks());

  it("rejects nanny role", async () => {
    const r = await onboardingModule.execute(
      "read_onboarding_progress",
      {},
      makeCtx("nanny"),
    );
    expect(r.success).toBe(false);
    expect(r.error).toMatch(/parent-side/);
  });

  it("returns error for unknown tool", async () => {
    const r = await onboardingModule.execute("nope", {}, makeCtx());
    expect(r.success).toBe(false);
    expect(r.error).toMatch(/Unknown tool/);
  });
});

describe("onboarding module — read_onboarding_progress", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns not_started when no position exists", async () => {
    vi.mocked(getPosition).mockResolvedValue({ data: null, error: null });
    const r = await onboardingModule.execute(
      "read_onboarding_progress",
      {},
      makeCtx(),
    );
    expect(r.success).toBe(true);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const data = r.data as any;
    expect(data.stage).toBe("not_started");
    expect(data.missing).toHaveLength(5);
    expect(data.cta_href).toBe("/parent/request");
  });

  it("lists missing fields + reports draft stage for partial position", async () => {
    vi.mocked(getPosition).mockResolvedValue({
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      data: {
        id: "p1",
        suburb: "Clapham",
        hours_per_week: 30,
        days_required: ["Monday"],
        hourly_rate: null, // missing
        urgency: "within_a_month",
        children: [],
        status: "draft",
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      } as any,
      error: null,
    });
    const r = await onboardingModule.execute(
      "read_onboarding_progress",
      {},
      makeCtx(),
    );
    expect(r.success).toBe(true);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const data = r.data as any;
    expect(data.missing).toEqual(
      expect.arrayContaining(["Hourly rate", "Children (at least one)"]),
    );
    expect(data.stage).not.toBe("not_started");
  });

  it("returns ready_to_publish when every field is set", async () => {
    vi.mocked(getPosition).mockResolvedValue({
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      data: {
        id: "p1",
        suburb: "Clapham",
        hours_per_week: 30,
        days_required: ["Monday", "Tuesday"],
        hourly_rate: 45,
        urgency: "within_a_month",
        children: [{ age_months: 14 }],
        status: "draft",
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      } as any,
      error: null,
    });
    const r = await onboardingModule.execute(
      "read_onboarding_progress",
      {},
      makeCtx(),
    );
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const data = r.data as any;
    expect(data.stage).toBe("ready_to_publish");
    expect(data.missing).toEqual([]);
  });

  it("returns published when status === active", async () => {
    vi.mocked(getPosition).mockResolvedValue({
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      data: {
        id: "p1",
        suburb: "Clapham",
        hours_per_week: 30,
        days_required: ["Monday"],
        hourly_rate: 45,
        urgency: "immediate",
        children: [{ age_months: 14 }],
        status: "active",
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      } as any,
      error: null,
    });
    const r = await onboardingModule.execute(
      "read_onboarding_progress",
      {},
      makeCtx(),
    );
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const data = r.data as any;
    expect(data.stage).toBe("published");
    expect(data.headline.toLowerCase()).toContain("live");
  });

  it("never leaks internal field names", async () => {
    vi.mocked(getPosition).mockResolvedValue({
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      data: {
        id: "p1",
        suburb: "Clapham",
        hours_per_week: null,
        days_required: null,
        hourly_rate: null,
        urgency: null,
        children: [],
        status: "draft",
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      } as any,
      error: null,
    });
    const r = await onboardingModule.execute(
      "read_onboarding_progress",
      {},
      makeCtx(),
    );
    expect(JSON.stringify(r.data)).not.toMatch(
      /saveTypeformPosition|position_status|days_required/,
    );
  });
});

describe("onboarding module — read_next_step", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns the first missing field as next step", async () => {
    vi.mocked(getPosition).mockResolvedValue({ data: null, error: null });
    const r = await onboardingModule.execute("read_next_step", {}, makeCtx());
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const data = r.data as any;
    expect(data.next_step.toLowerCase()).toContain("timeline");
  });

  it("published path reads well", async () => {
    vi.mocked(getPosition).mockResolvedValue({
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      data: {
        id: "p1",
        suburb: "Clapham",
        hours_per_week: 30,
        days_required: ["Monday"],
        hourly_rate: 45,
        urgency: "immediate",
        children: [{ age_months: 14 }],
        status: "active",
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      } as any,
      error: null,
    });
    const r = await onboardingModule.execute("read_next_step", {}, makeCtx());
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const data = r.data as any;
    expect(data.stage).toBe("published");
    expect(data.next_step.toLowerCase()).toContain("wait for nannies");
  });
});
