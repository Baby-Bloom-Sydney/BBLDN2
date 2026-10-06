"use client";

/**
 * The DBS step body (unit 3b, BB-LDN-3b-061026; brief changes 2–3; rulings #1, #3, #14, #19; copy deck §1.3, §2.3).
 * One upload slot for page 1 (a photo or a PDF), the Update Service notice, one consent tick, the "Verify DBS" CTA.
 * No number, date or method chooser. Used by onboarding step 3 (`layout="onboarding"`) and by the DBS section's
 * edit mode on /nanny/verification (`layout="inline"`).
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { CheckCircle2, Loader2, Upload, AlertCircle } from "lucide-react";
import { uploadFileWithProgress } from "@/lib/supabase/storage";
import { createClient } from "@/lib/supabase/client";
import { DBS_LINKS } from "@/lib/constants";
import { DBS_UPLOAD_ACCEPT, checkDbsCertificateFile } from "@/lib/dbs/certificate-file";

type UploadState = "idle" | "checking" | "uploading" | "done" | "error";

interface DbsCertificateStepProps {
  /** Her id for the storage folder; resolved from the session when absent. */
  userId?: string;
  layout: "onboarding" | "inline";
  submitting: boolean;
  error: string | null;
  /** Called with the uploaded file's storage path once a file is uploaded and the tick is given. */
  onSubmit: (certificatePath: string) => void;
}

const INPUT_ID = "dbs-certificate-file";

export function DbsCertificateStep({ userId, layout, submitting, error, onSubmit }: DbsCertificateStepProps) {
  const [noCertificate, setNoCertificate] = useState(false);
  const [path, setPath] = useState<string | null>(null);
  const [consent, setConsent] = useState(false);
  const [uploadBusy, setUploadBusy] = useState(false);
  const isOnboarding = layout === "onboarding";
  const canSubmit = !!path && consent && !submitting && !uploadBusy;

  const cta = (
    <button
      type="button"
      onClick={() => path && onSubmit(path)}
      disabled={!canSubmit}
      className="w-full bg-violet-600 hover:bg-violet-700 active:bg-violet-800 text-white h-11 rounded-lg font-medium text-sm transition-colors disabled:opacity-50 disabled:cursor-not-allowed focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-400 focus-visible:ring-offset-2"
    >
      {submitting || uploadBusy ? (
        <span className="flex items-center justify-center gap-2">
          <Loader2 className="w-4 h-4 animate-spin" />
          {submitting ? "Verifying..." : "Uploading..."}
        </span>
      ) : (
        "Verify DBS"
      )}
    </button>
  );

  return (
    <div className="space-y-5">
      {isOnboarding && !noCertificate && (
        <div className="rounded-xl border border-violet-500 bg-violet-50 ring-1 ring-violet-500 p-4">
          <p className="text-sm font-medium text-violet-700">Enhanced DBS certificate</p>
          <p className="text-xs text-slate-500 mt-0.5">A photo of page 1, or a PDF</p>
        </div>
      )}

      {noCertificate ? (
        <NoCertificateCard />
      ) : (
        <>
          <HowToUploadBox />
          <UpdateServiceNotice />
          <DbsCertificateDropzone
            userId={userId}
            onUploaded={setPath}
            onReset={() => setPath(null)}
            onBusyChange={setUploadBusy}
          />
          <label className="flex items-start gap-2.5 cursor-pointer">
            <input
              type="checkbox"
              checked={consent}
              onChange={(e) => setConsent(e.target.checked)}
              disabled={submitting}
              className="mt-0.5 h-4 w-4 shrink-0 rounded border-slate-300 text-violet-600 focus:ring-violet-500 accent-violet-600 cursor-pointer"
            />
            {/* [LEGAL] placeholder — final wording from the legal chat (copy deck §1.3, ruling #17). */}
            <span className="text-xs text-slate-500 leading-relaxed">
              I confirm this enhanced DBS certificate is genuine and issued to me, and I agree to Baby Bloom checking it
              with the DBS Update Service.
            </span>
          </label>
        </>
      )}

      {isOnboarding && (
        <button
          type="button"
          onClick={() => setNoCertificate((v) => !v)}
          className="w-full text-center text-xs text-slate-400 hover:text-violet-600 underline transition-colors"
        >
          {noCertificate ? "I have an enhanced DBS certificate" : "I don't have an enhanced DBS certificate"}
        </button>
      )}

      {error && <p className="text-sm text-red-600 bg-red-50 px-4 py-2 rounded-lg">{error}</p>}

      {!noCertificate &&
        (isOnboarding ? (
          <div className="fixed bottom-0 left-0 right-0 z-20 pt-3 pb-[66px] bg-gradient-to-t from-white from-70% to-transparent">
            <div className="max-w-md mx-auto px-2">{cta}</div>
          </div>
        ) : (
          cta
        ))}
    </div>
  );
}

// ── Pieces ──

function NoCertificateCard() {
  return (
    <div className="rounded-xl bg-amber-50 border border-amber-200 p-4 text-sm text-amber-800 space-y-2">
      <p className="font-medium">An enhanced DBS check is required to work with children in the UK.</p>
      <p className="text-xs text-amber-700">
        You can&apos;t continue without one. If you&apos;re self-employed, you can apply through an umbrella body —
        GOV.UK explains how.
      </p>
      <a
        href={DBS_LINKS.getEnhanced}
        target="_blank"
        rel="noopener noreferrer"
        className="inline-block text-xs font-medium text-amber-800 underline hover:text-amber-900"
      >
        Get an enhanced DBS &rarr;
      </a>
    </div>
  );
}

