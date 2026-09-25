"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Card, CardContent } from "@/components/ui/card";
import { adminVerifyIdentity, adminRejectIdentity } from "@/lib/actions/admin";
import { formatRelativeTime } from "@/lib/utils";
import { AlertTriangle, CheckCircle2, X, Loader2, ImageOff, Pencil } from "lucide-react";
import type { PendingIdentityCheck } from "./page";

interface IDCheckModalProps {
  check: PendingIdentityCheck | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

// Country/nationality equivalence — "United Kingdom" and "BRITISH CITIZEN" are the same
const COUNTRY_NATIONALITY_MAP: Record<string, string[]> = {
  'united kingdom': ['british', 'british citizen', 'gbr', 'uk'],
  'australia': ['australian', 'aus'],
  'new zealand': ['new zealander', 'nzl', 'kiwi'],
  'united states': ['american', 'usa', 'us'],
  'canada': ['canadian', 'can'],
  'ireland': ['irish', 'irl'],
  'south africa': ['south african', 'zaf'],
  'india': ['indian', 'ind'],
  'china': ['chinese', 'chn'],
  'philippines': ['filipino', 'philippine', 'phl'],
};

function isNationalityMatch(country: string | null, nationality: string | null): boolean {
  if (!country || !nationality) return true; // no data = no mismatch
  const c = country.toLowerCase().trim();
  const n = nationality.toLowerCase().trim();
  if (c === n) return true;
  // Check if either value appears in the other's equivalence group
  for (const [key, aliases] of Object.entries(COUNTRY_NATIONALITY_MAP)) {
    const group = [key, ...aliases];
    if (group.includes(c) && group.includes(n)) return true;
  }
  return false;
}

function isFirstNameMatch(submitted: string | null, extracted: string | null): boolean {
  if (!submitted || !extracted) return true;
  const subFirst = submitted.toLowerCase().trim().split(/\s+/)[0];
  const extFirst = extracted.toLowerCase().trim().split(/\s+/)[0];
  return subFirst === extFirst;
}

function DetailRow({ label, submitted, extracted, isNationality, isGivenNames }: {
  label: string;
  submitted: string | null;
  extracted: string | null;
  isNationality?: boolean;
  isGivenNames?: boolean;
}) {
  const mismatch = submitted && extracted && (
    isNationality
      ? !isNationalityMatch(submitted, extracted)
      : isGivenNames
      ? !isFirstNameMatch(submitted, extracted)
      : submitted.toLowerCase().trim() !== extracted.toLowerCase().trim()
  );
  return (
    <div className="flex justify-between">
      <span className="font-medium text-slate-500">{label}</span>
      <span className={mismatch ? "font-semibold text-red-600" : ""}>
        {extracted || "-"}
        {mismatch && <span className="ml-1 text-xs text-red-400">(mismatch)</span>}
      </span>
    </div>
  );
}

export function IDCheckModal({ check, open, onOpenChange }: IDCheckModalProps) {
  const router = useRouter();
  const [comments, setComments] = useState("");
  const [confirmAction, setConfirmAction] = useState<"verify" | "reject" | null>(null);
  const [loading, setLoading] = useState(false);
  const [zoomedImage, setZoomedImage] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [editedFields, setEditedFields] = useState<Record<string, string>>({});

  if (!check) return null;

  const name = `${check.first_name || ""} ${check.last_name || ""}`.trim() || "Unknown";

  // AI data helpers
  const hasAIData = !!(check.extracted_surname || check.extracted_given_names || check.extracted_dob || check.identity_ai_reasoning);
  const aiIssues: string[] = (() => {
    if (!check.identity_ai_issues) return [];
    try { return JSON.parse(check.identity_ai_issues); } catch { return []; }
  })();

  function formatDate(dateStr: string | null): string {
    if (!dateStr) return "-";
    return new Date(dateStr).toLocaleDateString("en-GB", {
      day: "numeric",
      month: "short",
      year: "numeric",
    });
  }

  async function handleVerify() {
    setLoading(true);
    const result = await adminVerifyIdentity(check!.id);
    setLoading(false);

    if (result.success) {
      setConfirmAction(null);
      setComments("");
      onOpenChange(false);
      router.refresh();
    } else {
      alert(`Error: ${result.error}`);
    }
  }

  async function handleReject() {
    if (!comments.trim()) {
      alert("Please enter a reason for rejection.");
      return;
    }
    setLoading(true);
    const result = await adminRejectIdentity(check!.id, comments);
    setLoading(false);

    if (result.success) {
      setConfirmAction(null);
      setComments("");
      onOpenChange(false);
      router.refresh();
    } else {
      alert(`Error: ${result.error}`);
    }
  }

  function handleClose(openState: boolean) {
    if (!openState) {
      setConfirmAction(null);
      setComments("");
      setZoomedImage(null);
      setEditing(false);
      setEditedFields({});
    }
    onOpenChange(openState);
  }

  return (
    <>
      <Dialog open={open} onOpenChange={handleClose}>
        <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Identity Verification Review</DialogTitle>
            <DialogDescription>
              {name} — submitted {formatRelativeTime(check.created_at)}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 mt-2">
            {/* Photo Comparison — Selfie left, Passport right */}
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div>
                <p className="mb-1 text-xs font-semibold text-slate-500 uppercase">
                  Identification Photo
                </p>
                {check.identification_photo_url ? (
                  <img
                    src={check.identification_photo_url}
                    alt="ID Photo"
                    className="w-full max-h-52 rounded-lg border-2 border-slate-200 object-contain cursor-zoom-in bg-slate-50"
                    onClick={() => setZoomedImage(check.identification_photo_url!)}
                  />
                ) : (
                  <div className="flex h-52 items-center justify-center rounded-lg border-2 border-dashed border-slate-200 bg-slate-50">
                    <div className="text-center text-slate-400">
                      <ImageOff className="mx-auto h-8 w-8" />
                      <p className="mt-1 text-xs">No photo uploaded</p>
                    </div>
                  </div>
                )}
              </div>
              <div>
                <p className="mb-1 text-xs font-semibold text-slate-500 uppercase">
                  Passport Photo
                </p>
                {check.passport_upload_url ? (
                  <img
                    src={check.passport_upload_url}
                    alt="Passport"
                    className="w-full max-h-52 rounded-lg border-2 border-slate-200 object-contain cursor-zoom-in bg-slate-50"
                    onClick={() => setZoomedImage(check.passport_upload_url!)}
                  />
                ) : (
                  <div className="flex h-52 items-center justify-center rounded-lg border-2 border-dashed border-slate-200 bg-slate-50">
                    <div className="text-center text-slate-400">
                      <ImageOff className="mx-auto h-8 w-8" />
                      <p className="mt-1 text-xs">No document uploaded</p>
                    </div>
                  </div>
                )}
              </div>
            </div>

            {/* Details Comparison */}
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              {/* Submitted Details */}
              <Card>
                <CardContent className="p-4">
                  <h3 className="mb-2 text-sm font-semibold text-slate-700">Submitted Details</h3>
                  <div className="space-y-1.5 text-sm">
                    <div className="flex justify-between">
                      <span className="font-medium text-slate-500">Surname</span>
                      <span>{check.surname || "-"}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="font-medium text-slate-500">Given Name(s)</span>
                      <span>{check.given_names || "-"}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="font-medium text-slate-500">Date of Birth</span>
                      <span>{formatDate(check.date_of_birth)}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="font-medium text-slate-500">Country of Issue</span>
                      <span>{check.passport_country || "-"}</span>
                    </div>
                  </div>
                </CardContent>
              </Card>

              {/* AI Extracted Details (editable) */}
              <Card className={hasAIData ? "border-slate-200" : "border-dashed"}>
                <CardContent className="p-4">
                  <div className="mb-2 flex items-center justify-between">
                    <h3 className="text-sm font-semibold text-slate-700">AI Extracted Details</h3>
                    {hasAIData && (
                      <button
                        type="button"
                        onClick={() => {
                          if (!editing) {
                            setEditedFields({
                              extracted_surname: check.extracted_surname ?? '',
                              extracted_given_names: check.extracted_given_names ?? '',
                              extracted_dob: check.extracted_dob ?? '',
                              extracted_nationality: check.extracted_nationality ?? '',
                              extracted_passport_number: check.extracted_passport_number ?? '',
                              extracted_passport_expiry: check.extracted_passport_expiry ?? '',
                            });
                          }
                          setEditing(!editing);
                        }}
                        className="flex items-center gap-1 text-xs text-violet-600 hover:text-violet-800"
                      >
                        <Pencil className="h-3 w-3" />
                        {editing ? 'Done' : 'Edit'}
                      </button>
                    )}
                  </div>
                  {hasAIData ? (
                    editing ? (
                      <div className="space-y-2 text-sm">
                        {[
                          { key: 'extracted_surname', label: 'Surname' },
                          { key: 'extracted_given_names', label: 'Given Name(s)' },
                          { key: 'extracted_dob', label: 'Date of Birth' },
                          { key: 'extracted_nationality', label: 'Nationality' },
                          { key: 'extracted_passport_number', label: 'Passport #' },
                          { key: 'extracted_passport_expiry', label: 'Expiry' },
                        ].map(({ key, label }) => (
                          <div key={key} className="flex items-center gap-2">
                            <span className="w-28 shrink-0 font-medium text-slate-500">{label}</span>
                            <Input
                              value={editedFields[key] ?? ''}
                              onChange={(e) => setEditedFields(prev => ({ ...prev, [key]: e.target.value }))}
                              className="h-7 text-sm"
                            />
                          </div>
                        ))}
                      </div>
                    ) : (
                      <div className="space-y-1.5 text-sm">
                        <DetailRow label="Surname" submitted={check.surname} extracted={check.extracted_surname} />
                        <DetailRow label="Given Name(s)" submitted={check.given_names} extracted={check.extracted_given_names} isGivenNames />
                        <DetailRow label="Date of Birth" submitted={check.date_of_birth} extracted={check.extracted_dob} />
                        <DetailRow label="Nationality" submitted={check.passport_country} extracted={check.extracted_nationality} isNationality />
                        <div className="flex justify-between">
                          <span className="font-medium text-slate-500">Passport #</span>
                          <span>{check.extracted_passport_number || "-"}</span>
                        </div>
                        <div className="flex justify-between">
                          <span className="font-medium text-slate-500">Expiry</span>
                          <span>{check.extracted_passport_expiry ? formatDate(check.extracted_passport_expiry) : "-"}</span>
                        </div>
                      </div>
                    )
                  ) : (
                    <div className="flex h-24 items-center justify-center">
                      <div className="rounded-lg bg-yellow-50 border border-yellow-200 px-3 py-2">
                        <p className="text-sm text-yellow-700">AI analysis pending...</p>
                      </div>
                    </div>
                  )}
                </CardContent>
              </Card>
            </div>

            {/* AI Flagged Issues */}
            {hasAIData ? (
              aiIssues.length > 0 ? (
                <Card className="border-red-200 bg-red-50">
                  <CardContent className="p-4">
                    <h3 className="mb-2 flex items-center gap-2 text-sm font-semibold text-red-700">
                      <AlertTriangle className="h-4 w-4" />
                      AI Flagged Issues
                    </h3>
                    <ul className="space-y-1 text-sm text-red-600">
                      {aiIssues.map((issue, i) => (
                        <li key={i} className="flex items-start gap-2">
                          <span className="mt-0.5 text-red-400">-</span>
                          <span>{issue}</span>
                        </li>
                      ))}
                    </ul>
                    {check.identity_ai_reasoning && (
                      <details className="mt-3">
                        <summary className="cursor-pointer text-xs font-medium text-red-500 hover:text-red-700">
                          View AI reasoning
                        </summary>
                        <ul className="mt-2 text-xs text-red-600 rounded bg-red-100/50 p-2 space-y-1 list-disc list-inside">
                          {check.identity_ai_reasoning.split(/\n|(?:\d+\.\s)/).filter(Boolean).map((line, i) => (
                            <li key={i}>{line.replace(/^[-•]\s*/, '').trim()}</li>
                          ))}
                        </ul>
                      </details>
                    )}
                  </CardContent>
                </Card>
              ) : (
                <Card className="border-green-200 bg-green-50">
                  <CardContent className="p-4">
                    <h3 className="flex items-center gap-2 text-sm font-semibold text-green-700">
                      <CheckCircle2 className="h-4 w-4" />
                      AI Check Passed
                    </h3>
                    <p className="mt-1 text-sm text-green-600">
                      No issues detected. Document appears authentic and details match.
                    </p>
                    {check.identity_ai_reasoning && (
                      <details className="mt-3">
                        <summary className="cursor-pointer text-xs font-medium text-green-500 hover:text-green-700">
                          View AI reasoning
                        </summary>
                        <ul className="mt-2 text-xs text-green-700 rounded bg-green-100/50 p-2 space-y-1 list-disc list-inside">
                          {check.identity_ai_reasoning.split(/\n|(?:\d+\.\s)/).filter(Boolean).map((line, i) => (
                            <li key={i}>{line.replace(/^[-•]\s*/, '').trim()}</li>
                          ))}
                        </ul>
                      </details>
                    )}
                  </CardContent>
                </Card>
              )
            ) : (
              <Card className="border-yellow-200 bg-yellow-50">
                <CardContent className="p-4">
                  <h3 className="mb-1 flex items-center gap-2 text-sm font-semibold text-yellow-700">
                    <AlertTriangle className="h-4 w-4" />
                    AI Analysis Pending
                  </h3>
                  <p className="text-sm text-yellow-600">
                    AI analysis has not completed yet. You may wait for it to finish or proceed with manual review.
                  </p>
                </CardContent>
              </Card>
            )}

            {/* Previous rejection reason (if re-review) */}
            {check.identity_rejection_reason && (
              <Card className="border-yellow-200 bg-yellow-50">
                <CardContent className="p-4">
                  <h3 className="mb-1 text-sm font-semibold text-yellow-700">
                    Previous Rejection Reason
                  </h3>
                  <p className="text-sm text-yellow-800">{check.identity_rejection_reason}</p>
                </CardContent>
              </Card>
            )}

            {/* Rejection Reason / Comments */}
            <div>
              <label className="mb-1 block text-sm font-medium text-slate-700">
                {confirmAction === "reject" ? "Rejection Reason" : "Admin Comments"}
                {confirmAction === "reject" && <span className="text-red-500 ml-1">(required)</span>}
              </label>
              {confirmAction === "reject" && (
                <div className="flex flex-wrap gap-2 mb-2">
                  {[
                    "Your surname does not match your passport",
                    "Your date of birth does not match your passport",
                    "Your passport has expired",
                    "Your passport image is unclear or unreadable",
                    "Your selfie does not match the photo on your passport",
                    "Your selfie does not meet requirements",
                  ].map((reason) => (
                    <button
                      key={reason}
                      type="button"
                      onClick={() => setComments(reason)}
                      className={`rounded-full border px-3 py-1 text-xs transition-colors ${
                        comments === reason
                          ? "border-red-400 bg-red-100 text-red-700"
                          : "border-slate-200 bg-white text-slate-600 hover:border-red-300 hover:bg-red-50"
                      }`}
                    >
                      {reason}
                    </button>
                  ))}
                </div>
              )}
              <Textarea
                value={comments}
                onChange={(e) => setComments(e.target.value)}
                placeholder={confirmAction === "reject" ? "Select a reason above or type a custom reason..." : "Optional admin notes..."}
                className="resize-none"
                rows={2}
              />
            </div>

            {/* Action Buttons */}
            <div className="flex gap-3 pt-2">
              {confirmAction === null ? (
                <>
                  <Button
                    className="flex-1 bg-green-500 hover:bg-green-600 text-white"
                    onClick={() => setConfirmAction("verify")}
                  >
                    <CheckCircle2 className="mr-2 h-4 w-4" />
                    VERIFY USER
                  </Button>
                  <Button
                    variant="outline"
                    className="flex-1 text-red-600 border-red-300 hover:bg-red-50"
                    onClick={() => setConfirmAction("reject")}
                  >
                    <X className="mr-2 h-4 w-4" />
                    REJECT
                  </Button>
                </>
              ) : confirmAction === "verify" ? (
                <div className="flex flex-1 items-center gap-3 rounded-lg border border-green-200 bg-green-50 p-3">
                  <span className="text-sm font-medium text-green-700">
                    Are you sure you want to verify this user?
                  </span>
                  <div className="ml-auto flex gap-2">
                    <Button
                      size="sm"
                      className="bg-green-500 hover:bg-green-600 text-white"
                      disabled={loading}
                      onClick={handleVerify}
                    >
                      {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : "Yes, Verify"}
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => setConfirmAction(null)}
                      disabled={loading}
                    >
                      Cancel
                    </Button>
                  </div>
                </div>
              ) : (
                <div className="flex flex-1 items-center gap-3 rounded-lg border border-red-200 bg-red-50 p-3">
                  <span className="text-sm font-medium text-red-700">
                    Are you sure you want to reject?
                  </span>
                  <div className="ml-auto flex gap-2">
                    <Button
                      size="sm"
                      variant="outline"
                      className="text-red-600 border-red-300 hover:bg-red-100"
                      disabled={loading || !comments.trim()}
                      onClick={handleReject}
                    >
                      {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : "Yes, Reject"}
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => setConfirmAction(null)}
                      disabled={loading}
                    >
                      Cancel
                    </Button>
                  </div>
                </div>
              )}
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Image Zoom Overlay — portal outside Dialog to avoid click interception */}
      {zoomedImage && (
        <div
          className="fixed inset-0 z-[100] flex items-center justify-center bg-black/90 p-4 cursor-pointer"
          onClick={() => setZoomedImage(null)}
        >
          <button
            type="button"
            onClick={() => setZoomedImage(null)}
            className="absolute top-4 right-4 rounded-full bg-white/20 p-2 text-white hover:bg-white/40 transition-colors"
          >
            <X className="h-6 w-6" />
          </button>
          <img
            src={zoomedImage}
            alt="Enlarged"
            className="max-h-full max-w-full rounded-lg object-contain"
            onClick={(e) => e.stopPropagation()}
          />
        </div>
      )}
    </>
  );
}
