"use client";

/**
 * The DBS certificate section of /nanny/verification (file name kept — renaming is cleanup, D-4).
 * Unit 3b, BB-LDN-3b-061026: brief changes 3, 7, 8; rulings #6, #7, #13, #18, #22; copy deck §2.3–§2.4, §3.
 *
 * Edit mode is the same body as onboarding step 3 (`DbsCertificateStep`). Display mode is one branch per
 * `getDbsDisplayState` state. Fail states carry Edit & Resubmit + Request manual review (3c's
 * `submitDbsForManualReview`); barred carries none.
 */
import { useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { GuidanceCard } from "./GuidanceCard";
import { DbsCertificateStep } from "../../onboarding-verification/steps/DbsCertificateStep";
import { submitWWCCSection } from "@/lib/actions/verification";
import { submitDbsForManualReview } from "@/lib/actions/dbs-review";
import { fireDbsCheck } from "@/lib/dbs/run-dbs-check";
import { DBS_VERIFICATION_METHOD, type UserGuidance } from "@/lib/verification";
import {
  getDbsDisplayState,
  dbsCardFor,
  dbsCardExtras,
  isDbsFailState,
  formatDbsNumber,
  formatDbsDate,
  type DbsDisplayState,
} from "@/lib/dbs/nanny-display";
import type { VerificationData } from "@/lib/actions/verification";

interface WWCCSectionProps {
  verification: VerificationData | null;
  identityVerified?: boolean;
  onSaved: (verificationId: string, method: string) => void;
}

const SAVE_ERROR = "We couldn't save your certificate. Please try again.";
const REVIEW_ERROR = "We couldn't send your request. Please try again.";

/** The reason a state implies when the stored guidance carries no code (deck §4 cards). */
const STATE_REASON: Partial<Record<DbsDisplayState, string>> = {
  new_info: "DBS_NEW_INFO",
  no_match: "DBS_NO_MATCH",
  technical_retry: "TECHNICAL_RETRY",
  barred: "DBS_BARRED",
};

/** Deck §2.4 "Failed, no guidance" — the fallback card when a fail state has nothing stored. */
const NO_GUIDANCE_CARD: UserGuidance = {
  title: "We couldn't verify your DBS certificate",
  explanation: "No worries — you can upload it again, or ask our team to check it by hand.",
  steps_to_fix: [],
};

export function WWCCSection({ verification, identityVerified, onSaved }: WWCCSectionProps) {
  const stored = getDbsDisplayState(verification);
  const [editing, setEditing] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [showReviewConfirm, setShowReviewConfirm] = useState(false);
  const [reviewSubmitting, setReviewSubmitting] = useState(false);
  const [reviewError, setReviewError] = useState<string | null>(null);
  const [reviewSent, setReviewSent] = useState(false);

  const state: DbsDisplayState = reviewSent ? "manual_review" : stored;

  async function handleSave(certificatePath: string) {
    setIsSaving(true);
    setSaveError(null);
    try {
      const result = await submitWWCCSection({ certificate_path: certificatePath, consent: true });
      if (!result.success || !result.verificationId) {
        setSaveError(result.error ?? SAVE_ERROR);
        return;
      }
      // Fire the AI now if ID is verified; otherwise the page queues it until identity passes.
      if (identityVerified) fireDbsCheck(result.verificationId);
      setEditing(false);
      setReviewSent(false);
      onSaved(result.verificationId, DBS_VERIFICATION_METHOD);
    } catch (err) {
      console.error("[WWCCSection] save failed:", err);
      setSaveError(SAVE_ERROR);
    } finally {
      setIsSaving(false);
    }
  }

  async function handleConfirmReview() {
    setShowReviewConfirm(false);
    setReviewSubmitting(true);
    setReviewError(null);
    try {
      const result = await submitDbsForManualReview();
      if (!result.success) {
        setReviewError(result.error ?? REVIEW_ERROR);
        return;
      }
      setReviewSent(true);
    } catch (err) {
      console.error("[WWCCSection] manual review request failed:", err);
      setReviewError(REVIEW_ERROR);
    } finally {
      setReviewSubmitting(false);
    }
  }

  function startEdit() {
    setShowReviewConfirm(false);
    setSaveError(null);
    setEditing(true);
  }

  // Not started always shows the form, even if the row resets while this section is mounted (review LOW).
  if (editing || (stored === "not_started" && !reviewSent)) {
    return (
      <div className="space-y-4">
        <p className="text-sm font-medium text-slate-700">Your DBS certificate</p>
        <DbsCertificateStep layout="inline" submitting={isSaving} error={saveError} onSubmit={handleSave} />
      </div>
    );
  }

  const guidance = verification?.wwcc_user_guidance ?? null;
  const reason = guidance?.reason_code ?? STATE_REASON[state];
  const failed = isDbsFailState(state);
  const actions = failed
    ? {
        primaryAction: { label: "Edit & Resubmit", onClick: startEdit },
        secondaryAction: {
          label: reviewSubmitting ? "Submitting..." : "Request manual review",
          onClick: () => !reviewSubmitting && setShowReviewConfirm(true),
        },
      }
    : {};
  // 22 shows the admin's reason in the red box; a guidance card is added only if one was stored.
  const showCard = (failed || state === "barred") && (state !== "rejected" || !!guidance);

  return (
    <div className="space-y-4">
      {reviewError && <div className="rounded-lg bg-red-50 p-3 text-sm text-red-600">{reviewError}</div>}
      {reviewSent && (
        <div role="status" className="rounded-lg bg-green-50 border border-green-200 p-3 text-sm text-green-700">
          Sent to our team. We&apos;ll email you.
        </div>
      )}

      <DbsStatus state={state} verification={verification} />

      {state === "rejected" && (
        <div className="rounded-lg bg-red-50 p-3 text-sm text-red-700">
          <p className="font-medium">We couldn&apos;t accept your DBS certificate</p>
          {verification?.wwcc_rejection_reason && <p className="mt-1">{verification.wwcc_rejection_reason}</p>}
        </div>
      )}

      {showCard && (
        <GuidanceCard
          guidance={guidance || reason ? dbsCardFor(reason, guidance) : NO_GUIDANCE_CARD}
          {...dbsCardExtras(reason)}
          {...actions}
        />
      )}

      {state === "rejected" && !guidance && (
        <div className="flex flex-col sm:flex-row gap-2">
          <Button type="button" onClick={startEdit} className="bg-violet-600 hover:bg-violet-700 text-white" size="sm">
            Edit &amp; Resubmit
          </Button>
          <Button
            type="button"
            variant="outline"
            onClick={() => setShowReviewConfirm(true)}
            disabled={reviewSubmitting}
            size="sm"
          >
            {reviewSubmitting ? "Submitting..." : "Request manual review"}
          </Button>
        </div>
      )}

      {/* Mirrors IdentitySection's dialog; its turnaround body kept as it is (#18). */}
      <Dialog open={showReviewConfirm} onOpenChange={setShowReviewConfirm}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Submit for manual review?</DialogTitle>
            <DialogDescription>
              Manual review can take up to 3 days. We recommend re-attempting verification first.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="flex gap-2 sm:gap-0">
            <Button type="button" onClick={startEdit} className="bg-violet-600 hover:bg-violet-700 text-white">
              No, I&apos;ll try again
            </Button>
            <Button type="button" variant="outline" onClick={handleConfirmReview}>
              Yes, submit for review
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

/** The non-card lines of display mode, one per state (deck §2.4). */
function DbsStatus({ state, verification }: { state: DbsDisplayState; verification: VerificationData | null }) {
  switch (state) {
    case "reading":
      return (
        <p className="text-sm text-slate-500">
          We&apos;re reading your DBS certificate. This usually takes about 15 seconds.
        </p>
      );
    case "checking":
      return <p className="text-sm text-slate-500">Checking your certificate with the DBS Update Service…</p>;
    case "clear":
      return (
        <div className="space-y-1 text-sm text-green-700">
          {verification?.wwcc_number && <p>Certificate number: {formatDbsNumber(verification.wwcc_number)}</p>}
          {verification?.wwcc_expiry_date && <p>Issued: {formatDbsDate(verification.wwcc_expiry_date)}</p>}
          {verification?.ocg_verified_at && (
            <p>Update Service: current · checked {formatDbsDate(verification.ocg_verified_at)}</p>
          )}
        </div>
      );
    case "with_team":
      // A cross-check mismatch has its own card on the page (deck §2.1); don't show two.
      if (verification?.cross_check_status === "review") return null;
      return (
        <div className="rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-700 space-y-1">
          <p className="font-medium text-amber-800">We&apos;re taking a closer look</p>
          <p>Our team checks some certificates by hand. You don&apos;t need to do anything — we&apos;ll email you.</p>
        </div>
      );
    case "manual_review":
      return (
        <div className="rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-700 space-y-1">
          <p className="font-medium text-amber-800">Pending manual review</p>
          <p>We&apos;ll check your DBS certificate by hand. This may take up to 3 days.</p>
        </div>
      );
    default:
      return null;
  }
}
