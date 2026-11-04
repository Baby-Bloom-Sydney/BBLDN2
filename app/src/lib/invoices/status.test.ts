/**
 * The status a list shows (plan R1: a row still `sending` after 10 minutes shows as failed; readers count only sent).
 * BB-wave1-041126/06a-build, 2026-11-04.
 */
import { describe, expect, it } from "vitest";
import { countsAsIssued, countsAsSent, shownStatus } from "./status";

const at = (iso: string) => new Date(iso);

describe("shownStatus", () => {
  it("shows sent, cancelled and failed as they are", () => {
    for (const status of ["sent", "cancelled", "failed"] as const) {
      expect(shownStatus({ status, createdAt: "2027-02-15T09:00:00Z" }, at("2027-02-15T10:00:00Z"))).toBe(status);
    }
  });

  it("shows a fresh sending row as sending, and one older than 10 minutes as failed (R1)", () => {
    const row = { status: "sending" as const, createdAt: "2027-02-15T09:00:00Z" };
    expect(shownStatus(row, at("2027-02-15T09:09:59Z"))).toBe("sending");
    expect(shownStatus(row, at("2027-02-15T09:10:00Z"))).toBe("failed");
  });

  it("shows an unreadable created time as failed rather than sending forever", () => {
    expect(shownStatus({ status: "sending", createdAt: "garbage" }, at("2027-02-15T09:00:00Z"))).toBe("failed");
  });
});

describe("what the readers count (R1)", () => {
  it("only a sent row with its PDF is sent; sent or cancelled is issued", () => {
    expect(countsAsSent({ status: "sent", pdfPath: "n/i.pdf" })).toBe(true);
    expect(countsAsSent({ status: "sent", pdfPath: null })).toBe(false);
    for (const status of ["sending", "failed", "cancelled"] as const) {
      expect(countsAsSent({ status, pdfPath: "n/i.pdf" })).toBe(false);
    }
    expect(countsAsIssued({ status: "cancelled", pdfPath: "n/i.pdf" })).toBe(true);
    expect(countsAsIssued({ status: "failed", pdfPath: "n/i.pdf" })).toBe(false);
    expect(countsAsIssued({ status: "sending", pdfPath: "n/i.pdf" })).toBe(false);
  });
});
