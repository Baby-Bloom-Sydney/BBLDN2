/**
 * setup-stripe-test-mode.ts — London (LDN2 unit 4f)
 *
 * Provisions the Stripe TEST-MODE objects London needs, idempotently:
 *
 *  - 2 products + 2 prices for the self-serve app, from `PRICES` in
 *    `@/config/prices` (ADR-091): upfront to age 3 (one-time) and monthly
 *    (recurring). Tax-inclusive (M-1 1a). Identified by product metadata
 *    `bb_ldn_role` and price `lookup_key`; a changed amount creates a new
 *    price and moves the lookup key to it.
 *  - 1 webhook endpoint (no Connect — London has none) subscribed to the
 *    non-Connect events the route handles. Identified by metadata
 *    `bb_ldn_role=main`; re-running with a new `--base-url` updates its
 *    URL in place.
 *  - A GB Stripe Tax registration (M-1 1c), or the reason Stripe refused.
 *
 * Runs against the existing (non-UK) connected account in test mode until London's own
 * account exists (P-20, M-2). It REFUSES any key that is not a test key.
 *
 * Writes NOTHING to any env file. It prints the ids and the env lines to
 * set. The webhook signing secret (only returned by Stripe on create) is
 * never printed: pass `--secret-out=<path outside the repo>` and it is
 * written there with mode 0600, for the operator to move into the
 * keychain and delete.
 *
 * Run:
 *   STRIPE_SECRET_KEY=<test key> \
 *   VERCEL_PROTECTION_BYPASS=<bypass, optional> \
 *   npx tsx scripts/setup-stripe-test-mode.ts \
 *     --base-url=https://<preview host> [--secret-out=/path/outside/repo]
 *
 * Env names (D5 fixed): STRIPE_PRODUCT_UPFRONT_ID, STRIPE_PRICE_UPFRONT_ID,
 * STRIPE_PRODUCT_MONTHLY_ID, STRIPE_PRICE_MONTHLY_ID, STRIPE_WEBHOOK_SECRET,
 * STRIPE_WEBHOOK_ENDPOINT_ID. Gone: the Connect webhook pair (its route never
 * existed) and the billing-portal configuration id (nothing reads it).
 */

import { writeFileSync } from "node:fs";
import { relative, resolve } from "node:path";

import Stripe from "stripe";

import { PRICES } from "@/config/prices";
import { SITE_NAME } from "@/lib/constants";

// ── Pure data ────────────────────────────────────────────────────────────────

export type PriceRole = "self_serve_upfront" | "self_serve_monthly";

export interface PriceSpec {
  role: PriceRole;
  productName: string;
  description: string;
  lookupKey: string;
  unitAmount: number;
  currency: typeof PRICES.currency;
  recurring: { interval: "month" } | null;
  taxBehavior: "inclusive";
  envProduct: "STRIPE_PRODUCT_UPFRONT_ID" | "STRIPE_PRODUCT_MONTHLY_ID";
  envPrice: "STRIPE_PRICE_UPFRONT_ID" | "STRIPE_PRICE_MONTHLY_ID";
}

export const PRICE_SPECS: readonly PriceSpec[] = [
  {
    role: "self_serve_upfront",
    productName: `${SITE_NAME} app — upfront to age 3`,
    description: "One payment for app access until your youngest child turns 3.",
    lookupKey: "bb_ldn_self_serve_upfront",
    unitAmount: PRICES.selfServe.upfrontToAge3Pence,
    currency: PRICES.currency,
    recurring: null,
    taxBehavior: "inclusive",
    envProduct: "STRIPE_PRODUCT_UPFRONT_ID",
    envPrice: "STRIPE_PRICE_UPFRONT_ID",
  },
  {
    role: "self_serve_monthly",
    productName: `${SITE_NAME} app — monthly`,
    description: "Monthly app access.",
    lookupKey: "bb_ldn_self_serve_monthly",
    unitAmount: PRICES.selfServe.monthlyPence,
    currency: PRICES.currency,
    recurring: { interval: "month" },
    taxBehavior: "inclusive",
    envProduct: "STRIPE_PRODUCT_MONTHLY_ID",
    envPrice: "STRIPE_PRICE_MONTHLY_ID",
  },
];

/** Connect / payout cases the route still carries until 4a-i; never subscribed. */
export const CONNECT_EVENTS = [
  "account.updated",
  "account.application.deauthorized",
  "capability.updated",
  "payout.created",
  "payout.paid",
  "payout.failed",
] as const;

