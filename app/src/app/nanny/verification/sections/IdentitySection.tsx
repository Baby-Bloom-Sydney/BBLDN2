"use client";

import { useRef, useState, useCallback, useEffect } from "react";
import { Loader2, CheckCircle2, Upload, Camera, AlertCircle } from "lucide-react";
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
import { uploadFileWithProgress } from "@/lib/supabase/storage";
import { submitIdentitySection, submitIdentityForManualReview } from "@/lib/actions/verification";
import { createClient } from "@/lib/supabase/client";
import type { VerificationData } from "@/lib/actions/verification";

const PASSPORT_COUNTRIES = [
  "Australia", "Afghanistan", "Albania", "Algeria", "Andorra", "Angola",
  "Antigua and Barbuda", "Argentina", "Armenia", "Austria", "Azerbaijan",
  "Bahamas", "Bahrain", "Bangladesh", "Barbados", "Belarus", "Belgium",
  "Belize", "Benin", "Bhutan", "Bolivia", "Bosnia and Herzegovina",
  "Botswana", "Brazil", "Brunei", "Bulgaria", "Burkina Faso", "Burundi",
  "Cambodia", "Cameroon", "Canada", "Cape Verde", "Central African Republic",
  "Chad", "Chile", "China", "Colombia", "Comoros", "Congo", "Costa Rica",
  "Croatia", "Cuba", "Cyprus", "Czech Republic", "Denmark", "Djibouti",
  "Dominican Republic", "Ecuador", "Egypt", "El Salvador",
  "Equatorial Guinea", "Eritrea", "Estonia", "Eswatini", "Ethiopia",
  "Fiji", "Finland", "France", "Gabon", "Gambia", "Georgia", "Germany",
  "Ghana", "Greece", "Grenada", "Guatemala", "Guinea", "Guinea-Bissau",
  "Guyana", "Haiti", "Honduras", "Hungary", "Iceland", "India",
  "Indonesia", "Iran", "Iraq", "Ireland", "Israel", "Italy", "Jamaica",
  "Japan", "Jordan", "Kazakhstan", "Kenya", "Kuwait", "Kyrgyzstan",
  "Laos", "Latvia", "Lebanon", "Lesotho", "Liberia", "Libya",
  "Liechtenstein", "Lithuania", "Luxembourg", "Madagascar", "Malawi",
  "Malaysia", "Maldives", "Mali", "Malta", "Mauritania", "Mauritius",
  "Mexico", "Moldova", "Monaco", "Mongolia", "Montenegro", "Morocco",
  "Mozambique", "Myanmar", "Namibia", "Nepal", "Netherlands",
  "New Zealand", "Nicaragua", "Niger", "Nigeria", "North Korea",
  "North Macedonia", "Norway", "Oman", "Pakistan", "Panama",
  "Papua New Guinea", "Paraguay", "Peru", "Philippines", "Poland",
  "Portugal", "Qatar", "Romania", "Russia", "Rwanda", "Saudi Arabia",
  "Senegal", "Serbia", "Sierra Leone", "Singapore", "Slovakia",
  "Slovenia", "Solomon Islands", "Somalia", "South Africa", "South Korea",
  "South Sudan", "Spain", "Sri Lanka", "Sudan", "Suriname", "Sweden",
  "Switzerland", "Syria", "Taiwan", "Tajikistan", "Tanzania", "Thailand",
  "Timor-Leste", "Togo", "Trinidad and Tobago", "Tunisia", "Turkey",
  "Turkmenistan", "Uganda", "Ukraine", "United Arab Emirates",
  "United Kingdom", "United States", "Uruguay", "Uzbekistan",
  "Venezuela", "Vietnam", "Yemen", "Zambia", "Zimbabwe",
];

// ── Circular Progress ──

function CircularProgress({ percent }: { percent: number }) {
  const radius = 18;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference - (percent / 100) * circumference;

  return (
    <svg className="h-12 w-12 -rotate-90" viewBox="0 0 44 44">
      <circle cx="22" cy="22" r={radius} fill="none" stroke="#e2e8f0" strokeWidth="3" />
      <circle cx="22" cy="22" r={radius} fill="none" stroke="#8B5CF6" strokeWidth="3"
        strokeLinecap="round" strokeDasharray={circumference} strokeDashoffset={offset}
        className="transition-all duration-300" />
      <text x="22" y="22" textAnchor="middle" dominantBaseline="central"
        className="fill-slate-700 font-medium" fontSize="10" transform="rotate(90 22 22)">
        {percent}%
      </text>
    </svg>
  );
}

