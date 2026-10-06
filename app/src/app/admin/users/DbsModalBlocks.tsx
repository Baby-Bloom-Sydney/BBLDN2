"use client";

/**
 * Presentational blocks of `DBSCheckModal` (unit 3d, brief change 11; spec §2.2 blocks 2–7). Each block copies the
 * cited `IDCheckModal` block's markup. Pure: props in, markup out — no actions, no fetches.
 *
 * Rulings: #3 (page 1 only), #8 (surname + DOB decide; forename is information), #24 (reason_code / confidence in the
 * guidance JSON, tamper flags in `wwcc_ai_issues`), #27 (Ask for page 2 shown only when content continues).
 * Never: renders the certificate from a storage path (signed URL only), shows the old regulator's name, or lets a
 * field be edited (the ID modal's Edit toggle never saved, spec §2.2 block 3).
 */
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { StatusBadge } from "@/components/dashboard/StatusBadge";
import { AlertTriangle, CheckCircle2, ExternalLink, ImageOff, Loader2, RefreshCw } from "lucide-react";
import { formatRelativeTime } from "@/lib/utils";
import { datesMatch, surnamesMatch } from "@/lib/dbs/match";
import { DBS_API_RESULT } from "@/lib/verification";
import type { DbsHistoryEntry, PendingDbsCheck } from "@/lib/admin/dbs-queues";

export function formatDate(dateStr: string | null): string {
  if (!dateStr) return "-";
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) return dateStr;
  return d.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
}

/** The certificate JSON written by 3c's pipeline (`extracted_wwcc_clearance_type`). Unparseable = empty. */
export function certificateFacts(raw: string | null): Record<string, unknown> {
  if (!raw) return {};
  try {
    const v = JSON.parse(raw);
    return v && typeof v === "object" ? v : {};
  } catch {
    return {};
  }
}

function parseList(raw: string | null): string[] {
  if (!raw) return [];
  try {
    const v = JSON.parse(raw);
    return Array.isArray(v) ? v.map(String) : [];
  } catch {
    return [];
  }
}

const TAMPER_FLAGS = new Set(["font_mismatch", "background_patch", "level_inconsistent", "box_edited", "layout_mismatch", "api_mismatch"]);

function Row({ label, value, mismatch }: { label: string; value: string | null; mismatch?: boolean }) {
  return (
    <div className="flex justify-between gap-3">
      <span className="font-medium text-slate-500">{label}</span>
      <span className={mismatch ? "font-semibold text-red-600 text-right" : "text-right"}>
        {value || "-"}
        {mismatch && <span className="ml-1 text-xs text-red-400">(mismatch)</span>}
      </span>
    </div>
  );
}

// ── Block 2: certificate viewer ──

export function CertificateViewer({ check, onZoom, onAskPage2, canAskPage2 }: {
  check: PendingDbsCheck;
  onZoom: (url: string) => void;
  onAskPage2: () => void;
  canAskPage2: boolean;
}) {
  return (
    <div>
      <p className="mb-1 text-xs font-semibold text-slate-500 uppercase">DBS certificate — page 1</p>
      {!check.certificate_url ? (
        <div className="flex h-52 items-center justify-center rounded-lg border-2 border-dashed border-slate-200 bg-slate-50">
          <div className="text-center text-slate-400">
            <ImageOff className="mx-auto h-8 w-8" />
            <p className="mt-1 text-xs">No certificate uploaded</p>
          </div>
        </div>
      ) : check.is_pdf ? (
        <div className="flex h-40 flex-col items-center justify-center gap-3 rounded-lg border-2 border-slate-200 bg-slate-50">
          <p className="text-sm text-slate-500">PDF certificate</p>
          <Button variant="outline" size="sm" className="gap-2" onClick={() => window.open(check.certificate_url!, "_blank", "noopener,noreferrer")}>
            Open PDF
            <ExternalLink className="h-3.5 w-3.5" />
          </Button>
        </div>
      ) : (
        <img
          src={check.certificate_url}
          alt="DBS certificate page 1"
          className="w-full max-h-[28rem] rounded-lg border-2 border-slate-200 object-contain cursor-zoom-in bg-slate-50"
          onClick={() => onZoom(check.certificate_url!)}
        />
      )}
      <div className="mt-1 flex items-center justify-between text-xs text-slate-500">
        <span>Page 1 only. Ask for page 2 if content continues.</span>
        {canAskPage2 && (
          <button type="button" className="font-medium text-violet-600 hover:text-violet-800" onClick={onAskPage2}>
            Ask for page 2
          </button>
        )}
      </div>
    </div>
  );
}

