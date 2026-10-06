"use client";

/**
 * /nanny/verification — the three-step accordion (residence, ID, DBS) with status polling.
 * Unit 3b (BB-LDN-3b-061026, brief changes 1, 4, 6, 10; rulings #10, #30): the DBS step reads its state from the one
 * decoder (`getDbsDisplayState`) for its badge, default-open rule, stepper and "fully verified" banner; polling keeps
 * running while the certificate is read, the Update Service runs, or a technical retry is due; the certificate check
 * fires through `fireDbsCheck` (queued until ID is verified); the cross-check card shows fixed copy only.
 * Never: renders `cross_check_reasoning` (internal text), or shows "fully verified" except at `clear` (30/40).
 */
import { useState, useEffect, useCallback } from "react";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import { IdentitySection } from "./sections/IdentitySection";
import { WWCCSection } from "./sections/WWCCSection";
import { ContactSection } from "./sections/ContactSection";
import { SectionStatusBadge } from "./sections/SectionStatusBadge";
import { Shield, Check, CheckCircle } from "lucide-react";
import { useRouter } from "next/navigation";
import type { VerificationData } from "@/lib/actions/verification";
import { DBS_VERIFICATION_METHOD, type UserGuidance } from "@/lib/verification";
import { getDbsDisplayState, isDbsFailState, type DbsDisplayState } from "@/lib/dbs/nanny-display";
import { fireDbsCheck } from "@/lib/dbs/run-dbs-check";

interface ProfileData {
  firstName: string;
  lastName: string;
  dateOfBirth: string;
}

interface VerificationPageClientProps {
  initialData: VerificationData | null;
  profileData: ProfileData | null;
}

type PollResponse = {
  identity_status: string;
  identity_verified: boolean;
  identity_rejection_reason: string | null;
  identity_user_guidance: UserGuidance | null;
  surname: string | null;
  given_names: string | null;
  date_of_birth: string | null;
  extracted_passport_number: string | null;
  extracted_nationality: string | null;
  wwcc_status: string;
  wwcc_number: string | null;
  wwcc_expiry_date: string | null;
  wwcc_doc_verified: boolean;
  wwcc_verified: boolean;
  wwcc_rejection_reason: string | null;
  wwcc_user_guidance: UserGuidance | null;
  ocg_result_status: string | null;
  ocg_verified_at: string | null;
  contact_status: string;
  cross_check_status: string;
  cross_check_reasoning: string | null;
  status: number;
};

type StepState = "completed" | "current" | "future";
type BadgeStatus = "processing" | "verified" | "review" | "rejected" | "failed";

/** States where the page keeps polling: the AI is reading, the Update Service is running, or a retry is due (#30). */
const DBS_POLL_STATES: ReadonlySet<DbsDisplayState> = new Set(["reading", "checking", "technical_retry"]);
/** States that open the DBS accordion by default: something for her to read or do. */
const DBS_OPEN_STATES: ReadonlySet<DbsDisplayState> = new Set(["with_team", "manual_review", "barred"]);

/** The DBS badge, from the one decoder (3b, brief change 10): 23/26 are "Action needed", never "Expired". */
function dbsBadge(state: DbsDisplayState): BadgeStatus | null {
  if (state === "reading" || state === "checking") return "processing";
  if (state === "clear") return "verified";
  if (state === "with_team" || state === "manual_review") return "review";
  if (state === "rejected" || state === "barred") return "rejected";
  if (isDbsFailState(state)) return "failed";
  return null;
}

/** Identity and residence badges (their own section values). */
function sectionBadge(sectionStatus: string): BadgeStatus | null {
  switch (sectionStatus) {
    case "pending": case "processing": return "processing";
    case "verified": case "saved": return "verified";
    case "review": return "review";
    case "rejected": return "rejected";
    case "failed": return "failed";
    default: return null;
  }
}

function stepLineColor(step: StepState): string {
  return step === "completed" ? "bg-green-300" : step === "current" ? "bg-violet-200" : "bg-slate-200";
}

