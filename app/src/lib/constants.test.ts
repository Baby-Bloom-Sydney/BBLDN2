/**
 * `lib/constants.ts` is the single source for London's place and brand
 * facts (LDN2 Stage 2, unit 2-0; triage §0 finding 1, P-7). Until this
 * unit it had zero importers, so nothing guarded its values.
 *
 * These pins are what later units (2b time, 2c locale, 2d currency,
 * 2e phone, 2f brand) rely on when they re-point their literals here.
 * They assert *shape and invariants*, never a copy string a human may
 * still reword.
 *
 * BB-LDN-2-0-250926, 2026-09-25.
 */

import { describe, it, expect } from "vitest";
import {
  SITE_NAME,
  SITE_DESCRIPTION,
  SITE_URL,
  SITE_DOMAIN,
  BRAND,
  SENDERS,
  SUPPORT_INBOX,
  LEGAL_ENTITY,
  APP_TZ,
  APP_LOCALE,
  OG_LOCALE,
  HOURLY_RATE_BOUNDS,
} from "./constants";

describe("LEGAL_ENTITY — ADR-171 sentinel", () => {
  it("is still the @pending:company sentinel", () => {
    expect(LEGAL_ENTITY).toBe("@pending:company");
  });

  it("carries the @pending: prefix, so filling it in fails this test", () => {
    // ADR-171: the entity's own values are not ours to invent. A real
    // company name must arrive as a deliberate change that breaks a
    // test, not as a plausible string that ships unnoticed.
    expect(LEGAL_ENTITY).toMatch(/^@pending:/);
  });
});

describe("SITE_URL", () => {
  it("has no trailing slash, so callers can write `${SITE_URL}/path`", () => {
    expect(SITE_URL.endsWith("/")).toBe(false);
  });

  it("parses as an absolute URL", () => {
    expect(() => new URL(SITE_URL)).not.toThrow();
    expect(new URL(SITE_URL).protocol).toMatch(/^https?:$/);
  });

  it("is hosted on SITE_DOMAIN when no env override is set", () => {
    // The env var wins at module-eval time (preview / localhost), so
    // this only asserts the relationship for the shipped default.
    if (!process.env.NEXT_PUBLIC_SITE_URL) {
      expect(new URL(SITE_URL).host).toBe(SITE_DOMAIN);
    }
  });
});

describe("SITE_DOMAIN", () => {
  it("is a bare host — no scheme, no path, no trailing dot", () => {
    expect(SITE_DOMAIN).not.toMatch(/[:/]/);
    expect(SITE_DOMAIN.endsWith(".")).toBe(false);
  });

  it("is not an Australian domain", () => {
    expect(SITE_DOMAIN.endsWith(".com.au")).toBe(false);
  });
});

describe("SENDERS", () => {
  const senderKeys = [
    "noreply",
    "hello",
    "support",
    "admin",
    "compliance",
    "privacy",
  ] as const;

  it.each(senderKeys)("%s is a single address on SITE_DOMAIN", (key) => {
    const address = SENDERS[key];
    const parts = address.split("@");
    expect(parts).toHaveLength(2);
    expect(parts[0]).toBe(key);
    expect(parts[1]).toBe(SITE_DOMAIN);
  });

  it("declares exactly the six senders and no more", () => {
    expect(Object.keys(SENDERS).sort()).toEqual([...senderKeys].sort());
  });

  it("SUPPORT_INBOX is SENDERS.support, not a second literal", () => {
    expect(SUPPORT_INBOX).toBe(SENDERS.support);
  });
});

describe("APP_TZ / APP_LOCALE / OG_LOCALE", () => {
  it("APP_TZ is an IANA zone Intl accepts", () => {
    expect(
      () => new Intl.DateTimeFormat("en-GB", { timeZone: APP_TZ }),
    ).not.toThrow();
  });

  it("APP_TZ is the zone Intl resolves it to (not an alias or a typo)", () => {
    const resolved = new Intl.DateTimeFormat("en-GB", {
      timeZone: APP_TZ,
    }).resolvedOptions().timeZone;
    expect(resolved).toBe(APP_TZ);
  });

  it("APP_LOCALE is a locale Intl accepts", () => {
    expect(() => new Intl.DateTimeFormat(APP_LOCALE)).not.toThrow();
  });

  it("OG_LOCALE is APP_LOCALE in Open Graph's underscore form", () => {
    expect(OG_LOCALE).toBe(APP_LOCALE.replace("-", "_"));
  });
});

describe("HOURLY_RATE_BOUNDS — Q-1, BAI 2026-09-25 (£15–£30)", () => {
  it("is 15..30 inclusive", () => {
    expect(HOURLY_RATE_BOUNDS.min).toBeGreaterThanOrEqual(15);
    expect(HOURLY_RATE_BOUNDS.max).toBeLessThanOrEqual(30);
  });

  it("min is below max", () => {
    expect(HOURLY_RATE_BOUNDS.min).toBeLessThan(HOURLY_RATE_BOUNDS.max);
  });

  it("both bounds are finite whole pounds", () => {
    expect(Number.isInteger(HOURLY_RATE_BOUNDS.min)).toBe(true);
    expect(Number.isInteger(HOURLY_RATE_BOUNDS.max)).toBe(true);
  });
});

describe("BRAND", () => {
  it("names London, Greater London, United Kingdom, GB", () => {
    expect(BRAND.city).toBe("London");
    expect(BRAND.region).toBe("Greater London");
    expect(BRAND.country).toBe("United Kingdom");
    expect(BRAND.countryCode).toBe("GB");
  });

  it("BRAND.name is SITE_NAME, not a second literal", () => {
    expect(BRAND.name).toBe(SITE_NAME);
  });
});

describe("no Sydney survives in the source", () => {
  it.each([
    ["SITE_NAME", SITE_NAME],
    ["SITE_DESCRIPTION", SITE_DESCRIPTION],
    ["SITE_DOMAIN", SITE_DOMAIN],
    ["BRAND.city", BRAND.city],
    ["BRAND.region", BRAND.region],
    ["BRAND.country", BRAND.country],
  ])("%s mentions no Australian place", (_label, value) => {
    expect(value).not.toMatch(/sydney|nsw|australia/i);
  });

  it("SITE_DESCRIPTION is non-empty", () => {
    expect(SITE_DESCRIPTION.trim().length).toBeGreaterThan(0);
  });
});
