/**
 * Unit 3c (BB-LDN-3c-061026) — regression G2, written before the first edit and kept green:
 * `submitIdentityForManualReview` still sends identity to review (11) with the VER-004 email. 3c adds the DBS twin in
 * its own file (`lib/actions/dbs-review.ts`) and does not touch this one.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { createMemoryDb, type MemoryDb } from "../../../tests/fakes/memory-supabase";

const h = vi.hoisted(() => ({ db: null as unknown as MemoryDb, sendEmail: vi.fn(async () => ({ success: true })) }));

vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => h.db.client() }));
vi.mock("@/lib/supabase/server", () => ({ createClient: () => ({ auth: { getUser: async () => ({ data: { user: { id: "u1" } }, error: null }) } }) }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/ai/verification-pipeline", () => ({ triggerCrossCheck: vi.fn() }));
vi.mock("@/lib/email/resend", () => ({ sendEmail: h.sendEmail }));
vi.mock("@/lib/email/helpers", () => ({ getUserEmailInfo: vi.fn(async () => ({ email: "admin+3c@babybloomsydney.com.au", firstName: "Jane", lastName: "Doe", userId: "u1" })) }));
vi.mock("./connection-helpers", () => ({ createInboxMessage: vi.fn() }));

import { submitIdentityForManualReview } from "./verification";

beforeEach(() => {
  vi.clearAllMocks();
  h.db = createMemoryDb({
    verifications: [{ id: "v1", user_id: "u1", updated_at: "x", identity_status: "failed", wwcc_status: "not_started", cross_check_status: "not_started", verification_status: 11 }],
    nannies: [{ id: "n1", user_id: "u1", verification_level: 1 }],
  });
});

describe("G2 regression — identity manual review unchanged", () => {
  it("G2 submitIdentityForManualReview still sets identity review (11) and sends the VER-004 email", async () => {
    expect(await submitIdentityForManualReview()).toEqual({ success: true, error: null });
    expect(h.db.tables.verifications[0]).toMatchObject({ identity_status: "review", verification_status: 11, cross_check_status: "not_started" });
    const types = h.sendEmail.mock.calls.map((c) => (c as unknown as [{ emailType: string }])[0].emailType);
    expect(types).toEqual(["verification_pending"]);
  });
});
