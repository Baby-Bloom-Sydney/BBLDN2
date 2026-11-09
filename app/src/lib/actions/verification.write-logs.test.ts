/**
 * A failed write of her verification row is logged by its code only — never the error's message or details, which can
 * repeat the row (her name, date of birth, address, certificate). What she is told is unchanged.
 *
 * BB-wave1-041126, 2026-11-09.
 */
import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from "vitest";
import { fakeAdmin, type FakeAdmin } from "@/lib/payments/fake-admin.test-util";

const USER = "b0600000-0000-4000-8000-000000000001";
let admin: FakeAdmin;

vi.mock("@/lib/supabase/server", () => ({ createClient: () => ({ auth: { getUser: async () => ({ data: { user: { id: USER } }, error: null }) } }) }));
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    ...admin.client,
    storage: { from: () => ({ list: async () => ({ data: [{ name: "1700000000000-page1.pdf" }], error: null }) }) },
  }),
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/ai/verification-pipeline", () => ({ triggerCrossCheck: vi.fn() }));
vi.mock("@/lib/email/resend", () => ({ sendEmail: vi.fn() }));
vi.mock("@/lib/email/helpers", () => ({ getUserEmailInfo: vi.fn() }));
vi.mock("./connection-helpers", () => ({ createInboxMessage: vi.fn() }));

import { submitContactSection, submitIdentityForManualReview, submitIdentitySection, submitWWCCSection } from "./verification";

const PRIVATE = /Okafor|Amara|1995-05-05|Upper Street|N1 0AA|Failing row/;
const ROW_ERROR = {
  message: "new row for relation \"verifications\" violates check constraint",
  code: "23514",
  details: "Failing row contains (Okafor, Amara, 1995-05-05, 1 Upper Street, London, N1 0AA)",
};
const IDENTITY = { surname: "Okafor", given_names: "Amara", date_of_birth: "1995-05-05", passport_country: "GB", passport_upload_url: "p", identification_photo_url: "s" };
const CONTACT = { phone_number: "", address_line: "1 Upper Street", city: "London", postcode: "N1 0AA", country: "United Kingdom" };

let spy: MockInstance<typeof console.error>;

beforeEach(() => {
  admin = fakeAdmin({ verifications: { id: "v-1", wwcc_status: "not_started", identity_status: "verified" } });
  admin.writeErrors.verifications = ROW_ERROR;
  spy = vi.spyOn(console, "error").mockImplementation(() => {});
  vi.spyOn(console, "log").mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
});

const logged = () => JSON.stringify(spy.mock.calls);

describe("a failed verification write is logged by its code only", () => {
  it("identity, updating her row", async () => {
    expect((await submitIdentitySection(IDENTITY)).success).toBe(false);
    expect(spy).toHaveBeenCalledWith("[submitIdentitySection] Update failed", { code: "23514" });
    expect(logged()).not.toMatch(PRIVATE);
  });

  it("identity, her first row", async () => {
    admin.reads.verifications = null;
    expect((await submitIdentitySection(IDENTITY)).success).toBe(false);
    expect(spy).toHaveBeenCalledWith("[submitIdentitySection] Insert failed", { code: "23514" });
    expect(logged()).not.toMatch(PRIVATE);
  });

  it("identity, asking for a manual review", async () => {
    expect(await submitIdentityForManualReview()).toEqual({ success: false, error: "Failed to submit for manual review" });
    expect(spy).toHaveBeenCalledWith("[submitIdentityForManualReview] Update failed", { code: "23514" });
    expect(logged()).not.toMatch(PRIVATE);
  });

  it("the DBS certificate", async () => {
    expect((await submitWWCCSection({ certificate_path: `${USER}/1700000000000-page1.pdf`, consent: true })).success).toBe(false);
    expect(spy).toHaveBeenCalledWith("[submitWWCCSection] Update failed", { code: "23514" });
    expect(logged()).not.toMatch(PRIVATE);
  });

  it("her address and contact details", async () => {
    expect(await submitContactSection(CONTACT)).toEqual({ success: false, error: "Failed to save contact details" });
    expect(spy).toHaveBeenCalledWith("[submitContactSection] Update failed", { code: "23514" });
    expect(logged()).not.toMatch(PRIVATE);
  });

  it("an error without a code is logged as Error", async () => {
    admin.writeErrors.verifications = { message: "Failing row contains (1 Upper Street)" };
    await submitContactSection(CONTACT);
    expect(spy).toHaveBeenCalledWith("[submitContactSection] Update failed", { code: "Error" });
    expect(logged()).not.toMatch(PRIVATE);
  });
});
