import type { GuaranteePromise } from "./rules";

/** One ledger row as the admin list shows it (4e). */
export interface GuaranteeListRow {
  id: string;
  familyName: string;
  familyEmail: string | null;
  promise: GuaranteePromise;
  conditionMet: boolean;
  outcome: string;
  paidOutPence: number;
  notes: string | null;
  recordedBy: string;
  recordedAt: string;
}
