/**
 * Diagnostic — what London's test-mode Stripe setup looks like (LDN2 unit 4f).
 * Read-only; creates nothing. Refuses a non-test key.
 *
 * Reports: the account, the GB Stripe Tax registration (M-1 1c — reported,
 * never a failure: the live UK account comes with the company), the webhook
 * endpoints, and London's products/prices (metadata `bb_ldn_role`).
 *
 * Run: `STRIPE_SECRET_KEY=<test key> npx tsx scripts/check-stripe-status.ts`
 */

import { resolve } from "node:path";

import Stripe from "stripe";

import { assertTestKey } from "./setup-stripe-test-mode";

const ROLE_KEY = "bb_ldn_role";
const LIST_PAGE = 100;
const MINOR_UNITS = 100;

export type GbTaxState =
  | { state: "registered"; id: string; status: string }
  | { state: "absent" }
  | { state: "error"; detail: string };

export async function gbTaxReport(stripe: Stripe): Promise<GbTaxState> {
  try {
    const regs = await stripe.tax.registrations.list({ limit: LIST_PAGE });
    const gb = regs.data.find((r) => r.country === "GB");
    return gb ? { state: "registered", id: gb.id, status: gb.status } : { state: "absent" };
  } catch (err) {
    return { state: "error", detail: err instanceof Error ? err.message : String(err) };
  }
}

async function main(): Promise<void> {
  const stripe = new Stripe(assertTestKey(process.env.STRIPE_SECRET_KEY));

  const account = await stripe.accounts.retrieve(null);
  console.log("Stripe status (test mode)");
  console.log(`  account country: ${account.country} · default currency: ${account.default_currency}`);
  console.log(`  charges enabled: ${account.charges_enabled}`);

  const tax = await gbTaxReport(stripe);
  console.log(`\nSTRIPE TAX — GB: ${JSON.stringify(tax)}`);

  const hooks = await stripe.webhookEndpoints.list({ limit: LIST_PAGE });
  console.log(`\nWEBHOOK ENDPOINTS (${hooks.data.length})`);
  for (const h of hooks.data) {
    const host = new URL(h.url).host;
    const role = h.metadata?.[ROLE_KEY] ?? "-";
    console.log(`  ${h.id} ${host} role=${role} events=${h.enabled_events.length} status=${h.status}`);
  }

  const products = await stripe.products.list({ active: true, limit: LIST_PAGE });
  const london = products.data.filter((p) => p.metadata?.[ROLE_KEY]);
  console.log(`\nLONDON PRODUCTS (${london.length})`);
  for (const p of london) {
    const prices = await stripe.prices.list({ product: p.id, active: true });
    console.log(`  ${p.metadata[ROLE_KEY]} ${p.id}`);
    for (const pr of prices.data) {
      const amount = ((pr.unit_amount ?? 0) / MINOR_UNITS).toFixed(2);
      const every = pr.recurring ? `/${pr.recurring.interval}` : " one-time";
      console.log(
        `    ${pr.id} ${pr.currency.toUpperCase()} ${amount}${every} tax=${pr.tax_behavior} key=${pr.lookup_key ?? "-"}`,
      );
    }
  }
}

const isDirectRun =
  process.argv[1] !== undefined && resolve(process.argv[1]) === resolve(__filename);
if (isDirectRun) {
  main().catch((err) => {
    console.error("FAILED:", err instanceof Error ? err.message : err);
    process.exit(1);
  });
}
