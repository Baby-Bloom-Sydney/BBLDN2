"use server";

/**
 * Send a reviewed invoice (plan 06 §14.6 b4.2; old step 12; brief §0.5, §3 nanny 7; R1, R16, R20; 06a handoff).
 *
 * Contract:
 * - The switch first (off → `invoices_disabled`, before the session or any read); then her proof from the request's
 *   session (`proveNanny`; none → `signed_out`). The nanny is always the proof's.
 * - The input is what the review gave plus the draft: `{ invoiceId, kind, targetId, periodStart, lines,
 *   replacesInvoiceId, expectedTotalPence, reviewKey }`. Anything else (an address, a figure) is ignored.
 * - **Checked before anything is created** (`review.ts`): her bank details and a printable address are there
 *   (`no_details` / `no_address` → the setup), and what she reviewed — her issuer, VAT, the account, every figure —
 *   is still what the server works out (`changed` → the review again, "Your business settings changed — check the
 *   invoice again"). The database checks the total once more, under her lock.
 * - **In order** (06a handoff): create (the next number, the family and the recipients' addresses from her own
 *   placement or trial connection — never from the client; the cap, the correction rules) → the PDF from the created
 *   row and her full bank details → stored → the family's email (PDF attached, reply-to her) → her copy (after the
 *   family's result, R16) → finished as sent with both deliveries.
 * - **R1, never deleted:** a PDF that can't be made or stored finishes the row as failed and no email goes; its
 *   number stays used. The same invoice id again is never a second send (`in_progress`, `already_done`,
 *   `already_failed` — the last means review again for a new id). A finish that fails is tried once more; if it
 *   still fails after the emails went, `not_recorded` says so.
 * - A family email that failed is not a refusal: the result says `delivery.family: "failed"` and her list offers
 *   Resend. The page sets `maxDuration = 30` (render, upload, two emails).
 *
 * Only this async function is exported: every async export of a `"use server"` file is callable from a browser.
 *
 * BB-wave1-041126/06b4, 2026-11-12.
 */

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { nannyInvoicesEnabled } from "@/lib/features/flags";
import type { InvoiceEmailFacts } from "../emails/invoice-wording";
import { sendInvoiceEmails } from "../emails/send-invoice-emails";
import { proveNanny, type NannyProof } from "../nanny-proof";
import { invoicePdfData } from "../pdf/model";
import { renderInvoicePdf } from "../pdf/render";
import { checkSend } from "../review";
import { createInvoice, finishInvoice, type CreatedInvoice, type FinishOutcome, type StoredPaymentDetails } from "../store";
import { uploadInvoicePdf } from "../store-delivery";
import type { InvoiceResult } from "../types";
import { invoiceDraftSchema } from "../validation-lines";
import { draftRefusal, invoiceRefusal, type InvoiceDeliveries, type SendInvoiceResult } from "./invoice-messages";

const INVOICES_PATH = "/nanny/invoices";
/** A Postgres integer: a total beyond it can't be an invoice's. */
const MAX_TOTAL_PENCE = 2_147_483_647;
const sealed = z.object({
  expectedTotalPence: z.number().int().positive().max(MAX_TOTAL_PENCE),
  reviewKey: z.string().regex(/^[0-9a-f]{64}$/),
});

const emailFacts = (c: CreatedInvoice): InvoiceEmailFacts => ({
  number: c.number,
  kind: c.kind,
  periodStart: c.periodStart,
  nannyName: c.nannyName,
  familyName: c.familyName,
  figures: { hours: c.hours, expensesPence: c.expensesPence, totalPence: c.totalPence, vatMode: c.vat.mode },
  replacesNumber: c.replacesNumber,
});

/** The PDF from the created row and her full details, stored in the bucket. */
async function storedPdf(proof: NannyProof, created: CreatedInvoice, details: StoredPaymentDetails): Promise<InvoiceResult<Buffer>> {
  const data = invoicePdfData(created, details);
  if (!data.ok) return data;
  const rendered = await renderInvoicePdf(data.value);
  if (!rendered.ok) return rendered;
  const stored = await uploadInvoicePdf(proof, created, rendered.value);
  return stored.ok ? rendered : stored;
}

/** Finished as sent, tried once more on a failure; a retry that finds it no longer sending means the first landed. */
async function finishedAsSent(proof: NannyProof, invoiceId: string, delivery: InvoiceDeliveries): Promise<boolean> {
  const outcome: FinishOutcome = { kind: "sent", family: delivery.family, nanny: delivery.nanny };
  if ((await finishInvoice(proof, invoiceId, outcome)).ok) return true;
  const retry = await finishInvoice(proof, invoiceId, outcome);
  return retry.ok || retry.error === "not_sending";
}

/** Everything after create: the PDF, the two emails, the finish. */
async function deliverCreated(proof: NannyProof, created: CreatedInvoice, details: StoredPaymentDetails): Promise<SendInvoiceResult> {
  const pdf = await storedPdf(proof, created, details);
  if (!pdf.ok) {
    await finishInvoice(proof, created.invoiceId, { kind: "failed" });
    return invoiceRefusal(pdf.error === "no_details" ? "no_details" : "error");
  }
  const delivery = await sendInvoiceEmails(
    emailFacts(created),
    { familyEmail: created.familyEmail, nannyEmail: created.nannyEmail, parentUserId: created.parentUserId, nannyUserId: proof.userId },
    { filename: `${created.number}.pdf`, content: pdf.value },
  );
  if (!(await finishedAsSent(proof, created.invoiceId, delivery))) return invoiceRefusal("not_recorded");
  return { ok: true, invoiceId: created.invoiceId, number: created.number, delivery };
}

export async function sendInvoice(input: unknown): Promise<SendInvoiceResult> {
  if (!nannyInvoicesEnabled()) return invoiceRefusal("invoices_disabled");
  const proof = await proveNanny();
  if (!proof) return invoiceRefusal("signed_out");
  const reviewed = sealed.safeParse(input);
  if (!reviewed.success) return invoiceRefusal("invalid");
  const now = new Date();
  const draft = invoiceDraftSchema(now).safeParse(input);
  if (!draft.success) return draftRefusal(draft.error);
  const { expectedTotalPence, reviewKey } = reviewed.data;
  const checked = await checkSend(proof, draft.data, { totalPence: expectedTotalPence, reviewKey });
  if (!checked.ok) return invoiceRefusal(checked.error);
  const created = await createInvoice(proof, draft.data, checked.value.details.accountLast4, expectedTotalPence, now);
  if (!created.ok) return invoiceRefusal(created.error);
  const result = await deliverCreated(proof, created.value, checked.value.details);
  revalidatePath(INVOICES_PATH);
  return result;
}
