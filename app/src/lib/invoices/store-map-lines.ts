/**
 * The store's line, issuer and list shapes (plan 06 §14.4, b2.4): zod schemas that parse what amendment 21 returns
 * — an invoice's lines, her effective issuer (`nanny_invoice_issuer`), a business save, her own invoice list — and
 * the `p_lines` the store sends. Pure: no I/O. A row or reply that doesn't fit is never silently dropped or guessed;
 * the caller fails the whole read (the 02 `mapRows` rule).
 *
 * BB-wave1-041126/06b2-build, 2026-11-06.
 */

import { z } from "zod";
import { isInvoiceNumber } from "./numbering";
import {
  BUSINESS_TYPE_KEYS,
  CANCEL_REASONS,
  EXPENSE_TYPE_KEYS,
  INVOICE_KINDS,
  INVOICE_STATUSES,
  VAT_MODES,
  type BusinessType,
  type CancelReason,
  type EmailDelivery,
  type ExpenseType,
  type InvoiceKind,
  type InvoiceStatus,
  type VatMode,
} from "./types";
import { isLondonDate } from "./week";

const id = z.string().min(1);
export const instant = z.string().refine((v) => !Number.isNaN(Date.parse(v))).transform((v) => new Date(v).toISOString());
export const londonDate = z.string().refine(isLondonDate);
/** `numeric`: PostgREST may send a number or its text. */
export const hoursValue = z.union([z.number(), z.string()]).transform(Number).pipe(z.number().positive().finite());
export const pence = z.number().int();
const delivery = z.enum(["sent", "failed"]).nullable();

/** One stored line, as the screens and the PDF use it (in her order). */
export type StoredLine =
  | {
      readonly lineNo: number;
      readonly kind: "shift";
      readonly date: string;
      readonly hours: number;
      readonly ratePence: number;
      readonly description: string | null;
      readonly amountPence: number;
    }
  | {
      readonly lineNo: number;
      readonly kind: "expense";
      readonly expenseType: ExpenseType;
      readonly description: string | null;
      readonly amountPence: number;
    };

/** The columns of a stored line (the reply's `lines`, and the embedded read). */
export const LINE_COLUMNS = "line_no, kind, shift_date, hours, rate_pence, expense_type, description, amount_pence";

const lineNo = z.number().int().min(1);
const shiftRow = z.object({
  line_no: lineNo, kind: z.literal("shift"), shift_date: londonDate, hours: hoursValue, rate_pence: pence.positive(),
  expense_type: z.null(), description: z.string().nullable(), amount_pence: pence.nonnegative(),
});
const expenseRow = z.object({
  line_no: lineNo, kind: z.literal("expense"), shift_date: z.null(), hours: z.null(), rate_pence: z.null(),
  expense_type: z.enum(EXPENSE_TYPE_KEYS), description: z.string().nullable(), amount_pence: pence.positive(),
});

export const lineRow = z.discriminatedUnion("kind", [shiftRow, expenseRow]).transform((r): StoredLine =>
  r.kind === "shift"
    ? { lineNo: r.line_no, kind: "shift", date: r.shift_date, hours: r.hours, ratePence: r.rate_pence, description: r.description, amountPence: r.amount_pence }
    : { lineNo: r.line_no, kind: "expense", expenseType: r.expense_type, description: r.description, amountPence: r.amount_pence });

/** Lines in her order, whatever order a read returned them in. */
export const linesInOrder = (lines: readonly StoredLine[]): readonly StoredLine[] => [...lines].sort((a, b) => a.lineNo - b.lineNo);

/** 14.7: the single rate when every shift on an invoice has it; null when the rates differ (or there is no shift). */
export function singleRate(lines: readonly { readonly kind: string; readonly rate_pence: number | null }[]): number | null {
  const rates = new Set(lines.filter((l) => l.kind === "shift").map((l) => l.rate_pence));
  if (rates.size !== 1) return null;
  const [rate] = [...rates];
  return rate ?? null;
}

type LineIn =
  | { readonly kind: "shift"; readonly date: string; readonly hours: number; readonly ratePence: number; readonly description: string | null }
  | { readonly kind: "expense"; readonly expenseType: ExpenseType; readonly amountPence: number; readonly description: string | null };

/** `p_lines` (keys = the line table's columns, plan 14.4), in her order; a blank description is left out. */
export function linesArg(lines: readonly LineIn[]): readonly Readonly<Record<string, string | number>>[] {
  return lines.map((l): Readonly<Record<string, string | number>> => {
    const base: Record<string, string | number> = l.kind === "shift"
      ? { kind: "shift", shift_date: l.date, hours: l.hours, rate_pence: l.ratePence }
      : { kind: "expense", expense_type: l.expenseType, amount_pence: l.amountPence };
    return l.description === null ? base : { ...base, description: l.description };
  });
}

/** Who she is on her invoices now, with the defaults (amendment 21's `nanny_invoice_issuer`). No bank field. */
export interface Issuer {
  readonly businessType: BusinessType;
  readonly name: string | null;
  readonly tradingName: string | null;
  readonly tradingNameSource: "business" | "name";
  readonly address: string | null;
  readonly addressSource: "business" | "verification" | null;
  readonly companyName: string | null;
  readonly companyNumber: string | null;
  readonly registeredOffice: string | null;
  readonly partnershipName: string | null;
  readonly vat: { readonly mode: VatMode; readonly rateBp: number | null; readonly number: string | null };
}

