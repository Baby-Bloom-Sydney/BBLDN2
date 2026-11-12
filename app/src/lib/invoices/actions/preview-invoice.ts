"use server";

/**
 * The review step of a new invoice (plan 06 §14.6 b4.2; old step 12; brief §3 nanny 6, §0a A, C). It writes nothing.
 *
 * Contract:
 * - The switch first (off → `invoices_disabled`, before the session or any read); then her proof from the request's
 *   session (`proveNanny`, never an id from the client; none → `signed_out`).
 * - The draft — `{ kind, targetId, periodStart, lines, replacesInvoiceId }` — is parsed with the shared schema
 *   (`validation-lines.ts`); a refusal names each field by path ("lines.2.hours") with its plain message. Anything
 *   else the client sends (an id, a total, an address) is ignored.
 * - The figures are the server's (`review.ts`: `totals.ts` with her VAT setting), never the client's.
 * - It answers the family (name, the email masked to its local part, area), who she is on the invoice (read-only;
 *   "Change in Settings"), her bank details masked, `needsPaymentDetails` / `needsAddress` for the first-invoice
 *   setup (with her home address row's version for its save), the duplicate warning, the invoice a correction
 *   replaces, and — to send back with `sendInvoice` — a fresh invoice id, the server's total and the review key.
 *
 * Only this async function is exported: every async export of a `"use server"` file is callable from a browser.
 *
 * BB-wave1-041126/06b4, 2026-11-12.
 */

import { nannyInvoicesEnabled } from "@/lib/features/flags";
import { readOwnHome } from "@/lib/settings/home-address";
import { createClient } from "@/lib/supabase/server";
import { proveNanny, type NannyProof } from "../nanny-proof";
import { newInvoiceId, readReview, type ReviewFacts } from "../review";
import { invoiceDraftSchema } from "../validation-lines";
import { draftRefusal, invoiceRefusal, type InvoicePreview, type PreviewInvoiceResult } from "./invoice-messages";

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/** Her home address row's version, read with her own session, for the setup's address save; undefined if unreadable. */
async function homeVersion(proof: NannyProof): Promise<string | null | undefined> {
  const own = await readOwnHome(createClient(), proof.userId);
  return own === null ? undefined : own.updatedAt;
}

function previewOf(invoiceId: string, facts: ReviewFacts, addressVersion: string | null): InvoicePreview {
  const { businessUpdatedAt: _version, ...issuer } = facts.issuer;
  const { target, masks, totals } = facts;
  return {
    invoiceId,
    reviewKey: facts.key,
    expectedTotalPence: totals.totalPence,
    totals,
    vat: { mode: issuer.vat.mode, rateBp: issuer.vat.rateBp },
    recipient: { familyName: target.familyName, emailHint: target.familyEmailHint, area: target.area },
    issuer,
    bank: masks === null ? null : { accountName: masks.accountName, sortCodeLast2: masks.sortCodeLast2, accountLast4: masks.accountLast4 },
    needsPaymentDetails: masks === null,
    needsAddress: issuer.address === null,
    addressVersion,
    duplicates: facts.duplicates,
    replaces: facts.replaces,
  };
}

export async function previewInvoice(input: unknown): Promise<PreviewInvoiceResult> {
  if (!nannyInvoicesEnabled()) return invoiceRefusal("invoices_disabled");
  const proof = await proveNanny();
  if (!proof) return invoiceRefusal("signed_out");
  if (!isRecord(input)) return invoiceRefusal("invalid");
  const now = new Date();
  const draft = invoiceDraftSchema(now).safeParse({ ...input, invoiceId: newInvoiceId() });
  if (!draft.success) return draftRefusal(draft.error);
  const facts = await readReview(proof, draft.data, now);
  if (!facts.ok) return invoiceRefusal(facts.error);
  const version = facts.value.issuer.address === null ? await homeVersion(proof) : null;
  if (version === undefined) return invoiceRefusal("error");
  return { ok: true, preview: previewOf(draft.data.invoiceId, facts.value, version) };
}
