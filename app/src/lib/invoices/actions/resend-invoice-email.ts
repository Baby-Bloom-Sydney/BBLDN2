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
 * - Security review (2026-11-12):
 *   - M1: only a `failed` email goes again — never one whose delivery isn't recorded yet. An invoice email is
 *     **claimed** before it is sent (`claimInvoiceResend`): of two resends at once one wins and the other answers
 *     `too_soon`, as does a second within a minute. A cancellation has no attempt time to claim with (no SQL change
 *     here), so two resends at the very same moment can still both send it.
 *   - L1: a suspended or deactivated nanny is refused (`nanny_inactive`).
 *   - L2: when the family no longer has an account, their email is skipped and answered `failed` (nothing claimed or
 *     written; it was failed already).
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
  skippedFamilyEmail,
  type InvoiceAddresses,
} from "../emails/send-invoice-emails";
import { proveNanny, type NannyProof } from "../nanny-proof";
import {
  claimInvoiceResend,
  downloadInvoicePdf,
  familyHasAccount,
  readInvoiceToChange,
  recordResend,
  type ResendTarget,
  type SentInvoice,
} from "../store-delivery";
import { invoiceOk, type EmailDelivery, type InvoiceResult } from "../types";
import { invoiceRefusal, type ResendInvoiceEmailResult } from "./invoice-messages";

const INVOICES_PATH = "/nanny/invoices";
const resendInput = z.object({
  invoiceId: z.guid(),
  what: z.enum(["invoice", "cancellation"]),
  recipient: z.enum(["family", "nanny"]),
});

/** What a resend did, and the claim its record must match (an invoice email's; none for a cancellation). */
interface SentAgain {
  readonly delivery: EmailDelivery;
  readonly claim: string | null;
}

/** Whether that email can go again: the right state, and recorded as `failed` (M1: never a delivery not yet recorded). */
function resendable(sent: SentInvoice, target: ResendTarget): boolean {
  const d = sent.delivery;
  const family = target.recipient === "family";
  if (target.what === "invoice") return sent.status === "sent" && (family ? d.family : d.nanny) === "failed";
  return sent.status === "cancelled" && sent.cancelReason !== null && (family ? d.cancelFamily : d.cancelNanny) === "failed";
}

/** The invoice email again: claimed first (M1), then the stored PDF, the same number. */
async function invoiceAgain(
  proof: NannyProof,
  sent: SentInvoice,
  to: InvoiceAddresses,
  recipient: ResendTarget["recipient"],
): Promise<InvoiceResult<SentAgain>> {
  const claim = await claimInvoiceResend(proof, sent.invoiceId, recipient, new Date());
  if (!claim.ok) return claim;
  const stored = await downloadInvoicePdf(proof, sent);
  if (!stored.ok) return stored;
  const pdf = { filename: `${sent.number}.pdf`, content: stored.value };
  const delivery = recipient === "family"
    ? await familyInvoiceEmail(sent, to, pdf)
    : await nannyInvoiceCopy(sent, to, pdf, sent.delivery.family ?? "failed");
  return invoiceOk({ delivery, claim: claim.value });
}

/** The cancellation again (no PDF). */
async function cancellationAgain(sent: SentInvoice, to: InvoiceAddresses, recipient: ResendTarget["recipient"]): Promise<SentAgain> {
  const facts = { ...sent, reason: sent.cancelReason ?? "other" }; // never null here: `resendable` checked it
  const delivery = recipient === "family"
    ? await familyCancellation(facts, to)
    : await nannyCancellation(facts, to, sent.delivery.cancelFamily ?? "failed");
  return { delivery, claim: null };
}

/** The family's email can't go when they no longer have an account (L2): `false`, or a refusal when it can't be read. */
async function familyGone(proof: NannyProof, sent: SentInvoice, target: ResendTarget): Promise<InvoiceResult<boolean>> {
  if (target.recipient !== "family") return invoiceOk(false);
  const account = await familyHasAccount(proof, sent.parentUserId);
  return account.ok ? invoiceOk(!account.value) : account;
}

export async function resendInvoiceEmail(input: unknown): Promise<ResendInvoiceEmailResult> {
  if (!nannyInvoicesEnabled()) return invoiceRefusal("invoices_disabled");
  const proof = await proveNanny();
  if (!proof) return invoiceRefusal("signed_out");
  const parsed = resendInput.safeParse(input);
  if (!parsed.success) return invoiceRefusal("invalid");
  const { invoiceId, what, recipient } = parsed.data;
  const invoice = await readInvoiceToChange(proof, invoiceId);
  if (!invoice.ok) return invoiceRefusal(invoice.error);
  const sent = invoice.value;
  if (!resendable(sent, { what, recipient })) return invoiceRefusal("not_resendable");
  const gone = await familyGone(proof, sent, { what, recipient });
  if (!gone.ok) return invoiceRefusal(gone.error);
  if (gone.value) return { ok: true, invoiceId, what, recipient, delivery: skippedFamilyEmail() };
  const to = { ...sent, nannyUserId: proof.userId };
  const again = what === "invoice" ? await invoiceAgain(proof, sent, to, recipient) : invoiceOk(await cancellationAgain(sent, to, recipient));
  if (!again.ok) return invoiceRefusal(again.error);
  await recordResend(proof, invoiceId, { what, recipient }, again.value.delivery, new Date(), again.value.claim); // logged by code on a failure
  revalidatePath(INVOICES_PATH);
  return { ok: true, invoiceId, what, recipient, delivery: again.value.delivery };
}
