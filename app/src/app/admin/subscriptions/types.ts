export interface AdminSubscriptionRow {
  parentUserId: string;
  fullName: string;
  email: string | null;
  status:
    | "trial"
    | "active_monthly"
    | "active_upfront"
    | "past_due"
    | "cancelled"
    | "lapsed"
    | "deposit_paid"
    | "placed";
  /** 4c (amendment 12): self-serve or done-for-you. */
  familyType: "self_serve" | "dfy";
  /** 4c: placed, balance due date passed, bill not paid (the sweep raises these). */
  paymentDue: boolean;
  plan: "monthly" | "upfront" | "trial" | "none";
  tenureDays: number | null;
  subscriberSinceIso: string | null;
  cumulativeSpendAud: number;
  cycle: number;
  nextEventIso: string | null;
  nextEventLabel: string;
  failedPayments: number;
  hasNanny: boolean;
  cancellationReason: string | null;
  updatedAtIso: string;
}

export interface AdminSubscriptionCounters {
  activeMonthly: number;
  activeUpfront: number;
  trial: number;
  pastDue: number;
  cancelled: number;
  lapsed: number;
  depositPaid: number;
  placed: number;
  paymentDue: number;
}

/** 4c — a done-for-you family whose balance is due and unpaid (ADR-094; brief step 7). */
export function isPaymentDue(
  row: { status: string; payment_due_at: string | null; bill_paid_at: string | null },
  nowMs: number = Date.now(),
): boolean {
  return (
    row.status === "placed" &&
    row.bill_paid_at === null &&
    row.payment_due_at !== null &&
    Date.parse(row.payment_due_at) <= nowMs
  );
}