const text = z.string().nullable();
export const issuerReply = z
  .object({
    business_type: z.enum(BUSINESS_TYPE_KEYS), name: text, trading_name: text, trading_name_source: z.enum(["business", "name"]),
    address: text, address_source: z.enum(["business", "verification"]).nullable(), company_name: text, company_number: text,
    registered_office: text, partnership_name: text, vat_mode: z.enum(VAT_MODES), vat_rate_bp: z.number().int().nullable(), vat_number: text,
  })
  .transform((r): Issuer => ({
    businessType: r.business_type, name: r.name, tradingName: r.trading_name, tradingNameSource: r.trading_name_source,
    address: r.address, addressSource: r.address_source, companyName: r.company_name, companyNumber: r.company_number,
    registeredOffice: r.registered_office, partnershipName: r.partnership_name,
    vat: { mode: r.vat_mode, rateBp: r.vat_rate_bp, number: r.vat_number },
  }));

export const businessSavedReply = z
  .object({ status: z.literal("saved"), changed: z.boolean() })
  .transform((r): { readonly changed: boolean } => ({ changed: r.changed }));

/** One of her own invoices, for her list (no email, bank or PDF field). */
export interface MyInvoice {
  readonly invoiceId: string;
  readonly nannyId: string;
  readonly seq: number;
  readonly number: string;
  readonly kind: InvoiceKind;
  readonly placementId: string | null;
  readonly connectionRequestId: string | null;
  readonly parentUserId: string;
  readonly familyName: string;
  readonly periodStart: string;
  readonly hours: number;
  readonly shiftsPence: number;
  readonly expensesPence: number;
  readonly vatMode: VatMode;
  readonly vatPence: number;
  readonly totalPence: number;
  readonly status: InvoiceStatus;
  readonly replacesInvoiceId: string | null;
  readonly delivery: {
    readonly family: EmailDelivery | null;
    readonly nanny: EmailDelivery | null;
    readonly cancelFamily: EmailDelivery | null;
    readonly cancelNanny: EmailDelivery | null;
  };
  readonly sentAt: string | null;
  readonly cancelledAt: string | null;
  readonly cancelReason: CancelReason | null;
  readonly createdAt: string;
}

export const MY_INVOICE_COLUMNS =
  "id, nanny_id, invoice_seq, invoice_number, kind, placement_id, connection_request_id, parent_user_id, family_name, period_start, " +
  "hours, shifts_pence, expenses_pence, vat_mode, vat_pence, total_pence, status, replaces_invoice_id, family_email_status, " +
  "nanny_email_status, cancel_family_email_status, cancel_nanny_email_status, sent_at, cancelled_at, cancel_reason, created_at";

export const myInvoiceRow = z
  .object({
    id, nanny_id: id, invoice_seq: z.number().int().positive(), invoice_number: z.string().refine(isInvoiceNumber),
    kind: z.enum(INVOICE_KINDS), placement_id: id.nullable(), connection_request_id: id.nullable(), parent_user_id: id,
    family_name: z.string(), period_start: londonDate, hours: hoursValue, shifts_pence: pence, expenses_pence: pence,
    vat_mode: z.enum(VAT_MODES), vat_pence: pence, total_pence: pence, status: z.enum(INVOICE_STATUSES),
    replaces_invoice_id: id.nullable(), family_email_status: delivery, nanny_email_status: delivery,
    cancel_family_email_status: delivery, cancel_nanny_email_status: delivery, sent_at: instant.nullable(),
    cancelled_at: instant.nullable(), cancel_reason: z.enum(CANCEL_REASONS).nullable(), created_at: instant,
  })
  .transform((r): MyInvoice => ({
    invoiceId: r.id, nannyId: r.nanny_id, seq: r.invoice_seq, number: r.invoice_number, kind: r.kind, placementId: r.placement_id,
    connectionRequestId: r.connection_request_id, parentUserId: r.parent_user_id, familyName: r.family_name,
    periodStart: r.period_start, hours: r.hours, shiftsPence: r.shifts_pence, expensesPence: r.expenses_pence, vatMode: r.vat_mode,
    vatPence: r.vat_pence, totalPence: r.total_pence, status: r.status, replacesInvoiceId: r.replaces_invoice_id,
    delivery: { family: r.family_email_status, nanny: r.nanny_email_status, cancelFamily: r.cancel_family_email_status, cancelNanny: r.cancel_nanny_email_status },
    sentAt: r.sent_at, cancelledAt: r.cancelled_at, cancelReason: r.cancel_reason, createdAt: r.created_at,
  }));

/** One invoice of hers with its lines embedded (the correction pre-fill). */
export const MY_LINES_COLUMNS = `id, nanny_id, nanny_invoice_lines(${LINE_COLUMNS})`;
export const myLinesRow = z.object({ id, nanny_id: id, nanny_invoice_lines: z.array(lineRow) });
