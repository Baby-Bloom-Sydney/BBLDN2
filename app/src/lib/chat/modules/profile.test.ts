import { describe, it, expect, beforeEach, vi } from "vitest";
import type { ModuleContext } from "./types";

// Mock server actions so their side-effecting imports (Resend, etc.) never
// run during unit tests. The profile module only consumes these four.
vi.mock("@/lib/actions/nanny", () => ({
  getNannyProfile: vi.fn(),
  updateNannyProfile: vi.fn(),
}));
vi.mock("@/lib/actions/parent", () => ({
  getPosition: vi.fn(),
}));
vi.mock("@/lib/actions/position-funnel", () => ({
  getParentPlacement: vi.fn(),
}));

import { profileModule } from "./profile";
import { getNannyProfile, updateNannyProfile } from "@/lib/actions/nanny";
import { getPosition } from "@/lib/actions/parent";
import { getParentPlacement } from "@/lib/actions/position-funnel";
import { HOURLY_RATE_BOUNDS } from "@/lib/constants";

/** An in-bounds rate, expressed through the one config bound (Q-1/Q-7). */
const IN_BOUNDS_RATE = HOURLY_RATE_BOUNDS.max;

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

// Minimal NannyProfile fixture — only the fields the module touches.
function nannyFixture(overrides: Record<string, unknown> = {}) {
  const base = {
    first_name: "Jess",
    last_name: "Mahoney",
    email: "jess@example.com",
    mobile_number: null,
    date_of_birth: null,
    suburb: "Clapham",
    postcode: "SW4",
    profile_picture_url: "https://example.com/pp.jpg",
    gender: null,
    nationality: null,
    languages: null,
    total_experience_years: 5,
    nanny_experience_years: 3,
    under_3_experience_years: 2,
    newborn_experience_years: 1,
    experience_details: null,
    role_types_preferred: ["Mothers Help"],
    level_of_support_offered: ["Child Development"],
    hourly_rate_min: 45,
    pay_frequency: null,
    immediate_start_available: true,
    placement_ongoing_preferred: true,
    start_date_earliest: null,
    end_date_latest: null,
    max_children: 2,
    min_child_age_months: 6,
    max_child_age_months: 60,
    additional_needs_ok: false,
    sydney_resident: true,
    residency_status: null,
    right_to_work: true,
    drivers_license: true,
    has_car: true,
    comfortable_with_pets: true,
    vaccination_status: true,
    non_smoker: true,
    hobbies_interests: null,
    strengths_traits: null,
    skills_training: null,
    motivation: null,
    personality_traits: null,
    professional_values: null,
    childcare_roles: null,
    // Fields not on the declared interface but present at runtime:
    verification_level: 3,
    visible_in_bsr: false,
    photo_1_url: "https://example.com/1.jpg",
    photo_2_url: null,
    photo_3_url: null,
    available_days: ["Monday", "Tuesday"],
    ai_content: { generated_at: "2026-03-01T00:00:00Z" },
  };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return { ...base, ...overrides } as any;
}

describe("profile module — role gate", () => {
  beforeEach(() => vi.clearAllMocks());

  it("rejects admin role on read_my_profile", async () => {
    const ctx = makeCtx();
    ctx.effectiveRole = "admin";
    const r = await profileModule.execute("read_my_profile", {}, ctx);
    expect(r.success).toBe(false);
    expect(r.error).toMatch(/nanny and parent/);
  });

  it("returns error for unknown tool", async () => {
    const r = await profileModule.execute("nope", {}, makeCtx());
    expect(r.success).toBe(false);
    expect(r.error).toMatch(/Unknown tool/);
  });
});

