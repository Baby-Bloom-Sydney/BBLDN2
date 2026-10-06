import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  verificationModule,
  summariseNannyState,
  type VerificationSummary,
} from "./verification";
import type { ModuleContext } from "./types";

// Every internal token that MUST NOT leak into Gemini's view.
const FORBIDDEN_TOKENS = [
  "verification_level",
  "verification_status",
  "verification_tier",
  "identity_status",
  "wwcc_status",
  "cross_check_status",
  "tier 1",
  "tier 2",
  "tier 3",
  "level 0",
  "level 1",
  "level 2",
  "level 3",
  "level 4",
  "status 0",
  "status 10",
  "status 11",
  "status 12",
  "status 20",
  "status 21",
  "status 30",
  "status 40",
];

function assertNoLeaks(summary: VerificationSummary) {
  const blob = JSON.stringify(summary).toLowerCase();
  for (const t of FORBIDDEN_TOKENS) {
    expect(blob, `found forbidden token: "${t}"`).not.toContain(t);
  }
}

describe("summariseNannyState — no-row (fresh signup)", () => {
  it("tells the user to finish registration and start verification", () => {
    const s = summariseNannyState(null, null);
    expect(s.headline).toMatch(/start/i);
    expect(s.whats_still_needed.some((x) => /registration/i.test(x))).toBe(
      true,
    );
    expect(s.how_to_continue?.url).toBe("/nanny/verification");
    assertNoLeaks(s);
  });
});

describe("summariseNannyState — registered, verification not submitted", () => {
  it("profile done, asks for verification form", () => {
    const s = summariseNannyState(
      { verification_level: 1 },
      {
        verification_status: 0,
        identity_status: "not_started",
        wwcc_status: "not_started",
        cross_check_status: "not_started",
        identity_user_guidance: null,
        wwcc_user_guidance: null,
        identity_rejection_reason: null,
        wwcc_rejection_reason: null,
      },
    );
    expect(s.whats_complete.some((x) => /profile/i.test(x))).toBe(true);
    expect(s.whats_still_needed.some((x) => /verification form/i.test(x))).toBe(
      true,
    );
    expect(s.how_to_continue?.url).toBe("/nanny/verification");
    assertNoLeaks(s);
  });
});

describe("summariseNannyState — pending AI ID check", () => {
  it("marks ID as in progress, nothing for user to do", () => {
    const s = summariseNannyState(
      { verification_level: 1 },
      {
        verification_status: 10,
        identity_status: "processing",
        wwcc_status: "not_started",
        cross_check_status: "not_started",
        identity_user_guidance: null,
        wwcc_user_guidance: null,
        identity_rejection_reason: null,
        wwcc_rejection_reason: null,
      },
    );
    expect(s.whats_in_progress.some((x) => /checking/i.test(x))).toBe(true);
    expect(s.how_to_continue).toBeNull();
    assertNoLeaks(s);
  });
});

describe("summariseNannyState — ID rejected", () => {
  it("surfaces the rejection reason and asks for resubmit", () => {
    const s = summariseNannyState(
      { verification_level: 1 },
      {
        verification_status: 12,
        identity_status: "rejected",
        wwcc_status: "not_started",
        cross_check_status: "not_started",
        identity_user_guidance: null,
        wwcc_user_guidance: null,
        identity_rejection_reason: "passport photo was blurry",
        wwcc_rejection_reason: null,
      },
    );
    expect(s.whats_still_needed.some((x) => /blurry/i.test(x))).toBe(true);
    expect(s.how_to_continue?.url).toBe("/nanny/verification");
    assertNoLeaks(s);
  });
});

describe("summariseNannyState — ID done, WWCC pending", () => {
  it("headline reflects WWCC-in-progress", () => {
    const s = summariseNannyState(
      { verification_level: 2 },
      {
        verification_status: 20,
        identity_status: "verified",
        wwcc_status: "pending",
        cross_check_status: "passed",
        identity_user_guidance: null,
        wwcc_user_guidance: null,
        identity_rejection_reason: null,
        wwcc_rejection_reason: null,
      },
    );
    expect(s.whats_complete.some((x) => /identity/i.test(x))).toBe(true);
    expect(
      s.whats_in_progress.some((x) => /working with children/i.test(x)),
    ).toBe(true);
    // Not visible to parents yet
    expect(s.cannot_do_yet.some((x) => /search results/i.test(x.what))).toBe(
      true,
    );
    assertNoLeaks(s);
  });
});

