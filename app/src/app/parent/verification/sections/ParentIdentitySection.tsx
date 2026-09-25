"use client";

import { useRef, useState, useCallback, useEffect } from "react";
import { Loader2, CheckCircle2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { GuidanceCard } from "@/app/nanny/verification/sections/GuidanceCard";
import { uploadFileWithProgress } from "@/lib/supabase/storage";
import { submitParentIdentitySection, submitParentIdentityForManualReview } from "@/lib/actions/parent-verification";
import { createClient } from "@/lib/supabase/client";
import type { ParentVerificationData } from "@/types/parent";

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
  fieldName,
  accept,
  uploadState,
  uploadProgress,
  fileName,
  uploadError,
  onFileSelect,
  onFormatError,
  disabled,
}: {
  label: string;
  fieldName: string;
  accept: string;
  uploadState: UploadState;
  uploadProgress: number;
  fileName: string | null;
  uploadError: string | null;
  onFileSelect: (file: File) => void;
  onFormatError?: (message: string) => void;
  disabled?: boolean;
}) {
  const inputRef = useRef<HTMLInputElement>(null);

  function handleFile(file: File) {
    if (!isAllowedImageFile(file)) {
      onFormatError?.("Unsupported format. Please upload a PNG, JPEG, or WebP image.");
      return;
    }
    onFileSelect(file);
  }

  return (
    <div className="space-y-2">
      <Label className="text-sm font-medium text-slate-700">{label}</Label>
      <div
        onClick={() => !disabled && uploadState !== "uploading" && inputRef.current?.click()}
        onDrop={(e) => {
          e.preventDefault();
          if (disabled || uploadState === "uploading") return;
          const file = e.dataTransfer.files?.[0];
          if (file) handleFile(file);
        }}
        onDragOver={(e) => e.preventDefault()}
        className={`flex flex-col items-center justify-center gap-3 rounded-lg border-2 border-dashed px-6 py-8 text-center transition-colors ${
          disabled || uploadState === "uploading"
            ? "border-slate-200 bg-slate-100 cursor-not-allowed"
            : "border-slate-300 bg-slate-50 cursor-pointer hover:border-violet-400 hover:bg-violet-50"
        }`}
      >
        {uploadState === "uploading" ? (
          <div className="flex flex-col items-center gap-2">
            <CircularProgress percent={uploadProgress} />
            <span className="text-xs text-slate-500">Uploading {fileName}...</span>
          </div>
        ) : uploadState === "done" ? (
          <div className="flex items-center gap-2 text-green-600">
            <CheckCircle2 className="h-5 w-5" />
            <span className="text-sm font-medium">Image uploaded</span>
            {!disabled && <span className="text-xs text-slate-500 ml-2">Click to replace</span>}
          </div>
        ) : (
          <>
            {uploadError && (
              <p className="text-xs text-red-500 mb-1">{uploadError}</p>
            )}
            <svg className="h-8 w-8 text-slate-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
            </svg>
            <div>
              <p className="text-sm font-medium text-slate-700">{label}</p>
              <p className="text-xs text-slate-500 mt-0.5">PNG, JPEG, or WebP — drag & drop or click to upload</p>
            </div>
          </>
        )}
      </div>
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
          // Reset so same file can be re-selected
          e.target.value = "";
        }}
      />
    </div>
  );
}

// ── Parent Identity Section ──

interface ParentIdentitySectionProps {
  verification: ParentVerificationData | null;
  documentType: string; // 'passport' or 'drivers_license'
  onSaved: (verificationId: string, data: { surname: string; givenNames: string; dob: string }) => void;
  onManualReview: () => void;
}