describe("profile module — read_my_profile (nanny)", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns a plain-English snapshot with no internal field names", async () => {
    vi.mocked(getNannyProfile).mockResolvedValue({
      data: nannyFixture(),
      error: null,
    });
    const r = await profileModule.execute(
      "read_my_profile",
      {},
      makeCtx("nanny"),
    );
    expect(r.success).toBe(true);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const data = r.data as any;
    expect(data.role).toBe("nanny");
    expect(data.first_name).toBe("Jess");
    expect(data.hourly_rate).toBe("£45/hour");
    expect(data.age_range).toMatch(/6 months.+5 years/);
    expect(data.photo_count).toBe(2);
    // Plain-English visibility — never expose the number
    expect(String(data.visibility)).toMatch(/profile is live/i);
    expect(JSON.stringify(data)).not.toMatch(
      /verification_level|verification_tier|visible_in_bsr|visible_in_match_making/,
    );
  });

  it("provisional (level 3) visibility says 'live' — no pending-check language", async () => {
    // Matches the verification-module memory — never volunteer the final-check pending note.
    vi.mocked(getNannyProfile).mockResolvedValue({
      data: nannyFixture({ verification_level: 3 }),
      error: null,
    });
    const r = await profileModule.execute(
      "read_my_profile",
      {},
      makeCtx("nanny"),
    );
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const data = r.data as any;
    const text = String(data.visibility).toLowerCase();
    expect(text).toContain("profile is live");
    expect(text).not.toMatch(
      /final (administrative )?check|still in progress|pending/,
    );
  });

  it("level 0 describes the not-started state in plain English", async () => {
    vi.mocked(getNannyProfile).mockResolvedValue({
      data: nannyFixture({ verification_level: 0 }),
      error: null,
    });
    const r = await profileModule.execute(
      "read_my_profile",
      {},
      makeCtx("nanny"),
    );
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const data = r.data as any;
    expect(String(data.visibility).toLowerCase()).toContain("haven't started");
  });

  it("formats 'Not set yet' when hourly_rate_min is null", async () => {
    vi.mocked(getNannyProfile).mockResolvedValue({
      data: nannyFixture({ hourly_rate_min: null }),
      error: null,
    });
    const r = await profileModule.execute(
      "read_my_profile",
      {},
      makeCtx("nanny"),
    );
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const data = r.data as any;
    expect(data.hourly_rate).toBe("Not set yet");
  });

  it("surfaces fetch error verbatim", async () => {
    vi.mocked(getNannyProfile).mockResolvedValue({
      data: null,
      error: "Database timeout",
    });
    const r = await profileModule.execute(
      "read_my_profile",
      {},
      makeCtx("nanny"),
    );
    expect(r.success).toBe(false);
    expect(r.error).toBe("Database timeout");
  });
});

describe("profile module — read_my_profile (parent)", () => {
  beforeEach(() => vi.clearAllMocks());

  it("blends position + placement into one snapshot", async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    vi.mocked(getPosition).mockResolvedValue({
      data: {
        id: "pos-1",
        suburb: "Chelsea",
        hours_per_week: 30,
        days_required: ["Monday", "Tuesday", "Wednesday"],
        hourly_rate: 40,
        children: [{ age_months: 18 }, { age_months: 36 }],
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      } as any,
      error: null,
    });
    vi.mocked(getParentPlacement).mockResolvedValue({
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      data: {
        nannyName: "Jess Mahoney",
        nannySuburb: "Clapham",
        weeklyHours: 30,
        hourlyRate: 45,
        hiredAt: "2026-03-01T00:00:00Z",
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      } as any,
      error: null,
    });
    const r = await profileModule.execute(
      "read_my_profile",
      {},
      makeCtx("parent"),
    );
    expect(r.success).toBe(true);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const data = r.data as any;
    expect(data.role).toBe("parent");
    expect(data.has_active_position).toBe(true);
    expect(data.position_summary.num_children).toBe(2);
    expect(data.has_active_placement).toBe(true);
    expect(data.placement_summary.nanny_name).toBe("Jess Mahoney");
  });

  it("handles parent with no position and no placement", async () => {
    vi.mocked(getPosition).mockResolvedValue({ data: null, error: null });
    vi.mocked(getParentPlacement).mockResolvedValue({
      data: null,
      error: null,
    });
    const r = await profileModule.execute(
      "read_my_profile",
      {},
      makeCtx("parent"),
    );
    expect(r.success).toBe(true);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const data = r.data as any;
    expect(data.has_active_position).toBe(false);
    expect(data.has_active_placement).toBe(false);
    expect(data.position_summary).toBeNull();
    expect(data.placement_summary).toBeNull();
  });
});

