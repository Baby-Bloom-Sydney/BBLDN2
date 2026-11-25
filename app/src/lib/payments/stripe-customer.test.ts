/**
 * The family's Stripe customer (moved out of `actions/admin/dfy.ts` for brief 03; plan 03 row A3). Behaviour is
 * unchanged from 4-w5fix (W5-M3): reuse the row's customer; else create one with the parent's email under a
 * per-parent idempotency key and store it on the row only where none is stored yet; a failed store throws.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fakeAdmin, writesTo, type FakeAdmin } from "./fake-admin.test-util";

const h = vi.hoisted(() => ({ createCustomer: vi.fn() }));
vi.mock("@/lib/stripe/client", () => ({ getStripeClient: () => ({ customers: { create: h.createCustomer } }) }));

import { customerFor } from "./stripe-customer";

const PARENT = "b0300000-0000-4000-8000-000000000001";
const ROW = { id: "s1", stripe_customer_id: null } as const;

let fake: FakeAdmin;
beforeEach(() => {
  fake = fakeAdmin();
  h.createCustomer.mockReset();
  h.createCustomer.mockResolvedValue({ id: "cus_new_1" });
});

describe("customerFor", () => {
  it("reuses the row's customer: no Stripe call, no write", async () => {
    expect(await customerFor(fake.client, PARENT, { id: "s1", stripe_customer_id: "cus_kept" }, "p@example.com")).toBe("cus_kept");
    expect(h.createCustomer).not.toHaveBeenCalled();
    expect(fake.ops).toHaveLength(0);
  });

  it("creates one with the parent's email, her user id as metadata and the per-parent idempotency key", async () => {
    expect(await customerFor(fake.client, PARENT, null, "p@example.com")).toBe("cus_new_1");
    expect(h.createCustomer).toHaveBeenCalledTimes(1);
    expect(h.createCustomer).toHaveBeenCalledWith(
      { email: "p@example.com", metadata: { user_id: PARENT } },
      { idempotencyKey: `dfy-customer-${PARENT}` },
    );
  });

  it("leaves the email out when there is none", async () => {
    await customerFor(fake.client, PARENT, null, null);
    const [params] = h.createCustomer.mock.calls[0];
    expect(params).toEqual({ metadata: { user_id: PARENT } });
    expect(params).not.toHaveProperty("email");
  });

  it("stores the new customer on the row, only where none is stored yet", async () => {
    expect(await customerFor(fake.client, PARENT, ROW, "p@example.com")).toBe("cus_new_1");
    const writes = writesTo(fake, "parent_subscriptions");
    expect(writes).toHaveLength(1);
    expect(writes[0].kind).toBe("update");
    expect(writes[0].payload).toEqual({ stripe_customer_id: "cus_new_1" });
    expect(writes[0].filters).toEqual([
      ["eq", "id", "s1"],
      ["is", "stripe_customer_id", null],
    ]);
  });

  it("a failed store throws: no link without a traceable customer", async () => {
    fake.writeErrors.parent_subscriptions = { message: "boom" };
    await expect(customerFor(fake.client, PARENT, ROW, "p@example.com")).rejects.toThrow("customer store failed");
  });

  it("no row → the customer is created but not stored (the deposit webhook stores it)", async () => {
    expect(await customerFor(fake.client, PARENT, null, "p@example.com")).toBe("cus_new_1");
    expect(fake.ops).toHaveLength(0);
  });

  it("a Stripe failure propagates and nothing is written", async () => {
    h.createCustomer.mockRejectedValueOnce(new Error("stripe down"));
    await expect(customerFor(fake.client, PARENT, ROW, null)).rejects.toThrow("stripe down");
    expect(fake.ops).toHaveLength(0);
  });
});
