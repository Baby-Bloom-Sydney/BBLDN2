// T-032 — Verification mini-chip strip for the list row.
// Shows WWCC / ID / Photo / ABN as ✓ / ✗ / · in a compact horizontal row.

import { Check, X, Minus } from "lucide-react";
import type { VerificationSnapshot } from "@/lib/leads/types";

interface VerificationMiniChipProps {
  verification: VerificationSnapshot;
  className?: string;
}

interface ChipProps {
  label: string;
  state: "yes" | "no" | "unknown";
}

function Chip({ label, state }: ChipProps) {
  const base =
    "inline-flex items-center gap-0.5 rounded px-1.5 py-0.5 text-[10px] font-medium ring-1 ring-inset";
  const cls =
    state === "yes"
      ? "bg-green-50 text-green-700 ring-green-200"
      : state === "no"
        ? "bg-slate-50 text-slate-500 ring-slate-200"
        : "bg-slate-50 text-slate-400 ring-slate-200";
  const Icon = state === "yes" ? Check : state === "no" ? X : Minus;
  return (
    <span className={`${base} ${cls}`} title={`${label}: ${state}`}>
      <Icon className="h-2.5 w-2.5" aria-hidden="true" />
      <span>{label}</span>
    </span>
  );
}

function boolToState(
  value: boolean | null,
  missingAsUnknown = false,
): "yes" | "no" | "unknown" {
  if (value === true) return "yes";
  if (value === false) return missingAsUnknown ? "unknown" : "no";
  return missingAsUnknown ? "unknown" : "no";
}

export function VerificationMiniChip({
  verification,
  className = "",
}: VerificationMiniChipProps) {
  return (
    <div className={`flex flex-wrap items-center gap-1 ${className}`}>
      <Chip
        label="DBS"
        state={boolToState(verification.wwcc_verified, true)}
      />
      <Chip
        label="ID"
        state={boolToState(verification.identity_verified, true)}
      />
      <Chip label="Photo" state={verification.photo_present ? "yes" : "no"} />
      <Chip label="ABN" state={verification.abn_present ? "yes" : "no"} />
    </div>
  );
}
