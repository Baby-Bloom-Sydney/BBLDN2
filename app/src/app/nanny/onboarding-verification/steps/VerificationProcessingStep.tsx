"use client";

/**
 * Onboarding step 4 — the processing screen, with real polling (extracted from OnboardingVerificationClient by unit
 * 3b, BB-LDN-3b-061026; brief change 5; rulings #10, #30; copy deck §1.4).
 *
 * The DBS half reads `getDbsDisplayState`, not the bare code: "You're verified!" only at `clear` (30/40), so a 21
 * (review) can never show success (the old `s >= 30`-adjacent defect), and API-down (`technical_retry`, held at 20)
 * goes to the failure bucket, which sends her to /nanny/verification where the card is shown.
 */
import { useEffect, useRef, useState } from "react";
import { AlertCircle, CheckCircle2, Loader2, ShieldCheck } from "lucide-react";
import { ID_FAILED_CODES, ID_REVIEW_CODES } from "@/lib/verification";
import {
  dbsInputFromPoll,
  getDbsDisplayState,
  isDbsFailState,
  type DbsDisplayInput,
  type DbsDisplayState,
} from "@/lib/dbs/nanny-display";

interface ProcessingProfile {
  firstName: string;
  profilePictureUrl: string | null;
  bioSnippet: string | null;
}

const DBS_REVIEW_STATES: ReadonlySet<DbsDisplayState> = new Set(["with_team", "manual_review"]);

