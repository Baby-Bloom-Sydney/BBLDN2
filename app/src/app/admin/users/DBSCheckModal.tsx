"use client";

/**
 * The admin's DBS review panel (unit 3d, brief change 11; spec §2.2) — mirrors `IDCheckModal`: certificate,
 * AI read, cross-check, raw Update Service result, history, then the decision with the ID modal's two-step inline confirm.
 *
 * Actions by list (brief change 9): A / B → APPROVE DBS · REJECT · More: BAR (+ Run DBS check now) · C (re-check
 * alerts, #35) → read-only + Run DBS check now · D (barred) → LIFT BAR only (#36).
 * Rulings: #11, #26 (reject chips = the ID modal's, document noun → DBS), #27 (page 2 by email), #30, P-1 (Approve disabled
 * without an API pass — the server refuses it too), P-4 (reject emails her — server side).
 * Inputs: one `PendingDbsCheck` + its list. Outputs: server actions, then close + `router.refresh()`; errors via
 * `alert()` (parity with the ID modal; toast = cleanup).
 * Never: decides anything itself — every rule here is repeated and enforced by the server action.
 */
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { StatusBadge } from "@/components/dashboard/StatusBadge";
import { CheckCircle2, X, Loader2, Ban, Unlock } from "lucide-react";
import { formatRelativeTime } from "@/lib/utils";
import { IDENTITY_STATUS, STATUS_LABELS, isDbsApiPass, statusTone } from "@/lib/verification";
import { adminRejectWWCC } from "@/lib/actions/admin";
import { adminVerifyWWCC, adminBarDbs, adminLiftDbsBar, adminRunDbsCheck } from "@/lib/actions/admin-dbs";
import { hasRecordChip, type DbsListKey, type PendingDbsCheck } from "@/lib/admin/dbs-queues";
import { ContactUserModal } from "./ContactUserModal";
import { AiResultCard, CertificateViewer, CrossCheckPanel, DetailsCards, HistoryBlock, UpdateServicePanel } from "./DbsModalBlocks";

