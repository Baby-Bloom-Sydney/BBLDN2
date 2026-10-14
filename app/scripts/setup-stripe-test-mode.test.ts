/**
 * Unit 4f (LDN2 Stage 4) — the London Stripe test-mode setup script.
 * Pins: GBP prices from `PRICES`, tax-inclusive (M-1 1a), test keys only,
 * one webhook endpoint with the route's non-Connect events (D5), nothing
 * secret printed, idempotent re-runs.
 */
import { mkdtempSync, readFileSync, statSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { describe, expect, it, vi } from "vitest";

import { PRICES } from "@/config/prices";

import {
  CONNECT_EVENTS,
  PRICE_SPECS,
  WEBHOOK_EVENTS,
  assertSecretOutPath,
  assertTestKey,
  ensureGbTaxRegistration,
  ensurePrice,
  ensureProduct,
  ensureWebhookEndpoint,
  envLines,
  redactUrl,
  redactSecrets,
  webhookUrl,
  writeSecretFile,
} from "./setup-stripe-test-mode";

const SCRIPT = readFileSync(
  resolve(__dirname, "setup-stripe-test-mode.ts"),
  "utf-8",
);
const ROUTE = readFileSync(
  resolve(__dirname, "..", "src/app/api/webhooks/stripe/route.ts"),
  "utf-8",
);

describe("assertTestKey", () => {
  it("accepts sk_test_ and rk_test_ keys", () => {
    expect(assertTestKey("sk_test_abc")).toBe("sk_test_abc");
    expect(assertTestKey("rk_test_abc")).toBe("rk_test_abc");
  });

  it.each([undefined, "", "sk_live_abc", "rk_live_abc", "pk_test_abc", "abc"])(
    "refuses %s",
    (key) => {
      expect(() => assertTestKey(key)).toThrow(/test/i);
    },
  );
});

describe("PRICE_SPECS — London self-serve prices from config", () => {
  it("has exactly the two self-serve prices", () => {
    expect(PRICE_SPECS.map((s) => s.role)).toEqual([
      "self_serve_upfront",
      "self_serve_monthly",
    ]);
  });

  it("upfront is one-time, the config amount, in the config currency", () => {
    const upfront = PRICE_SPECS[0];
    expect(upfront.unitAmount).toBe(PRICES.selfServe.upfrontToAge3Pence);
    expect(upfront.recurring).toBeNull();
    expect(upfront.currency).toBe(PRICES.currency);
    expect(upfront.envPrice).toBe("STRIPE_PRICE_UPFRONT_ID");
    expect(upfront.envProduct).toBe("STRIPE_PRODUCT_UPFRONT_ID");
  });

  it("monthly is recurring per month at the config amount", () => {
    const monthly = PRICE_SPECS[1];
    expect(monthly.unitAmount).toBe(PRICES.selfServe.monthlyPence);
    expect(monthly.recurring).toEqual({ interval: "month" });
    expect(monthly.currency).toBe(PRICES.currency);
    expect(monthly.envPrice).toBe("STRIPE_PRICE_MONTHLY_ID");
    expect(monthly.envProduct).toBe("STRIPE_PRODUCT_MONTHLY_ID");
  });

  it("every price is tax-inclusive (M-1 1a) and has a distinct lookup key", () => {
    for (const s of PRICE_SPECS) expect(s.taxBehavior).toBe("inclusive");
    const keys = PRICE_SPECS.map((s) => s.lookupKey);
    expect(new Set(keys).size).toBe(keys.length);
  });
});

// The currency / domain / city residue is the London sweep's job (currency + brand rules, ratchet on the
// allow entries); this pins what the sweep cannot see.
describe("the script carries no Connect, portal or env-writer residue", () => {
  it.each([
    /stripe-connect/,
    /STRIPE_CONNECT_WEBHOOK/,
    /STRIPE_BILLING_PORTAL_CONFIGURATION_ID/,
    /billingPortal/,
    /connect:\s*true/,
    /writeFileSync\([^)]*\.env/,
  ])("has no %s", (pattern) => {
    expect(SCRIPT).not.toMatch(pattern);
  });
});

describe("WEBHOOK_EVENTS", () => {
  it("equals the route's handled events minus the Connect ones", () => {
    const routeCases = [...ROUTE.matchAll(/case "([a-z_.]+)":/g)].map(
      (m) => m[1],
    );
    expect(routeCases.length).toBeGreaterThan(0);
    const expected = routeCases.filter(
      (e) => !(CONNECT_EVENTS as readonly string[]).includes(e),
    );
    expect([...WEBHOOK_EVENTS].sort()).toEqual([...expected].sort());
  });

  it("has no Connect or payout event", () => {
    for (const e of WEBHOOK_EVENTS) {
      expect(e).not.toMatch(/^(account|capability|payout|transfer)\./);
    }
  });
});

describe("webhookUrl / redactUrl", () => {
  it("joins the base url and the route, with the bypass as a query param", () => {
    expect(webhookUrl("https://x.vercel.app/", "s3cret")).toBe(
      "https://x.vercel.app/api/webhooks/stripe?x-vercel-protection-bypass=s3cret",
    );
    expect(webhookUrl("https://x.vercel.app", undefined)).toBe(
      "https://x.vercel.app/api/webhooks/stripe",
    );
  });

  it("refuses a non-https base url", () => {
    expect(() => webhookUrl("http://x.vercel.app", undefined)).toThrow(/https/);
  });

  it("redacts the bypass value", () => {
    const red = redactUrl(
      "https://x.vercel.app/api/webhooks/stripe?x-vercel-protection-bypass=s3cret",
    );
    expect(red).not.toContain("s3cret");
    expect(red).toContain("x-vercel-protection-bypass=");
  });
});

describe("envLines", () => {
  it("prints ids, never the signing secret value", () => {
    const lines = envLines({
      STRIPE_PRODUCT_UPFRONT_ID: "prod_1",
      STRIPE_PRICE_UPFRONT_ID: "price_1",
      STRIPE_PRODUCT_MONTHLY_ID: "prod_2",
      STRIPE_PRICE_MONTHLY_ID: "price_2",
      STRIPE_WEBHOOK_ENDPOINT_ID: "we_1",
    }).join("\n");
    expect(lines).toContain("STRIPE_PRICE_UPFRONT_ID=price_1");
    expect(lines).toContain("STRIPE_WEBHOOK_ENDPOINT_ID=we_1");
    expect(lines).toMatch(/STRIPE_WEBHOOK_SECRET=<.*>/);
    expect(lines).not.toMatch(/whsec_/);
  });
});

describe("assertSecretOutPath", () => {
  it("refuses a path inside the repository", () => {
    const repo = resolve(__dirname, "..", "..");
    expect(() =>
      assertSecretOutPath(resolve(repo, "app/whsec.txt"), repo),
    ).toThrow(/outside/);
  });

  it("accepts a new file in an existing directory outside the repository", () => {
    const dir = mkdtempSync(resolve(tmpdir(), "bb4f-"));
    const repo = mkdtempSync(resolve(tmpdir(), "bb4f-repo-"));
    expect(assertSecretOutPath(resolve(dir, "whsec.txt"), repo)).toBe(resolve(dir, "whsec.txt"));
  });

  it("refuses a repo directory whose name merely starts with two dots", () => {
    const repo = mkdtempSync(resolve(tmpdir(), "bb4f-repo-"));
    const fixed = mkdtempSync(resolve(repo, "..c-"));
    expect(() => assertSecretOutPath(resolve(fixed, "whsec.txt"), repo)).toThrow(/outside/);
  });

  it("refuses a path that reaches into the repository through a symlink", () => {
    const repo = mkdtempSync(resolve(tmpdir(), "bb4f-repo-"));
    const outside = mkdtempSync(resolve(tmpdir(), "bb4f-"));
    const link = resolve(outside, "link");
    symlinkSync(repo, link);
    expect(() => assertSecretOutPath(resolve(link, "whsec.txt"), repo)).toThrow(/outside/);
  });

  it("refuses an existing file and a missing directory", () => {
    const repo = mkdtempSync(resolve(tmpdir(), "bb4f-repo-"));
    const dir = mkdtempSync(resolve(tmpdir(), "bb4f-"));
    const existing = resolve(dir, "old.txt");
    writeFileSync(existing, "x", { mode: 0o644 });
    expect(() => assertSecretOutPath(existing, repo)).toThrow(/exists/);
    expect(() => assertSecretOutPath(resolve(dir, "nope", "f.txt"), repo)).toThrow(/directory/);
  });
});

describe("writeSecretFile", () => {
  it("creates the file with mode 0600", () => {
    const f = resolve(mkdtempSync(resolve(tmpdir(), "bb4f-")), "s.txt");
    writeSecretFile(f, "whsec_fake");
    expect(statSync(f).mode & 0o777).toBe(0o600);
    expect(readFileSync(f, "utf-8")).toBe("whsec_fake");
  });

  it("never writes into an existing file (which may be world-readable)", () => {
    const f = resolve(mkdtempSync(resolve(tmpdir(), "bb4f-")), "s.txt");
    writeFileSync(f, "old", { mode: 0o644 });
    expect(() => writeSecretFile(f, "whsec_fake")).toThrow();
    expect(readFileSync(f, "utf-8")).toBe("old");
  });
});

describe("redactSecrets", () => {
  it("removes the bypass value from an error message", () => {
    expect(redactSecrets("bad url https://x/?x-vercel-protection-bypass=s3cret!", ["s3cret"])).toBe(
      "bad url https://x/?x-vercel-protection-bypass=REDACTED!",
    );
    expect(redactSecrets("plain", [undefined])).toBe("plain");
  });
});

// ── idempotency against a fake Stripe ───────────────────────────────────────

function fakeStripe(state: {
  products?: Array<Record<string, unknown>>;
  prices?: Array<Record<string, unknown>>;
  hooks?: Array<Record<string, unknown>>;
  registrations?: Array<Record<string, unknown>>;
  registrationCreateError?: Error;
}) {
  const s = {
    products: {
      list: vi.fn(async () => ({ data: state.products ?? [], has_more: false })),
      create: vi.fn(async (p: Record<string, unknown>) => ({ id: "prod_new", ...p })),
    },
    prices: {
      list: vi.fn(async () => ({ data: state.prices ?? [], has_more: false })),
      create: vi.fn(async (p: Record<string, unknown>) => ({ id: "price_new", ...p })),
    },
    webhookEndpoints: {
      list: vi.fn(async () => ({ data: state.hooks ?? [], has_more: false })),
      create: vi.fn(async (p: Record<string, unknown>) => ({
        id: "we_new",
        secret: "whsec_fake",
        ...p,
      })),
      update: vi.fn(async (id: string, p: Record<string, unknown>) => ({ id, ...p })),
    },
    tax: {
      registrations: {
        list: vi.fn(async () => ({ data: state.registrations ?? [] })),
        create: vi.fn(async (p: Record<string, unknown>) => {
          if (state.registrationCreateError) throw state.registrationCreateError;
          return { id: "taxreg_new", status: "active", ...p };
        }),
      },
    },
  };
  return s;
}

type FakeStripe = ReturnType<typeof fakeStripe>;
// The ensure* helpers take the SDK; the fake implements the calls they make.
const asStripe = (s: FakeStripe) => s as unknown as Parameters<typeof ensureProduct>[0];

describe("ensureProduct", () => {
  const spec = PRICE_SPECS[0];

  it("reuses a product carrying the London role metadata", async () => {
    const s = fakeStripe({
      products: [{ id: "prod_old", metadata: { bb_ldn_role: spec.role } }],
    });
    expect(await ensureProduct(asStripe(s), spec)).toBe("prod_old");
    expect(s.products.create).not.toHaveBeenCalled();
  });

  it("lists active products only, so an archived London product is not reused", async () => {
    const s = fakeStripe({});
    await ensureProduct(asStripe(s), spec);
    expect(s.products.list.mock.calls[0][0]).toMatchObject({ active: true });
  });

  it("creates the product with the role metadata when none exists", async () => {
    const s = fakeStripe({ products: [{ id: "prod_other", metadata: {} }] });
    expect(await ensureProduct(asStripe(s), spec)).toBe("prod_new");
    expect(s.products.create.mock.calls[0][0]).toMatchObject({
      metadata: { bb_ldn_role: spec.role },
    });
  });
});

describe("ensurePrice", () => {
  const spec = PRICE_SPECS[1];

  it("reuses an active price with the lookup key and the same shape", async () => {
    const s = fakeStripe({
      prices: [
        {
          id: "price_old",
          product: "prod_x",
          lookup_key: spec.lookupKey,
          unit_amount: spec.unitAmount,
          currency: spec.currency,
          tax_behavior: "inclusive",
          recurring: { interval: "month", interval_count: 1 },
          active: true,
        },
      ],
    });
    expect(await ensurePrice(asStripe(s), spec, "prod_x")).toBe("price_old");
    expect(s.prices.create).not.toHaveBeenCalled();
  });

  const good = {
    id: "price_old",
    product: "prod_x",
    lookup_key: spec.lookupKey,
    unit_amount: spec.unitAmount,
    currency: spec.currency,
    tax_behavior: "inclusive",
    recurring: { interval: "month", interval_count: 1 },
    active: true,
  };

  it("asks Stripe for the active price under the lookup key", async () => {
    const s = fakeStripe({ prices: [good] });
    await ensurePrice(asStripe(s), spec, "prod_x");
    expect(s.prices.list.mock.calls[0][0]).toMatchObject({
      lookup_keys: [spec.lookupKey],
      active: true,
    });
  });

  it.each([
    ["another product", { product: "prod_other" }],
    ["another currency", { currency: "usd" }],
    ["exclusive tax", { tax_behavior: "exclusive" }],
    ["every two months", { recurring: { interval: "month", interval_count: 2 } }],
    ["one-time", { recurring: null }],
  ])("does not reuse a price on %s", async (_label, patch) => {
    const s = fakeStripe({ prices: [{ ...good, ...patch }] });
    expect(await ensurePrice(asStripe(s), spec, "prod_x")).toBe("price_new");
  });

  it("reuses a price whose product comes back expanded", async () => {
    const s = fakeStripe({ prices: [{ ...good, product: { id: "prod_x" } }] });
    expect(await ensurePrice(asStripe(s), spec, "prod_x")).toBe("price_old");
  });

  it("creates a GBP, tax-inclusive price and moves the lookup key when the amount changed", async () => {
    const s = fakeStripe({
      prices: [
        {
          id: "price_stale",
          lookup_key: spec.lookupKey,
          unit_amount: spec.unitAmount + 1,
          currency: spec.currency,
          tax_behavior: "inclusive",
          recurring: { interval: "month" },
          active: true,
        },
      ],
    });
    expect(await ensurePrice(asStripe(s), spec, "prod_x")).toBe("price_new");
    expect(s.prices.create.mock.calls[0][0]).toMatchObject({
      product: "prod_x",
      unit_amount: spec.unitAmount,
      currency: PRICES.currency,
      tax_behavior: "inclusive",
      lookup_key: spec.lookupKey,
      transfer_lookup_key: true,
      recurring: { interval: "month" },
    });
  });
});

describe("ensureWebhookEndpoint", () => {
  const url = "https://x.vercel.app/api/webhooks/stripe?x-vercel-protection-bypass=b";

  it("creates one non-Connect endpoint with the London metadata and returns the secret", async () => {
    const s = fakeStripe({});
    const r = await ensureWebhookEndpoint(asStripe(s), url);
    expect(r).toEqual({ id: "we_new", secret: "whsec_fake", created: true });
    const params = s.webhookEndpoints.create.mock.calls[0][0];
    expect(params).toMatchObject({ url, metadata: { bb_ldn_role: "main" } });
    expect(params).not.toHaveProperty("connect");
    expect([...(params.enabled_events as string[])].sort()).toEqual(
      [...WEBHOOK_EVENTS].sort(),
    );
  });

  it("updates the existing London endpoint in place (url + events) instead of creating a second", async () => {
    const s = fakeStripe({
      hooks: [
        { id: "we_other", url: "https://other.example/api/webhooks/stripe", metadata: {} },
        { id: "we_ldn", url: "https://old.vercel.app/x", metadata: { bb_ldn_role: "main" } },
      ],
    });
    const r = await ensureWebhookEndpoint(asStripe(s), url);
    expect(r).toEqual({ id: "we_ldn", secret: null, created: false });
    expect(s.webhookEndpoints.create).not.toHaveBeenCalled();
    const [, params] = s.webhookEndpoints.update.mock.calls[0];
    expect(params).toMatchObject({ url, disabled: false });
    expect([...(params.enabled_events as string[])].sort()).toEqual([...WEBHOOK_EVENTS].sort());
  });

  it("refuses to drop the bypass from an endpoint that had one", async () => {
    const s = fakeStripe({
      hooks: [
        {
          id: "we_ldn",
          url: "https://old.vercel.app/api/webhooks/stripe?x-vercel-protection-bypass=b",
          metadata: { bb_ldn_role: "main" },
        },
      ],
    });
    await expect(
      ensureWebhookEndpoint(asStripe(s), "https://new.vercel.app/api/webhooks/stripe"),
    ).rejects.toThrow(/VERCEL_PROTECTION_BYPASS/);
    expect(s.webhookEndpoints.update).not.toHaveBeenCalled();
  });
});

describe("ensureGbTaxRegistration (M-1 1c)", () => {
  it("reports an existing GB registration and creates nothing", async () => {
    const s = fakeStripe({ registrations: [{ id: "taxreg_gb", country: "GB", status: "active" }] });
    const r = await ensureGbTaxRegistration(asStripe(s));
    expect(r).toMatchObject({ outcome: "exists", id: "taxreg_gb" });
    expect(s.tax.registrations.create).not.toHaveBeenCalled();
  });

  it("creates a GB standard registration when none exists", async () => {
    const s = fakeStripe({ registrations: [{ id: "taxreg_au", country: "AU", status: "active" }] });
    const r = await ensureGbTaxRegistration(asStripe(s));
    expect(r).toMatchObject({ outcome: "created", id: "taxreg_new" });
    expect(s.tax.registrations.create.mock.calls[0][0]).toMatchObject({
      country: "GB",
      country_options: { gb: { type: "standard" } },
      active_from: "now",
    });
  });

  it("reports Stripe's refusal (an invalid-request error) as a fact instead of throwing", async () => {
    const refusal = Object.assign(new Error("not allowed for AU accounts"), {
      type: "StripeInvalidRequestError",
    });
    const s = fakeStripe({ registrationCreateError: refusal });
    const r = await ensureGbTaxRegistration(asStripe(s));
    expect(r).toEqual({ outcome: "refused", detail: "not allowed for AU accounts" });
  });

  it("labels auth, permission or network failures as errors, not refusals", async () => {
    const auth = Object.assign(new Error("Invalid API Key"), { type: "StripeAuthenticationError" });
    const s = fakeStripe({ registrationCreateError: auth });
    const r = await ensureGbTaxRegistration(asStripe(s));
    expect(r).toEqual({ outcome: "error", detail: "Invalid API Key" });
  });
});