describe("summariseNannyState — provisionally verified (level 3)", () => {
  // UX rule: the nanny sees "Verified" on their dashboard. Katie must not
  // volunteer the pending-final-check note or the interview/babysitting
  // holds unless the user specifically asks. Those live in only_if_asked.
  const s = summariseNannyState(
    { verification_level: 3 },
    {
      verification_status: 30,
      identity_status: "verified",
      wwcc_status: "verified",
      cross_check_status: "passed",
      identity_user_guidance: null,
      wwcc_user_guidance: null,
      identity_rejection_reason: null,
      wwcc_rejection_reason: null,
    },
  );

  it("headline reads as 'verified' (matches dashboard)", () => {
    expect(s.headline).toMatch(/verified/i);
    expect(s.headline).not.toMatch(/finalising|pending|not (yet|fully)/i);
  });

  it("WWCC is in whats_complete, not in whats_in_progress", () => {
    expect(s.whats_complete.some((x) => /working with children/i.test(x))).toBe(
      true,
    );
    expect(
      s.whats_in_progress.some((x) => /working with children/i.test(x)),
    ).toBe(false);
  });

  it("does NOT list interview/babysitting blockers in cannot_do_yet", () => {
    expect(s.cannot_do_yet.some((x) => /interview/i.test(x.what))).toBe(false);
    expect(s.cannot_do_yet.some((x) => /babysitting/i.test(x.what))).toBe(
      false,
    );
  });

  it("still reports visible to parents in can_do_now", () => {
    expect(s.can_do_now.some((x) => /visible to parents/i.test(x))).toBe(true);
  });

  it("hides the final-check note + accept-holds in only_if_asked", () => {
    expect(
      s.only_if_asked.some((x) => /final administrative check/i.test(x)),
    ).toBe(true);
    expect(s.only_if_asked.some((x) => /accept(ing)? interview/i.test(x))).toBe(
      true,
    );
  });

  it("has no next action for the user", () => {
    expect(s.how_to_continue).toBeNull();
  });

  it("still passes the forbidden-token guard", () => {
    assertNoLeaks(s);
  });
});

describe("summariseNannyState — fully verified (level 4)", () => {
  it("everything complete, full access", () => {
    const s = summariseNannyState(
      { verification_level: 4 },
      {
        verification_status: 40,
        identity_status: "verified",
        wwcc_status: "verified",
        cross_check_status: "passed",
        identity_user_guidance: null,
        wwcc_user_guidance: null,
        identity_rejection_reason: null,
        wwcc_rejection_reason: null,
      },
    );
    expect(s.headline).toMatch(/fully verified/i);
    expect(s.whats_still_needed).toHaveLength(0);
    expect(s.how_to_continue).toBeNull();
    expect(s.can_do_now.some((x) => /interview/i.test(x))).toBe(true);
    expect(s.cannot_do_yet).toHaveLength(0);
    assertNoLeaks(s);
  });
});

describe("summariseNannyState — only_if_asked for non-provisional levels", () => {
  it("is an empty array when not provisional (nothing to hide)", () => {
    const levels = [0, 1, 2, 4] as const;
    for (const level of levels) {
      const s = summariseNannyState(
        { verification_level: level },
        {
          verification_status: level === 4 ? 40 : level === 2 ? 20 : 0,
          identity_status: level >= 2 ? "verified" : "not_started",
          wwcc_status: level === 4 ? "verified" : "not_started",
          cross_check_status: level >= 2 ? "passed" : "not_started",
          identity_user_guidance: null,
          wwcc_user_guidance: null,
          identity_rejection_reason: null,
          wwcc_rejection_reason: null,
        },
      );
      expect(Array.isArray(s.only_if_asked)).toBe(true);
      expect(s.only_if_asked).toHaveLength(0);
    }
  });
});

describe("summariseNannyState — system_guidance pass-through", () => {
  it("appends identity + wwcc guidance", () => {
    const s = summariseNannyState(
      { verification_level: 2 },
      {
        verification_status: 20,
        identity_status: "verified",
        wwcc_status: "pending",
        cross_check_status: "passed",
        identity_user_guidance: "Your ID looked good.",
        wwcc_user_guidance: "WWCC auto-check may take up to 24 hours.",
        identity_rejection_reason: null,
        wwcc_rejection_reason: null,
      },
    );
    expect(s.system_guidance).toContain("looked good");
    expect(s.system_guidance).toContain("24 hours");
    assertNoLeaks(s);
  });
});

