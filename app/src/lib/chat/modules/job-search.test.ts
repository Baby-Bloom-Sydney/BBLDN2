import { describe, it, expect, beforeEach, vi } from "vitest";
import type { ModuleContext } from "./types";

vi.mock("@/lib/actions/matching", () => ({
  getDfyNotificationsForNanny: vi.fn(),
}));

import { jobSearchModule } from "./job-search";
import { getDfyNotificationsForNanny } from "@/lib/actions/matching";

function makeCtx(role: "nanny" | "parent" = "nanny"): ModuleContext {
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

function buildNotification(overrides: Record<string, unknown> = {}) {
  return {
    id: "n1",
    positionId: "p1",
    matchScore: 0.85,
    distanceKm: 3.2,
    dfyTier: "standard" as const,
    status: "notified",
    notifiedAt: "2026-04-20T00:00:00Z",
    viewedAt: null,
    respondedAt: null,
    position: {
      suburb: "Chelsea",
      scheduleType: "regular",
      hourlyRate: 45,
      hoursPerWeek: 30,
      daysRequired: ["Monday", "Tuesday", "Wednesday"],
      schedule: null,
      levelOfSupport: ["Primary carer"],
      urgency: "within_a_month",
      startDate: "2026-06-01",
      placementLength: "12_months",
      reasonForNanny: ["returning_to_work"],
      languagePreference: null,
      qualificationRequirement: null,
      certificateRequirements: [],
      vaccinationRequired: true,
      driversLicenseRequired: true,
      carRequired: false,
      comfortableWithPetsRequired: false,
      nonSmokerRequired: true,
      otherRequirements: null,
      description: "Looking for a kind, experienced nanny.",
      children: [{ ageMonths: 18, gender: null }],
    },
    parent: {
      firstName: "Jane",
      lastName: "Doe",
      profilePicUrl: null,
    },
    ...overrides,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any;
}

describe("job-search module — role gate", () => {
  beforeEach(() => vi.clearAllMocks());

  it("rejects parent role", async () => {
    const r = await jobSearchModule.execute(
      "read_my_job_matches",
      {},
      makeCtx("parent"),
    );
    expect(r.success).toBe(false);
    expect(r.error).toMatch(/only visible on a nanny/i);
  });

  it("rejects admin", async () => {
    const ctx = makeCtx();
    ctx.effectiveRole = "admin";
    const r = await jobSearchModule.execute("read_my_job_matches", {}, ctx);
    expect(r.success).toBe(false);
  });

  it("returns error for unknown tool", async () => {
    const r = await jobSearchModule.execute("nope", {}, makeCtx());
    expect(r.success).toBe(false);
    expect(r.error).toMatch(/Unknown tool/);
  });
});

describe("job-search module — read_my_job_matches", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns plain-English summaries + requirement list", async () => {
    vi.mocked(getDfyNotificationsForNanny).mockResolvedValue({
      data: [buildNotification({ id: "n1" })],
      error: null,
    });
    const r = await jobSearchModule.execute(
      "read_my_job_matches",
      {},
      makeCtx("nanny"),
    );
    expect(r.success).toBe(true);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const data = r.data as any;
    expect(data.count).toBe(1);
    expect(data.matches[0].suburb).toBe("Chelsea");
    expect(data.matches[0].distance).toMatch(/3\.2 km/);
    expect(data.matches[0].requirements).toEqual(
      expect.arrayContaining([
        "driver's license",
        "vaccinations up to date",
        "non-smoker",
      ]),
    );
    expect(data.matches[0].parent_first_name).toBe("Jane");
  });

  it("never leaks internal field names", async () => {
    vi.mocked(getDfyNotificationsForNanny).mockResolvedValue({
      data: [buildNotification()],
      error: null,
    });
    const r = await jobSearchModule.execute(
      "read_my_job_matches",
      {},
      makeCtx("nanny"),
    );
    expect(JSON.stringify(r.data)).not.toMatch(
      /match_score|dfy_tier|respondedAt|notifiedAt/,
    );
  });

  it("returns friendly empty-state", async () => {
    vi.mocked(getDfyNotificationsForNanny).mockResolvedValue({
      data: [],
      error: null,
    });
    const r = await jobSearchModule.execute(
      "read_my_job_matches",
      {},
      makeCtx("nanny"),
    );
    expect(r.success).toBe(true);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const data = r.data as any;
    expect(data.count).toBe(0);
    expect(String(data.summary).toLowerCase()).toContain("no open-position");
  });

  it("surfaces server errors verbatim", async () => {
    vi.mocked(getDfyNotificationsForNanny).mockResolvedValue({
      data: null,
      error: "DB down",
    });
    const r = await jobSearchModule.execute(
      "read_my_job_matches",
      {},
      makeCtx("nanny"),
    );
    expect(r.success).toBe(false);
    expect(r.error).toBe("DB down");
  });
});

describe("job-search module — read_job_match_detail", () => {
  beforeEach(() => vi.clearAllMocks());

  it("requires a match_id", async () => {
    const r = await jobSearchModule.execute(
      "read_job_match_detail",
      {},
      makeCtx("nanny"),
    );
    expect(r.success).toBe(false);
    expect(r.error).toMatch(/match_id/);
  });

  it("rejects unknown match id", async () => {
    vi.mocked(getDfyNotificationsForNanny).mockResolvedValue({
      data: [buildNotification({ id: "n1" })],
      error: null,
    });
    const r = await jobSearchModule.execute(
      "read_job_match_detail",
      { match_id: "other" },
      makeCtx("nanny"),
    );
    expect(r.success).toBe(false);
    expect(r.error).toMatch(/No open match found/);
  });

  it("returns full detail including description + reasons + emits job_match tile", async () => {
    vi.mocked(getDfyNotificationsForNanny).mockResolvedValue({
      data: [buildNotification({ id: "n1" })],
      error: null,
    });
    const r = await jobSearchModule.execute(
      "read_job_match_detail",
      { match_id: "n1" },
      makeCtx("nanny"),
    );
    expect(r.success).toBe(true);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const data = r.data as any;
    expect(data.description).toContain("kind, experienced nanny");
    expect(data.reason_for_nanny).toContain("returning_to_work");
    expect(r.tile?.kind).toBe("job_match");
    if (r.tile?.kind === "job_match") {
      expect(r.tile.data.id).toBe("n1");
    }
  });
});