export function ParentIdentitySection({ verification, documentType, onSaved, onManualReview }: ParentIdentitySectionProps) {
  const status = verification?.identity_status ?? "not_started";
  const isProcessing = status === "processing" || status === "pending";
  const isCompleted = status === "verified";
  const isReview = status === "review";
  const isFailed = verification?.verification_status === 12;
  const isRejected = verification?.verification_status === 13;
  const needsAction = isFailed || isRejected;

  const [editing, setEditing] = useState(status === "not_started");
  const [isSaving, setIsSaving] = useState(false);
  const [isSubmittingReview, setIsSubmittingReview] = useState(false);
  const [showReviewConfirm, setShowReviewConfirm] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Form state
  const [surname, setSurname] = useState(verification?.surname ?? "");
  const [givenNames, setGivenNames] = useState(verification?.given_names ?? "");
  const [dob, setDob] = useState(verification?.date_of_birth ?? "");
  const [issuingCountry, setIssuingCountry] = useState(verification?.issuing_country ?? "");
  const [confirmed, setConfirmed] = useState(false);
  const [biometricConsent, setBiometricConsent] = useState(false);

  // Upload state — upload eagerly on file selection
  const uploadAbortRef = useRef<AbortController | null>(null);
  useEffect(() => {
    return () => { uploadAbortRef.current?.abort(); };
  }, []);

  const [documentUploadState, setDocumentUploadState] = useState<UploadState>(
    verification?.document_upload_url ? "done" : "idle"
  );
  const [documentProgress, setDocumentProgress] = useState(0);
  const [documentFileName, setDocumentFileName] = useState<string | null>(
    verification?.document_upload_url ? "Previously uploaded" : null
  );
  const [documentUrl, setDocumentUrl] = useState<string | null>(verification?.document_upload_url ?? null);
  const [documentError, setDocumentError] = useState<string | null>(null);

  const [selfieUploadState, setSelfieUploadState] = useState<UploadState>(
    verification?.identification_photo_url ? "done" : "idle"
  );
  const [selfieProgress, setSelfieProgress] = useState(0);
  const [selfieFileName, setSelfieFileName] = useState<string | null>(
    verification?.identification_photo_url ? "Previously uploaded" : null
  );
  const [selfieUrl, setSelfieUrl] = useState<string | null>(verification?.identification_photo_url ?? null);
  const [selfieError, setSelfieError] = useState<string | null>(null);

  const docLabel = documentType === "passport" ? "Passport" : "Driver's License";

  const handleDocumentSelect = useCallback(async (file: File) => {
    setDocumentFileName(file.name);
    setDocumentUploadState("uploading");
    setDocumentProgress(0);
    setDocumentError(null);

    uploadAbortRef.current?.abort();
    const controller = new AbortController();
    uploadAbortRef.current = controller;

    const supabase = createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      setDocumentUploadState("error");
      setDocumentError("Not authenticated");
      return;
    }

    const result = await uploadFileWithProgress(
      "parent-verifications", user.id, file,
      (p) => setDocumentProgress(p),
      controller.signal
    );

    if (result.error || !result.url) {
      setDocumentUploadState("error");
      setDocumentError(result.error ?? "Upload failed");
    } else {
      setDocumentUrl(result.url);
      setDocumentUploadState("done");
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
      "parent-verifications", user.id, file,
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

  const canSave =
    surname.trim() &&
    givenNames.trim() &&
    dob &&
    issuingCountry &&
    documentUrl &&
    selfieUrl &&
    documentUploadState === "done" &&
    selfieUploadState === "done" &&
    confirmed &&
    biometricConsent;

  async function handleSaveAndVerify() {
    if (!documentUrl || !selfieUrl) return;
    setIsSaving(true);
    setError(null);

    try {
      // Files already uploaded — just call server action
      let saveResult;
      try {
        saveResult = await Promise.race([
          submitParentIdentitySection({
            document_type: documentType,
            issuing_country: issuingCountry,
            surname: surname.trim(),
            given_names: givenNames.trim(),
            date_of_birth: dob,
            document_upload_url: documentUrl,
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
        body: JSON.stringify({ verificationId: saveResult.verificationId, phase: "parent-identity" }),
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
      const result = await submitParentIdentityForManualReview();
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
            <p>Document Type: {documentType === "passport" ? "Passport" : "Driver's License"}</p>
            {documentType === "passport" ? (
              verification?.extracted_passport_number && (
                <p>Passport: {verification.extracted_passport_number}</p>
              )
            ) : (
              verification?.extracted_license_number && (
                <p>License: {verification.extracted_license_number}</p>
              )
            )}
          </div>
        )}

        {isReview && (
          <div className="rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-700 space-y-1">
            <p className="font-medium text-amber-800">Pending manual review</p>
            <p>We will manually review your documents. This may take up to 3 days.</p>
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
            secondaryAction={isFailed ? {
              label: isSubmittingReview ? "Submitting..." : "Submit for Manual Review",
              onClick: () => setShowReviewConfirm(true),
            } : undefined}
          />
        )}

        {needsAction && !verification?.identity_user_guidance && !isReview && (
          <div className="flex gap-2">
            <Button
              type="button"
              onClick={() => { setEditing(true); setConfirmed(false); }}
              className="bg-violet-600 hover:bg-violet-700 text-white"
              size="sm"
            >
              Edit & Resubmit
            </Button>
            {isFailed && (
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
                ) : "Submit for Manual Review"}
              </Button>
            )}
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
  const today = new Date().toISOString().split("T")[0];
  const isUploading = documentUploadState === "uploading" || selfieUploadState === "uploading";

  return (
    <div className="space-y-6">
      {error && (
        <div className="rounded-lg bg-red-50 p-3 text-sm text-red-600">{error}</div>
      )}

      <div className="space-y-2">
        <Label htmlFor="surname" className="text-sm font-medium text-slate-700">Surname</Label>
        <Input
          id="surname"
          placeholder={`As shown on ${docLabel.toLowerCase()}`}
          value={surname}
          onChange={(e) => setSurname(e.target.value)}
          disabled={isSaving}
        />
      </div>

      <div className="space-y-2">
        <Label htmlFor="given_names" className="text-sm font-medium text-slate-700">Given Name(s)</Label>
        <Input
          id="given_names"
          placeholder={`As shown on ${docLabel.toLowerCase()}`}
          value={givenNames}
          onChange={(e) => setGivenNames(e.target.value)}
          disabled={isSaving}
        />
      </div>

      <div className="space-y-2">
        <Label htmlFor="date_of_birth" className="text-sm font-medium text-slate-700">Date of Birth</Label>
        <Input
          id="date_of_birth"
          type="date"
          max={today}
          value={dob}
          onChange={(e) => setDob(e.target.value)}
          disabled={isSaving}
        />
      </div>

      <div className="space-y-2">
        <Label htmlFor="issuing_country" className="text-sm font-medium text-slate-700">Country of Issue</Label>
        <select
          id="issuing_country"
          value={issuingCountry}
          onChange={(e) => setIssuingCountry(e.target.value)}
          disabled={isSaving}
          className="w-full rounded-lg border border-slate-300 bg-white px-4 py-2.5 text-sm text-slate-800 focus:border-violet-500 focus:ring-1 focus:ring-violet-500 outline-none"
        >
          <option value="" disabled>Select country of issue</option>
          {PASSPORT_COUNTRIES.map((c) => (
            <option key={c} value={c}>{c}</option>
          ))}
        </select>
      </div>

      <FileUploadZone
        label={`Upload ${docLabel}`}
        fieldName="document_file"
        accept=".png,.jpg,.jpeg,.gif,.webp"
        uploadState={documentUploadState}
        uploadProgress={documentProgress}
        fileName={documentFileName}
        uploadError={documentError}
        onFileSelect={handleDocumentSelect}
        onFormatError={(msg) => setDocumentError(msg)}
        disabled={isSaving}
      />

      <div className="space-y-2">
        <FileUploadZone
          label="Upload Identification Photo"
          fieldName="identification_photo"
          accept=".png,.jpg,.jpeg,.gif,.webp"
          uploadState={selfieUploadState}
          uploadProgress={selfieProgress}
          fileName={selfieFileName}
          uploadError={selfieError}
          onFileSelect={handleSelfieSelect}
          onFormatError={(msg) => setSelfieError(msg)}
          disabled={isSaving}
        />
        <div className="rounded-lg bg-blue-50 border border-blue-200 p-3 text-xs text-blue-700 space-y-1">
          <p className="font-medium text-blue-800">For the best result, your selfie should:</p>
          <ul className="list-disc list-inside space-y-0.5">
            <li>Be a clear, front-facing photo — like a passport photo</li>
            <li>Show your full face with a neutral expression</li>
            <li>Have no sunglasses, hats, or face coverings</li>
            <li>Be well-lit with even lighting (natural light is best)</li>
            <li>A plain background helps but isn&apos;t required</li>
          </ul>
        </div>
      </div>

      <div className="space-y-1.5">
        <label htmlFor="document_confirmed" className="flex items-start gap-2 cursor-pointer">
          <input
            id="document_confirmed"
            type="checkbox"
            checked={confirmed}
            onChange={(e) => setConfirmed(e.target.checked)}
            disabled={isSaving}
            className="mt-0.5 h-3.5 w-3.5 shrink-0 rounded border-slate-300 text-violet-600 focus:ring-violet-500 cursor-pointer"
          />
          <span className="text-xs text-slate-500 leading-relaxed">
            I confirm that the document I have provided is genuine, valid, and issued to me.
          </span>
        </label>
        <label htmlFor="biometric_consent" className="flex items-start gap-2 cursor-pointer">
          <input
            id="biometric_consent"
            type="checkbox"
            checked={biometricConsent}
            onChange={(e) => setBiometricConsent(e.target.checked)}
            disabled={isSaving}
            className="mt-0.5 h-3.5 w-3.5 shrink-0 rounded border-slate-300 text-violet-600 focus:ring-violet-500 cursor-pointer"
          />
          <span className="text-xs text-slate-500 leading-relaxed">
            I have read the{" "}
            <a
              href="/legal/biometric-notice-client?from=/parent/verification"
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
          "Verify"
        )}
      </Button>
    </div>
  );
}
