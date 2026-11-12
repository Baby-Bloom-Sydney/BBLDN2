"use server";

/**
 * Resend one email of a sent or cancelled invoice (plan 06 §14.6 b4.3; old step 13; brief §0.9, §9.12; R15): "Resend
 * email" when the family's (or her copy) wasn't delivered, "Resend cancellation" when a cancellation wasn't.
 *
 * Contract:
 * - The switch first (off → `invoices_disabled`, before the session or any read); then her proof from the request's
 *   session (`proveNanny`; none → `signed_out`). The input is `{ invoiceId, what: "invoice" | "cancellation",
 *   recipient: "family" | "nanny" }`; anything else is ignored.
 * - **Her own invoice only** (`not_found` otherwise), and only for a recipient whose email of that kind isn't `sent`:
 *   the invoice email on a sent invoice, the cancellation on a cancelled one. Anything else → `not_resendable`.
 * - The invoice email is sent again with **the stored PDF** — the same file and number the family was first sent —
 *   to the invoice's snapshot address; her copy says whether the family's has arrived. A cancellation carries no
 *   PDF.
 * - The outcome is recorded on the row while that email is still undelivered; a resend that fails again answers
 *   `delivery: "failed"` (not a refusal), and the list keeps offering Resend.
 *
 * Only this async function is exported: every async export of a `"use server"` file is callable from a browser.
 *
 * BB-wave1-041126/06b4, 2026-11-12.
 */

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { nannyInvoicesEnabled } from "@/lib/features/flags";
import {
  familyCancellation,
  familyInvoiceEmail,
  nannyCancellation,
  nannyInvoiceCopy,
  type InvoiceAddresses,
} from "../emails/send-invoice-emails";
import { proveNanny, type NannyProof } from "../nanny-proof";
import { downloadInvoicePdf, readSentInvoice, recordResend, type ResendTarget, type SentInvoice } from "../store-delivery";
import { invoiceOk, type EmailDelivery, type InvoiceResult } from "../types";
import { invoiceRefusal, type ResendInvoiceEmailResult } from "./invoice-messages";

const INVOICES_PATH = "/nanny/invoices";
const resendInput = z.object({
  invoiceId: z.guid(),
  what: z.enum(["invoice", "cancellation"]),
  recipient: z.enum(["family", "nanny"]),
});

/** Whether that email can go again: the right state, and not yet delivered. */
function resendable(sent: SentInvoice, target: ResendTarget): boolean {
  const d = sent.delivery;
  if (target.what === "invoice") return sent.status === "sent" && (target.recipient === "family" ? d.family : d.nanny) !== "sent";
  const cancellation = target.recipient === "family" ? d.cancelFamily : d.cancelNanny;
  return sent.status === "cancelled" && sent.cancelReason !== null && cancellation !== "sent";
}

/** The invoice email again, with the stored PDF. */
async function invoiceAgain(proof: NannyProof, sent: SentInvoice, to: InvoiceAddresses, recipient: ResendTarget["recipient"]): Promise<InvoiceResult<EmailDelivery>> {
  const stored = await downloadInvoicePdf(proof, sent);
  if (!stored.ok) return stored;
  const pdf = { filename: `${sent.number}.pdf`, content: stored.value };
  return invoiceOk(recipient === "family"
    ? await familyInvoiceEmail(sent, to, pdf)
    : await nannyInvoiceCopy(sent, to, pdf, sent.delivery.family ?? "failed"));
}

/** The cancellation again (no PDF). */
async function cancellationAgain(sent: SentInvoice, to: InvoiceAddresses, recipient: ResendTarget["recipient"]): Promise<EmailDelivery> {
  const facts = { ...sent, reason: sent.cancelReason ?? "other" }; // never null here: `resendable` checked it
  return recipient === "family" ? familyCancellation(facts, to) : nannyCancellation(facts, to, sent.delivery.cancelFamily ?? "failed");
}

export async function resendInvoiceEmail(input: unknown): Promise<ResendInvoiceEmailResult> {
  if (!nannyInvoicesEnabled()) return invoiceRefusal("invoices_disabled");
  const proof = await proveNanny();
  if (!proof) return invoiceRefusal("signed_out");
  const parsed = resendInput.safeParse(input);
  if (!parsed.success) return invoiceRefusal("invalid");
  const { invoiceId, what, recipient } = parsed.data;
  const invoice = await readSentInvoice(proof, invoiceId);
  if (!invoice.ok) return invoiceRefusal(invoice.error);
  if (!resendable(invoice.value, { what, recipient })) return invoiceRefusal("not_resendable");
  const to = { ...invoice.value, nannyUserId: proof.userId };
  const delivery = what === "invoice"
    ? await invoiceAgain(proof, invoice.value, to, recipient)
    : invoiceOk(await cancellationAgain(invoice.value, to, recipient));
  if (!delivery.ok) return invoiceRefusal(delivery.error);
  await recordResend(proof, invoiceId, { what, recipient }, delivery.value, new Date()); // logged by code on a failure
  revalidatePath(INVOICES_PATH);
  return { ok: true, invoiceId, what, recipient, delivery: delivery.value };
}