interface DBSCheckModalProps {
  check: PendingDbsCheck | null;
  list: DbsListKey;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

type Confirm = "approve" | "reject" | "bar" | "lift" | null;

// #26: the ID modal's chips with the document noun changed, keeping only those that apply to a certificate. copy: 3g pins
const REJECT_CHIPS = [
  "The surname on your DBS certificate does not match your passport",
  "The date of birth on your DBS certificate does not match your passport",
  "Your DBS certificate image is unclear or unreadable",
];

// copy: 3g pins
const PAGE2_SUBJECT = "Your DBS certificate — page 2";
const PAGE2_BODY =
  "Thanks for uploading page 1 of your DBS certificate. To finish our review, please reply to this email with a clear photo of page 2 of the same certificate.";

const CONFIRM_TEXT: Record<Exclude<Confirm, null>, string> = {
  approve: "Approve? She becomes fully verified and her held replies are sent to parents.",
  reject: "Reject this certificate? She is emailed the reason and can upload again.",
  bar: "Bar this nanny? Her account is suspended, her pending connections are cancelled, and she is emailed.",
  lift: "Lift the bar? She can upload a new certificate; she is not verified until you approve again.",
};

const YES_LABEL: Record<Exclude<Confirm, null>, string> = {
  approve: "Yes, approve",
  reject: "Yes, reject",
  bar: "Yes, bar",
  lift: "Yes, lift",
};

/** Why Approve is disabled, mirroring `adminVerifyWWCC`'s refusals. Null = enabled. */
function approveBlockedReason(c: PendingDbsCheck): string | null {
  if (c.identity_status !== IDENTITY_STATUS.VERIFIED) return "Passport check not verified";
  if (!isDbsApiPass(c.ocg_result_status)) return "Needs an Update Service pass — run the DBS check first";
  if (c.verification_status !== 21 && c.verification_status !== 30) return `Not approvable from status ${c.verification_status}`;
  return null;
}

function runBlockedReason(c: PendingDbsCheck): string | null {
  if (!c.extracted_wwcc_number || !c.extracted_wwcc_surname || !c.extracted_wwcc_dob) {
    return "Needs the certificate number, surname and date of birth read from the certificate";
  }
  return null;
}

export function DBSCheckModal({ check, list, open, onOpenChange }: DBSCheckModalProps) {
  const router = useRouter();
  const [reason, setReason] = useState("");
  const [confirm, setConfirm] = useState<Confirm>(null);
  const [loading, setLoading] = useState(false);
  const [running, setRunning] = useState(false);
  const [runMessage, setRunMessage] = useState<string | null>(null);
  const [zoomed, setZoomed] = useState<string | null>(null);
  const [contactOpen, setContactOpen] = useState(false);

  if (!check) return null;

  const name = `${check.first_name || ""} ${check.last_name || ""}`.trim() || "Unknown";
  const decides = list === "awaiting" || list === "needsPerson";
  const approveBlocked = approveBlockedReason(check);
  const needsReason = confirm === "reject" || confirm === "bar";

  function reset() {
    setConfirm(null);
    setReason("");
    setRunMessage(null);
    setZoomed(null);
  }

  function handleClose(state: boolean) {
    if (!state) reset();
    onOpenChange(state);
  }

  async function act() {
    if (!confirm) return;
    setLoading(true);
    const id = check!.id;
    const result =
      confirm === "approve" ? await adminVerifyWWCC(id)
      : confirm === "reject" ? await adminRejectWWCC(id, reason)
      : confirm === "bar" ? await adminBarDbs(id, reason)
      : await adminLiftDbsBar(id);
    setLoading(false);
    if (!result.success) {
      alert(`Error: ${result.error}`);
      return;
    }
    if ("warning" in result && result.warning) alert(result.warning);
    handleClose(false);
    router.refresh();
  }

  async function runCheck() {
    setRunning(true);
    const r = await adminRunDbsCheck(check!.id);
    setRunning(false);
    setRunMessage(r.success ? (r.result ? `Update Service: ${r.result}` : "Check run — refreshing") : r.error);
    router.refresh();
  }

  return (
    <>
      <Dialog open={open} onOpenChange={handleClose}>
        <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex flex-wrap items-center gap-2">
              DBS Certificate Review
              <StatusBadge variant={statusTone(check.verification_status) === "unattempted" ? "pending" : statusTone(check.verification_status)}>
                {STATUS_LABELS[check.verification_status] ?? `Unknown (${check.verification_status})`}
              </StatusBadge>
            </DialogTitle>
            <DialogDescription>
              {name} — submitted {formatRelativeTime(check.wwcc_status_at ?? check.created_at)}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 mt-2">
            <CertificateViewer check={check} onZoom={setZoomed} onAskPage2={() => setContactOpen(true)} canAskPage2={hasRecordChip(check)} />
            <DetailsCards check={check} />
            <AiResultCard check={check} />
            <CrossCheckPanel check={check} />
            <UpdateServicePanel
              check={check}
              canRun={list !== "barred"}
              runDisabledReason={runBlockedReason(check)}
              running={running}
              onRun={runCheck}
              runMessage={runMessage}
            />
            <HistoryBlock check={check} />

            {needsReason && (
              <div>
                <label className="mb-1 block text-sm font-medium text-slate-700">
                  {confirm === "bar" ? "Reason for barring" : "Rejection reason"}
                  <span className="text-red-500 ml-1">(required)</span>
                </label>
                {confirm === "reject" && (
                  <div className="flex flex-wrap gap-2 mb-2">
                    {REJECT_CHIPS.map((chip) => (
                      <button
                        key={chip}
                        type="button"
                        onClick={() => setReason(chip)}
                        className={`rounded-full border px-3 py-1 text-xs transition-colors ${
                          reason === chip ? "border-red-400 bg-red-100 text-red-700" : "border-slate-200 bg-white text-slate-600 hover:border-red-300 hover:bg-red-50"
                        }`}
                      >
                        {chip}
                      </button>
                    ))}
                  </div>
                )}
                <Textarea value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Select a reason above or type one..." className="resize-none" rows={2} />
              </div>
            )}

            <div className="space-y-2 pt-2">
              {confirm === null ? (
                <>
                  {decides && (
                    <div className="flex gap-3">
                      <div className="flex-1">
                        <Button className="w-full bg-green-500 hover:bg-green-600 text-white" disabled={!!approveBlocked} onClick={() => setConfirm("approve")}>
                          <CheckCircle2 className="mr-2 h-4 w-4" /> APPROVE DBS
                        </Button>
                        {approveBlocked && <p className="mt-1 text-xs text-slate-500">{approveBlocked}</p>}
                      </div>
                      <Button variant="outline" className="flex-1 text-red-600 border-red-300 hover:bg-red-50" onClick={() => setConfirm("reject")}>
                        <X className="mr-2 h-4 w-4" /> REJECT
                      </Button>
                    </div>
                  )}
                  {(decides || list === "recheckAlerts") && (
                    <div className="flex justify-end border-t pt-2">
                      <span className="mr-2 self-center text-xs text-slate-400">More:</span>
                      <Button size="sm" className="bg-red-600 hover:bg-red-700 text-white" onClick={() => setConfirm("bar")}>
                        <Ban className="mr-1 h-3.5 w-3.5" /> BAR
                      </Button>
                    </div>
                  )}
                  {list === "barred" && (
                    <Button variant="outline" className="w-full" onClick={() => setConfirm("lift")}>
                      <Unlock className="mr-2 h-4 w-4" /> LIFT BAR
                    </Button>
                  )}
                </>
              ) : (
                <div className={`flex flex-1 items-center gap-3 rounded-lg border p-3 ${confirm === "approve" || confirm === "lift" ? "border-green-200 bg-green-50" : "border-red-200 bg-red-50"}`}>
                  <span className={`text-sm font-medium ${confirm === "approve" || confirm === "lift" ? "text-green-700" : "text-red-700"}`}>{CONFIRM_TEXT[confirm]}</span>
                  <div className="ml-auto flex gap-2">
                    <Button size="sm" variant="outline" disabled={loading || (needsReason && !reason.trim())} onClick={act}>
                      {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : YES_LABEL[confirm]}
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => setConfirm(null)} disabled={loading}>
                      Cancel
                    </Button>
                  </div>
                </div>
              )}
            </div>
          </div>
        </DialogContent>
      </Dialog>

      <ContactUserModal
        userEmail={check.email ?? ""}
        userName={name}
        userId={check.user_id}
        open={contactOpen}
        onOpenChange={setContactOpen}
        defaultSubject={PAGE2_SUBJECT}
        defaultBody={PAGE2_BODY}
        logActionType="dbs_page2_requested"
      />

      {zoomed && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/90 p-4 cursor-pointer" onClick={() => setZoomed(null)}>
          <button type="button" onClick={() => setZoomed(null)} className="absolute top-4 right-4 rounded-full bg-white/20 p-2 text-white hover:bg-white/40 transition-colors">
            <X className="h-6 w-6" />
          </button>
          <img src={zoomed} alt="Enlarged certificate" className="max-h-full max-w-full rounded-lg object-contain" onClick={(e) => e.stopPropagation()} />
        </div>
      )}
    </>
  );
}