describe("profile module — read_my_position / read_my_placement", () => {
  beforeEach(() => vi.clearAllMocks());

  it("read_my_position rejects nanny role", async () => {
    const r = await profileModule.execute(
      "read_my_position",
      {},
      makeCtx("nanny"),
    );
    expect(r.success).toBe(false);
    expect(r.error).toMatch(/Only parents/);
  });

  it("read_my_position returns has_active_position=false when empty", async () => {
    vi.mocked(getPosition).mockResolvedValue({ data: null, error: null });
    const r = await profileModule.execute(
      "read_my_position",
      {},
      makeCtx("parent"),
    );
    expect(r.success).toBe(true);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const data = r.data as any;
    expect(data.has_active_position).toBe(false);
    expect(String(data.summary).toLowerCase()).toContain(
      "don't have an active position",
    );
  });

  it("read_my_placement rejects nanny role", async () => {
    const r = await profileModule.execute(
      "read_my_placement",
      {},
      makeCtx("nanny"),
    );
    expect(r.success).toBe(false);
    expect(r.error).toMatch(/Only parents/);
  });
});

describe("profile module — tile emission (WU 8.18)", () => {
  beforeEach(() => vi.clearAllMocks());

  // Narrows the loosely-typed ToolResult.tile to a katie_note shape so
  // the assertion block reads `tile.data.body` etc with full type
  // checking instead of `as any` blanket casts. If the tile is the
  // wrong kind (or missing) the helper throws — which surfaces as a
  // fast, descriptive test failure.
  function expectKatieNoteTile(
    tile: { kind: string; data: unknown } | undefined,
  ): {
    badge?: string;
    title?: string;
    body: string;
    action?: { label: string; href: string };
    image_url?: string;
  } {
    if (!tile) throw new Error("expected katie_note tile but got none");
    if (tile.kind !== "katie_note") {
      throw new Error(`expected katie_note tile, got ${tile.kind}`);
    }
    return tile.data as {
      badge?: string;
      title?: string;
      body: string;
      action?: { label: string; href: string };
      image_url?: string;
    };
  }

  it("read_my_profile (nanny) emits a katie_note tile with the profile snapshot", async () => {
    vi.mocked(getNannyProfile).mockResolvedValue({
      data: nannyFixture(),
      error: null,
    });
    const r = await profileModule.execute(
      "read_my_profile",
      {},
      makeCtx("nanny"),
    );
    expect(r.success).toBe(true);
    const td = expectKatieNoteTile(r.tile);
    expect(td.badge).toBe("Your Profile");
    expect(td.title).toMatch(/Jess/);
    expect(td.body).toMatch(/£45\/hour/);
    expect(td.action?.href).toBe("/nanny/profile");
  });

  it("read_my_profile (parent) emits a katie_note tile with the account snapshot", async () => {
    vi.mocked(getPosition).mockResolvedValue({
      data: {
        id: "pos-1",
        suburb: "Chelsea",
        hours_per_week: 30,
        days_required: ["Mon", "Tue"],
        hourly_rate: 40,
        children: [{ age_months: 18 }],
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      } as any,
      error: null,
    });
    vi.mocked(getParentPlacement).mockResolvedValue({
      data: {
        nannyName: "Jess",
        nannySuburb: "Clapham",
        weeklyHours: 30,
        hourlyRate: 45,
        hiredAt: "2026-03-01T00:00:00Z",
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      } as any,
      error: null,
    });
    const r = await profileModule.execute(
      "read_my_profile",
      {},
      makeCtx("parent"),
    );
    const td = expectKatieNoteTile(r.tile);
    expect(td.body).toMatch(/Chelsea/);
    expect(td.body).toMatch(/Jess/);
    expect(td.action?.href).toBe("/parent");
  });

  // WU 8.18b — read_my_position now emits a parent_position id-only
  // tile that fetches and renders the same PositionDetailView used on
  // /parent/position. The structured fields stay in `data` so Gemini
  // can narrate them.
  it("read_my_position emits a parent_position id-only tile", async () => {
    vi.mocked(getPosition).mockResolvedValue({
      data: {
        id: "pos-1",
        suburb: "Islington",
        urgency: "As soon as possible",
        start_date: "2026-05-01",
        hours_per_week: 25,
        days_required: ["Mon", "Wed", "Fri"],
        hourly_rate: 42,
        children: [{ age_months: 12 }, { age_months: 36 }],
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      } as any,
      error: null,
    });
    const r = await profileModule.execute(
      "read_my_position",
      {},
      makeCtx("parent"),
    );
    expect(r.success).toBe(true);
    expect(r.tile?.kind).toBe("parent_position");
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const tileData = r.tile?.data as any;
    expect(tileData.id).toBe("pos-1");
    // Structured fields still flow back to Gemini via the `data` envelope.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const data = r.data as any;
    expect(data.has_active_position).toBe(true);
    expect(data.position.num_children).toBe(2);
  });

  it("read_my_position emits a katie_note CTA tile when no position exists", async () => {
    vi.mocked(getPosition).mockResolvedValue({ data: null, error: null });
    const r = await profileModule.execute(
      "read_my_position",
      {},
      makeCtx("parent"),
    );
    expect(r.success).toBe(true);
    // No position id available, so the dedicated parent_position
    // tile can't render — fall back to a katie_note CTA pointing at
    // /parent/request. Different purpose than the data tile.
    const td = expectKatieNoteTile(r.tile);
    expect(td.badge).toBe("No Position");
    expect(td.action?.href).toBe("/parent/request");
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const data = r.data as any;
    expect(data.has_active_position).toBe(false);
  });

  it("read_my_placement emits a parent_placement id-only tile", async () => {
    vi.mocked(getParentPlacement).mockResolvedValue({
      data: {
        id: "placement-1",
        nannyName: "Jess Mahoney",
        nannySuburb: "Clapham",
        weeklyHours: 30,
        hourlyRate: 45,
        hiredAt: "2026-03-01T00:00:00Z",
        startDate: "2026-03-15",
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      } as any,
      error: null,
    });
    const r = await profileModule.execute(
      "read_my_placement",
      {},
      makeCtx("parent"),
    );
    expect(r.success).toBe(true);
    expect(r.tile?.kind).toBe("parent_placement");
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const tileData = r.tile?.data as any;
    expect(tileData.id).toBe("placement-1");
    // Structured fields still in data envelope for Gemini.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const data = r.data as any;
    expect(data.placement.nanny_name).toBe("Jess Mahoney");
  });

  it("read_my_placement does NOT emit a tile when no placement exists", async () => {
    vi.mocked(getParentPlacement).mockResolvedValue({
      data: null,
      error: null,
    });
    const r = await profileModule.execute(
      "read_my_placement",
      {},
      makeCtx("parent"),
    );
    expect(r.success).toBe(true);
    // No tile — narration only — keeps the chat tidy when there's nothing to render
    expect(r.tile).toBeUndefined();
  });
});