/** The route's non-Connect cases (pinned against `route.ts` by the test). */
export const WEBHOOK_EVENTS = [
  "checkout.session.completed",
  "customer.subscription.updated",
  "customer.subscription.deleted",
  "invoice.payment_succeeded",
  "invoice.payment_failed",
  "payment_intent.payment_failed",
  "charge.refunded",
] as const satisfies readonly Stripe.WebhookEndpointCreateParams.EnabledEvent[];

const WEBHOOK_ROLE = "main";
const ROLE_KEY = "bb_ldn_role";
const WEBHOOK_PATH = "/api/webhooks/stripe";
const BYPASS_PARAM = "x-vercel-protection-bypass";
const LIST_PAGE = 100;

// ── Guards and formatting ────────────────────────────────────────────────────

export function assertTestKey(key: string | undefined): string {
  if (!key || !(key.startsWith("sk_test_") || key.startsWith("rk_test_"))) {
    throw new Error(
      "STRIPE_SECRET_KEY must be a test key (sk_test_ or rk_test_). Live setup is not this script.",
    );
  }
  return key;
}

export function webhookUrl(baseUrl: string, bypass: string | undefined): string {
  const url = new URL(WEBHOOK_PATH, baseUrl);
  if (url.protocol !== "https:") {
    throw new Error("--base-url must be https (Stripe delivers to public https only)");
  }
  if (bypass) url.searchParams.set(BYPASS_PARAM, bypass);
  return url.toString();
}

export function redactUrl(url: string): string {
  const u = new URL(url);
  if (u.searchParams.has(BYPASS_PARAM)) u.searchParams.set(BYPASS_PARAM, "REDACTED");
  return u.toString();
}

export type CapturedIds = Record<
  PriceSpec["envProduct"] | PriceSpec["envPrice"] | "STRIPE_WEBHOOK_ENDPOINT_ID",
  string
>;

export function envLines(ids: CapturedIds): string[] {
  return [
    ...Object.entries(ids).map(([k, v]) => `${k}=${v}`),
    "STRIPE_WEBHOOK_SECRET=<from --secret-out on create; never printed>",
  ];
}

export function assertSecretOutPath(path: string, repoRoot: string): string {
  const rel = relative(resolve(repoRoot), resolve(path));
  if (!rel.startsWith("..")) {
    throw new Error("--secret-out must be outside the repository");
  }
  return path;
}

// ── Stripe operations (each takes the SDK so tests can fake it) ─────────────

export async function ensureProduct(stripe: Stripe, spec: PriceSpec): Promise<string> {
  let startingAfter: string | undefined;
  for (;;) {
    const page = await stripe.products.list({
      limit: LIST_PAGE,
      ...(startingAfter ? { starting_after: startingAfter } : {}),
    });
    const hit = page.data.find((p) => p.metadata?.[ROLE_KEY] === spec.role);
    if (hit) {
      console.log(`  = product ${spec.role}: ${hit.id}`);
      return hit.id;
    }
    if (!page.has_more || page.data.length === 0) break;
    startingAfter = page.data[page.data.length - 1].id;
  }
  const created = await stripe.products.create({
    name: spec.productName,
    description: spec.description,
    metadata: { [ROLE_KEY]: spec.role },
  });
  console.log(`  + product ${spec.role}: ${created.id}`);
  return created.id;
}

function priceMatches(p: Stripe.Price, spec: PriceSpec): boolean {
  const recurringMatches =
    spec.recurring === null
      ? p.recurring === null
      : p.recurring?.interval === spec.recurring.interval;
  return (
    p.unit_amount === spec.unitAmount &&
    p.currency === spec.currency &&
    p.tax_behavior === spec.taxBehavior &&
    recurringMatches
  );
}

export async function ensurePrice(
  stripe: Stripe,
  spec: PriceSpec,
  productId: string,
): Promise<string> {
  const existing = await stripe.prices.list({
    lookup_keys: [spec.lookupKey],
    active: true,
    limit: 1,
  });
  const current = existing.data[0];
  if (current && priceMatches(current, spec)) {
    console.log(`  = price ${spec.lookupKey}: ${current.id}`);
    return current.id;
  }
  const created = await stripe.prices.create({
    product: productId,
    unit_amount: spec.unitAmount,
    currency: spec.currency,
    tax_behavior: spec.taxBehavior,
    lookup_key: spec.lookupKey,
    transfer_lookup_key: true,
    ...(spec.recurring ? { recurring: { interval: spec.recurring.interval } } : {}),
  });
  console.log(`  + price ${spec.lookupKey}: ${created.id}`);
  return created.id;
}

