/**
 * Unit 3b (BB-LDN-3b-061026) — `submitWWCCSection` becomes the DBS certificate write (brief change 4; rulings #3, #34;
 * security note A3). Plus regression G2 (04-test-plan §6): identity manual review still lands on the identity-review
 * path and sends VER-004. Written before the code; hoisted Supabase mock as `verification.sync.test.ts`.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

type Call = { table: string; op: string; args: unknown[] };

const state = vi.hoisted(() => ({
  calls: [] as Call[],
  user: { id: "user-1" } as { id: string } | null,
  verification: null as Record<string, unknown> | null,
  updateError: null as unknown,
  storageNames: ["1700000000000-page1.pdf"] as string[],
  storageList: [] as unknown[][],
  sendEmail: null as unknown as ReturnType<typeof import("vitest")["vi"]["fn"]>,
}));

function builder(table: string) {
  const record = (op: string, args: unknown[]) => state.calls.push({ table, op, args });
  const result = () => {
    if (table === "verifications") return { data: state.verification, error: null };
    if (table === "nannies") return { data: { id: "nanny-1", verification_level: 2 }, error: null };
    return { data: [], error: null };
  };
  const b: Record<string, unknown> = {};
  for (const op of ["select", "eq", "in", "order", "limit", "delete", "insert", "neq", "not"]) {
    b[op] = (...args: unknown[]) => {
      record(op, args);
      return b;
    };
  }
  b.update = (...args: unknown[]) => {
    record("update", args);
    const u: Record<string, unknown> = {};
    u.eq = (...a: unknown[]) => {
      record("update.eq", a);
      return Promise.resolve({ error: table === "verifications" ? state.updateError : null });
    };
    return u;
  };
  b.single = async () => result();
  b.maybeSingle = async () => result();
  b.then = (resolveFn: (v: unknown) => unknown) => Promise.resolve(result()).then(resolveFn);
  return b;
}

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    from: (table: string) => builder(table),
    storage: {
      from: () => ({
        list: async (...args: unknown[]) => {
          state.storageList.push(args);
          return { data: state.storageNames.map((name) => ({ name })), error: null };
        },
      }),
    },
  }),
}));
vi.mock("@/lib/supabase/server", () => ({
  createClient: () => ({ auth: { getUser: async () => ({ data: { user: state.user }, error: null }) } }),
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/ai/verification-pipeline", () => ({ triggerCrossCheck: vi.fn(async () => undefined) }));
vi.mock("@/lib/email/resend", () => {
  const fn = vi.fn(async () => ({}));
  state.sendEmail = fn as never;
  return { sendEmail: fn };
});
vi.mock("@/lib/email/helpers", () => ({ getUserEmailInfo: vi.fn(async () => ({ email: "n@example.test", firstName: "Jane" })) }));
vi.mock("./connection-helpers", () => ({ createInboxMessage: vi.fn() }));

import { submitWWCCSection, submitIdentityForManualReview } from "./verification";
import { DBS_VERIFICATION_METHOD, VERIFICATION_STATUS } from "@/lib/verification";

const verificationUpdates = () =>
  state.calls.filter((c) => c.table === "verifications" && c.op === "update").map((c) => c.args[0] as Record<string, unknown>);

const PATH = "user-1/1700000000000-page1.pdf";

beforeEach(() => {
  state.calls = [];
  state.user = { id: "user-1" };
  state.updateError = null;
  state.storageNames = ["1700000000000-page1.pdf"];
  state.storageList = [];
  state.verification = { id: "ver-1", identity_status: "verified", wwcc_status: "not_started" };
  (state.sendEmail as unknown as { mockClear: () => void }).mockClear();
});

describe("submitWWCCSection — DBS certificate write", () => {
  it("returns an error and writes nothing when consent is not true", async () => {
    const r = await submitWWCCSection({ certificate_path: PATH, consent: false as unknown as true });
    expect(r.success).toBe(false);
    expect(verificationUpdates()).toHaveLength(0);
  });

  it("returns an error and writes nothing when consent is missing", async () => {
    const r = await submitWWCCSection({ certificate_path: PATH } as never);
    expect(r.success).toBe(false);
    expect(verificationUpdates()).toHaveLength(0);
  });

  it("returns the deck error and writes nothing when the path is missing", async () => {
    const r = await submitWWCCSection({ certificate_path: "", consent: true });
    expect(r).toEqual({ success: false, error: "Please upload page 1 of your DBS certificate to continue." });
    expect(verificationUpdates()).toHaveLength(0);
  });

  it.each([
    ["another user's folder", "user-2/1700000000000-page1.pdf"],
    ["a prefix-sharing user", "user-10/1700000000000-page1.pdf"],
    ["a bare filename", "page1.pdf"],
    ["a traversal out of her folder", "user-1/../user-2/page1.pdf"],
    ["a full URL", "https://example.test/user-1/page1.pdf"],
    ["an encoded traversal (security review HIGH)", "user-1/%2e%2e/user-2/1700000000000-passport.jpg"],
    ["an upper-case encoded traversal", "user-1/%2E%2E/user-2/1700000000000-passport.jpg"],
    ["a mixed encoded traversal", "user-1/.%2e/user-2/1700000000000-passport.jpg"],
    ["a backslash traversal", "user-1/..\\user-2\\1700000000000-passport.jpg"],
    ["a nested folder", "user-1/sub/1700000000000-page1.pdf"],
    ["a name that is not the upload helper's", "user-1/page1.pdf"],
    ["a name of only dots", "user-1/1700000000000-.."],
    ["a query string", "user-1/1700000000000-page1.pdf?x=1"],
  ])("returns an error and writes nothing when the path is %s", async (_n, path) => {
    const r = await submitWWCCSection({ certificate_path: path, consent: true });
    expect(r.success).toBe(false);
    expect(verificationUpdates()).toHaveLength(0);
  });

  it("returns an error and writes nothing when the file is not in her folder in storage", async () => {
    state.storageNames = [];
    const r = await submitWWCCSection({ certificate_path: PATH, consent: true });
    expect(r).toEqual({ success: false, error: "Please upload page 1 of your DBS certificate to continue." });
    expect(verificationUpdates()).toHaveLength(0);
  });

  it("returns an error and writes nothing when not signed in", async () => {
    state.user = null;
    const r = await submitWWCCSection({ certificate_path: PATH, consent: true });
    expect(r.success).toBe(false);
    expect(verificationUpdates()).toHaveLength(0);
  });

  it("writes wwcc_verification_method='dbs_certificate', wwcc_declaration=true and wwcc_declaration_at when valid", async () => {
    const r = await submitWWCCSection({ certificate_path: PATH, consent: true });
    expect(r).toEqual({ success: true, error: null, verificationId: "ver-1" });
    const [u] = verificationUpdates();
    expect(u.wwcc_verification_method).toBe(DBS_VERIFICATION_METHOD);
    expect(u.wwcc_declaration).toBe(true);
    expect(typeof u.wwcc_declaration_at).toBe("string");
    expect(Number.isNaN(Date.parse(u.wwcc_declaration_at as string))).toBe(false);
    expect(Object.values(u)).toContain(PATH);
    expect(u.wwcc_status).toBe("pending");
    expect(u.verification_status).toBe(VERIFICATION_STATUS.WWCC_SUBMITTED);
  });

  it("ignores any extracted_wwcc_* field the client sends (A3): the payload nulls them all", async () => {
    await submitWWCCSection({
      certificate_path: PATH,
      consent: true,
      extracted_wwcc_number: "001234567890",
      extracted_wwcc_surname: "Doe",
      wwcc_number: "001234567890",
      wwcc_verification_method: "manual_entry",
    } as never);
    const [u] = verificationUpdates();
    for (const k of Object.keys(u).filter((k) => k.startsWith("extracted_wwcc_"))) expect(u[k]).toBeNull();
    expect(u.extracted_wwcc_number).toBeNull();
    expect(u.wwcc_number).toBeNull();
    expect(u.wwcc_verification_method).toBe(DBS_VERIFICATION_METHOD);
    expect(u.wwcc_doc_verified).toBe(false);
    expect(u.wwcc_status).toBe("pending");
  });

  it("resets the AI fields, guidance and cross-check when it succeeds, as today", async () => {
    await submitWWCCSection({ certificate_path: PATH, consent: true });
    const [u] = verificationUpdates();
    for (const k of ["wwcc_ai_reasoning", "wwcc_ai_issues", "wwcc_rejection_reason", "wwcc_user_guidance", "cross_check_reasoning", "cross_check_issues", "cross_check_at"]) {
      expect(u[k], k).toBeNull();
    }
    expect(u.cross_check_status).toBe("not_started");
    expect(u.wwcc_verified).toBe(false);
  });

  it("returns the deck save error when the update fails", async () => {
    state.updateError = { message: "boom" };
    const r = await submitWWCCSection({ certificate_path: PATH, consent: true });
    expect(r).toEqual({ success: false, error: "We couldn't save your certificate. Please try again." });
  });

  it("returns an error when there is no verification row", async () => {
    state.verification = null;
    const r = await submitWWCCSection({ certificate_path: PATH, consent: true });
    expect(r.success).toBe(false);
    expect(verificationUpdates()).toHaveLength(0);
  });
});

describe("G2 — identity manual review (regression, unchanged by 3b)", () => {
  it("writes identity review → 11 and sends VER-004 when identity fails", async () => {
    state.verification = { id: "ver-1", wwcc_status: "not_started" };
    const r = await submitIdentityForManualReview();
    expect(r).toEqual({ success: true, error: null });
    const [u] = verificationUpdates();
    expect(u.identity_status).toBe("review");
    expect(u.verification_status).toBe(VERIFICATION_STATUS.PENDING_ID_REVIEW);
    expect(state.sendEmail).toHaveBeenCalledTimes(1);
  });
});
