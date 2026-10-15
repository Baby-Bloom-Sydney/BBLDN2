/**
 * Refunds in the admin timeline (LDN2 unit 4d; offer §3 "Refund", D1).
 * A processed `refund_requests` row reads "Refunded £x.xx" from
 * `approved_amount_aud_cents` (pence in London — the column rename is cleanup's).
 */

import { describe, expect, it } from "vitest";

import { buildTimelineEntries } from "./build-timeline";
import type { RefundRow } from "./page";

const refund = (over: Partial<RefundRow> = {}): RefundRow => ({
  id: "rr1",
  status: "approved",
  approved_amount_aud_cents: 100,
  refund_processed_at: "2026-10-15T03:00:00Z",
  stripe_refund_id: "re_1",
  reason_text: "Refund issued in the Stripe Dashboard",
  created_at: "2026-10-15T03:00:00Z",
  ...over,
});

const build = (refunds: RefundRow[]) =>
  buildTimelineEntries({ sub: null, children: [], payouts: [], refunds, activityLogs: [], nannyLogs: [] });

describe("buildTimelineEntries — refunds", () => {
  it("a processed refund reads 'Refunded £1.00' in pence, two decimals", () => {
    const processed = build([refund()]).find((e) => e.id === "refund:rr1:processed");
    expect(processed?.title).toBe("Refunded £1.00");
    expect(processed?.category).toBe("refund");
    expect(processed?.timestampIso).toBe("2026-10-15T03:00:00Z");
  });

  it("keeps pence exact (no rounding to whole pounds)", () => {
    const processed = build([refund({ approved_amount_aud_cents: 150050 })]).find(
      (e) => e.id === "refund:rr1:processed",
    );
    expect(processed?.title).toBe("Refunded £1500.50");
  });

  it("a refund not yet processed has no 'Refunded' entry", () => {
    const entries = build([refund({ refund_processed_at: null })]);
    expect(entries.some((e) => e.title.startsWith("Refunded"))).toBe(false);
  });

  it("the request entry carries reason_text", () => {
    const requested = build([refund()]).find((e) => e.id === "refund:rr1:requested");
    expect(requested?.detail).toBe("Refund issued in the Stripe Dashboard");
  });
});