export interface WebhookResult {
  id: string;
  /** Only Stripe's create response carries the signing secret. */
  secret: string | null;
  created: boolean;
}

export async function ensureWebhookEndpoint(
  stripe: Stripe,
  url: string,
): Promise<WebhookResult> {
  const list = await stripe.webhookEndpoints.list({ limit: LIST_PAGE });
  const existing = list.data.find((e) => e.metadata?.[ROLE_KEY] === WEBHOOK_ROLE);
  const enabledEvents = [...WEBHOOK_EVENTS];
  if (existing) {
    await stripe.webhookEndpoints.update(existing.id, {
      url,
      enabled_events: enabledEvents,
    });
    console.log(`  = webhook ${existing.id} → ${redactUrl(url)} (url + events refreshed)`);
    return { id: existing.id, secret: null, created: false };
  }
  const created = await stripe.webhookEndpoints.create({
    url,
    enabled_events: enabledEvents,
    description: `${SITE_NAME} London preview — main webhook`,
    metadata: { [ROLE_KEY]: WEBHOOK_ROLE },
  });
  console.log(`  + webhook ${created.id} → ${redactUrl(url)}`);
  return { id: created.id, secret: created.secret ?? null, created: true };
}

export type GbTaxOutcome =
  | { outcome: "exists"; id: string; status: string }
  | { outcome: "created"; id: string; status: string }
  | { outcome: "refused"; detail: string };

export async function ensureGbTaxRegistration(stripe: Stripe): Promise<GbTaxOutcome> {
  try {
    const regs = await stripe.tax.registrations.list({ limit: LIST_PAGE });
    const gb = regs.data.find((r) => r.country === "GB");
    if (gb) return { outcome: "exists", id: gb.id, status: gb.status };
    const created = await stripe.tax.registrations.create({
      country: "GB",
      country_options: { gb: { type: "standard" } },
      active_from: "now",
    });
    return { outcome: "created", id: created.id, status: created.status };
  } catch (err) {
    return { outcome: "refused", detail: err instanceof Error ? err.message : String(err) };
  }
}

// ── Entry point ──────────────────────────────────────────────────────────────

function parseArgs(argv: string[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const a of argv) {
    const m = a.match(/^--([^=]+)=(.*)$/);
    if (m) out[m[1]] = m[2];
  }
  return out;
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const key = assertTestKey(process.env.STRIPE_SECRET_KEY);
  const baseUrl = args["base-url"];
  if (!baseUrl) throw new Error("--base-url=https://<preview host> is required");
  const secretOut = args["secret-out"]
    ? assertSecretOutPath(args["secret-out"], resolve(__dirname, "..", ".."))
    : undefined;
  const url = webhookUrl(baseUrl, process.env.VERCEL_PROTECTION_BYPASS);

  const stripe = new Stripe(key);
  const account = await stripe.accounts.retrieve(null);
  console.log(`Stripe test-mode setup — account country ${account.country}`);

  const ids: Partial<CapturedIds> = {};
  for (const spec of PRICE_SPECS) {
    const productId = await ensureProduct(stripe, spec);
    ids[spec.envProduct] = productId;
    ids[spec.envPrice] = await ensurePrice(stripe, spec, productId);
  }
  const hook = await ensureWebhookEndpoint(stripe, url);
  ids.STRIPE_WEBHOOK_ENDPOINT_ID = hook.id;

  if (hook.secret && secretOut) {
    writeFileSync(secretOut, hook.secret, { mode: 0o600 });
    console.log("  signing secret written to --secret-out (mode 0600); move it and delete the file");
  } else if (hook.created) {
    console.warn("  ! endpoint created without --secret-out: roll its secret in the dashboard");
  }

  const tax = await ensureGbTaxRegistration(stripe);
  console.log(`  GB tax registration: ${JSON.stringify(tax)}`);

  console.log("\nEnv lines to set (this script writes none):");
  for (const line of envLines(ids as CapturedIds)) console.log(`  ${line}`);
}

const isDirectRun =
  process.argv[1] !== undefined && resolve(process.argv[1]) === resolve(__filename);
if (isDirectRun) {
  main().catch((err) => {
    console.error("\nFAILED:", err instanceof Error ? err.message : err);
    process.exit(1);
  });
}
