/**
 * `/nanny/invoices/new`, the server page (plan 06 old step 14, §14.6 b4.4; brief §8, §9.1; R2 of 06b-4's plan, R20):
 * - Switch off ("", "false", "TRUE", "1"): `notFound()` before any auth or read.
 * - No nanny session (a parent, an admin, nobody): `notFound()`.
 * - On: her families, her VAT setting and the target the parameters ask for (`?placement=`, `?connection=`,
 *   `?replaces=`; never a `week`). **The RSC payload** holds the families (no family id), the target (no family id, no
 *   email), her VAT mode and rate, and London's today — nothing of her bank details, her address or her name.
 * - A failed read: the page with one plain message.
 * - `maxDuration = 30` (render, upload and two emails; security L6).
 *
 * BB-wave1-041126/06b4, 2026-11-12.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { isValidElement, type ReactElement } from "react";

const calls = vi.hoisted(() => ({
  proveNanny: vi.fn(),
  listInvoiceableFamilies: vi.fn(),
  resolveInvoiceTarget: vi.fn(),
  readIssuer: vi.fn(),
  readMyInvoices: vi.fn(),
  readMyInvoiceLines: vi.fn(),
}));
vi.mock("next/navigation", () => ({
  notFound: () => {
    throw new Error("NOT_FOUND");
  },
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));
vi.mock("@/lib/invoices/nanny-proof", () => ({ proveNanny: calls.proveNanny }));
vi.mock("@/lib/invoices/families", () => ({ listInvoiceableFamilies: calls.listInvoiceableFamilies, resolveInvoiceTarget: calls.resolveInvoiceTarget }));
vi.mock("@/lib/invoices/store-business", () => ({ readIssuer: calls.readIssuer }));
vi.mock("@/lib/invoices/store", () => ({ readMyInvoices: calls.readMyInvoices, readMyInvoiceLines: calls.readMyInvoiceLines }));
vi.mock("@/lib/invoices/actions/preview-invoice", () => ({ previewInvoice: vi.fn() }));
vi.mock("@/lib/invoices/actions/send-invoice", () => ({ sendInvoice: vi.fn() }));
vi.mock("@/lib/invoices/actions/save-business-settings", () => ({ saveBusinessSettings: vi.fn() }));

import { issuerReply } from "@/lib/invoices/store-map-lines";
import { ISSUER, NANNY_ID, NANNY_USER, PARENT_USER, PLACEMENT, RATE, TARGET } from "@/lib/invoices/invoice-rows.test-util";
import NewInvoicePage, { maxDuration } from "./page";
import { NewInvoiceClient } from "./NewInvoiceClient";

const PROOF = { kind: "nanny_proof", nannyId: NANNY_ID, userId: NANNY_USER };
const FAMILY = {
  parentUserId: PARENT_USER, familyName: "Olivia Hartley", area: "Islington",
  placements: [{ placementId: PLACEMENT, status: "active", startDate: "2027-02-02", weeklyHours: 30, ratePence: RATE }], trials: [],
};

beforeEach(() => {
  vi.stubEnv("NANNY_INVOICES_ENABLED", "true");
  calls.proveNanny.mockReset().mockResolvedValue(PROOF);
  calls.listInvoiceableFamilies.mockReset().mockResolvedValue({ ok: true, value: [FAMILY] });
  calls.resolveInvoiceTarget.mockReset().mockResolvedValue({ ok: true, value: { ...TARGET, prefill: { shifts: [{ date: "2027-02-01", hours: 6, ratePence: RATE, description: null }], ratePence: RATE, rateSource: "placement" } } });
  calls.readIssuer.mockReset().mockResolvedValue({ ok: true, value: issuerReply.parse({ ...ISSUER, vat_mode: "added", vat_rate_bp: 2000, vat_number: "GB123456789" }) });
  calls.readMyInvoices.mockReset();
  calls.readMyInvoiceLines.mockReset();
});
afterEach(() => vi.unstubAllEnvs());

const render = async (searchParams: Record<string, string | string[] | undefined> = {}) =>
  (await NewInvoicePage({ searchParams })) as ReactElement<Record<string, unknown>>;

describe("/nanny/invoices/new — switch off", () => {
  it.each(["", "false", "TRUE", "1"])("%j → notFound() before any auth or read", async (value) => {
    vi.stubEnv("NANNY_INVOICES_ENABLED", value);
    await expect(render({ placement: PLACEMENT })).rejects.toThrow("NOT_FOUND");
    for (const fn of Object.values(calls)) expect(fn).not.toHaveBeenCalled();
  });
});

describe("/nanny/invoices/new — switch on", () => {
  it("lives up to 30 seconds (render, upload, two emails)", () => {
    expect(maxDuration).toBe(30);
  });

  it("no nanny session → notFound(), nothing read", async () => {
    calls.proveNanny.mockResolvedValueOnce(null);
    await expect(render()).rejects.toThrow("NOT_FOUND");
    expect(calls.listInvoiceableFamilies).not.toHaveBeenCalled();
  });

  it("the plain page: her families and VAT, no target", async () => {
    const out = await render();
    expect(isValidElement(out)).toBe(true);
    expect(out.type).toBe(NewInvoiceClient);
    expect(out.props.target).toBeNull();
    expect(out.props.vat).toEqual({ mode: "added", rateBp: 2000 });
    expect(calls.resolveInvoiceTarget).not.toHaveBeenCalled();
  });

  it("?placement= → its target; the RSC payload carries no family id, email, bank detail, address or her name", async () => {
    const out = await render({ placement: PLACEMENT });
    expect(Object.keys(out.props).sort()).toEqual(["families", "loadFailed", "target", "today", "vat"]);
    expect(out.props.target).toMatchObject({ kind: "regular_week", targetId: PLACEMENT, familyName: "Olivia Hartley" });
    expect(typeof out.props.today).toBe("string");
    const payload = JSON.stringify(out.props);
    for (const secret of [PARENT_USER, NANNY_ID, NANNY_USER, "admin+b06", "112233", "87654321", "Upper Street", "Sophie", "GB123456789", "nanny_proof"]) {
      expect(payload).not.toContain(secret);
    }
  });

  it("a week parameter isn't read (06b-5's)", async () => {
    await render({ placement: PLACEMENT, week: "2027-02-08" });
    expect(calls.resolveInvoiceTarget.mock.calls[0]?.[3]).not.toBe("2027-02-08");
  });

  it.each([
    ["the families", () => calls.listInvoiceableFamilies.mockResolvedValueOnce({ ok: false, error: "error" })],
    ["her VAT", () => calls.readIssuer.mockResolvedValueOnce({ ok: false, error: "error" })],
    ["the target", () => calls.resolveInvoiceTarget.mockResolvedValueOnce({ ok: false, error: "error" })],
  ])("a failed read of %s → the page with one plain message", async (_what, fail) => {
    fail();
    const out = await render({ placement: PLACEMENT });
    expect(out.props).toMatchObject({ loadFailed: true, families: [], target: null });
  });
});