describe("profile module — propose_/apply_update_rate", () => {
  beforeEach(() => vi.clearAllMocks());

  it("rejects parent role", async () => {
    const r = await profileModule.execute(
      "propose_update_rate",
      { hourly_rate: IN_BOUNDS_RATE },
      makeCtx("parent"),
    );
    expect(r.success).toBe(false);
    expect(r.error).toMatch(/Only nannies/);
  });

  it("rejects non-number rate", async () => {
    const r = await profileModule.execute(
      "propose_update_rate",
      { hourly_rate: "fifty" },
      makeCtx("nanny"),
    );
    expect(r.success).toBe(false);
    expect(r.error).toMatch(/number/);
  });

  it("rejects a rate below the configured minimum", async () => {
    const r = await profileModule.execute(
      "propose_update_rate",
      { hourly_rate: HOURLY_RATE_BOUNDS.min - 1 },
      makeCtx("nanny"),
    );
    expect(r.success).toBe(false);
    expect(r.error).toContain(
      `between £${HOURLY_RATE_BOUNDS.min} and £${HOURLY_RATE_BOUNDS.max}`,
    );
  });

  it("rejects a rate above the configured maximum", async () => {
    const r = await profileModule.execute(
      "propose_update_rate",
      { hourly_rate: HOURLY_RATE_BOUNDS.max + 1 },
      makeCtx("nanny"),
    );
    expect(r.success).toBe(false);
    expect(r.error).toContain(
      `between £${HOURLY_RATE_BOUNDS.min} and £${HOURLY_RATE_BOUNDS.max}`,
    );
  });

  it("propose returns preview, does not hit server action", async () => {
    const r = await profileModule.execute(
      "propose_update_rate",
      { hourly_rate: IN_BOUNDS_RATE },
      makeCtx("nanny"),
    );
    expect(r.success).toBe(true);
    expect(updateNannyProfile).not.toHaveBeenCalled();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const data = r.data as any;
    expect(data.preview).toContain(`£${IN_BOUNDS_RATE}/hour`);
    expect(data.email_side_effect).toBe(false);
  });

  it("apply updates profile + returns success", async () => {
    vi.mocked(updateNannyProfile).mockResolvedValue({
      success: true,
      error: null,
    });
    const r = await profileModule.execute(
      "apply_update_rate",
      { hourly_rate: IN_BOUNDS_RATE },
      makeCtx("nanny"),
    );
    expect(r.success).toBe(true);
    expect(updateNannyProfile).toHaveBeenCalledWith({
      hourly_rate_min: IN_BOUNDS_RATE,
    });
  });

  it("surfaces server-action error verbatim", async () => {
    vi.mocked(updateNannyProfile).mockResolvedValue({
      success: false,
      error: "Not authenticated",
    });
    const r = await profileModule.execute(
      "apply_update_rate",
      { hourly_rate: IN_BOUNDS_RATE },
      makeCtx("nanny"),
    );
    expect(r.success).toBe(false);
    expect(r.error).toBe("Not authenticated");
  });
});