// ── File Upload Zone with Progress ──

type UploadState = "idle" | "uploading" | "done" | "error";

const ALLOWED_IMAGE_TYPES = ["image/png", "image/jpeg", "image/gif", "image/webp"];

function isAllowedImageFile(file: File): boolean {
  if (ALLOWED_IMAGE_TYPES.includes(file.type)) return true;
  // Fallback: check extension for cases where MIME type is empty
  const ext = file.name.split(".").pop()?.toLowerCase();
  return ext === "png" || ext === "jpg" || ext === "jpeg" || ext === "gif" || ext === "webp";
}

function FileUploadZone({
  label,
  hint,
  fieldName,
  accept,
  uploadState,
  uploadProgress,
  fileName,
  uploadError,
  onFileSelect,
  onFormatError,
  disabled,
  variant = "default",
}: {
  label: string;
  hint?: string;
  fieldName: string;
  accept: string;
  uploadState: UploadState;
  uploadProgress: number;
  fileName: string | null;
  uploadError: string | null;
  onFileSelect: (file: File) => void;
  onFormatError?: (message: string) => void;
  disabled?: boolean;
  variant?: "default" | "selfie";
}) {
  const inputRef = useRef<HTMLInputElement>(null);

  function handleFile(file: File) {
    // Skip format check for non-image accepts (e.g. PDF)
    if (accept !== "application/pdf,.pdf" && !isAllowedImageFile(file)) {
      onFormatError?.("Unsupported format. Please upload a PNG, JPEG, or WebP image.");
      return;
    }
    onFileSelect(file);
  }

  const isSelfie = variant === "selfie";

  return (
    <div className="space-y-1.5">
      <label className="text-sm font-medium text-slate-700 block">{label}</label>
      <input
        ref={inputRef}
        id={fieldName}
        type="file"
        accept={accept}
        className="hidden"
        disabled={disabled || uploadState === "uploading"}
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) handleFile(file);
          e.target.value = "";
        }}
      />
      <button
        type="button"
        onClick={() => !disabled && uploadState !== "uploading" && inputRef.current?.click()}
        onDrop={(e) => {
          e.preventDefault();
          if (disabled || uploadState === "uploading") return;
          const file = e.dataTransfer.files?.[0];
          if (file) handleFile(file);
        }}
        onDragOver={(e) => e.preventDefault()}
        disabled={disabled || uploadState === "uploading"}
        className={`w-full flex flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed px-6 py-5 text-center transition-all duration-300 ${
          uploadState === "done"
            ? "border-green-300 bg-green-50"
            : uploadState === "uploading"
            ? "border-violet-300 bg-violet-50/30 cursor-wait"
            : uploadState === "error"
            ? "border-red-300 bg-red-50 hover:border-red-400"
            : disabled
            ? "border-slate-200 bg-slate-100 cursor-not-allowed"
            : isSelfie
            ? "border-violet-300 bg-violet-50/50 hover:border-violet-400 hover:bg-violet-50 active:bg-violet-100"
            : "border-slate-300 bg-slate-50 hover:border-violet-400 hover:bg-violet-50 active:bg-violet-50"
        }`}
      >
        {uploadState === "done" ? (
          <div className="flex items-center gap-2 text-green-600">
            <CheckCircle2 className="h-5 w-5" />
            <span className="text-sm font-medium">{isSelfie ? "Photo uploaded" : "File uploaded"}</span>
          </div>
        ) : uploadState === "uploading" ? (
          <div className="flex flex-col items-center gap-2">
            <CircularProgress percent={uploadProgress} />
            <span className="text-xs text-slate-500">Uploading...</span>
          </div>
        ) : uploadState === "error" ? (
          <div className="flex flex-col items-center gap-2">
            <AlertCircle className="h-7 w-7 text-red-400" />
            <p className="text-sm font-medium text-red-600">Upload failed — tap to retry</p>
            {uploadError && <p className="text-xs text-red-500">{uploadError}</p>}
          </div>
        ) : (
          <>
            {isSelfie ? (
              <div className="w-10 h-10 rounded-full bg-violet-100 flex items-center justify-center">
                <Camera className="h-5 w-5 text-violet-600" />
              </div>
            ) : (
              <Upload className="h-7 w-7 text-violet-500" />
            )}
            <p className="text-sm font-medium text-slate-700">
              {hint ?? (isSelfie ? "Upload your identification selfie" : "Tap to upload")}
            </p>
          </>
        )}
      </button>
    </div>
  );
}

