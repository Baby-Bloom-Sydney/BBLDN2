"use server";

/**
 * Cancel a sent invoice (plan 06 §14.6 b4.3; old step 13; brief §0.8, §3 nanny 8–9; R15, R16). A sent invoice is
 * never edited: she cancels it, with a reason, and may send a corrected one ("Replaces …").
 *
 * Contract:
 * - The switch first (off → `invoices_disabled`, before the session or any read); then her proof from the request's
 *   session (`proveNanny`; none → `signed_out`). The input is `{ invoiceId, reason }`, the reason one of
 *   `CANCEL_REASONS`; anything else is ignored.
 * - **Her own sent invoice only:** `not_found` when there's none of hers; `not_cancellable` when it isn't sent (or
 *   stopped being sent in between: the update is conditional on `sent`). The row moves sent → cancelled with the
 *   reason and the time; its number stays used.
 * - Both cancellation emails go to the addresses the invoice was sent to (its snapshot, never an input): the
 *   family's first (reply-to her), then hers saying whether it reached them; both deliveries are recorded (R15), so
 *   her list can offer "Resend cancellation". A failed email or record never undoes the cancel.
 *
 * Only this async function is exported: every async export of a `"use server"` file is callable from a browser.
 *
 * BB-wave1-041126/06b4, 2026-11-12.
 */

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { nannyInvoicesEnabled } from "@/lib/features/flags";
import { sendCancellationEmails } from "../emails/send-invoice-emails";
import { proveNanny } from "../nanny-proof";
import { cancelSentInvoice, readSentInvoice, recordCancelDelivery } from "../store-delivery";
import { CANCEL_REASONS } from "../types";
import { invoiceRefusal, type CancelInvoiceResult } from "./invoice-messages";

const INVOICES_PATH = "/nanny/invoices";
const cancelInput = z.object({ invoiceId: z.guid(), reason: z.enum(CANCEL_REASONS) });

export async function cancelInvoice(input: unknown): Promise<CancelInvoiceResult> {
  if (!nannyInvoicesEnabled()) return invoiceRefusal("invoices_disabled");
  const proof = await proveNanny();
  if (!proof) return invoiceRefusal("signed_out");
  const parsed = cancelInput.safeParse(input);
  if (!parsed.success) return invoiceRefusal("invalid");
  const { invoiceId, reason } = parsed.data;
  const invoice = await readSentInvoice(proof, invoiceId);
  if (!invoice.ok) return invoiceRefusal(invoice.error);
  if (invoice.value.status !== "sent") return invoiceRefusal("not_cancellable");
  const cancelled = await cancelSentInvoice(proof, invoiceId, reason, new Date());
  if (!cancelled.ok) return invoiceRefusal(cancelled.error);
  const sent = invoice.value;
  const delivery = await sendCancellationEmails({ ...sent, reason }, { ...sent, nannyUserId: proof.userId });
  await recordCancelDelivery(proof, invoiceId, delivery); // a failure is logged by code; the cancel stands
  revalidatePath(INVOICES_PATH);
  return { ok: true, invoiceId, number: sent.number, delivery };
}
