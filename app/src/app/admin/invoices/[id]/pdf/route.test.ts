/**
 * `GET /admin/invoices/[id]/pdf` (plan 06 step 17, §14.6 c.1; brief §3 admin 2, §9 surface 6): BAI's "View PDF" — any
 * invoice that went out, through a link made per click, after the admin check and the read, that lives 60 seconds.
 * - Switch off: 404 (the repo's JSON shape) before the admin check or any read.
 * - Not an admin (a parent, a nanny, nobody): 404, nothing read.
 * - Not an id, none, not out, no PDF: 404 (never 403: nothing says it exists). A storage or read failure: 500, nothing
 *   of the path. Every answer `private, no-store`.
 * - Out: 302 to the signed link.
 *
 * BB-wave1-041126/06c, 2026-11-23.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const calls = vi.hoisted(() => ({ proveAdmin: vi.fn(), adminInvoicePdfLink: vi.fn(), invoicePdfLink: vi.fn() }));
vi.mock("@/lib/calls/admin-proof", () => ({ proveAdmin: calls.proveAdmin }));
vi.mock("@/lib/invoices/store-pdf-link", () => ({ adminInvoicePdfLink: calls.adminInvoicePdfLink, invoicePdfLink: calls.invoicePdfLink }));

import { GET } from "./route";

const ID = "b0600000-0000-4000-8000-000000009001";
const PROOF = { kind: "admin_proof" };
const PATH = `b0600000-0000-4000-8000-000000000101/${ID}.pdf`;
const LINK = `https://example.supabase.co/storage/v1/object/sign/nanny-invoices/${PATH}?token=t`;
const get = (id: string = ID) => GET(new Request(`http://localhost/admin/invoices/${id}/pdf`), { params: { id } });

beforeEach(() => {
  vi.stubEnv("NANNY_INVOICES_ENABLED", "true");
  calls.proveAdmin.mockReset().mockResolvedValue(PROOF);
  calls.adminInvoicePdfLink.mockReset().mockResolvedValue({ ok: true, value: LINK });
  calls.invoicePdfLink.mockReset();
});
afterEach(() => vi.unstubAllEnvs());

describe("the admin invoice PDF route — switch off", () => {
  it.each(["", "false", "TRUE", "1"])("%j → 404 before the admin check or any read", async (value) => {
    vi.stubEnv("NANNY_INVOICES_ENABLED", value);
    const res = await get();
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "Not found" });
    expect(res.headers.get("cache-control")).toBe("private, no-store");
    expect(calls.proveAdmin).not.toHaveBeenCalled();
    expect(calls.adminInvoicePdfLink).not.toHaveBeenCalled();
  });
});

describe("the admin invoice PDF route — switch on", () => {
  it("an invoice that went out → 302 to the 60-second signed link, made with the admin proof, not cached", async () => {
    const res = await get();
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe(LINK);
    expect(res.headers.get("cache-control")).toBe("private, no-store");
    expect(calls.adminInvoicePdfLink).toHaveBeenCalledWith(PROOF, ID);
    expect(calls.invoicePdfLink).not.toHaveBeenCalled(); // never the nanny's own-invoice check
  });

  it("not an admin (a parent, a nanny, nobody) → 404, nothing read", async () => {
    calls.proveAdmin.mockResolvedValueOnce(null);
    const res = await get();
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "Not found" });
    expect(res.headers.get("cache-control")).toBe("private, no-store");
    expect(calls.adminInvoicePdfLink).not.toHaveBeenCalled();
  });

  it.each(["not_found", "invalid"])("%s (none, not out, no PDF, not an id) → 404, not cached", async (error) => {
    calls.adminInvoicePdfLink.mockResolvedValueOnce({ ok: false, error });
    const res = await get("../x");
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "Not found" });
    expect(res.headers.get("cache-control")).toBe("private, no-store");
  });

  it.each(["error", "invoices_disabled"])("%s → 500 with nothing of the invoice or its path", async (error) => {
    calls.adminInvoicePdfLink.mockResolvedValueOnce({ ok: false, error });
    const res = await get();
    expect(res.status).toBe(500);
    expect(res.headers.get("cache-control")).toBe("private, no-store");
    const body = JSON.stringify(await res.json());
    expect(body).not.toContain(ID);
    expect(body).not.toContain(".pdf");
  });

  it("a signed link that can't be redirected to → 500, logged by its kind only, nothing of the link", async () => {
    const logged = vi.spyOn(console, "error").mockImplementation(() => undefined);
    calls.adminInvoicePdfLink.mockResolvedValueOnce({ ok: true, value: `not a url ${PATH}` });
    const res = await get();
    expect(logged).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(logged.mock.calls)).not.toContain(PATH);
    logged.mockRestore();
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: "Unavailable" });
    expect(res.headers.get("cache-control")).toBe("private, no-store");
    expect(res.headers.get("location")).toBeNull();
  });
});
