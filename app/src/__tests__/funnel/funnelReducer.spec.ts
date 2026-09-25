import { describe, expect, it } from "vitest";
import {
  DEFAULT_FUNNEL_STATE,
  type FunnelAction,
  type NannyLeadFunnelState,
} from "@/types/nanny-leads";
import { funnelReducer } from "@/app/(funnel)/apply/components/FunnelOrchestrator";

// ── T-023 reducer behaviour ──────────────────────────────────────────
// These tests exercise the two reducer changes added with the
// External U3 Position feature:
//   1. UPDATE_LEAD_SIGNALS — merges payload into state.lead_signals
//   2. RESTORE_STATE — DEEP-MERGES payload against DEFAULT_FUNNEL_STATE
//      so users with a persisted state from before the schema change
//      (no lead_signals key) don't crash on first access.

describe("funnelReducer — UPDATE_LEAD_SIGNALS (T-023)", () => {
  it("sets external_u3_position from null to true", () => {
    const action: FunnelAction = {
      type: "UPDATE_LEAD_SIGNALS",
      payload: { external_u3_position: true },
    };

    const next = funnelReducer(DEFAULT_FUNNEL_STATE, action);

    expect(next.lead_signals.external_u3_position).toBe(true);
  });

  it("sets external_u3_position from null to false", () => {
    const action: FunnelAction = {
      type: "UPDATE_LEAD_SIGNALS",
      payload: { external_u3_position: false },
    };

    const next = funnelReducer(DEFAULT_FUNNEL_STATE, action);

    expect(next.lead_signals.external_u3_position).toBe(false);
  });

  it("preserves untouched state fields when updating lead_signals", () => {
    const seeded: NannyLeadFunnelState = {
      ...DEFAULT_FUNNEL_STATE,
      first_name: "Sarah",
      email: "sarah@example.com",
    };

    const action: FunnelAction = {
      type: "UPDATE_LEAD_SIGNALS",
      payload: { external_u3_position: true },
    };

    const next = funnelReducer(seeded, action);

    expect(next.first_name).toBe("Sarah");
    expect(next.email).toBe("sarah@example.com");
    expect(next.lead_signals.external_u3_position).toBe(true);
  });

  it("does not mutate the input state (immutable update)", () => {
    const seeded: NannyLeadFunnelState = { ...DEFAULT_FUNNEL_STATE };
    const action: FunnelAction = {
      type: "UPDATE_LEAD_SIGNALS",
      payload: { external_u3_position: true },
    };

    funnelReducer(seeded, action);

    expect(seeded.lead_signals.external_u3_position).toBeNull();
  });
});

describe("funnelReducer — RESTORE_STATE deep-merge (T-023 §4.2)", () => {
  // Simulates a real persisted-state payload from before lead_signals
  // was added to the schema. Pre-T-023 users will have this in localStorage.
  // Accessing state.lead_signals.external_u3_position on this shape
  // without the deep-merge fix would throw "Cannot read properties of
  // undefined (reading 'external_u3_position')" on first reveal.
  type PreT023State = Omit<NannyLeadFunnelState, "lead_signals">;
  const stalePayload: PreT023State = {
    first_name: "Returning",
    last_name: "User",
    email: "returning@example.com",
    phone: "07700900123",
    identity: DEFAULT_FUNNEL_STATE.identity,
    experience: {
      ...DEFAULT_FUNNEL_STATE.experience,
      date_of_birth: "1990-01-01",
      total_experience: "5",
      under_3_experience_yn: true,
      under_3_experience: 3,
    },
    qualifications: DEFAULT_FUNNEL_STATE.qualifications,
    residency: DEFAULT_FUNNEL_STATE.residency,
    preferences: DEFAULT_FUNNEL_STATE.preferences,
    availability: DEFAULT_FUNNEL_STATE.availability,
    salary: DEFAULT_FUNNEL_STATE.salary,
    matching: DEFAULT_FUNNEL_STATE.matching,
    about_you: DEFAULT_FUNNEL_STATE.about_you,
    ai_bio: null,
    ai_content: null,
    leadId: null,
    currentStage: "N1",
    currentPage: 4,
  };

  it("preserves restored top-level fields", () => {
    const action: FunnelAction = {
      type: "RESTORE_STATE",
      payload: stalePayload as NannyLeadFunnelState,
    };

    const next = funnelReducer(DEFAULT_FUNNEL_STATE, action);

    expect(next.first_name).toBe("Returning");
    expect(next.email).toBe("returning@example.com");
    expect(next.currentPage).toBe(4);
  });

  it("preserves restored nested JSONB sections (experience)", () => {
    const action: FunnelAction = {
      type: "RESTORE_STATE",
      payload: stalePayload as NannyLeadFunnelState,
    };

    const next = funnelReducer(DEFAULT_FUNNEL_STATE, action);

    expect(next.experience.date_of_birth).toBe("1990-01-01");
    expect(next.experience.total_experience).toBe("5");
    expect(next.experience.under_3_experience_yn).toBe(true);
    expect(next.experience.under_3_experience).toBe(3);
  });

  it("fills missing top-level lead_signals from DEFAULT (does not crash)", () => {
    const action: FunnelAction = {
      type: "RESTORE_STATE",
      payload: stalePayload as NannyLeadFunnelState,
    };

    const next = funnelReducer(DEFAULT_FUNNEL_STATE, action);

    // Without the deep-merge fix this access would throw because
    // stalePayload has no lead_signals key.
    expect(next.lead_signals).toBeDefined();
    expect(next.lead_signals.external_u3_position).toBeNull();
  });

  it("merges nested JSONB sections — payload identity sparse, defaults backfill", () => {
    const sparsePayload = {
      ...stalePayload,
      identity: {
        motivation: "Supporting families",
        // intentionally missing: personality_traits, level_of_support, professional_values
      },
    } as unknown as NannyLeadFunnelState;

    const action: FunnelAction = {
      type: "RESTORE_STATE",
      payload: sparsePayload,
    };

    const next = funnelReducer(DEFAULT_FUNNEL_STATE, action);

    expect(next.identity.motivation).toBe("Supporting families");
    // Defaults backfilled — no undefined access at runtime
    expect(next.identity.personality_traits).toEqual([]);
    expect(next.identity.level_of_support).toEqual([]);
    expect(next.identity.professional_values).toEqual([]);
  });

  it("preserves an explicitly-set lead_signals when present in payload", () => {
    const payloadWithSignals: NannyLeadFunnelState = {
      ...stalePayload,
      lead_signals: { external_u3_position: true },
    } as NannyLeadFunnelState;

    const action: FunnelAction = {
      type: "RESTORE_STATE",
      payload: payloadWithSignals,
    };

    const next = funnelReducer(DEFAULT_FUNNEL_STATE, action);

    expect(next.lead_signals.external_u3_position).toBe(true);
  });
});
