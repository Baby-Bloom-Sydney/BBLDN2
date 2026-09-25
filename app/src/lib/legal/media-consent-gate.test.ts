/**
 * media-consent-gate — automated coverage of the parent-photo consent
 * decision tree.
 *
 * Bailey 2026-05-14 + COPC exposure draft (2026-03-31): parents must
 * affirmatively consent to media uploads for their child, the consent
 * is valid for 12 months, and the rule applies until the child is 15.
 *
 * AGR slug is treated as a configuration parameter ("agr-20-parent-
 * photo-consent-v1" as placeholder) so T-014's final slug naming can
 * land via a single migration without code churn.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  hasParentMediaConsent,
  PARENT_APP_CONSENT_AGREEMENT_ID,
  PARENT_APP_CONSENT_SLUG,
  type MediaConsentGateDeps,
} from "./media-consent-gate";

// ---------------------------------------------------------------------------
// Test fixtures
// ---------------------------------------------------------------------------

const NOW = new Date("2026-06-01T12:00:00+01:00");
const ONE_DAY_MS = 24 * 60 * 60 * 1000;

interface ChildRow {
  id: string;
  date_of_birth: string | null;
  age_months_approx: number | null;
}

interface ConsentRow {
  user_id: string;
  user_type: "client" | "professional" | null;
  agreement_id: string;
  related_entity_id: string;
  consent_given: boolean;
  created_at: string;
}

function isoOffset(days: number): string {
  return new Date(NOW.getTime() + days * ONE_DAY_MS).toISOString();
}

function isoYearsAgo(years: number, extraDays = 0): string {
  const d = new Date(NOW);
  d.setUTCFullYear(d.getUTCFullYear() - years);
  d.setUTCDate(d.getUTCDate() - extraDays);
  return d.toISOString();
}

function dobYearsAgo(years: number, extraDays = 0): string {
  // Return YYYY-MM-DD style for a DOB.
  return isoYearsAgo(years, extraDays).slice(0, 10);
}

// ---------------------------------------------------------------------------
// Minimal Supabase fake — implements just the chain shapes we use.
// ---------------------------------------------------------------------------

function createFakeAdmin(seed: {
  children: ChildRow[];
  consents: ConsentRow[];
}): MediaConsentGateDeps["admin"] {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return {
    from(table: string) {
      if (table === "child_client") return childClientTable(seed.children);
      if (table === "consent_records")
        return consentRecordsTable(seed.consents);
      throw new Error(`fake admin: unhandled table ${table}`);
    },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any;
}

function childClientTable(children: ChildRow[]) {
  return {
    select(_cols: string) {
      return {
        eq(field: keyof ChildRow, value: unknown) {
          return {
            async maybeSingle<T>(): Promise<{ data: T | null; error: null }> {
              const row = children.find((c) => c[field] === value) ?? null;
              return { data: row as unknown as T | null, error: null };
            },
          };
        },
      };
    },
  };
}

function consentRecordsTable(consents: ConsentRow[]) {
  const filters: Array<(r: ConsentRow) => boolean> = [];
  const builder: {
    eq: (field: keyof ConsentRow, value: unknown) => typeof builder;
    order: (field: string, opts: unknown) => typeof builder;
    limit: (n: number) => typeof builder;
    maybeSingle: <T>() => Promise<{ data: T | null; error: null }>;
  } = {
    eq(field, value) {
      filters.push((r) => r[field] === value);
      return builder;
    },
    order(_field, _opts) {
      return builder;
    },
    limit(_n) {
      return builder;
    },
    async maybeSingle<T>() {
      const matched = consents
        .filter((r) => filters.every((f) => f(r)))
        .sort((a, b) => b.created_at.localeCompare(a.created_at));
      const top = matched[0] ?? null;
      return { data: top as unknown as T | null, error: null };
    },
  };
  return {
    select(_cols: string) {
      return builder;
    },
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

beforeEach(() => {
  vi.clearAllMocks();
});

describe("hasParentMediaConsent — child age cliff", () => {
  it("age >= 15: not_required + allowed (COPC age floor)", async () => {
    const admin = createFakeAdmin({
      children: [
        {
          id: "c1",
          date_of_birth: dobYearsAgo(15),
          age_months_approx: null,
        },
      ],
      consents: [],
    });
    const result = await hasParentMediaConsent(
      { childId: "c1" },
      { admin, now: NOW },
    );
    expect(result.state).toBe("not_required");
    expect(result.allowed).toBe(true);
  });

  it("age = 14y364d: still requires consent", async () => {
    const admin = createFakeAdmin({
      children: [
        {
          id: "c1",
          date_of_birth: dobYearsAgo(14, 364),
          age_months_approx: null,
        },
      ],
      consents: [],
    });
    const result = await hasParentMediaConsent(
      { childId: "c1" },
      { admin, now: NOW },
    );
    expect(result.state).toBe("never_given");
    expect(result.allowed).toBe(false);
  });

  it("falls back to age_months_approx when DOB is null", async () => {
    const admin = createFakeAdmin({
      children: [
        {
          id: "c1",
          date_of_birth: null,
          // 16y * 12mo = 192. Over the threshold.
          age_months_approx: 16 * 12,
        },
      ],
      consents: [],
    });
    const result = await hasParentMediaConsent(
      { childId: "c1" },
      { admin, now: NOW },
    );
    expect(result.state).toBe("not_required");
  });
});

describe("hasParentMediaConsent — consent freshness", () => {
  function youngChild(): ChildRow {
    return {
      id: "c1",
      date_of_birth: dobYearsAgo(3),
      age_months_approx: null,
    };
  }

  function consent(over: Partial<ConsentRow> = {}): ConsentRow {
    return {
      user_id: "parent-1",
      user_type: "client",
      agreement_id: PARENT_APP_CONSENT_AGREEMENT_ID,
      related_entity_id: "c1",
      consent_given: true,
      created_at: NOW.toISOString(),
      ...over,
    };
  }

  it("never_given: blocked when no record exists", async () => {
    const admin = createFakeAdmin({
      children: [youngChild()],
      consents: [],
    });
    const result = await hasParentMediaConsent(
      { childId: "c1" },
      { admin, now: NOW },
    );
    expect(result.state).toBe("never_given");
    expect(result.allowed).toBe(false);
  });

  it("active: consent given today, expires in ~365d", async () => {
    const admin = createFakeAdmin({
      children: [youngChild()],
      consents: [consent({ created_at: NOW.toISOString() })],
    });
    const result = await hasParentMediaConsent(
      { childId: "c1" },
      { admin, now: NOW },
    );
    expect(result.state).toBe("active");
    expect(result.allowed).toBe(true);
    expect(result.signedAt).toBe(NOW.toISOString());
    expect(result.expiresAt).toBeDefined();
  });

  it("active: consent 11 months ago is still valid", async () => {
    const admin = createFakeAdmin({
      children: [youngChild()],
      consents: [consent({ created_at: isoOffset(-30 * 11) })],
    });
    const result = await hasParentMediaConsent(
      { childId: "c1" },
      { admin, now: NOW },
    );
    expect(result.state).toBe("active");
    expect(result.allowed).toBe(true);
  });

  it("nearing_expiry: consent within 7d of TTL (T-7d modal trigger)", async () => {
    // 365 - 5 = 360 days ago → 5 days until expiry → within 7d window.
    const admin = createFakeAdmin({
      children: [youngChild()],
      consents: [consent({ created_at: isoOffset(-360) })],
    });
    const result = await hasParentMediaConsent(
      { childId: "c1" },
      { admin, now: NOW },
    );
    expect(result.state).toBe("nearing_expiry");
    expect(result.allowed).toBe(true);
  });

  it("expired: consent older than 365d", async () => {
    const admin = createFakeAdmin({
      children: [youngChild()],
      consents: [consent({ created_at: isoOffset(-366) })],
    });
    const result = await hasParentMediaConsent(
      { childId: "c1" },
      { admin, now: NOW },
    );
    expect(result.state).toBe("expired");
    expect(result.allowed).toBe(false);
  });

  it("revoked: most recent record has consent_given=false", async () => {
    const admin = createFakeAdmin({
      children: [youngChild()],
      consents: [
        consent({ created_at: isoOffset(-30) }),
        consent({
          created_at: isoOffset(-1),
          consent_given: false,
        }),
      ],
    });
    const result = await hasParentMediaConsent(
      { childId: "c1" },
      { admin, now: NOW },
    );
    expect(result.state).toBe("revoked");
    expect(result.allowed).toBe(false);
  });

  it("uses most recent record when multiple exist", async () => {
    // Older record expired; newer record fresh. Should be active.
    const admin = createFakeAdmin({
      children: [youngChild()],
      consents: [
        consent({ created_at: isoOffset(-400) }),
        consent({ created_at: isoOffset(-1) }),
      ],
    });
    const result = await hasParentMediaConsent(
      { childId: "c1" },
      { admin, now: NOW },
    );
    expect(result.state).toBe("active");
  });

  it("ignores records for other agreements (e.g. nanny attestation)", async () => {
    const admin = createFakeAdmin({
      children: [youngChild()],
      consents: [
        consent({
          agreement_id: "NANNY-ATTESTATION",
          created_at: isoOffset(-1),
        }),
      ],
    });
    const result = await hasParentMediaConsent(
      { childId: "c1" },
      { admin, now: NOW },
    );
    expect(result.state).toBe("never_given");
  });

  it("ignores records for other children", async () => {
    const admin = createFakeAdmin({
      children: [youngChild()],
      consents: [
        consent({
          related_entity_id: "c-other",
          created_at: isoOffset(-1),
        }),
      ],
    });
    const result = await hasParentMediaConsent(
      { childId: "c1" },
      { admin, now: NOW },
    );
    expect(result.state).toBe("never_given");
  });
});

describe("hasParentMediaConsent — error cases", () => {
  it("child_not_found: child row doesn't exist", async () => {
    const admin = createFakeAdmin({ children: [], consents: [] });
    const result = await hasParentMediaConsent(
      { childId: "ghost" },
      { admin, now: NOW },
    );
    expect(result.state).toBe("child_not_found");
    expect(result.allowed).toBe(false);
  });

  it("missing both DOB and age_months_approx: blocked + reason", async () => {
    const admin = createFakeAdmin({
      children: [{ id: "c1", date_of_birth: null, age_months_approx: null }],
      consents: [],
    });
    const result = await hasParentMediaConsent(
      { childId: "c1" },
      { admin, now: NOW },
    );
    // Can't determine age cliff — be defensive, require consent.
    expect(result.state).toBe("never_given");
    expect(result.allowed).toBe(false);
  });
});
