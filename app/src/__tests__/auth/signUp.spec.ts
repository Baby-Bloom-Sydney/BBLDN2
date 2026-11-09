import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Module-scope so test assertions get typed access to insertCall payloads
// (per typescript-reviewer feedback — keeping it inside vi.hoisted scoped
// the type to the closure and forced opaque-record access at call sites).
interface InsertCall {
  table: string;
  payload: Record<string, unknown>;
}

// vi.mock factories are hoisted to the TOP of the file (before any other
// statement runs), so anything they reference must also be hoisted.
// `vi.hoisted()` is the supported escape hatch for shared mock state.
const mocks = vi.hoisted(() => {
  const insertCalls: { table: string; payload: Record<string, unknown> }[] = [];

  function makeAdminFromStub() {
    return vi.fn((table: string) => ({
      insert: vi.fn((payload: Record<string, unknown>) => {
        insertCalls.push({ table, payload });
        return Promise.resolve({ error: null });
      }),
      delete: vi.fn(() => ({
        eq: vi.fn(async () => ({ error: null })),
      })),
      // lookupValidInvite reads child_invites + user_profiles via select
      // chain. Default: no invite found (data: null). Tests that exercise
      // the invite path can override per-test.
      select: vi.fn(() => ({
        eq: vi.fn(() => ({
          maybeSingle: vi.fn(async () => ({ data: null, error: null })),
          single: vi.fn(async () => ({ data: null, error: null })),
        })),
      })),
    }));
  }

  return {
    insertCalls,
    deleteUserMock: vi.fn(async () => ({ error: null })),
    sendEmailMock: vi.fn(async () => undefined),
    signupViaInviteMock: vi.fn(async () => ({ success: true })),
    authSignUpMock: vi.fn(),
    authSignOutMock: vi.fn(async () => undefined),
    adminFromMock: makeAdminFromStub(),
    // expose the factory so beforeEach can rebuild the from() stub between
    // tests without leaking spy state across cases.
    makeAdminFromStub,
  };
});

// Re-export the typed insertCalls so test bodies get IntelliSense on payload.
const insertCalls = mocks.insertCalls as InsertCall[];

vi.mock("next/navigation", () => ({
  redirect: vi.fn(),
}));

vi.mock("@/lib/supabase/server", () => ({
  createClient: () => ({
    auth: {
      signUp: mocks.authSignUpMock,
      signOut: mocks.authSignOutMock,
    },
  }),
}));

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    from: mocks.adminFromMock,
    auth: { admin: { deleteUser: mocks.deleteUserMock } },
  }),
}));

vi.mock("@/lib/email/resend", () => ({
  sendEmail: mocks.sendEmailMock,
}));

vi.mock("@/lib/invite/signup-stamp", () => ({
  signupViaInvite: mocks.signupViaInviteMock,
}));

// SUT — imported AFTER mocks so they're applied.
import { signUp } from "@/lib/auth/actions";

const VALID_USER_ID = "00000000-0000-0000-0000-000000000001";
// Ofcom drama range. P-5: typed as 07…, stored as E.164 +44….
const VALID_UK_MOBILE = "07700900123";
const STORED_UK_MOBILE = "+447700900123";

function buildFormData(
  overrides: Record<string, string | undefined> = {},
): FormData {
  const fd = new FormData();
  const fields: Record<string, string | undefined> = {
    email: "parent@example.com",
    password: "Test-Password-1!",
    firstName: "Jane",
    lastName: "Smith",
    role: "parent",
    mobile_number: VALID_UK_MOBILE,
    ...overrides,
  };
  for (const [k, v] of Object.entries(fields)) {
    if (v !== undefined) fd.append(k, v);
  }
  return fd;
}