function StepIndicator({ state, isFirst, isLast, topLineColor, bottomLineColor }: {
  state: StepState;
  isFirst?: boolean;
  isLast?: boolean;
  topLineColor?: string;
  bottomLineColor?: string;
}) {
  const isCompleted = state === "completed";
  const isCurrent = state === "current";

  return (
    <div className="flex w-7 shrink-0 flex-col items-center">
      <div className={`w-0.5 h-3.5 ${!isFirst && topLineColor ? topLineColor : "bg-transparent"}`} />
      <div
        className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full border-2 ${
          isCompleted
            ? "border-green-500 bg-green-500"
            : isCurrent
            ? "border-violet-500 bg-violet-50 ring-2 ring-violet-200"
            : "border-slate-200 bg-white"
        }`}
      >
        {isCompleted && <Check className="h-4 w-4 text-white" />}
        {isCurrent && <div className="h-2.5 w-2.5 rounded-full bg-violet-500" />}
      </div>
      {!isLast && <div className={`w-0.5 flex-1 ${bottomLineColor ?? stepLineColor(state)}`} />}
    </div>
  );
}

export function VerificationPageClient({ initialData, profileData }: VerificationPageClientProps) {
  const router = useRouter();
  const [verification, setVerification] = useState<VerificationData | null>(initialData);

  // Determine which sections are unlocked
  const identityStatus = verification?.identity_status ?? "not_started";
  const dbsState = getDbsDisplayState(verification);
  const contactStatus = verification?.contact_status ?? "not_started";
  const crossCheckStatus = verification?.cross_check_status ?? "not_started";

  const verificationStatus = verification?.verification_status ?? 0;
  const identityInReview = identityStatus === "review";
  const identityLocked = contactStatus !== "saved";
  const wwccLocked = contactStatus !== "saved" || identityStatus === "not_started";

  // Determine which sections to open by default
  const getDefaultOpen = useCallback((): string[] => {
    if (contactStatus === "not_started") return ["contact"];
    if (identityStatus === "not_started") return ["identity"];
    if (identityInReview) return ["identity"];
    if (["failed", "rejected"].includes(identityStatus)) return ["identity"];
    if (dbsState === "not_started" && !wwccLocked) return ["dbs"];
    if (identityStatus === "processing") return ["dbs"];
    if (isDbsFailState(dbsState) || DBS_OPEN_STATES.has(dbsState)) return ["dbs"];
    return ["contact"];
  }, [identityStatus, dbsState, contactStatus, wwccLocked, identityInReview]);

  const [openSections, setOpenSections] = useState<string[]>(getDefaultOpen());
  const [pendingWwccFire, setPendingWwccFire] = useState<{ verificationId: string } | null>(null);

  // Poll for status updates when sections are processing or pending
  const isProcessing =
    identityStatus === "processing" || identityStatus === "pending" || DBS_POLL_STATES.has(dbsState);

  useEffect(() => {
    if (!isProcessing) return;

    const interval = setInterval(async () => {
      try {
        const res = await fetch("/api/verification-status");
        if (!res.ok) return;
        const data: PollResponse = await res.json();

        setVerification((prev) => {
          if (!prev) return prev;
          return {
            ...prev,
            identity_status: data.identity_status,
            identity_verified: data.identity_verified,
            identity_rejection_reason: data.identity_rejection_reason,
            identity_user_guidance: data.identity_user_guidance,
            surname: data.surname ?? prev.surname,
            given_names: data.given_names ?? prev.given_names,
            date_of_birth: data.date_of_birth ?? prev.date_of_birth,
            extracted_passport_number: data.extracted_passport_number ?? prev.extracted_passport_number,
            extracted_nationality: data.extracted_nationality ?? prev.extracted_nationality,
            wwcc_status: data.wwcc_status,
            wwcc_number: data.wwcc_number ?? prev.wwcc_number,
            wwcc_expiry_date: data.wwcc_expiry_date ?? prev.wwcc_expiry_date,
            wwcc_doc_verified: data.wwcc_doc_verified,
            wwcc_verified: data.wwcc_verified,
            wwcc_rejection_reason: data.wwcc_rejection_reason,
            wwcc_user_guidance: data.wwcc_user_guidance,
            ocg_result_status: data.ocg_result_status ?? prev.ocg_result_status,
            ocg_verified_at: data.ocg_verified_at ?? prev.ocg_verified_at,
            contact_status: data.contact_status,
            cross_check_status: data.cross_check_status,
            cross_check_reasoning: data.cross_check_reasoning,
            verification_status: data.status ?? prev.verification_status,
          };
        });

        // Fire the queued certificate check once identity is verified
        if (data.identity_status === "verified" && pendingWwccFire) {
          fireDbsCheck(pendingWwccFire.verificationId);
          setPendingWwccFire(null);
        }
      } catch {
        // Ignore polling errors
      }
    }, 3000);

    return () => clearInterval(interval);
  }, [isProcessing, pendingWwccFire]);

  // On mount: fire the certificate check if it was queued before a page refresh (re-keyed to the DBS method, 3b)
  useEffect(() => {
    if (
      initialData?.identity_status === "verified" &&
      initialData?.wwcc_status === "pending" &&
      initialData?.wwcc_verification_method === DBS_VERIFICATION_METHOD &&
      initialData?.id
    ) {
      fireDbsCheck(initialData.id);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleIdentitySaved = (verificationId: string, data: { surname: string; givenNames: string; dob: string }) => {
    setVerification((prev) => {
      if (prev) {
        return { ...prev, identity_status: "processing", identity_user_guidance: null, surname: data.surname, given_names: data.givenNames, date_of_birth: data.dob };
      }
      // First save — create minimal verification data
      return {
        id: verificationId,
        identity_status: "processing",
        wwcc_status: "not_started",
        contact_status: "not_started",
        cross_check_status: "not_started",
        verification_status: 10,
        identity_verified: false,
        identity_rejection_reason: null,
        identity_user_guidance: null,
        extracted_passport_number: null,
        extracted_nationality: null,
        wwcc_verification_method: null,
        wwcc_number: null,
        wwcc_expiry_date: null,
        wwcc_grant_email_url: null,
        wwcc_service_nsw_screenshot_url: null,
        wwcc_doc_verified: false,
        wwcc_verified: false,
        wwcc_rejection_reason: null,
        wwcc_user_guidance: null,
        ocg_result_status: null,
        ocg_verified_at: null,
        phone_number: null,
        address_line: null,
        city: null,
        state: null,
        postcode: null,
        country: null,
        cross_check_reasoning: null,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        surname: data.surname,
        given_names: data.givenNames,
        date_of_birth: data.dob,
        passport_country: null,
        passport_upload_url: null,
        identification_photo_url: null,
      } as VerificationData;
    });
    setOpenSections(["dbs"]);
  };

  const handleManualReview = () => {
    setVerification((prev) => {
      if (!prev) return prev;
      return {
        ...prev,
        identity_status: "review",
        identity_user_guidance: null,
        // Wipe the DBS section client-side to match the server
        wwcc_status: "not_started",
        wwcc_verification_method: null,
        wwcc_number: null,
        wwcc_expiry_date: null,
        wwcc_grant_email_url: null,
        wwcc_service_nsw_screenshot_url: null,
        wwcc_doc_verified: false,
        wwcc_verified: false,
        wwcc_rejection_reason: null,
        wwcc_user_guidance: null,
        cross_check_status: "not_started",
        cross_check_reasoning: null,
      };
    });
    setOpenSections(["identity"]);
  };

  const handleWWCCSaved = (verificationId: string, wwccMethod: string) => {
    setVerification((prev) => {
      if (!prev) return prev;
      return { ...prev, wwcc_status: "pending", wwcc_user_guidance: null, wwcc_verification_method: wwccMethod };
    });
    // Queue the certificate check if identity isn't verified yet (no method branch any more)
    if (identityStatus !== "verified") {
      setPendingWwccFire({ verificationId });
    }
    setOpenSections([]);
  };

  const handleContactSaved = () => {
    setVerification((prev) => {
      if (!prev) return prev;
      return { ...prev, contact_status: "saved" };
    });
    setOpenSections(["identity"]);
  };

  const allVerified =
    contactStatus === "saved" &&
    identityStatus === "verified" &&
    dbsState === "clear";

  // Auto-redirect to hub after verification is complete
  const [redirectCountdown, setRedirectCountdown] = useState(3);
  useEffect(() => {
    if (!allVerified) return;
    const interval = setInterval(() => {
      setRedirectCountdown((prev) => {
        if (prev <= 1) {
          clearInterval(interval);
          router.push("/nanny");
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
    return () => clearInterval(interval);
  }, [allVerified, router]);

  // Stepper states (order: Residence → Identity → DBS → Connect)
  const contactStep: StepState = contactStatus === "saved" ? "completed" : "current";
  const identityStep: StepState = identityLocked ? "future" : identityStatus === "verified" ? "completed" : "current";
  const wwccStep: StepState = wwccLocked ? "future" : dbsState === "clear" ? "completed" : "current";
  const goalStep: StepState = allVerified ? "completed" : "future";

  return (
    <div className="mx-auto max-w-2xl rounded-2xl border border-slate-200 bg-white shadow-sm p-4 sm:p-5 space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-slate-800 text-center">Verification</h1>
        {allVerified ? (
          <p className="text-sm text-green-600 mt-1 font-medium flex items-center justify-center gap-1.5">
            <Shield className="h-4 w-4" />
            Your account is fully verified!
          </p>
        ) : (
          <p className="text-sm text-slate-500 mt-1 text-center">
            Complete each step to connect with families.
          </p>
        )}
      </div>

      <Accordion type="multiple" value={openSections} onValueChange={setOpenSections}>
        {/* Step 1: Verify Residence (independent — always available) */}
        <div className="flex gap-2 sm:gap-3">
          <StepIndicator state={contactStep} isFirst />
          <div className="flex-1 min-w-0 pb-3">
            <AccordionItem value="contact" className="border-0">
              <AccordionTrigger className="hover:no-underline">
                <div className="flex items-center justify-between w-full mr-2">
                  <span className="text-base font-semibold text-slate-800">
                    Verify Residence
                  </span>
                  {sectionBadge(contactStatus) && (
                    <SectionStatusBadge status={sectionBadge(contactStatus)!} />
                  )}
                </div>
              </AccordionTrigger>
              <AccordionContent forceMount>
                <ContactSection
                  verification={verification}
                  locked={false}
                  onSaved={handleContactSaved}
                />
              </AccordionContent>
            </AccordionItem>
          </div>
        </div>

        {/* Step 2: Verify ID */}
        <div className="flex gap-2 sm:gap-3">
          <StepIndicator state={identityStep} topLineColor={stepLineColor(contactStep)} />
          <div className="flex-1 min-w-0 overflow-hidden pb-3">
            <AccordionItem value="identity" className="border-0" disabled={identityLocked}>
              <AccordionTrigger className="hover:no-underline" disabled={identityLocked}>
                <div className="flex items-center justify-between w-full mr-2">
                  <span className={`text-base font-semibold ${identityLocked ? "text-slate-400" : "text-slate-800"}`}>Verify ID</span>
                  {!identityLocked && sectionBadge(identityStatus) && (
                    <SectionStatusBadge
                      status={sectionBadge(identityStatus)!}
                      customLabel={identityInReview ? "Pending review" : undefined}
                    />
                  )}
                </div>
              </AccordionTrigger>
              <AccordionContent forceMount>
                <IdentitySection
                  verification={verification}
                  locked={identityLocked}
                  profileData={profileData}
                  onSaved={handleIdentitySaved}
                  onManualReview={handleManualReview}
                />
              </AccordionContent>
            </AccordionItem>
          </div>
        </div>

        {/* Step 3: Verify DBS */}
        <div className="flex gap-2 sm:gap-3">
          <StepIndicator state={wwccStep} topLineColor={stepLineColor(identityStep)} bottomLineColor={stepLineColor(goalStep)} />
          <div className="flex-1 min-w-0 overflow-hidden pb-3">
            <AccordionItem value="dbs" className="border-0" disabled={wwccLocked}>
              <AccordionTrigger className="hover:no-underline" disabled={wwccLocked}>
                <div className="flex items-center justify-between w-full mr-2">
                  <span className={`text-base font-semibold ${wwccLocked ? "text-slate-400" : "text-slate-800"}`}>
                    Verify DBS
                  </span>
                  {!wwccLocked && dbsBadge(dbsState) && (
                    <SectionStatusBadge status={dbsBadge(dbsState)!} />
                  )}
                </div>
              </AccordionTrigger>
              <AccordionContent forceMount>
                <WWCCSection
                  verification={verification}
                  identityVerified={identityStatus === "verified"}
                  onSaved={handleWWCCSaved}
                />
              </AccordionContent>
            </AccordionItem>
          </div>
        </div>

        {/* Step 4: Connect with Families (goal step — no accordion) */}
        <div className="flex gap-2 sm:gap-3">
          <StepIndicator state={goalStep} isLast topLineColor={stepLineColor(goalStep)} />
          <div className="py-4">
            <span className={`text-base font-semibold ${allVerified ? "text-green-700" : "text-slate-300"}`}>
              Connect with Families
            </span>
          </div>
        </div>
      </Accordion>

      {allVerified && (
        <div className="flex flex-col items-center justify-center gap-2 rounded-xl border border-green-200 bg-green-50 p-6">
          <CheckCircle className="h-8 w-8 text-green-500" />
          <p className="text-lg font-semibold text-green-700">You&apos;re fully verified!</p>
          <p className="text-sm text-green-600">
            Redirecting you to your hub in {redirectCountdown}...
          </p>
        </div>
      )}

      {/* Cross-check review — fixed copy only; the stored reasoning is internal text (deck §2.1) */}
      {crossCheckStatus === "review" && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-700">
          <p className="font-medium">We&apos;re taking a closer look</p>
          <p className="mt-1">
            The name or date of birth on your certificate doesn&apos;t quite match your passport — this often happens
            after a name change. Our team will check it. You don&apos;t need to do anything; we&apos;ll email you.
          </p>
        </div>
      )}
    </div>
  );
}
