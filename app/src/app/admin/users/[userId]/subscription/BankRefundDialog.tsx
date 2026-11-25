"use client";

/**
 * Record refund (bank transfer) (plan 03 row B3; brief 03 §0.8, §3 Admin 6): a required reason (3–500 once
 * trimmed), Confirm. B2's `recordDepositBankRefund` stamps the refund and re-opens the place. Card refunds stay in
 * the Stripe Dashboard. Shown only for a bank-transfer deposit not yet refunded (the block's rule).
 *
 * BB-wave2-231126/03-build, 2026-11-25.
 */

import { useId, useState } from "react";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { REFUND_REASON_MAX, REFUND_REASON_MIN } from "@/lib/deposit/constants";
import { PANEL_ACTION_COPY, PANEL_COPY } from "@/lib/deposit/copy";
import { recordDepositBankRefund } from "./deposit-actions";
import { AlertLine, BUTTON, QUIET_BUTTON, useDialogWrite } from "./DepositParts";

export interface BankRefundDialogProps {
  readonly parentUserId: string;
  /** The block is busy with another request. */
  readonly disabled: boolean;
}

function useBankRefund({ parentUserId }: BankRefundDialogProps) {
  const [reason, setReason] = useState("");
  const write = useDialogWrite(() => setReason(""));
  const trimmed = reason.trim();
  const valid = trimmed.length >= REFUND_REASON_MIN && trimmed.length <= REFUND_REASON_MAX;
  const confirm = () => write.submit(() => recordDepositBankRefund(parentUserId, { reason: trimmed }));
  return { ...write, reason, setReason, valid, confirm };
}

export function BankRefundDialog(props: BankRefundDialogProps) {
  const id = useId();
  const r = useBankRefund(props);
  return (
    <Dialog open={r.open} onOpenChange={r.setOpen}>
      <DialogTrigger asChild>
        <button type="button" disabled={props.disabled} className={BUTTON}>
          {PANEL_COPY.bankRefundButton}
        </button>
      </DialogTrigger>
      <DialogContent className="max-h-[90vh] max-w-md overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="pr-8">{PANEL_COPY.bankRefundButton}</DialogTitle>
          <DialogDescription>{PANEL_ACTION_COPY.bankRefundDescription}</DialogDescription>
        </DialogHeader>
        <div className="space-y-1">
          <label htmlFor={`${id}-reason`} className="text-xs text-slate-600">
            {PANEL_ACTION_COPY.reasonLabel}
          </label>
          <textarea id={`${id}-reason`} value={r.reason} onChange={(e) => r.setReason(e.target.value)} required maxLength={REFUND_REASON_MAX} rows={3}
            aria-describedby={`${id}-hint`} disabled={r.pending}
            className="block w-full rounded-md border border-slate-200 px-2 py-1 text-base md:text-sm" />
          <p id={`${id}-hint`} className="text-xs text-slate-500">
            {PANEL_ACTION_COPY.reasonHint}
          </p>
        </div>
        {r.message && <AlertLine text={r.message} />}
        <DialogFooter className="gap-2 sm:gap-0">
          <button type="button" onClick={() => r.setOpen(false)} disabled={r.pending} className={QUIET_BUTTON}>
            {PANEL_ACTION_COPY.back}
          </button>
          <button type="button" onClick={r.confirm} disabled={!r.valid || r.pending} className={BUTTON}>
            {PANEL_ACTION_COPY.confirm}
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
