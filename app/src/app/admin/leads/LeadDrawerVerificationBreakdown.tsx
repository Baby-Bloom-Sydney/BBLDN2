// T-032 — Per-dimension verification breakdown (ID / WWCC / OCG / Photo / ABN / Level / Status).

import { Check, X, AlertTriangle, Clock } from "lucide-react";
import type { LeadDetail } from "@/lib/leads/fetch-lead-detail";

interface LeadDrawerVerificationBreakdownProps {
  detail: LeadDetail;
}

import { formatLeadDate } from "@/lib/leads/format";

const fmtDate = formatLeadDate;

interface RowProps {
  label: string;
  status: "ok" | "missing" | "pending" | "warn";
  detail?: string | null;
}

function Row({ label, status, detail }: RowProps) {
  const Icon =
    status === "ok"
      ? Check
      : status === "warn"
        ? AlertTriangle
        : status === "pending"
          ? Clock
          : X;
  const colour =
    status === "ok"
      ? "bg-green-50 text-green-700 ring-green-200"
      : status === "warn"
        ? "bg-amber-50 text-amber-700 ring-amber-200"
        : status === "pending"
          ? "bg-blue-50 text-blue-700 ring-blue-200"
          : "bg-slate-50 text-slate-500 ring-slate-200";
  return (
    <div className="flex items-center justify-between gap-2 rounded-md border border-slate-200 bg-white px-2.5 py-1.5 text-sm">
      <div className="flex items-center gap-2">
        <span
          className={`inline-flex h-5 w-5 items-center justify-center rounded-full ring-1 ring-inset ${colour}`}
        >
          <Icon className="h-3 w-3" />
        </span>
        <span className="text-slate-700">{label}</span>
      </div>
      <span className="text-xs text-slate-500">{detail}</span>
    </div>
  );
}

export function LeadDrawerVerificationBreakdown({
  detail,
}: LeadDrawerVerificationBreakdownProps) {
  const v = detail.verifications;
  const n = detail.nanny;
  const profile = detail.user_profile;

  const idStatus: RowProps["status"] = v?.identity_verified ? "ok" : "missing";
  const wwccStatus: RowProps["status"] = v?.wwcc_verified
    ? v?.wwcc_expiry_date &&
      new Date(v.wwcc_expiry_date).getTime() <
        Date.now() + 30 * 24 * 60 * 60 * 1000
      ? "warn"
      : "ok"
    : "missing";
  const photoStatus: RowProps["status"] = profile?.profile_picture_url
    ? "ok"
    : "missing";
  const abnStatus: RowProps["status"] = n?.abn
    ? n.abn_push_flagged_at
      ? "warn"
      : "ok"
    : "missing";

  return (
    <section>
      <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
        Verification
      </h3>
      <div className="space-y-1.5">
        <Row
          label="Identity"
          status={idStatus}
          detail={fmtDate(v?.identity_verified_at)}
        />
        <Row
          label="WWCC"
          status={wwccStatus}
          detail={
            v?.wwcc_number
              ? `#${v.wwcc_number}${v?.wwcc_verified ? ` · verified ${fmtDate(v.wwcc_verified_at)}` : ""}${v?.wwcc_expiry_date ? ` · expires ${fmtDate(v.wwcc_expiry_date)}` : ""}`
              : v?.wwcc_verified
                ? `verified ${fmtDate(v.wwcc_verified_at)}${v.wwcc_expiry_date ? ` · expires ${fmtDate(v.wwcc_expiry_date)}` : ""}`
                : "missing"
          }
        />
        <Row
          label="OCG audit"
          status={
            v?.ocg_result_status === "CLEARED"
              ? "ok"
              : v?.ocg_result_status
                ? "warn"
                : "missing"
          }
          detail={v?.ocg_result_status ?? "—"}
        />
        <Row
          label="Photo"
          status={photoStatus}
          detail={profile?.profile_picture_url ? "uploaded" : "no photo"}
        />
        <Row
          label="ABN"
          status={abnStatus}
          detail={
            n?.abn
              ? `${n.abn}${n.abn_push_flagged_at ? " · flagged" : ""}`
              : "missing"
          }
        />
        <Row
          label="Level"
          status={
            n?.verification_level === 4
              ? "ok"
              : n?.verification_level && n.verification_level > 0
                ? "pending"
                : "missing"
          }
          detail={`Lv ${n?.verification_level ?? 0}`}
        />
        <Row
          label="Status code"
          status={
            v?.verification_status === 40
              ? "ok"
              : v?.verification_status === 30
                ? "pending"
                : v?.verification_status
                  ? "pending"
                  : "missing"
          }
          detail={
            v?.verification_status !== null &&
            v?.verification_status !== undefined
              ? `code ${v.verification_status}`
              : "—"
          }
        />
      </div>
    </section>
  );
}