beforeEach(() => {
  mocks.insertCalls.length = 0;
  mocks.authSignUpMock.mockReset();
  mocks.authSignUpMock.mockResolvedValue({
    data: { user: { id: VALID_USER_ID } },
    error: null,
  });
  mocks.authSignOutMock.mockClear();
  mocks.deleteUserMock.mockClear();
  mocks.sendEmailMock.mockClear();
  mocks.signupViaInviteMock.mockClear();
  // mockClear() resets call tracking on the from() spy itself so future
  // tests can't read accumulated call counts from prior runs. The
  // implementation is then rebuilt so each test gets fresh insert
  // closures that capture the cleared `insertCalls` array.
  mocks.adminFromMock.mockClear();
  const fresh = mocks.makeAdminFromStub();
  mocks.adminFromMock.mockImplementation(fresh.getMockImplementation()!);
});

describe("signUp() — parent mobile validation (T-021)", () => {
  it("role=parent missing mobile_number → returns validation error and never creates auth user", async () => {
    const fd = buildFormData({ mobile_number: undefined });

    const result = await signUp(fd);

    expect(result.error).toMatch(/mobile/i);
    expect(mocks.authSignUpMock).not.toHaveBeenCalled();
    expect(insertCalls).toHaveLength(0);
  });

  it("role=parent invalid mobile_number (non-07 prefix) → returns validation error", async () => {
    const fd = buildFormData({ mobile_number: "0207946095" });

    const result = await signUp(fd);

    expect(result.error).toMatch(/mobile/i);
    expect(mocks.authSignUpMock).not.toHaveBeenCalled();
    expect(insertCalls).toHaveLength(0);
  });

  it("role=parent valid mobile_number → succeeds and persists normalised value to user_profiles", async () => {
    const fd = buildFormData({ mobile_number: VALID_UK_MOBILE });

    const result = await signUp(fd);

    expect(result.error).toBeUndefined();
    expect(result.success).toBe(true);
    expect(mocks.authSignUpMock).toHaveBeenCalledTimes(1);

    const profileInsert = insertCalls.find((c) => c.table === "user_profiles");
    expect(profileInsert).toBeDefined();
    expect(profileInsert?.payload.mobile_number).toBe(STORED_UK_MOBILE);
  });

  it("role=parent bare 7xxxxxxxxx → auto-promoted and persisted as E.164", async () => {
    const fd = buildFormData({ mobile_number: "7700900123" });

    const result = await signUp(fd);

    expect(result.success).toBe(true);
    const profileInsert = insertCalls.find((c) => c.table === "user_profiles");
    expect(profileInsert?.payload.mobile_number).toBe(STORED_UK_MOBILE);
  });

  it("role=parent mobile with spaces and dashes → normalised before persist", async () => {
    const fd = buildFormData({ mobile_number: "07700 900-123" });

    const result = await signUp(fd);

    expect(result.success).toBe(true);
    const profileInsert = insertCalls.find((c) => c.table === "user_profiles");
    expect(profileInsert?.payload.mobile_number).toBe(STORED_UK_MOBILE);
  });

  it("role=nanny with no mobile_number → succeeds (validation is role-gated)", async () => {
    const fd = buildFormData({ role: "nanny", mobile_number: undefined });

    const result = await signUp(fd);

    expect(result.error).toBeUndefined();
    expect(result.success).toBe(true);

    const profileInsert = insertCalls.find((c) => c.table === "user_profiles");
    expect(profileInsert).toBeDefined();
    // The nanny path passes `mobile_number: null` to the insert payload
    // (column is nullable; the apply funnel writes the actual value via
    // its own path later). Tightened from a union to a precise null check
    // so a future change that silently introduces undefined would fail.
    expect(profileInsert?.payload.mobile_number).toBeNull();

    // Confirm we used the nanny insert path, not parent.
    expect(insertCalls.some((c) => c.table === "nannies")).toBe(true);
    expect(insertCalls.some((c) => c.table === "parents")).toBe(false);
  });
});