// ── Block 3: passport vs certificate ──

const BOX_LABELS: [string, string][] = [
  ["police_records", "Police records"],
  ["s142_list", "s142 Education Act list"],
  ["childrens_barred_list", "Children's Barred List"],
  ["adults_barred_list", "Adults' Barred List"],
  ["other_police_info", "Other relevant information"],
];

export function DetailsCards({ check }: { check: PendingDbsCheck }) {
  const facts = certificateFacts(check.extracted_wwcc_clearance_type);
  const s = (k: string) => (typeof facts[k] === "string" ? (facts[k] as string) : null);
  const surnameMismatch = !!(check.extracted_surname && check.extracted_wwcc_surname) && !surnamesMatch(check.extracted_surname, check.extracted_wwcc_surname);
  const dobMismatch = !!(check.extracted_dob && check.extracted_wwcc_dob) && !datesMatch(check.extracted_dob, check.extracted_wwcc_dob);
  const level = [s("level"), s("statutory_statement_section")].filter(Boolean).join(" · ");

  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
      <Card>
        <CardContent className="p-4">
          <h3 className="mb-2 text-sm font-semibold text-slate-700">Passport (verified)</h3>
          <div className="space-y-1.5 text-sm">
            <Row label="Surname" value={check.extracted_surname} />
            <Row label="Given name(s)" value={check.extracted_given_names} />
            <Row label="Date of birth" value={formatDate(check.extracted_dob)} />
          </div>
        </CardContent>
      </Card>
      <Card>
        <CardContent className="p-4">
          <h3 className="mb-2 text-sm font-semibold text-slate-700">Certificate (AI read)</h3>
          <div className="space-y-1.5 text-sm">
            <Row label="Certificate no." value={check.extracted_wwcc_number} />
            <Row label="Surname" value={check.extracted_wwcc_surname} mismatch={surnameMismatch} />
            <Row label="Forenames" value={check.extracted_wwcc_first_name} />
            <Row label="Other names" value={check.extracted_wwcc_other_names} />
            <Row label="Date of birth" value={formatDate(check.extracted_wwcc_dob)} mismatch={dobMismatch} />
            <Row label="Issue date" value={formatDate(check.extracted_wwcc_expiry)} />
            <Row label="Level" value={level || null} />
            <Row label="Position / workforce" value={[s("position_applied_for"), s("workforce")].filter(Boolean).join(" · ") || null} />
            <Row label="Employer" value={s("employer_name")} />
            <Row label="Registered body" value={s("registered_body")} />
            <div className="mt-2 border-t pt-2 space-y-1">
              {BOX_LABELS.map(([key, label]) => {
                const v = s(key);
                const normal = v === "none_recorded" || (key === "adults_barred_list" && v === "not_requested");
                return (
                  <div key={key} className="flex justify-between gap-3">
                    <span className="text-slate-500">{label}</span>
                    <span className={normal ? "text-slate-700" : "font-semibold text-amber-600"}>{v ? v.replace(/_/g, " ") : "-"}</span>
                  </div>
                );
              })}
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

// ── Block 4: AI result ──

export function AiResultCard({ check }: { check: PendingDbsCheck }) {
  const issues = parseList(check.wwcc_ai_issues);
  const tamper = issues.filter((i) => TAMPER_FLAGS.has(i));
  const other = issues.filter((i) => !TAMPER_FLAGS.has(i) && !i.startsWith("confidence:") && !i.startsWith("refs:"));
  const confidence = check.wwcc_user_guidance?.confidence ?? null;
  const noRefs = issues.includes("refs:none");
  const reason = check.wwcc_user_guidance?.reason_code ?? null;
  const failed = other.length > 0 || tamper.length > 0 || (reason !== null && reason !== "PASS");

  if (!check.wwcc_ai_reasoning && issues.length === 0) {
    return (
      <Card className="border-yellow-200 bg-yellow-50">
        <CardContent className="p-4">
          <h3 className="mb-1 flex items-center gap-2 text-sm font-semibold text-yellow-700">
            <AlertTriangle className="h-4 w-4" /> AI read pending
          </h3>
          <p className="text-sm text-yellow-600">The AI has not finished reading the certificate.</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className={failed ? "border-red-200 bg-red-50" : "border-green-200 bg-green-50"}>
      <CardContent className="p-4">
        <div className="flex items-center justify-between gap-2">
          <h3 className={`flex items-center gap-2 text-sm font-semibold ${failed ? "text-red-700" : "text-green-700"}`}>
            {failed ? <AlertTriangle className="h-4 w-4" /> : <CheckCircle2 className="h-4 w-4" />}
            {failed ? `AI flagged — ${(reason ?? "see issues").replace(/_/g, " ").toLowerCase()}` : "AI check passed"}
          </h3>
          {confidence && <span className="rounded-full bg-white px-2 py-0.5 text-xs text-slate-600 border">confidence: {confidence}</span>}
        </div>
        {noRefs && <p className="mt-1 text-xs text-slate-500">Checked without reference examples.</p>}
        {other.length > 0 && (
          <ul className="mt-2 space-y-1 text-sm text-red-600">
            {other.map((issue, i) => <li key={i}>- {issue}</li>)}
          </ul>
        )}
        {tamper.length > 0 && (
          <div className="mt-2">
            <p className="text-xs font-semibold text-red-700">Possible alteration</p>
            <ul className="text-sm text-red-600">{tamper.map((f) => <li key={f}>- {f.replace(/_/g, " ")}</li>)}</ul>
          </div>
        )}
        {check.wwcc_ai_reasoning && (
          <details className="mt-3">
            <summary className="cursor-pointer text-xs font-medium text-slate-500 hover:text-slate-700">View AI reasoning</summary>
            <p className="mt-2 whitespace-pre-wrap rounded bg-white/60 p-2 text-xs text-slate-700">{check.wwcc_ai_reasoning}</p>
          </details>
        )}
      </CardContent>
    </Card>
  );
}

// ── Block 5: cross-check ──

export function CrossCheckPanel({ check }: { check: PendingDbsCheck }) {
  const surnameOk = surnamesMatch(check.extracted_surname, check.extracted_wwcc_surname);
  const dobOk = datesMatch(check.extracted_dob, check.extracted_wwcc_dob);
  const status = check.cross_check_status ?? "not_started";
  const variant = status === "passed" ? "verified" : status === "review" ? "failed" : "pending";
  return (
    <Card>
      <CardContent className="p-4 space-y-1.5 text-sm">
        <div className="mb-1 flex items-center justify-between">
          <h3 className="text-sm font-semibold text-slate-700">Cross-check: passport vs certificate</h3>
          <StatusBadge variant={variant}>{status.replace(/_/g, " ")}</StatusBadge>
        </div>
        <Row label="Surname" value={`${check.extracted_surname ?? "-"} / ${check.extracted_wwcc_surname ?? "-"}`} mismatch={!surnameOk} />
        <Row label="Date of birth" value={`${formatDate(check.extracted_dob)} / ${formatDate(check.extracted_wwcc_dob)}`} mismatch={!dobOk} />
        <Row label="Forename (information only)" value={`${check.extracted_given_names ?? "-"} / ${check.extracted_wwcc_first_name ?? "-"}`} />
        {check.cross_check_reasoning && <p className="pt-1 text-xs text-slate-500">{check.cross_check_reasoning}</p>}
      </CardContent>
    </Card>
  );
}

// ── Block 6: Update Service ──

const RESULT_BADGE: Record<string, { label: string; variant: "active" | "pending" | "failed" }> = {
  [DBS_API_RESULT.BLANK]: { label: "Clear", variant: "active" },
  [DBS_API_RESULT.NON_BLANK]: { label: "Has a record — read the certificate", variant: "pending" },
  [DBS_API_RESULT.NEW_INFO]: { label: "New information", variant: "failed" },
  [DBS_API_RESULT.NO_MATCH]: { label: "No Update Service match", variant: "failed" },
};

export function UpdateServicePanel({ check, canRun, runDisabledReason, running, onRun, runMessage }: {
  check: PendingDbsCheck;
  canRun: boolean;
  runDisabledReason: string | null;
  running: boolean;
  onRun: () => void;
  runMessage: string | null;
}) {
  const badge = check.ocg_result_status ? RESULT_BADGE[check.ocg_result_status] : null;
  return (
    <Card>
      <CardContent className="p-4 space-y-2 text-sm">
        <div className="flex items-center justify-between gap-2">
          <h3 className="text-sm font-semibold text-slate-700">DBS Update Service</h3>
          {badge ? <StatusBadge variant={badge.variant}>{badge.label}</StatusBadge> : <StatusBadge variant="unattempted">Not run</StatusBadge>}
        </div>
        <Row label="Checked" value={check.ocg_verified_at ? `${formatRelativeTime(check.ocg_verified_at)} (${formatDate(check.ocg_verified_at)})` : null} />
        {check.api_down_since && <p className="text-xs text-slate-500">API not answering since {formatRelativeTime(check.api_down_since)}</p>}
        {check.ocg_result_text && (
          <details>
            <summary className="cursor-pointer text-xs font-medium text-slate-500 hover:text-slate-700">Raw response</summary>
            <div className="mt-2 overflow-x-auto"><pre className="rounded bg-slate-50 p-2 text-xs">{check.ocg_result_text}</pre></div>
          </details>
        )}
        {canRun && (
          <div className="pt-1">
            <Button size="sm" variant="outline" className="gap-2" disabled={running || !!runDisabledReason} onClick={onRun}>
              {running ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
              Run DBS check now
            </Button>
            {runDisabledReason && <p className="mt-1 text-xs text-slate-500">{runDisabledReason}</p>}
            {runMessage && <p className="mt-1 text-xs text-slate-700">{runMessage}</p>}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// ── Block 7: history ──

const HISTORY_LABELS: Record<string, string> = {
  verification_approved: "Approved",
  verification_rejected: "Rejected",
  user_suspended: "Barred",
  user_reinstated: "Bar lifted",
  dbs_status_check: "Update Service check",
  dbs_page2_requested: "Page 2 requested",
};

function historyLine(h: DbsHistoryEntry): string {
  const d = h.action_details ?? {};
  const bits = [d.trigger, d.result, d.reason].filter((x) => typeof x === "string") as string[];
  return `${HISTORY_LABELS[h.action_type] ?? h.action_type}${bits.length ? ` — ${bits.join(" · ")}` : ""}`;
}

export function HistoryBlock({ check }: { check: PendingDbsCheck }) {
  const rows = check.history.filter((h) => h.action_type in HISTORY_LABELS);
  if (!check.wwcc_rejection_reason && rows.length === 0) return null;
  return (
    <Card className="border-slate-200">
      <CardContent className="p-4 text-sm">
        <h3 className="mb-1 text-sm font-semibold text-slate-700">History</h3>
        {check.wwcc_rejection_reason && <p className="mb-2 text-slate-700">Previous reason: {check.wwcc_rejection_reason}</p>}
        <ul className="space-y-0.5 text-xs text-slate-600">
          {rows.map((h, i) => (
            <li key={i}>
              {formatRelativeTime(h.created_at)} — {historyLine(h)}
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}