// ── Identity Section ──

interface ProfileData {
  firstName: string;
  lastName: string;
  dateOfBirth: string;
}

interface IdentitySectionProps {
  verification: VerificationData | null;
  locked: boolean;
  profileData: ProfileData | null;
  onSaved: (verificationId: string, data: { surname: string; givenNames: string; dob: string }) => void;
  onManualReview: () => void;
}

export function IdentitySection({ verification, locked, profileData, onSaved, onManualReview }: IdentitySectionProps) {
  const status = verification?.identity_status ?? "not_started";
  const isProcessing = status === "processing" || status === "pending";
  const isCompleted = status === "verified";
  const isReview = status === "review";
  const needsAction = status === "failed" || status === "rejected";

  const [editing, setEditing] = useState(status === "not_started");
  const [isSaving, setIsSaving] = useState(false);
  const [isSubmittingReview, setIsSubmittingReview] = useState(false);
  const [showReviewConfirm, setShowReviewConfirm] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Form state — pre-fill from verification data, fallback to profile
  const [surname, setSurname] = useState(verification?.surname ?? profileData?.lastName ?? "");
  const [givenNames, setGivenNames] = useState(verification?.given_names ?? profileData?.firstName ?? "");
  const [dob, setDob] = useState(verification?.date_of_birth ?? profileData?.dateOfBirth ?? "");
  const [passportCountry, setPassportCountry] = useState(verification?.passport_country ?? "");
  const [confirmed, setConfirmed] = useState(false);
  const [biometricConsent, setBiometricConsent] = useState(false);

  // Abort controller for in-flight uploads — cleaned up on unmount
  const uploadAbortRef = useRef<AbortController | null>(null);
  useEffect(() => {
    return () => { uploadAbortRef.current?.abort(); };
  }, []);

  // Upload state — upload eagerly on file selection
  const [passportUploadState, setPassportUploadState] = useState<UploadState>(
    verification?.passport_upload_url ? "done" : "idle"
  );
  const [passportProgress, setPassportProgress] = useState(0);
  const [passportFileName, setPassportFileName] = useState<string | null>(
    verification?.passport_upload_url ? "Previously uploaded" : null
  );
  const [passportUrl, setPassportUrl] = useState<string | null>(verification?.passport_upload_url ?? null);
  const [passportError, setPassportError] = useState<string | null>(null);

  const [selfieUploadState, setSelfieUploadState] = useState<UploadState>(
    verification?.identification_photo_url ? "done" : "idle"
  );
  const [selfieProgress, setSelfieProgress] = useState(0);
  const [selfieFileName, setSelfieFileName] = useState<string | null>(
    verification?.identification_photo_url ? "Previously uploaded" : null
  );
  const [selfieUrl, setSelfieUrl] = useState<string | null>(verification?.identification_photo_url ?? null);
  const [selfieError, setSelfieError] = useState<string | null>(null);

  // 18+ validation
  const [dobError, setDobError] = useState("");

  const handlePassportSelect = useCallback(async (file: File) => {
    setPassportFileName(file.name);
    setPassportUploadState("uploading");
    setPassportProgress(0);
    setPassportError(null);

    uploadAbortRef.current?.abort();
    const controller = new AbortController();
    uploadAbortRef.current = controller;

    const supabase = createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      setPassportUploadState("error");
      setPassportError("Not authenticated");
      return;
    }

    const result = await uploadFileWithProgress(
      "verification-documents", user.id, file,
      (p) => setPassportProgress(p),
      controller.signal
    );

    if (result.error || !result.url) {
      setPassportUploadState("error");
      setPassportError(result.error ?? "Upload failed");
    } else {
      setPassportUrl(result.url);
      setPassportUploadState("done");
    }
  }, []);

  const handleSelfieSelect = useCallback(async (file: File) => {
    setSelfieFileName(file.name);
    setSelfieUploadState("uploading");
    setSelfieProgress(0);
    setSelfieError(null);

    uploadAbortRef.current?.abort();
    const controller = new AbortController();
    uploadAbortRef.current = controller;

    const supabase = createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      setSelfieUploadState("error");
      setSelfieError("Not authenticated");
      return;
    }

    const result = await uploadFileWithProgress(
      "verification-documents", user.id, file,
      (p) => setSelfieProgress(p),
      controller.signal
    );

    if (result.error || !result.url) {
      setSelfieUploadState("error");
      setSelfieError(result.error ?? "Upload failed");
    } else {
      setSelfieUrl(result.url);
      setSelfieUploadState("done");
    }
  }, []);

  if (locked) {
    return (
      <div className="text-sm text-slate-500 py-4">
        Complete the Residence section first to unlock identity verification.
      </div>
    );
  }

  const canSave =
    surname.trim() &&
    givenNames.trim() &&
    dob &&
    passportCountry &&
    passportUrl &&
    selfieUrl &&
    passportUploadState === "done" &&
    selfieUploadState === "done" &&
    confirmed &&
    biometricConsent;

  async function handleSaveAndVerify() {
    if (!passportUrl || !selfieUrl) return;
    setIsSaving(true);
    setError(null);

    try {
      // Files already uploaded — just call server action
      let saveResult;
      try {
        saveResult = await Promise.race([
          submitIdentitySection({
            surname: surname.trim(),
            given_names: givenNames.trim(),
            date_of_birth: dob,
            passport_country: passportCountry,
            passport_upload_url: passportUrl,
            identification_photo_url: selfieUrl,
          }),
          new Promise<never>((_, reject) => setTimeout(() => reject(new Error("Save timed out — please try again")), 15000)),
        ]);
      } catch (saveErr) {
        setError(`Save failed: ${saveErr instanceof Error ? saveErr.message : "Please try again"}`);
        setIsSaving(false);
        return;
      }

      if (!saveResult.success) {
        setError(saveResult.error ?? "Failed to save");
        setIsSaving(false);
        return;
      }

      // Fire AI verification (fire-and-forget)
      fetch("/api/run-verification", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ verificationId: saveResult.verificationId, phase: "identity" }),
      }).catch(() => {});

      setIsSaving(false);
      setEditing(false);
      onSaved(saveResult.verificationId!, { surname: surname.trim(), givenNames: givenNames.trim(), dob });
    } catch (err) {
      setError(`Error: ${err instanceof Error ? err.message : "Unknown error"}`);
      setIsSaving(false);
    }
  }

  async function handleConfirmManualReview() {
    setShowReviewConfirm(false);
    setIsSubmittingReview(true);
    setError(null);
    try {
      const result = await submitIdentityForManualReview();
      if (!result.success) {
        setError(result.error ?? "Failed to submit for review");
        setIsSubmittingReview(false);
        return;
      }
      setIsSubmittingReview(false);
      onManualReview();
    } catch (err) {
      setError(`Error: ${err instanceof Error ? err.message : "Unknown error"}`);
      setIsSubmittingReview(false);
    }
  }

  // Status display (when not editing)
  if (!editing) {
    return (
      <div className="space-y-4">
        {error && (
          <div className="rounded-lg bg-red-50 p-3 text-sm text-red-600">{error}</div>
        )}

        {isProcessing && (
          <p className="text-sm text-slate-500">Your ID is being verified. This usually takes about 15 seconds.</p>
        )}

        {isCompleted && (
          <div className="space-y-1 text-sm text-green-700">
            {verification?.given_names && verification?.surname && (
              <p>Full Name: {verification.given_names} {verification.surname}</p>
            )}
            {(verification?.date_of_birth || dob) && (
              <p>Date of Birth: {new Date(verification?.date_of_birth || dob).toLocaleDateString("en-GB", { day: "2-digit", month: "2-digit", year: "numeric" })}</p>
            )}
            {verification?.extracted_passport_number && (
              <p>Passport: {verification.extracted_passport_number}</p>
            )}
            {verification?.extracted_nationality && (
              <p>Nationality: {verification.extracted_nationality}</p>
            )}
          </div>
        )}

        {isReview && (
          <div className="rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-700 space-y-1">
            <p className="font-medium text-amber-800">Pending manual review</p>
            <p>We will manually review your passport documents. This may take up to 3 days.</p>
          </div>
        )}

        {verification?.identity_rejection_reason && !isReview && (
          <div className="rounded-lg bg-red-50 p-3 text-sm text-red-700">
            <p className="font-medium">Verification failed</p>
            <p className="mt-1">{verification.identity_rejection_reason}</p>
          </div>
        )}

        {verification?.identity_user_guidance && !isReview && (
          <GuidanceCard
            guidance={verification.identity_user_guidance}
            primaryAction={{ label: "Edit & Resubmit", onClick: () => { setEditing(true); setConfirmed(false); } }}
            secondaryAction={{
              label: isSubmittingReview ? "Submitting..." : "Manual Review",
              onClick: () => setShowReviewConfirm(true),
            }}
          />
        )}

        {needsAction && !verification?.identity_user_guidance && !isReview && (
          <div className="space-y-3">
            <div className="rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-700 space-y-1">
              <p className="font-semibold text-amber-800">Identity verification was not successful</p>
              <p>Please check that your details match your passport exactly and try again, or submit for manual review.</p>
            </div>
            <div className="flex flex-col sm:flex-row gap-2">
              <Button
                type="button"
                onClick={() => { setEditing(true); setConfirmed(false); }}
                className="bg-violet-600 hover:bg-violet-700 text-white"
                size="sm"
              >
                Edit & Resubmit
              </Button>
              <Button
                type="button"
                variant="outline"
                onClick={() => setShowReviewConfirm(true)}
                disabled={isSubmittingReview}
                size="sm"
              >
                {isSubmittingReview ? (
                  <>
                    <Loader2 className="mr-2 h-3 w-3 animate-spin" />
                    Submitting...
                  </>
                ) : "Manual Review"}
              </Button>
            </div>
          </div>
        )}

        {/* Manual Review Confirmation Dialog */}
        <Dialog open={showReviewConfirm} onOpenChange={setShowReviewConfirm}>
          <DialogContent className="sm:max-w-md">
            <DialogHeader>
              <DialogTitle>Submit for manual review?</DialogTitle>
              <DialogDescription>
                Manual review can take up to 3 days. We recommend re-attempting verification first.
              </DialogDescription>
            </DialogHeader>
            <DialogFooter className="flex gap-2 sm:gap-0">
              <Button
                type="button"
                onClick={() => { setShowReviewConfirm(false); setEditing(true); setConfirmed(false); }}
                className="bg-violet-600 hover:bg-violet-700 text-white"
              >
                No, re-attempt verification
              </Button>
              <Button
                type="button"
                variant="outline"
                onClick={handleConfirmManualReview}
              >
                Yes, submit for review
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
    );
  }

  // Form (editing mode)
  const isUploading = passportUploadState === "uploading" || selfieUploadState === "uploading";

  const eighteenYearsAgo = new Date();
  eighteenYearsAgo.setFullYear(eighteenYearsAgo.getFullYear() - 18);
  const maxDob = eighteenYearsAgo.toISOString().split("T")[0];

  function handleDobChange(val: string) {
    setDob(val);
    if (val && val > maxDob) {
      setDobError("You must be at least 18 years old");
    } else {
      setDobError("");
    }
  }

  return (
    <div className="space-y-4">
      {error && (
        <div className="rounded-lg bg-red-50 p-3 text-sm text-red-600">{error}</div>
      )}

      {/* Given Name(s) + Surname — side by side */}
      <div className="grid grid-cols-2 gap-3">
        <div className="flex flex-col gap-1.5">
          <label className="text-sm font-medium text-slate-700">Given Name(s)</label>
          <input
            type="text"
            value={givenNames}
            onChange={(e) => setGivenNames(e.target.value)}
            placeholder="As on passport"
            disabled={isSaving}
            className="w-full h-11 rounded-lg border border-slate-200 px-3 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-violet-500 focus:border-transparent disabled:bg-slate-100"
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <label className="text-sm font-medium text-slate-700">Surname</label>
          <input
            type="text"
            value={surname}
            onChange={(e) => setSurname(e.target.value)}
            placeholder="As on passport"
            disabled={isSaving}
            className="w-full h-11 rounded-lg border border-slate-200 px-3 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-violet-500 focus:border-transparent disabled:bg-slate-100"
          />
        </div>
      </div>

      {/* Date of Birth */}
      <div className="flex flex-col gap-1.5">
        <label className="text-sm font-medium text-slate-700">Date of Birth</label>
        <input
          type="date"
          value={dob}
          onChange={(e) => handleDobChange(e.target.value)}
          max={maxDob}
          disabled={isSaving}
          className={`w-full h-11 rounded-lg border px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-violet-500 focus:border-transparent disabled:bg-slate-100 ${
            dobError ? "border-red-300" : "border-slate-200"
          }`}
        />
        {dobError && <p className="text-xs text-red-500 mt-1">{dobError}</p>}
      </div>

      {/* Selfie upload */}
      <FileUploadZone
        label="Identification photo"
        fieldName="identification_photo"
        accept=".png,.jpg,.jpeg,.gif,.webp"
        uploadState={selfieUploadState}
        uploadProgress={selfieProgress}
        fileName={selfieFileName}
        uploadError={selfieError}
        onFileSelect={handleSelfieSelect}
        onFormatError={(msg) => setSelfieError(msg)}
        disabled={isSaving}
        variant="selfie"
        hint="Upload your identification selfie"
      />

      {/* Selfie guidance — disappears after upload */}
      {selfieUploadState !== "done" && (
        <div className="rounded-lg bg-blue-50 border border-blue-200 p-3 text-xs text-blue-700 space-y-1">
          <p className="font-medium text-blue-800">This selfie should:</p>
          <ul className="list-disc list-inside space-y-0.5">
            <li>Be clear and front-facing</li>
            <li>Show your full face with a neutral expression</li>
            <li>Have no sunglasses, hats, or face coverings</li>
          </ul>
        </div>
      )}

      {/* Passport upload */}
      <FileUploadZone
        label="Passport verification"
        hint="Upload your passport photo page"
        fieldName="passport_file"
        accept=".png,.jpg,.jpeg,.gif,.webp"
        uploadState={passportUploadState}
        uploadProgress={passportProgress}
        fileName={passportFileName}
        uploadError={passportError}
        onFileSelect={handlePassportSelect}
        onFormatError={(msg) => setPassportError(msg)}
        disabled={isSaving}
      />

      {/* Passport guidance — disappears after upload */}
      {passportUploadState !== "done" && (
        <div className="rounded-lg bg-blue-50 border border-blue-200 p-3 text-xs text-blue-700 space-y-1">
          <p className="font-medium text-blue-800">This photo should:</p>
          <ul className="list-disc list-inside space-y-0.5">
            <li>Show the photo page of your passport</li>
            <li>Be flat and fully visible — no fingers or glare</li>
            <li>Have all text clearly readable</li>
          </ul>
        </div>
      )}

      {/* Passport country */}
      <div className="flex flex-col gap-1.5">
        <label className="text-sm font-medium text-slate-700">Passport Country of Issue</label>
        <select
          value={passportCountry}
          onChange={(e) => setPassportCountry(e.target.value)}
          disabled={isSaving}
          className="w-full h-11 rounded-lg border border-slate-200 bg-white px-4 py-2.5 text-sm text-slate-800 focus:outline-none focus:ring-2 focus:ring-violet-500 focus:border-transparent disabled:bg-slate-100"
        >
          <option value="" disabled>Select country of issue</option>
          {PASSPORT_COUNTRIES.map((c) => (
            <option key={c} value={c}>{c}</option>
          ))}
        </select>
      </div>

      {/* Checkboxes */}
      <div className="space-y-1.5">
        <label className="flex items-start gap-2 cursor-pointer">
          <input
            type="checkbox"
            checked={confirmed}
            onChange={(e) => setConfirmed(e.target.checked)}
            disabled={isSaving}
            className="mt-0.5 h-3.5 w-3.5 shrink-0 rounded border-slate-300 text-violet-600 focus:ring-violet-500 cursor-pointer"
          />
          <span className="text-xs text-slate-500 leading-relaxed">
            I confirm that the passport I have provided is genuine, valid, and issued to me.
          </span>
        </label>
        <label className="flex items-start gap-2 cursor-pointer">
          <input
            type="checkbox"
            checked={biometricConsent}
            onChange={(e) => setBiometricConsent(e.target.checked)}
            disabled={isSaving}
            className="mt-0.5 h-3.5 w-3.5 shrink-0 rounded border-slate-300 text-violet-600 focus:ring-violet-500 cursor-pointer"
          />
          <span className="text-xs text-slate-500 leading-relaxed">
            I have read the{" "}
            <a
              href="/legal/biometric-notice?from=/nanny/verification"
              className="text-violet-600 underline hover:text-violet-700"
              onClick={(e) => e.stopPropagation()}
            >
              Biometric Data Collection Notice
            </a>{" "}
            and consent to the collection and processing of my biometric data as described.
          </span>
        </label>
      </div>

      <Button
        type="button"
        onClick={handleSaveAndVerify}
        disabled={!canSave || isSaving || isUploading}
        className="w-full bg-violet-600 hover:bg-violet-700 text-white"
      >
        {isSaving ? (
          <>
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            Verifying...
          </>
        ) : isUploading ? (
          <>
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            Uploading...
          </>
        ) : (
          "Verify ID"
        )}
      </Button>
    </div>
  );
}
