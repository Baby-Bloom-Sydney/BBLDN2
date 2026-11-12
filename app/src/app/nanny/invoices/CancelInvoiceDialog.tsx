"use client";

/**
 * Cancel a sent invoice (plan 06 old step 13–14, §14.6 b4.4; brief §0.8, §3 nanny 8–9): she picks the reason ("Wrong
 * hours", "Wrong rate", "Wrong week or date", "Wrong family", "Other") and confirms. A sent invoice is never edited;
 * the number stays used, and both sides get the cancellation email (the action's job).
 *
 * - "Cancel invoice" waits for a reason; "Back" closes without cancelling.
 * - One request at a time (a ref, not state alone: React 18 batches); the dialog can't close while it runs.
 * - A refusal stays in the dialog with its plain message; an action that throws (offline, a new deploy) says
 *   "Something went wrong. Please try again." Done: the dialog closes and the list refreshes.
 *
 * BB-wave1-041126/06b4, 2026-11-12.
 */

import { useId, useRef, useState } from "react";
import { Loader2 } from "lucide-react";
import { EditNotice } from "@/components/settings/EditNotice";
import { RadioChoice, RadioGroupFieldset } from "@/components/settings/SettingsFields";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { cancelInvoice } from "@/lib/invoices/actions/cancel-invoice";
import { INVOICE_ACTION_MESSAGES } from "@/lib/invoices/actions/invoice-messages";
import { CANCEL_REASON_LABELS } from "@/lib/invoices/emails/invoice-wording";
import { CANCEL_REASONS, type CancelReason } from "@/lib/invoices/types";

export interface CancelTarget {
  readonly invoiceId: string;
  readonly number: string;
  readonly familyName: string;
}

export interface CancelInvoiceDialogProps {
  /** The invoice to cancel; null = closed. */
  readonly target: CancelTarget | null;
  readonly onClose: () => void;
  /** Cancelled: the page refreshes its list. */
  readonly onCancelled: () => void;
}

export function CancelInvoiceDialog({ target, onClose, onCancelled }: CancelInvoiceDialogProps) {
  const id = useId();
  const [reason, setReason] = useState<CancelReason | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const inFlight = useRef(false);

  const close = () => {
    if (inFlight.current) return;
    setReason(null);
    setMessage(null);
    onClose();
  };

  const confirm = async () => {
    if (target === null || reason === null || inFlight.current) return;
    inFlight.current = true;
    setPending(true);
    setMessage(null);
    let done = false;
    try {
      const result = await cancelInvoice({ invoiceId: target.invoiceId, reason });
      if (result.ok) done = true;
      else setMessage(result.message);
    } catch {
      setMessage(INVOICE_ACTION_MESSAGES.error);
    }
    inFlight.current = false;
    setPending(false);
    if (done) {
      setReason(null);
      onCancelled();
    }
  };

  return (
    <Dialog open={target !== null} onOpenChange={(open) => (open ? undefined : close())}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Cancel invoice</DialogTitle>
          <DialogDescription className="break-words">{target ? `${target.number} · ${target.familyName}` : ""}</DialogDescription>
        </DialogHeader>
        <RadioGroupFieldset legend="Reason">
          {CANCEL_REASONS.map((r) => (
            <RadioChoice key={r} name={`${id}-reason`} value={r} checked={reason === r} onSelect={() => setReason(r)} label={CANCEL_REASON_LABELS[r]} />
          ))}
        </RadioGroupFieldset>
        <EditNotice notice={message === null ? null : { tone: "alert", text: message }} />
        <DialogFooter className="gap-2 sm:gap-0">
          <Button type="button" variant="outline" onClick={close} disabled={pending}>
            Back
          </Button>
          <Button type="button" onClick={confirm} disabled={reason === null || pending} className="bg-violet-600 text-white hover:bg-violet-700">
            {pending && <Loader2 className="animate-spin" aria-hidden="true" />}
            Cancel invoice
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