export function VerificationProcessingStep({
  profile,
  onComplete,
}: {
  profile: ProcessingProfile;
  onComplete: (outcome: "success" | "failure" | "review") => void;
}) {
  const [poll, setPoll] = useState<DbsDisplayInput | null>(null);
  const statusCode = poll?.verification_status ?? null;
  const [contactSaved, setContactSaved] = useState(false);

  const enterTimeRef = useRef(Date.now());
  const [residenceDoneAt, setResidenceDoneAt] = useState<number | null>(null);
  const [identityDoneAt, setIdentityDoneAt] = useState<number | null>(null);
  const [dbsDoneAt, setDbsDoneAt] = useState<number | null>(null);

  // Minimum display timings
  const MIN_RESIDENCE_DELAY = 1000;
  const MIN_IDENTITY_DELAY = 3000;
  const MIN_DBS_DELAY = 5500;

  const [showResidenceDone, setShowResidenceDone] = useState(false);
  const [showIdentityDone, setShowIdentityDone] = useState(false);
  const [showDbsDone, setShowDbsDone] = useState(false);

  // Poll /api/verification-status every 3 seconds
  useEffect(() => {
    let intervalId: ReturnType<typeof setInterval>;

    const poll = async () => {
      try {
        const res = await fetch("/api/verification-status");
        if (!res.ok) return;
        const data = await res.json();
        if (data.status === null || data.status === undefined) return;
        setPoll(dbsInputFromPoll(data));
        if (data.contact_status === "saved") setContactSaved(true);
      } catch {
        // Ignore fetch errors, retry on next interval
      }
    };

    poll(); // Initial poll
    intervalId = setInterval(poll, 3000);

    return () => clearInterval(intervalId);
  }, []);

  // Derive sub-step states from integer status code
  const s = statusCode ?? -1;
  const isResidenceDone = contactSaved;
  const isIdentityDone = s >= 20; // Past the ID stage, into the DBS step or beyond
  const isIdentityFailed = ID_FAILED_CODES.has(s);
  const isIdentityReview = ID_REVIEW_CODES.has(s);
  const dbsState = getDbsDisplayState(poll);
  const isDbsDone = dbsState === "clear"; // 30 or 40 only — never 21 (copy deck §1.4)
  const isDbsFailed = isDbsFailState(dbsState) || dbsState === "barred";
  const isDbsReview = DBS_REVIEW_STATES.has(dbsState);

  // Apply minimum display timings
  useEffect(() => {
    if (statusCode === null) return;
    const now = Date.now();
    const elapsed = now - enterTimeRef.current;

    if (isResidenceDone && !residenceDoneAt) {
      setResidenceDoneAt(now);
      const delay = Math.max(0, MIN_RESIDENCE_DELAY - elapsed);
      setTimeout(() => setShowResidenceDone(true), delay);
    }

    if (isIdentityDone && !identityDoneAt) {
      setIdentityDoneAt(now);
      const delay = Math.max(0, MIN_IDENTITY_DELAY - elapsed);
      setTimeout(() => setShowIdentityDone(true), delay);
    }

    if (isDbsDone && !dbsDoneAt) {
      setDbsDoneAt(now);
      const delay = Math.max(0, MIN_DBS_DELAY - elapsed);
      setTimeout(() => setShowDbsDone(true), delay);
    }
  }, [
    statusCode,
    isResidenceDone,
    isIdentityDone,
    isDbsDone,
    residenceDoneAt,
    identityDoneAt,
    dbsDoneAt,
  ]);

  // Determine outcome — only fire once
  const allVerified = showResidenceDone && showIdentityDone && showDbsDone;
  const hasFailed = isIdentityFailed || isDbsFailed;
  const hasReview = (isIdentityReview || isDbsReview) && !hasFailed;
  const completedRef = useRef(false);

  useEffect(() => {
    if (completedRef.current) return;
    if (allVerified) {
      completedRef.current = true;
      onComplete("success");
    } else if (hasFailed) {
      completedRef.current = true;
      onComplete("failure");
    } else if (hasReview && showResidenceDone) {
      completedRef.current = true;
      onComplete("review");
    }
  }, [allVerified, hasFailed, hasReview, showResidenceDone, onComplete]);

  const subSteps = [
    {
      label: "Residence",
      status: showResidenceDone ? "done" : "current",
    },
    {
      label: "ID",
      status: isIdentityFailed
        ? "failed"
        : isIdentityReview
          ? "review"
          : showIdentityDone
            ? "done"
            : showResidenceDone
              ? "current"
              : "upcoming",
    },
    {
      label: "DBS",
      status: isDbsFailed
        ? "failed"
        : isDbsReview
          ? "review"
          : showDbsDone
            ? "done"
            : showIdentityDone
              ? "current"
              : "upcoming",
    },
  ];

  const verifyDone = allVerified || hasFailed || hasReview;

  const mainSteps = [
    {
      status: "done" as const,
      title: "Account Secured",
      desc: "Your profile is protected",
      spinning: false,
    },
    {
      status: (verifyDone ? "done" : "current") as "done" | "current",
      title: hasFailed
        ? "Verification Issue"
        : allVerified
          ? "Verified"
          : hasReview
            ? "Under Review"
            : "Verifying",
      desc: hasFailed
        ? isIdentityFailed
          ? "We ran into an issue with your documents"
          : "We ran into an issue with your certificate"
        : allVerified
          ? "Verification complete"
          : hasReview
            ? "Manual review in progress"
            : "Confirming your account details",
      spinning: !verifyDone,
    },
    {
      status: (allVerified ? "current" : "upcoming") as "current" | "upcoming",
      title: "Connect",
      desc: "Start receiving family opportunities",
      spinning: false,
    },
  ];

  const initial = profile.firstName?.charAt(0)?.toUpperCase() || "N";

  return (
    <div className="flex flex-col items-center text-center min-h-[calc(100vh-6rem)]">
      {/* Header */}
      <div className="pt-8 pb-4">
        <h2 className="text-xl sm:text-2xl font-semibold text-slate-800 leading-snug">
          {hasFailed
            ? "We ran into an issue"
            : allVerified
              ? "You\u2019re verified!"
              : hasReview
                ? "Under review"
                : "Verifying your account"}
        </h2>
        <p className="text-sm text-slate-500 mt-2">
          {hasFailed
            ? isIdentityFailed
              ? "There was a problem verifying your documents. Please review and try again."
              : "There was a problem with your certificate. We'll show you what to fix."
            : allVerified
              ? "You are now able to connect with families looking for childcare"
              : hasReview
                ? "Your documents are being reviewed. This usually takes 1-3 days."
                : isDbsDone
                  ? "Almost done…"
                  : dbsState === "checking"
                    ? "Checking with the DBS Update Service…"
                    : "Reading your certificate…"}
        </p>
      </div>

      {/* Card + stepper */}
      <div className="flex-1 flex flex-col items-center justify-center gap-6 w-full pb-24">
        {/* Profile card */}
        <div
          className={`bg-white rounded-xl border shadow-sm p-4 flex items-center gap-4 max-w-sm w-full transition-colors duration-700 ${
            hasFailed
              ? "border-red-300"
              : allVerified
                ? "border-green-300"
                : hasReview
                  ? "border-amber-300"
                  : "border-slate-200"
          }`}
        >
          <div className="relative shrink-0">
            {profile.profilePictureUrl ? (
              <img
                src={profile.profilePictureUrl}
                alt={profile.firstName || "Profile"}
                className="w-14 h-14 rounded-full overflow-hidden border-2 border-violet-200 object-cover"
              />
            ) : (
              <div className="w-14 h-14 rounded-full overflow-hidden border-2 border-violet-200 bg-violet-100 flex items-center justify-center">
                <span className="text-xl font-bold text-violet-600">
                  {initial}
                </span>
              </div>
            )}
            <div
              className={`absolute -bottom-0.5 -right-0.5 flex items-center justify-center rounded-full border ring-2 ring-white ${
                hasFailed
                  ? "bg-red-50 border-red-200"
                  : allVerified
                    ? "bg-green-50 border-green-200"
                    : "bg-green-50 border-green-200 animate-[verifyPulse_2s_ease-in-out_infinite]"
              }`}
              style={{ height: "22px", width: "22px" }}
            >
              <ShieldCheck
                className={`h-3 w-3 ${hasFailed ? "text-red-700" : "text-green-700"}`}
              />
            </div>
          </div>
          <div className="text-left flex-1 min-w-0">
            <p className="font-semibold text-slate-800 text-sm">
              {profile.firstName || "Nanny"}
            </p>
            <p className="text-xs text-slate-500 line-clamp-2">
              {profile.bioSnippet || "Professional nanny"}
            </p>
          </div>
        </div>

        <style>{`
          @keyframes verifyPulse {
            0%, 100% { opacity: 0; }
            30%, 70% { opacity: 1; }
          }
        `}</style>

        {/* Vertical stepper */}
        <div className="w-full max-w-xs mx-auto pt-2">
          {mainSteps.map((s, i) => (
            <div key={s.title} className="flex items-stretch gap-4">
              <div className="flex flex-col items-center">
                {s.status === "done" ? (
                  <div className="w-8 h-8 rounded-full bg-green-100 flex items-center justify-center shrink-0 transition-colors duration-500">
                    <CheckCircle2 className="w-5 h-5 text-green-600" />
                  </div>
                ) : s.status === "current" && s.spinning ? (
                  <div className="w-8 h-8 rounded-full border-[2.5px] border-violet-500 bg-white flex items-center justify-center shrink-0">
                    <Loader2 className="w-4 h-4 text-violet-500 animate-spin" />
                  </div>
                ) : s.status === "current" ? (
                  <div className="w-8 h-8 rounded-full border-[2.5px] border-violet-500 bg-white flex items-center justify-center shrink-0">
                    <div className="w-2.5 h-2.5 rounded-full bg-violet-500" />
                  </div>
                ) : (
                  <div className="w-8 h-8 rounded-full border-2 border-slate-200 bg-white shrink-0" />
                )}
                {i < mainSteps.length - 1 && (
                  <div
                    className={`w-0.5 flex-1 min-h-[28px] transition-colors duration-500 ${
                      s.status === "done" ? "bg-green-200" : "bg-slate-200"
                    }`}
                  />
                )}
              </div>

              <div
                className={`text-left pb-5 ${i === mainSteps.length - 1 ? "pb-0" : ""}`}
              >
                <p
                  className={`text-sm font-semibold leading-tight transition-colors duration-500 ${
                    s.status === "done"
                      ? "text-green-700"
                      : s.status === "current"
                        ? "text-slate-800"
                        : "text-slate-400"
                  }`}
                >
                  {s.title}
                </p>
                <p
                  className={`text-xs mt-0.5 transition-colors duration-500 ${
                    s.status === "upcoming"
                      ? "text-slate-300"
                      : "text-slate-500"
                  }`}
                >
                  {s.desc}
                </p>

                {/* Sub-steps under Verify */}
                {i === 1 && (
                  <div className="mt-2.5 space-y-1.5">
                    {subSteps.map((sub) => (
                      <div key={sub.label} className="flex items-center gap-2">
                        {sub.status === "done" ? (
                          <CheckCircle2 className="w-3.5 h-3.5 text-green-500 shrink-0" />
                        ) : sub.status === "failed" ? (
                          <AlertCircle className="w-3.5 h-3.5 text-red-500 shrink-0" />
                        ) : sub.status === "review" ? (
                          <Loader2 className="w-3.5 h-3.5 text-amber-500 shrink-0" />
                        ) : sub.status === "current" ? (
                          <Loader2 className="w-3.5 h-3.5 text-violet-500 animate-spin shrink-0" />
                        ) : (
                          <div className="w-1.5 h-1.5 rounded-full bg-slate-300 shrink-0 ml-1 mr-0.5" />
                        )}
                        <span
                          className={`text-xs transition-colors duration-300 ${
                            sub.status === "done"
                              ? "text-green-600"
                              : sub.status === "failed"
                                ? "text-red-600"
                                : sub.status === "review"
                                  ? "text-amber-600"
                                  : sub.status === "current"
                                    ? "text-violet-600 font-medium"
                                    : "text-slate-400"
                          }`}
                        >
                          {sub.label}
                          {sub.status === "failed" && " — Failed"}
                          {sub.status === "review" && " — Under Review"}
                        </span>
                      </div>
                    ))}
                  </div>
                )}

                {/* Note under Connect */}
                {i === 2 && !allVerified && (
                  <p className="text-xs text-slate-300 mt-1 italic">
                    Only verified nannies can connect with families.
                  </p>
                )}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
