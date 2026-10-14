/**
 * W6-D7 (3w6fix, BB-LDN-3w6fix-141026) — Katie's empty-state greeting is role-aware: parents have no verification
 * since 3h (D-7), so their greeting never offers it; a nanny's still does.
 */
import { describe, it, expect } from "vitest";
import { katieGreetingTopics } from "./greeting";

describe("katieGreetingTopics", () => {
  it("offers verification to a nanny", () => {
    expect(katieGreetingTopics("nanny")).toBe("child development, jobs, babysitting, verification, your profile");
  });

  it("never offers verification to a parent", () => {
    expect(katieGreetingTopics("parent")).not.toMatch(/verif/i);
    expect(katieGreetingTopics("parent")).toBe("child development, jobs, babysitting, your profile");
  });

  it("offers verification to no other role", () => {
    for (const role of ["admin", "", "unknown"]) expect(katieGreetingTopics(role)).not.toMatch(/verif/i);
  });
});
