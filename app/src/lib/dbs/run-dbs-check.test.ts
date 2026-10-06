/** Unit 3b (BB-LDN-3b-061026) — the one place both screens fire the certificate check from (brief change 4). */
import { afterEach, describe, expect, it, vi } from "vitest";
import { fireDbsCheck } from "./run-dbs-check";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("fireDbsCheck", () => {
  it("posts the verification id to /api/run-verification with no method field", () => {
    const fetchMock = vi.fn(async () => ({ ok: true }));
    vi.stubGlobal("fetch", fetchMock);
    fireDbsCheck("ver-1");
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("/api/run-verification");
    expect(init.method).toBe("POST");
    const body = JSON.parse(String(init.body));
    expect(body.verificationId).toBe("ver-1");
    expect(Object.keys(body).sort()).toEqual(["phase", "verificationId"]);
  });

  it("logs, never throws, when the request fails", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("offline"); }));
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(() => fireDbsCheck("ver-1")).not.toThrow();
    await new Promise((r) => setTimeout(r, 0));
    expect(err).toHaveBeenCalledWith(expect.stringContaining("fireDbsCheck"), expect.any(Error));
  });
});
