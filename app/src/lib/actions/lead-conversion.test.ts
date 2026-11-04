/**
 * signUpAndConvertLead (plan B4, D4; brief §6 row 1, §9.1–9.2). Pins what must stay true when 04 changes the one
 * return site: the call order — sign-up → lead → position → children → schedule → lead converted → **autofire**
 * (the nanny blast) → **welcome** — is the same in both flag states, and only the redirect differs:
 *   off → /parent?t=childcare&s=nannies&v=matches (today)
 *   on  → /matchmaking/call?next=<that, encoded> (the call slide; 04b rework W1/W6)
 * The early returns hand back signUp's own result (its redirect is flag-guarded in signUp itself).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fakeAdmin, type FakeAdmin } from "@/lib/payments/fake-admin.test-util";

const h = vi.hoisted(() => ({
  order: [] as string[],
  fake: null as unknown as FakeAdmin,
  signUp: vi.fn(),
  autofire: vi.fn(),
  send: vi.fn(),
}));
vi.mock("@/lib/auth/actions", () => ({ signUp: h.signUp }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => h.fake.client }));
vi.mock("./autofire-matchmaking", () => ({ autofireMatchmaking: h.autofire }));
vi.mock("@/lib/email/resend", () => ({ sendEmail: h.send }));

import { signUpAndConvertLead } from "./lead-conversion";

const MATCHES = "/parent?t=childcare&s=nannies&v=matches";
const VIA_CALL_PAGE = "/matchmaking/call?next=%2Fparent%3Ft%3Dchildcare%26s%3Dnannies%26v%3Dmatches";
const FULL_ORDER = ["signUp", "lead", "profile", "parent", "position", "children", "schedule", "converted", "autofire", "welcome"];

const LEAD_FORM = {
  num_children: 1,
  child_a_age: "1–2 years",
  weekly_roster: ["Monday"],
  monday_roster: ["morning"],
  postcode: "SW1A 1AA",
};

function step<T>(name: string, value: T) {
  return () => {
    h.order.push(name);
    return value;
  };
}

function seed(over: { lead?: unknown; position?: unknown } = {}) {
  h.fake = fakeAdmin({
    parent_leads: step("lead", "lead" in over ? over.lead : { form_data: LEAD_FORM }),
    user_profiles: step("profile", { user_id: "u-1" }),
    parents: step("parent", { id: "parent-1" }),
  });
  h.fake.writeResults.nanny_positions = step("position", "position" in over ? over.position : { id: "pos-1" });
  h.fake.writeResults.position_children = step("children", null);
  h.fake.writeResults.position_schedule = step("schedule", null);
  h.fake.writeResults.parent_leads = step("converted", null);
}

const form = () => {
  const fd = new FormData();
  fd.set("email", "jane@example.com");
  fd.set("firstName", "Jane");
  return fd;
};

beforeEach(() => {
  h.order.length = 0;
  vi.spyOn(console, "error").mockImplementation(() => {});
  h.signUp.mockReset();
  h.signUp.mockImplementation(async () => {
    h.order.push("signUp");
    return { success: true, redirectTo: "/parent" };
  });
  h.autofire.mockReset();
  h.autofire.mockImplementation(async () => {
    h.order.push("autofire");
  });
  h.send.mockReset();
  h.send.mockImplementation(async () => {
    h.order.push("welcome");
    return { success: true };
  });
  seed();
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe.each([
  ["off", "", MATCHES],
  ["on", "true", VIA_CALL_PAGE],
])("CALL_BOOKING_ENABLED %s", (_state, flag, target) => {
  beforeEach(() => vi.stubEnv("CALL_BOOKING_ENABLED", flag));

  it(`runs every step in today's order, then redirects to ${target}`, async () => {
    const result = await signUpAndConvertLead(form(), "lead-1");
    expect(h.order).toEqual(FULL_ORDER);
    expect(result).toEqual({ success: true, redirectTo: target });
  });

  it("the blast and the adv-parent welcome still go out, as today", async () => {
    await signUpAndConvertLead(form(), "lead-1");
    expect(h.autofire).toHaveBeenCalledWith("pos-1");
    expect(h.send).toHaveBeenCalledWith(expect.objectContaining({ to: "jane@example.com", emailType: "welcome_adv_parent" }));
  });

  it("a failed sign-up is returned untouched, and nothing else runs", async () => {
    h.signUp.mockResolvedValueOnce({ error: "Email taken" });
    expect(await signUpAndConvertLead(form(), "lead-1")).toEqual({ error: "Email taken" });
    expect(h.fake.ops).toEqual([]);
    expect(h.autofire).not.toHaveBeenCalled();
  });

  it("no lead found → signUp's own result; no blast, no welcome", async () => {
    seed({ lead: null });
    expect(await signUpAndConvertLead(form(), "lead-1")).toEqual({ success: true, redirectTo: "/parent" });
    expect(h.order).toEqual(["signUp", "lead"]);
  });

  it("the position insert failing → signUp's own result; no blast, no welcome", async () => {
    seed();
    h.fake.writeErrors.nanny_positions = { message: "constraint" };
    expect(await signUpAndConvertLead(form(), "lead-1")).toEqual({ success: true, redirectTo: "/parent" });
    expect(h.autofire).not.toHaveBeenCalled();
    expect(h.send).not.toHaveBeenCalled();
  });
});
