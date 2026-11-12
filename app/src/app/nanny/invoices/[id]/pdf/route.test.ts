/**
 * `GET /nanny/invoices/[id]/pdf` (plan 06 old step 14, §9 surface 6, R13, R20; brief §0.6, §9.9): her own invoice's
 * stored PDF through a link made per click, after the owner check, that lives 60 seconds.
 * - Switch off: 404 (the repo's JSON shape) before any auth or read.
 * - No nanny session (a parent, an admin, nobody): 404. Not hers, no PDF, not an id: 404 (never 403: nothing says it
 *   exists). A storage or read failure: 500, nothing of the path.
 * - Hers: 302 to the signed link, never cached.
 *
 * BB-wave1-041126/06b4, 2026-11-12.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const calls = vi.hoisted(() => ({ proveNanny: vi.fn(), invoicePdfLink: vi.fn() }));
vi.mock("@/lib/invoices/nanny-proof", () => ({ proveNanny: calls.proveNanny }));
vi.mock("@/lib/invoices/store-pdf-link", () => ({ invoicePdfLink: calls.invoicePdfLink }));

import { GET } from "./route";

const ID = "b0600000-0000-4000-8000-000000009001";
const PROOF = { kind: "nanny_proof" };
const LINK = "https://example.supabase.co/storage/v1/object/sign/nanny-invoices/x.pdf?token=t";
const get = (id: string = ID) => GET(new Request(`http://localhost/nanny/invoices/${id}/pdf`), { params: { id } });

beforeEach(() => {
  vi.stubEnv("NANNY_INVOICES_ENABLED", "true");
  calls.proveNanny.mockReset().mockResolvedValue(PROOF);
  calls.invoicePdfLink.mockReset().mockResolvedValue({ ok: true, value: LINK });
});
afterEach(() => vi.unstubAllEnvs());

describe("the invoice PDF route — switch off", () => {
  it.each(["", "false", "TRUE", "1"])("%j → 404 before any auth or read", async (value) => {
    vi.stubEnv("NANNY_INVOICES_ENABLED", value);
    const res = await get();
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "Not found" });
    expect(res.headers.get("cache-control")).toBe("private, no-store");
    expect(calls.proveNanny).not.toHaveBeenCalled();
    expect(calls.invoicePdfLink).not.toHaveBeenCalled();
  });
});

describe("the invoice PDF route — switch on", () => {
  it("hers → 302 to the 60-second signed link, not cached", async () => {
    const res = await get();
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe(LINK);
    expect(res.headers.get("cache-control")).toBe("private, no-store");
    expect(calls.invoicePdfLink).toHaveBeenCalledWith(PROOF, ID);
  });

  it("a signed link that can't be redirected to → 500, not cached, nothing of the link (security review L1)", async () => {
    const logged = vi.spyOn(console, "error").mockImplementation(() => undefined);
    calls.invoicePdfLink.mockResolvedValueOnce({ ok: true, value: "not a url" });
    const res = await get();
    expect(logged).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(logged.mock.calls)).not.toContain("not a url");
    logged.mockRestore();
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: "Unavailable" });
    expect(res.headers.get("cache-control")).toBe("private, no-store");
    expect(res.headers.get("location")).toBeNull();
  });

  it("no nanny session → 404, nothing read", async () => {
    calls.proveNanny.mockResolvedValueOnce(null);
    const res = await get();
    expect(res.status).toBe(404);
    expect(calls.invoicePdfLink).not.toHaveBeenCalled();
  });

  it.each(["not_found", "invalid"])("%s (not hers, no PDF, not an id) → 404", async (error) => {
    calls.invoicePdfLink.mockResolvedValueOnce({ ok: false, error });
    const res = await get("anything");
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "Not found" });
  });

  it("a failure → 500 with nothing of the invoice", async () => {
    calls.invoicePdfLink.mockResolvedValueOnce({ ok: false, error: "error" });
    const res = await get();
    expect(res.status).toBe(500);
    expect(res.headers.get("cache-control")).toBe("private, no-store");
    expect(JSON.stringify(await res.json())).not.toContain(ID);
  });
});
