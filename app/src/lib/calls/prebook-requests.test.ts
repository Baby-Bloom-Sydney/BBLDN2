/** The stub brief 03 wires (plan §7, §12 R10): until then no family has a pending pre-book request. */
import { describe, expect, it } from "vitest";
import { readPendingPrebookRequests } from "./prebook-requests";

describe("readPendingPrebookRequests (stub for brief 03)", () => {
  it("returns an empty map for any families", async () => {
    const requests = await readPendingPrebookRequests(["b0400000-0000-4000-8000-000000000001"]);
    expect(requests.size).toBe(0);
  });
});
