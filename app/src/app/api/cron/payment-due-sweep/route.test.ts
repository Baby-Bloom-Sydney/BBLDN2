/**
 * payment-due-sweep — raise only (4c brief step 6; N2, M-5, cards 5a/7a). BB-LDN-4c-151026.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { fakeAdmin, writesTo, type FakeAdmin } from "@/lib/payments/fake-admin.test-util";

const h = vi.hoisted(() => ({ fake: null as unknown as FakeAdmin, send: vi.fn() }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => h.fake.client }));
vi.mock("@/lib/email/resend", () => ({ sendEmail: h.send }));

import { GET } from "./route";

const req = (auth?: string) =>
  new NextRequest("http://localhost/api/cron/payment-due-sweep", {
    headers: auth ? { authorization: auth } : {},
  });

const DUE = [
  { id: "s1", parent_user_id: "p1", payment_due_at: "2026-10-14T00:00:00Z" },
  { id: "s2", parent_user_id: "p2", payment_due_at: "2026-10-13T00:00:00Z" },
];

beforeEach(() => {
  vi.stubEnv("CRON_SECRET", "test-secret");
  vi.stubEnv("ADMIN_EMAIL", "ops@example.com");
  h.fake = fakeAdmin({
    parent_subscriptions: DUE,
    user_profiles: [
      { user_id: "p1", first_name: "Ann", last_name: "<b>Lee</b>", email: "ann@example.com" },
      { user_id: "p2", first_name: "Bo", last_name: null, email: "bo@example.com" },
    ],
  });
  h.send.mockReset();
  h.send.mockResolvedValue({ success: true, messageId: "dry-run" });
});
afterEach(() => vi.unstubAllEnvs());

describe("payment-due-sweep", () => {
  it("refuses without the cron bearer (and when CRON_SECRET is unset)", async () => {
    expect((await GET(req())).status).toBe(401);
    expect((await GET(req("Bearer wrong"))).status).toBe(401);
    vi.stubEnv("CRON_SECRET", "");
    expect((await GET(req("Bearer "))).status).toBe(401);
    expect(h.fake.ops).toHaveLength(0);
  });

  it("selects placed, due, un-raised, unpaid rows", async () => {
    await GET(req("Bearer test-secret"));
    const sel = h.fake.ops.find((o) => o.table === "parent_subscriptions" && o.kind === "select")!;
    expect(sel.filters).toEqual(
      expect.arrayContaining([
        ["eq", "status", "placed"],
        ["lte", "payment_due_at", expect.any(String)],
        ["is", "payment_due_raised_at", null],
        ["is", "bill_paid_at", null],
      ]),
    );
  });

  it("one admin email listing the families (escaped), then stamps each row and logs payment.due", async () => {
    const res = await GET(req("Bearer test-secret"));
    expect(await res.json()).toEqual({ ok: true, raised: 2 });
    expect(h.send).toHaveBeenCalledTimes(1);
    const mail = h.send.mock.calls[0][0];
    expect(mail.to).toBe("ops@example.com");
    expect(mail.emailType).toBe("admin_notification");
    expect(mail.html).toContain("ann@example.com");
    expect(mail.html).toContain("bo@example.com");
    expect(mail.html).toContain("&lt;b&gt;Lee&lt;/b&gt;");
    expect(mail.html).not.toContain("<b>Lee</b>");
    const stamps = writesTo(h.fake, "parent_subscriptions");
    expect(stamps).toHaveLength(2);
    expect(stamps[0].payload).toEqual({ payment_due_raised_at: expect.any(String) });
    expect(stamps[0].filters).toContainEqual(["is", "payment_due_raised_at", null]);
    const logs = writesTo(h.fake, "activity_logs").map((o) => o.payload);
    expect(logs).toEqual([
      expect.objectContaining({ user_id: "p1", action_type: "payment.due" }),
      expect.objectContaining({ user_id: "p2", action_type: "payment.due" }),
    ]);
  });

  it("raise only: never mints a link and never emails a parent (cards 5a/7a)", async () => {
    await GET(req("Bearer test-secret"));
    for (const [mail] of h.send.mock.calls) {
      expect(mail.to).toBe("ops@example.com");
      expect(mail.html).not.toMatch(/checkout\.stripe\.com/);
    }
  });

  it("nothing due → no email, no write", async () => {
    h.fake.reads.parent_subscriptions = [];
    expect(await (await GET(req("Bearer test-secret"))).json()).toEqual({ ok: true, raised: 0 });
    expect(h.send).not.toHaveBeenCalled();
    expect(h.fake.ops.filter((o) => o.kind !== "select")).toHaveLength(0);
  });

  it("email fails → 500 and nothing stamped (tomorrow's run raises again)", async () => {
    h.send.mockResolvedValue({ success: false, error: "provider down" });
    expect((await GET(req("Bearer test-secret"))).status).toBe(500);
    expect(writesTo(h.fake, "parent_subscriptions")).toHaveLength(0);
  });
});
