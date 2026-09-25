import { describe, it, expect } from "vitest";
import {
  nannyJobBucket,
  parentRequestBucket,
  bucketHeadline,
  expiryText,
  distanceText,
  formatSlot,
  childrenSummary,
  banText,
} from "./bsr-translator";

describe("nannyJobBucket", () => {
  const baseNotif = {
    requestedAt: null,
    acceptedAt: null,
    declinedAt: null,
    notifiedFilled: false,
  };

  it("accepted wins over everything", () => {
    expect(
      nannyJobBucket(
        { ...baseNotif, acceptedAt: "2026-05-01T00:00:00Z" },
        "expired",
      ),
    ).toBe("accepted");
  });

  it("declined / notified_filled / expired status → past", () => {
    expect(nannyJobBucket({ ...baseNotif, declinedAt: "..." }, "active")).toBe(
      "past",
    );
    expect(
      nannyJobBucket({ ...baseNotif, notifiedFilled: true }, "active"),
    ).toBe("past");
    expect(nannyJobBucket(baseNotif, "expired")).toBe("past");
    expect(nannyJobBucket(baseNotif, "nanny_cancelled")).toBe("past");
  });

  it("requested but not accepted → requested", () => {
    expect(
      nannyJobBucket(
        { ...baseNotif, requestedAt: "2026-05-01T00:00:00Z" },
        "active",
      ),
    ).toBe("requested");
  });

  it("default — available", () => {
    expect(nannyJobBucket(baseNotif, "active")).toBe("available");
  });
});

describe("parentRequestBucket", () => {
  it("maps known statuses", () => {
    expect(parentRequestBucket("pending_payment")).toBe("pending_payment");
    expect(parentRequestBucket("accepted")).toBe("booked");
    expect(parentRequestBucket("confirmed")).toBe("booked");
    expect(parentRequestBucket("expired")).toBe("past");
    expect(parentRequestBucket("cancelled")).toBe("past");
    expect(parentRequestBucket("completed")).toBe("past");
    expect(parentRequestBucket("nanny_cancelled")).toBe("past");
    expect(parentRequestBucket("active")).toBe("awaiting_requesters");
    expect(parentRequestBucket("awaiting_parent_choice")).toBe(
      "awaiting_requesters",
    );
  });
});

describe("bucketHeadline", () => {
  it("returns plain English per bucket + role", () => {
    expect(bucketHeadline("available", "nanny")).toMatch(/Available/i);
    expect(bucketHeadline("requested", "nanny")).toMatch(/family is deciding/);
    expect(bucketHeadline("booked", "parent")).toMatch(/selected/);
    expect(bucketHeadline("pending_payment", "parent")).toMatch(/payment/);
  });
});

describe("expiryText", () => {
  it("returns null for null input", () => {
    expect(expiryText(null)).toEqual({ text: null, urgent: false });
  });

  it("returns 'Expired' + not urgent for past", () => {
    expect(expiryText("2020-01-01T00:00:00Z")).toEqual({
      text: "Expired",
      urgent: false,
    });
  });

  it("flags urgent when < 6h remaining", () => {
    const t = new Date(Date.now() + 3 * 60 * 60 * 1000).toISOString();
    const r = expiryText(t);
    expect(r.urgent).toBe(true);
    expect(r.text).toMatch(/^[23]h( \d+m)? left$/);
  });

  it("not urgent > 6h out", () => {
    const t = new Date(Date.now() + 20 * 60 * 60 * 1000).toISOString();
    const r = expiryText(t);
    expect(r.urgent).toBe(false);
    expect(r.text).toMatch(/^(1?9|20)h( \d+m)? left$/);
  });

  it("formats day + hour", () => {
    const t = new Date(Date.now() + 2.5 * 24 * 60 * 60 * 1000).toISOString();
    const r = expiryText(t);
    expect(r.text).toMatch(/^2d( \d+h)? left$/);
  });
});

describe("distanceText", () => {
  it("renders <1 for sub-kilometre", () => {
    expect(distanceText(0.3)).toBe("<1 km");
    expect(distanceText(0.9)).toBe("<1 km");
  });

  it("renders one decimal otherwise", () => {
    expect(distanceText(3.45)).toBe("3.5 km");
    expect(distanceText(12)).toBe("12.0 km");
  });

  it("unknown for null", () => {
    expect(distanceText(null)).toMatch(/unknown/);
  });
});

describe("formatSlot", () => {
  it("renders London-local prose", () => {
    const out = formatSlot({
      slot_date: "2026-05-03",
      start_time: "18:00",
      end_time: "22:00",
    });
    // Don't pin the day-name since it depends on locale, just check shape.
    expect(out).toMatch(/\w{3} 3 May — 6pm to 10pm/);
  });

  it("handles minutes", () => {
    const out = formatSlot({
      slot_date: "2026-05-03",
      start_time: "09:30",
      end_time: "13:45",
    });
    expect(out).toContain("9:30am to 1:45pm");
  });
});

describe("childrenSummary", () => {
  it("renders single child in months", () => {
    expect(childrenSummary([{ age_months: 8, gender: null }])).toBe(
      "1 child (8 months)",
    );
  });

  it("renders multiple children with mixed ages", () => {
    expect(
      childrenSummary([
        { age_months: 14, gender: null },
        { age_months: 36, gender: null },
      ]),
    ).toBe("2 children (1 year, 3 years)");
  });

  it("handles empty list", () => {
    expect(childrenSummary([])).toBe("No child details");
  });
});

describe("banText", () => {
  it("returns null when no ban", () => {
    expect(banText(null)).toBeNull();
  });

  it("mentions the end date + 3-cancellation rule, not internal fields", () => {
    const t = new Date(Date.now() + 90 * 24 * 60 * 60 * 1000).toISOString();
    const out = banText(t);
    expect(out).toBeTruthy();
    expect(String(out).toLowerCase()).toContain("3-cancellation");
    // Must never leak internal field name
    expect(String(out)).not.toMatch(/bsr_banned_until/);
  });
});
