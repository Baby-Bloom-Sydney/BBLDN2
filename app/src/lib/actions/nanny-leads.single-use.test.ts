/**
 * An application becomes an account once: a lead already turned into an account is not converted again, and its
 * saved answers no longer change.
 *
 * BB-wave1-041126, 2026-11-09.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fakeAdmin, writesTo, type FakeAdmin, type Op } from "@/lib/payments/fake-admin.test-util";

let admin: FakeAdmin;
const createUser = vi.fn();

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({ ...admin.client, from: admin.client.from, auth: { admin: { createUser } } }),
}));
vi.mock("@/lib/supabase/server", () => ({
  createClient: () => ({ auth: { signInWithPassword: async () => ({ error: null }) } }),
}));
vi.mock("@/lib/email/resend", () => ({ sendEmail: vi.fn(async () => ({ success: true })) }));

import { convertLeadToAccount, updateNannyLead } from "./nanny-leads";

const LEAD = { id: "lead-1", first_name: "nina", last_name: "walker", email: "nina@example.test", phone: null };

beforeEach(() => {
  createUser.mockReset().mockResolvedValue({ data: { user: { id: "user-new" } }, error: null });
  admin = fakeAdmin({ nanny_leads: LEAD });
  admin.writeResults.nannies = { id: "nanny-new" };
  // the claim and the final mark (conditional updates returning the lead) land unless a test says otherwise
  admin.writeResults.nanny_leads = (op: Op) => {
    const row = op.payload as { conversion_claimed_at?: unknown; lead_status?: unknown };
    return typeof row.conversion_claimed_at === "string" || row.lead_status === "converted" ? [{ id: "lead-1" }] : null;
  };
});

describe("convertLeadToAccount — once", () => {
  it.each([
    ["has an account", { auth_user_id: "user-1" }],
    ["is marked converted", { lead_status: "converted" }],
  ])("refuses a lead that %s, writing nothing", async (_label, converted) => {
    admin.reads.nanny_leads = { ...LEAD, ...converted };
    const result = await convertLeadToAccount("lead-1", "pw-123456", "other@example.test");
    expect(result).toEqual({ success: false, error: "An account with this email already exists. Please sign in instead." });
    expect(createUser).not.toHaveBeenCalled();
    expect(admin.ops.filter((o) => o.kind !== "select")).toEqual([]);
  });

  it("refuses a lead another conversion holds (its claim is refused), creating nothing", async () => {
    admin.writeResults.nanny_leads = [];
    const result = await convertLeadToAccount("lead-1", "pw-123456");
    expect(result).toEqual({ success: false, error: "An account with this email already exists. Please sign in instead." });
    expect(createUser).not.toHaveBeenCalled();
    expect(admin.ops.filter((o) => o.kind !== "select").map((o) => o.table)).toEqual(["nanny_leads"]);
  });

  it("converts a lead not yet converted", async () => {
    await convertLeadToAccount("lead-1", "pw-123456");
    expect(createUser).toHaveBeenCalledTimes(1);
  });
});

describe("updateNannyLead — before conversion only", () => {
  it("saves answers only to a lead without an account", async () => {
    expect(await updateNannyLead("lead-1", { funnel_step: "N3" })).toEqual({ success: true });
    const [update] = writesTo(admin, "nanny_leads");
    expect(update?.filters).toEqual([["eq", "id", "lead-1"], ["is", "auth_user_id", null]]);
  });
});