// ── Handler-level tests (role gating) ────────────────────────────────────

function makeCtx(
  role: "nanny" | "parent" | "admin",
  rows: {
    nanny?: { verification_level?: number };
    verifications?: Partial<{
      verification_status: number;
      identity_status: string;
      wwcc_status: string;
      cross_check_status: string;
      identity_user_guidance: string | null;
      wwcc_user_guidance: string | null;
      identity_rejection_reason: string | null;
      wwcc_rejection_reason: string | null;
    }>;
  },
): ModuleContext {
  const supabase = {
    from: vi.fn((t: string) => ({
      select: () => ({
        eq: () => ({
          maybeSingle: async () => {
            if (t === "nannies")
              return { data: rows.nanny ?? null, error: null };
            if (t === "verifications")
              return { data: rows.verifications ?? null, error: null };
            return { data: null, error: null };
          },
        }),
      }),
    })),
  };
  return {
    botId: "b",
    userId: "u",
    userRole: role,
    effectiveRole: role,
    children: [],
    currentSurface: null,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    supabase: supabase as any,
  };
}

describe("verification module — read_verification_status", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns nanny summary for nanny role", async () => {
    const ctx = makeCtx("nanny", {
      nanny: { verification_level: 2 },
      verifications: {
        verification_status: 20,
        identity_status: "verified",
        wwcc_status: "pending",
        cross_check_status: "passed",
      },
    });
    const r = await verificationModule.execute(
      "read_verification_status",
      {},
      ctx,
    );
    expect(r.success).toBe(true);
    const data = r.data as VerificationSummary;
    expect(data.headline).toBeDefined();
    assertNoLeaks(data);
  });

  it("returns no parent summary when the caller is a parent", async () => {
    // LDN2 3h (D-7): London parents are never verified, so the tool is not
    // offered to them and a parent caller gets a refusal, not a summary.
    const ctx = makeCtx("parent", {});
    const r = await verificationModule.execute(
      "read_verification_status",
      {},
      ctx,
    );
    expect(r.success).toBe(false);
    expect(r.data).toBeUndefined();
    const tables = (
      ctx.supabase.from as unknown as { mock: { calls: [string][] } }
    ).mock.calls.map(([t]) => t);
    expect(tables).not.toContain("parents");
  });

  it("refuses for admin role", async () => {
    const ctx = makeCtx("admin", {});
    const r = await verificationModule.execute(
      "read_verification_status",
      {},
      ctx,
    );
    expect(r.success).toBe(false);
  });

  it("attaches a verification_status tile when there's a next-step action", async () => {
    // Nanny at level 1 who hasn't submitted verification → how_to_continue
    // is present → tool result should carry an inline tile with a stepper
    // and a "Continue" link.
    const ctx = makeCtx("nanny", {
      nanny: { verification_level: 1 },
      verifications: {
        verification_status: 0,
        identity_status: "not_started",
        wwcc_status: "not_started",
        cross_check_status: "not_started",
      },
    });
    const r = await verificationModule.execute(
      "read_verification_status",
      {},
      ctx,
    );
    expect(r.success).toBe(true);
    expect(r.tile).toBeDefined();
    expect(r.tile?.kind).toBe("verification_status");
    if (r.tile?.kind === "verification_status") {
      expect(r.tile.data.action?.href).toBe("/nanny/verification");
      expect(r.tile.data.steps).toHaveLength(3);
      expect(r.tile.data.steps[0]).toEqual({
        label: "Profile complete",
        status: "verified",
      });
      expect(r.tile.data.steps[1].status).toBe("not_started");
      expect(r.tile.data.steps[2].status).toBe("not_started");
    }
  });

  it("attaches a fully-verified tile (all steps 'verified', no action) at level 4", async () => {
    const ctx = makeCtx("nanny", {
      nanny: { verification_level: 4 },
      verifications: {
        verification_status: 40,
        identity_status: "verified",
        wwcc_status: "verified",
        cross_check_status: "passed",
      },
    });
    const r = await verificationModule.execute(
      "read_verification_status",
      {},
      ctx,
    );
    expect(r.success).toBe(true);
    expect(r.tile?.kind).toBe("verification_status");
    if (r.tile?.kind === "verification_status") {
      expect(r.tile.data.action).toBeUndefined();
      expect(r.tile.data.headline.toLowerCase()).toMatch(
        /you'?re (fully )?verified/,
      );
      expect(r.tile.data.steps.every((s) => s.status === "verified")).toBe(
        true,
      );
    }
  });

  it("at level 3 the tile shows all steps 'verified' — the final check pending note is stripped from tile output", async () => {
    // Provisional level 3 UX: dashboard + Katie tile both say
    // "Verified". The silent OCG confirmation sits in only_if_asked and
    // must NOT show on the tile.
    const ctx = makeCtx("nanny", {
      nanny: { verification_level: 3 },
      verifications: {
        verification_status: 30,
        identity_status: "verified",
        wwcc_status: "verified",
        cross_check_status: "passed",
      },
    });
    const r = await verificationModule.execute(
      "read_verification_status",
      {},
      ctx,
    );
    expect(r.success).toBe(true);
    expect(r.tile?.kind).toBe("verification_status");
    if (r.tile?.kind === "verification_status") {
      expect(r.tile.data.action).toBeUndefined();
      expect(r.tile.data.headline.toLowerCase()).toMatch(/you'?re verified/);
      expect(r.tile.data.steps.every((s) => s.status === "verified")).toBe(
        true,
      );
      // Nothing in the visible tile copy should leak the pending
      // admin-check language.
      const blob = JSON.stringify(r.tile.data).toLowerCase();
      expect(blob).not.toMatch(
        /final (administrative )?check|still in progress|pending/,
      );
    }
  });
});