describe("profile module — propose_/apply_update_age_range", () => {
  beforeEach(() => vi.clearAllMocks());

  it("rejects min > max", async () => {
    const r = await profileModule.execute(
      "propose_update_age_range",
      { min_months: 60, max_months: 24 },
      makeCtx("nanny"),
    );
    expect(r.success).toBe(false);
    expect(r.error).toMatch(/greater than/);
  });

  it("rejects out-of-range values", async () => {
    const r = await profileModule.execute(
      "propose_update_age_range",
      { min_months: -1, max_months: 200 },
      makeCtx("nanny"),
    );
    expect(r.success).toBe(false);
    expect(r.error).toMatch(/between 0 and 180/);
  });

  it("propose preview flags matchmaking visibility shift", async () => {
    const r = await profileModule.execute(
      "propose_update_age_range",
      { min_months: 12, max_months: 60 },
      makeCtx("nanny"),
    );
    expect(r.success).toBe(true);
    expect(updateNannyProfile).not.toHaveBeenCalled();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const data = r.data as any;
    expect(data.preview.toLowerCase()).toContain("matchmaking");
  });

  it("apply updates both min and max in a single server call", async () => {
    vi.mocked(updateNannyProfile).mockResolvedValue({
      success: true,
      error: null,
    });
    const r = await profileModule.execute(
      "apply_update_age_range",
      { min_months: 12, max_months: 60 },
      makeCtx("nanny"),
    );
    expect(r.success).toBe(true);
    expect(updateNannyProfile).toHaveBeenCalledWith({
      min_child_age_months: 12,
      max_child_age_months: 60,
    });
  });
});

describe("read_my_profile.isPrefulfilled", () => {
  const tool = profileModule.tools.find((t) => t.name === "read_my_profile")!;

  it("returns true when my_profile_basics is present", () => {
    expect(
      tool.isPrefulfilled?.(
        {},
        {
          as_of: "2026-05-09T00:00:00Z",
          my_profile_basics: {
            first_name: "Emma",
            last_name: "Smith",
            role: "nanny",
          },
        },
      ),
    ).toBe(true);
  });

  it("returns false when my_profile_basics is absent", () => {
    expect(tool.isPrefulfilled?.({}, { as_of: "2026-05-09T00:00:00Z" })).toBe(
      false,
    );
    expect(tool.isPrefulfilled?.({}, undefined)).toBe(false);
  });

  it("returns false when partial / null my_profile_basics is supplied", () => {
    // Defensive — verifier should reject malformed slots, but the predicate
    // still treats falsy presence as "not loaded". null is the realistic
    // edge case (a publisher could in theory set `my_profile_basics: null`).
    expect(
      tool.isPrefulfilled?.(
        {},
        { as_of: "2026-05-09T00:00:00Z", my_profile_basics: null as never },
      ),
    ).toBe(false);
  });
});
