/**
 * Her business details in the store (plan 06 §14.4, b2.4): who she is on her invoices. With `store.ts`, the only
 * modules that touch amendment 21's tables. Server-only, and deliberately NOT a `"use server"` file (every async
 * export of one becomes a browser-callable action).
 *
 * - `readIssuer`: her effective issuer from `nanny_invoice_issuer` — her business details, or the defaults that
 *   function holds in one place (a sole trader, her full name, her verification address, not VAT registered). It
 *   returns no bank field, so Settings and the review can show it as it is.
 * - `saveBusiness`: her details parsed again here (`validation-business.ts`), then `nanny_business_details_save`,
 *   which takes her lock, refuses a suspended or deactivated nanny and logs a CHECK by constraint name only. Changes
 *   apply to future invoices only: a created invoice keeps its own snapshot.
 * - The switch first (`invoices_disabled`, before a client is made), then her proof; the nanny id is the proof's.
 *   Failures are logged by code only (`db.ts`).
 *
 * BB-wave1-041126/06b2-build, 2026-11-06.
 */

import { callRpc, LOCK_TIMEOUT, logFailure, serviceClient, type DbResult } from "./db";
import { nannyGate } from "./gate";
import type { NannyProof } from "./nanny-proof";
import { refusalReply } from "./store-map";
import { businessSavedReply, issuerReply, type Issuer } from "./store-map-lines";
import { FAILED, INVALID, invoiceOk, refused, type InvoiceResult } from "./types";
import { businessDetailsSchema } from "./validation-business";

export type { Issuer } from "./store-map-lines";

/** Who she is on her invoices now, defaults included; never a bank field. A missing nanny row is an error. */
export async function readIssuer(proof: NannyProof): Promise<InvoiceResult<Issuer>> {
  const gate = nannyGate(proof);
  if (gate) return gate;
  const admin = serviceClient();
  if (!admin) return FAILED;
  const reply = await callRpc(admin, "nanny_invoice_issuer", { p_nanny: proof.nannyId });
  if (!reply.ok) return FAILED;
  const parsed = issuerReply.safeParse(reply.value);
  if (parsed.success) return invoiceOk(parsed.data);
  logFailure("nanny_invoice_issuer", { code: "unexpected_reply" });
  return FAILED;
}

function savedOrRefused(reply: DbResult<unknown>): InvoiceResult<{ readonly changed: boolean }> {
  if (!reply.ok) return reply.code === LOCK_TIMEOUT ? refused("busy") : FAILED;
  const saved = businessSavedReply.safeParse(reply.value);
  if (saved.success) return invoiceOk(saved.data);
  const no = refusalReply.safeParse(reply.value);
  if (no.success) return refused(no.data.status);
  logFailure("nanny_business_details_save", { code: "unexpected_reply" });
  return FAILED;
}

/** Save or replace her business details (parsed again here); the reply says whether anything changed. */
export async function saveBusiness(proof: NannyProof, input: unknown): Promise<InvoiceResult<{ readonly changed: boolean }>> {
  const gate = nannyGate(proof);
  if (gate) return gate;
  const parsed = businessDetailsSchema.safeParse(input);
  if (!parsed.success) return INVALID;
  const admin = serviceClient();
  if (!admin) return FAILED;
  const d = parsed.data;
  const reply = await callRpc(admin, "nanny_business_details_save", {
    p_nanny: proof.nannyId,
    p_business_type: d.businessType,
    p_trading_name: d.tradingName,
    p_business_address: d.businessAddress,
    p_company_name: d.companyName,
    p_company_number: d.companyNumber,
    p_registered_office: d.registeredOffice,
    p_partnership_name: d.partnershipName,
    p_vat_mode: d.vatMode,
    p_vat_number: d.vatNumber,
    p_vat_rate_bp: d.vatRateBp,
  });
  return savedOrRefused(reply);
}