// ── Brief 04b (plan B4; brief §6 row 2, §9.1): the redirects in both CALL_BOOKING_ENABLED states. Add-only. ──
// Off is today: nanny → /nanny, invite → /invite/<token>?auto=1, parent → /parent. 04b rework W7 (brief §0a.5): a cold
// /signup is today's in both states too — she books her call after creating her position (place 2).

const INVITE_TOKEN = "ABCD-EFGH";

function withPendingInvite() {
  const fallback = mocks.adminFromMock.getMockImplementation()!;
  mocks.adminFromMock.mockImplementation((table: string) => {
    if (table !== "child_invites") return fallback(table);
    return {
      select: vi.fn(() => ({
        eq: vi.fn(() => ({
          maybeSingle: vi.fn(async () => ({
            data: {
              direction: "nanny_to_parent",
              status: "pending",
              child_client_id: "cc-1",
              created_by_user_id: null,
              child_client: { first_name: "Lily" },
            },
            error: null,
          })),
        })),
      })),
    } as unknown as ReturnType<typeof fallback>;
  });
}

describe.each([
  ["off", "", "/parent"],
  ["on", "true", "/parent"],
])("signUp() redirects with CALL_BOOKING_ENABLED %s (brief 04b)", (_state, flag, parentTarget) => {
  beforeEach(() => vi.stubEnv("CALL_BOOKING_ENABLED", flag));
  afterEach(() => vi.unstubAllEnvs());

  it(`a cold parent sign-up, no invite → ${parentTarget}`, async () => {
    expect(await signUp(buildFormData())).toEqual({ success: true, redirectTo: parentTarget });
  });

  it("nanny → /nanny, as today", async () => {
    expect(await signUp(buildFormData({ role: "nanny", mobile_number: undefined }))).toEqual({ success: true, redirectTo: "/nanny" });
  });

  it("parent through a nanny's invite → /invite/<token>?auto=1, as today", async () => {
    withPendingInvite();
    expect(await signUp(buildFormData({ invite_token: INVITE_TOKEN }))).toEqual({
      success: true,
      redirectTo: `/invite/${INVITE_TOKEN}?auto=1`,
    });
    expect(mocks.signupViaInviteMock).toHaveBeenCalledWith({ token: INVITE_TOKEN, userId: VALID_USER_ID });
  });
});

// ── 04b rework W11 (BAI 2026-11-05, brief §0a.6): a quick-match sign-up (`/signup?src=std`, signup_source
//    standard_match) lands on the call slide, then her Childcare tab. A cold /signup stays on today's redirect. ──
describe.each([
  ["off", "", "/parent"],
  ["on", "true", "/matchmaking/call?next=%2Fparent%3Ft%3Dchildcare"],
])("signUp() — quick match with CALL_BOOKING_ENABLED %s (W11)", (_state, flag, target) => {
  beforeEach(() => vi.stubEnv("CALL_BOOKING_ENABLED", flag));
  afterEach(() => vi.unstubAllEnvs());

  it(`quick-match parent → ${target}`, async () => {
    expect(await signUp(buildFormData({ signupSource: "standard_match" }))).toEqual({ success: true, redirectTo: target });
  });

  it("a cold parent sign-up → /parent", async () => {
    expect(await signUp(buildFormData({ signupSource: "direct" }))).toEqual({ success: true, redirectTo: "/parent" });
  });

  it("a quick-match nanny → /nanny; a quick-match parent through an invite → the invite, as today", async () => {
    expect(await signUp(buildFormData({ role: "nanny", mobile_number: undefined, signupSource: "standard_match" }))).toEqual({
      success: true,
      redirectTo: "/nanny",
    });
    withPendingInvite();
    expect(await signUp(buildFormData({ invite_token: INVITE_TOKEN, signupSource: "standard_match" }))).toEqual({
      success: true,
      redirectTo: `/invite/${INVITE_TOKEN}?auto=1`,
    });
  });
});
