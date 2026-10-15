import { PRICES } from "@/config/prices";

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
  /** 4g (D3): lifetime spend in pence, from `config/prices.ts` (`cumulativeSpendPence`). */
  cumulativeSpendPence: number;
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

/**
 * 4g (D3) — what this family has paid us, in pence, from config. Both admin pages call it so they agree.
 * Self-serve: paid monthly cycles × the monthly price, plus the upfront price once if paid upfront (each page keeps
 * its own test of "paid upfront"). Done-for-you: the row's own `deposit_pence` once `deposit_paid_at` is set, plus
 * its `balance_pence` once `bill_paid_at` is set — the amounts actually charged, which vary by cohort.
 */
export function cumulativeSpendPence(
  row: {
    family_type?: string | null;
    deposit_pence?: number | null;
    deposit_paid_at?: string | null;
    balance_pence?: number | null;
    bill_paid_at?: string | null;
  },
  selfServe: { monthlyCycles: number; upfrontPaid: boolean },
): number {
  if (row.family_type === "dfy") {
    const deposit = row.deposit_paid_at ? (row.deposit_pence ?? 0) : 0;
    const balance = row.bill_paid_at ? (row.balance_pence ?? 0) : 0;
    return deposit + balance;
  }
  const monthly = selfServe.monthlyCycles * PRICES.selfServe.monthlyPence;
  const upfront = selfServe.upfrontPaid ? PRICES.selfServe.upfrontToAge3Pence : 0;
  return monthly + upfront;
}