function HowToUploadBox() {
  return (
    <div className="rounded-xl bg-blue-50 border border-blue-100 p-4 text-xs text-blue-700 space-y-1.5">
      <p className="font-medium text-blue-800">How to upload your DBS certificate:</p>
      <ol className="list-decimal list-inside space-y-0.5 text-blue-600">
        <li>
          Use your <strong>enhanced</strong> DBS certificate — the paper one DBS posted to you. One from a previous job
          is fine.
        </li>
        <li>
          We only need <strong>page 1</strong> — it has your name, certificate number and the barred list checks.
        </li>
        <li>Lay it flat in good light. Get all four corners in, with no glare or shadows. Don&apos;t edit or crop it.</li>
        <li>Upload the photo below — or a PDF scan of your certificate.</li>
      </ol>
    </div>
  );
}

function UpdateServiceNotice() {
  return (
    <div className="text-xs text-slate-600 space-y-1">
      <p className="font-medium text-slate-700">You&apos;ll need to be on the DBS Update Service.</p>
      <p>We check your certificate with it automatically — you don&apos;t need to send us anything else.</p>
      <a
        href={DBS_LINKS.joinUpdateService}
        target="_blank"
        rel="noopener noreferrer"
        className="inline-block font-medium text-violet-700 underline hover:text-violet-800"
      >
        Join the Update Service &rarr;
      </a>
    </div>
  );
}

async function resolveUserId(given: string | undefined): Promise<string | null> {
  if (given) return given;
  const { data } = await createClient().auth.getUser();
  return data.user?.id ?? null;
}

function DbsCertificateDropzone({
  userId,
  onUploaded,
  onReset,
  onBusyChange,
}: {
  userId?: string;
  onUploaded: (path: string) => void;
  onReset: () => void;
  onBusyChange: (busy: boolean) => void;
}) {
  const [state, setState] = useState<UploadState>("idle");
  const [progress, setProgress] = useState(0);
  const [message, setMessage] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => () => abortRef.current?.abort(), []);
  const busy = state === "checking" || state === "uploading";
  useEffect(() => onBusyChange(busy), [busy, onBusyChange]);

  const handleFile = useCallback(
    async (file: File) => {
      onReset();
      setMessage(null);
      setState("checking");
      const problem = await checkDbsCertificateFile(file);
      if (problem) {
        setState("error");
        setMessage(problem);
        return;
      }
      const uid = await resolveUserId(userId);
      if (!uid) {
        setState("error");
        setMessage("Session expired — please refresh the page and try again");
        return;
      }
      abortRef.current?.abort();
      abortRef.current = new AbortController();
      setProgress(0);
      setState("uploading");
      const result = await uploadFileWithProgress("verification-documents", uid, file, setProgress, abortRef.current.signal);
      if (result.error || !result.url) {
        setState("error");
        setMessage(result.error ?? "Upload failed — please try again");
        return;
      }
      setState("done");
      onUploaded(result.url);
    },
    [userId, onUploaded, onReset],
  );

  return (
    <div className="space-y-1.5">
      <label htmlFor={INPUT_ID} className="text-sm font-medium text-slate-700 block">
        Page 1 of your DBS certificate
      </label>
      <input
        id={INPUT_ID}
        ref={inputRef}
        type="file"
        accept={DBS_UPLOAD_ACCEPT}
        className="hidden"
        disabled={busy}
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) void handleFile(file);
          e.target.value = "";
        }}
      />
      <button
        type="button"
        onClick={() => !busy && inputRef.current?.click()}
        onDrop={(e) => {
          e.preventDefault();
          const file = e.dataTransfer.files?.[0];
          if (file && !busy) void handleFile(file);
        }}
        onDragOver={(e) => e.preventDefault()}
        disabled={busy}
        className={`w-full flex flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed px-6 py-5 text-center transition-colors duration-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-400 ${
          state === "done"
            ? "border-green-300 bg-green-50"
            : busy
              ? "border-violet-300 bg-violet-50/30 cursor-wait"
              : state === "error"
                ? "border-red-300 bg-red-50 hover:border-red-400"
                : "border-slate-300 bg-slate-50 hover:border-violet-400 hover:bg-violet-50 active:bg-violet-50"
        }`}
      >
        {state === "done" ? (
          <span className="flex items-center gap-2 text-green-600">
            <CheckCircle2 className="h-5 w-5" />
            <span className="text-sm font-medium">Certificate uploaded</span>
          </span>
        ) : busy ? (
          <span className="flex flex-col items-center gap-2">
            <Loader2 className="h-7 w-7 text-violet-500 animate-spin" />
            <span className="text-xs text-slate-500">Uploading... {state === "uploading" ? `${progress}%` : ""}</span>
          </span>
        ) : state === "error" ? (
          <span className="flex flex-col items-center gap-2">
            <AlertCircle className="h-7 w-7 text-red-400" />
            <span className="text-sm font-medium text-red-600">{message}</span>
          </span>
        ) : (
          <>
            <Upload className="h-7 w-7 text-violet-500" />
            <span className="text-sm font-medium text-slate-700">Upload a photo of page 1, or a PDF</span>
            <span className="text-xs text-slate-400">drag and drop works too</span>
          </>
        )}
      </button>
    </div>
  );
}
