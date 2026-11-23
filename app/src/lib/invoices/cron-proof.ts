/**
 * The cron proof (plan 06 §16.7 b5.2; §16.4 "Cron auth"). The Friday invoice reminder's runner takes one as its first
 * parameter, so the only way to run it is through a request that carried the cron secret.
 *
 * - Made only by `proveInvoiceCron(authorization)`, from the request's `Authorization` header, and only while the
 *   switch is on. It must read exactly `Bearer $CRON_SECRET`; a missing, empty or blank `CRON_SECRET` refuses every
 *   header (fails closed, the call-reminders route's rule). Compared in constant time, on digests of equal length.
 * - The `nanny-proof.ts` shape: branded at the type level (the brand symbol isn't exported) and at run time
 *   (`isInvoiceCronProof` accepts only an object made here, in this process; a look-alike, a copy or a cast is
 *   refused), and refused `PROOF_LIFETIME_MS` after it was made, so a proof kept by mistake can't run a later pass.
 * - Reads no database and carries nothing but its kind.
 *
 * BB-wave1-041126/06b5-app, 2026-11-23.
 */

import { createHash, timingSafeEqual } from "node:crypto";
import { nannyInvoicesEnabled } from "@/lib/features/flags";

declare const INVOICE_CRON_PROOF: unique symbol;

export type InvoiceCronProof = {
  readonly kind: "invoice_cron_proof";
  readonly [INVOICE_CRON_PROOF]: true;
};

/** Longer than the cron route's `maxDuration` (60 s), so one run never outlives its proof. */
const PROOF_LIFETIME_MS = 120_000;
const issuedAt = new WeakMap<object, number>();

const digest = (value: string): Buffer => createHash("sha256").update(value, "utf8").digest();

/** Whether the header is exactly `Bearer <secret>`, compared without a timing difference. */
function bearerMatches(authorization: string, secret: string): boolean {
  return timingSafeEqual(digest(authorization), digest(`Bearer ${secret}`));
}

/** A proof for a request that carried the cron secret; null when the switch is off, the secret unset or the header wrong. */
export function proveInvoiceCron(authorization: string | null | undefined): InvoiceCronProof | null {
  if (!nannyInvoicesEnabled()) return null;
  const secret = process.env.CRON_SECRET;
  if (typeof secret !== "string" || secret.trim() === "") return null;
  if (typeof authorization !== "string" || !bearerMatches(authorization, secret)) return null;
  const proof = Object.freeze({ kind: "invoice_cron_proof" }) as InvoiceCronProof;
  issuedAt.set(proof, Date.now());
  return proof;
}

export function isInvoiceCronProof(value: unknown): value is InvoiceCronProof {
  if (typeof value !== "object" || value === null) return false;
  const at = issuedAt.get(value);
  return at !== undefined && Date.now() - at < PROOF_LIFETIME_MS;
}
