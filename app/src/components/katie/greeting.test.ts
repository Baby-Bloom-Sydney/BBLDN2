/**
 * W6-D7 (3w6fix, BB-LDN-3w6fix-141026) — Katie's empty-state greeting is role-aware: parents have no verification
 * since 3h (D-7), so their greeting never offers it; a nanny's still does.
 * 5-w3fix (W3-M1, P-23) — "babysitting" is offered only while `BABYSITTING_ENABLED` is on.
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { katieGreetingTopics } from "./greeting";

afterEach(() => vi.unstubAllEnvs());

const setBabysitting = (on: boolean) => vi.stubEnv("BABYSITTING_ENABLED", on ? "true" : "");

describe("katieGreetingTopics — babysitting on", () => {
  it("offers verification to a nanny", () => {
    setBabysitting(true);
    expect(katieGreetingTopics("nanny")).toBe("child development, jobs, babysitting, verification, your profile");
  });

  it("never offers verification to a parent", () => {
    setBabysitting(true);
    expect(katieGreetingTopics("parent")).not.toMatch(/verif/i);
    expect(katieGreetingTopics("parent")).toBe("child development, jobs, babysitting, your profile");
  });

  it("offers verification to no other role", () => {
    setBabysitting(true);
    for (const role of ["admin", "", "unknown"]) expect(katieGreetingTopics(role)).not.toMatch(/verif/i);
  });
});

describe("katieGreetingTopics — babysitting off (the default)", () => {
  it("a nanny is offered no babysitting, still verification", () => {
    setBabysitting(false);
    expect(katieGreetingTopics("nanny")).toBe("child development, jobs, verification, your profile");
  });

  it("a parent is offered neither babysitting nor verification", () => {
    setBabysitting(false);
    expect(katieGreetingTopics("parent")).toBe("child development, jobs, your profile");
  });

  it("no role is offered babysitting", () => {
    setBabysitting(false);
    for (const role of ["nanny", "parent", "admin", "", "unknown"]) {
      expect(katieGreetingTopics(role)).not.toMatch(/babysit/i);
    }
  });
});