describe("verification module — read_verification_next_steps", () => {
  it("returns empty with nothing_to_do=true when fully verified", async () => {
    const ctx = makeCtx("nanny", {
      nanny: { verification_level: 4 },
      verifications: {
        verification_status: 40,
        identity_status: "verified",
        wwcc_status: "verified",
        cross_check_status: "passed",
      },
    });
    const r = await verificationModule.execute(
      "read_verification_next_steps",
      {},
      ctx,
    );
    expect(r.success).toBe(true);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const data = r.data as any;
    expect(data.count).toBe(0);
    expect(data.nothing_to_do).toBe(true);
  });

  it("returns actionable steps with link when user has work", async () => {
    const ctx = makeCtx("nanny", {
      nanny: { verification_level: 1 },
      verifications: {
        verification_status: 12,
        identity_status: "rejected",
        wwcc_status: "not_started",
        cross_check_status: "not_started",
        identity_rejection_reason: "blurry",
      },
    });
    const r = await verificationModule.execute(
      "read_verification_next_steps",
      {},
      ctx,
    );
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const data = r.data as any;
    expect(data.count).toBeGreaterThan(0);
    expect(data.steps[0].url).toBe("/nanny/verification");
    expect(data.nothing_to_do).toBe(false);
  });
});

describe("verification module — rolesAllowed gate", () => {
  it("allows the verification tools for the nanny role only", () => {
    // Admin and parent are both blocked (LDN2 3h removed the parent arm).
    expect(verificationModule.rolesAllowed).toEqual(["nanny"]);
  });
});

describe("read_verification_status.isPrefulfilled", () => {
  const tool = verificationModule.tools.find(
    (t) => t.name === "read_verification_status",
  )!;

  it("returns true when verification_status slot is present", () => {
    expect(
      tool.isPrefulfilled?.(
        {},
        {
          as_of: "2026-05-09T00:00:00Z",
          verification_status: {
            level: 3,
            status_code: 30,
            label: "Provisionally verified",
            blocking_issues: [],
          },
        },
      ),
    ).toBe(true);
  });

  it("returns false when verification_status slot is absent (typical case)", () => {
    expect(tool.isPrefulfilled?.({}, { as_of: "2026-05-09T00:00:00Z" })).toBe(
      false,
    );
    expect(tool.isPrefulfilled?.({}, undefined)).toBe(false);
  });

  it("returns true even for an unverified summary (the summary itself is the answer)", () => {
    expect(
      tool.isPrefulfilled?.(
        {},
        {
          as_of: "2026-05-09T00:00:00Z",
          verification_status: {
            level: 0,
            status_code: 0,
            label: "Just signed up",
            blocking_issues: ["Submit ID + selfie"],
          },
        },
      ),
    ).toBe(true);
  });
});
