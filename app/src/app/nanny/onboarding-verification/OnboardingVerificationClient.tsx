"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { useRouter } from "next/navigation";
import {
  Upload,
  CheckCircle2,
  ShieldCheck,
  Loader2,
  Camera,
  AlertCircle,
} from "lucide-react";
import { uploadFileWithProgress } from "@/lib/supabase/storage";
import { VerifyLaterEscape } from "./VerifyLaterEscape";
import {
  submitIdentitySection,
  submitContactSection,
  submitWWCCSection,
  type VerificationData,
} from "@/lib/actions/verification";
import { BRAND } from "@/lib/constants";
import { fireDbsCheck } from "@/lib/dbs/run-dbs-check";
import { DbsCertificateStep } from "./steps/DbsCertificateStep";
import { VerificationProcessingStep } from "./steps/VerificationProcessingStep";
import {
  formatAddressLine,
  parseUkAddress,
  toTitleCase,
  type ParsedAddress,
  toServedPrefix,
} from "@/lib/uk-contact";

// ── Types ──

interface ProfileData {
  firstName: string;
  lastName: string;
  dateOfBirth: string;
  mobileNumber: string;
  suburb: string;
  postcode: string;
  profilePictureUrl: string | null;
  bioSnippet: string | null;
  nationality: string | null;
}

interface Props {
  initialStep: number;
  verification: VerificationData | null;
  profile: ProfileData;
  userId: string;
}

interface StoredAddress {
  addressLine: string;
  suburb: string;
  state: string;
  postcode: string;
}

// ── Constants ──

const PASSPORT_COUNTRIES = [
  "Australia",
  "Afghanistan",
  "Albania",
  "Algeria",
  "Andorra",
  "Angola",
  "Antigua and Barbuda",
  "Argentina",
  "Armenia",
  "Austria",
  "Azerbaijan",
  "Bahamas",
  "Bahrain",
  "Bangladesh",
  "Barbados",
  "Belarus",
  "Belgium",
  "Belize",
  "Benin",
  "Bhutan",
  "Bolivia",
  "Bosnia and Herzegovina",
  "Botswana",
  "Brazil",
  "Brunei",
  "Bulgaria",
  "Burkina Faso",
  "Burundi",
  "Cambodia",
  "Cameroon",
  "Canada",
  "Cape Verde",
  "Central African Republic",
  "Chad",
  "Chile",
  "China",
  "Colombia",
  "Comoros",
  "Congo",
  "Costa Rica",
  "Croatia",
  "Cuba",
  "Cyprus",
  "Czech Republic",
  "Denmark",
  "Djibouti",
  "Dominican Republic",
  "Ecuador",
  "Egypt",
  "El Salvador",
  "Equatorial Guinea",
  "Eritrea",
  "Estonia",
  "Eswatini",
  "Ethiopia",
  "Fiji",
  "Finland",
  "France",
  "Gabon",
  "Gambia",
  "Georgia",
  "Germany",
  "Ghana",
  "Greece",
  "Grenada",
  "Guatemala",
  "Guinea",
  "Guinea-Bissau",
  "Guyana",
  "Haiti",
  "Honduras",
  "Hungary",
  "Iceland",
  "India",
  "Indonesia",
  "Iran",
  "Iraq",
  "Ireland",
  "Israel",
  "Italy",
  "Jamaica",
  "Japan",
  "Jordan",
  "Kazakhstan",
  "Kenya",
  "Kuwait",
  "Kyrgyzstan",
  "Laos",
  "Latvia",
  "Lebanon",
  "Lesotho",
  "Liberia",
  "Libya",
  "Liechtenstein",
  "Lithuania",
  "Luxembourg",
  "Madagascar",
  "Malawi",
  "Malaysia",
  "Maldives",
  "Mali",
  "Malta",
  "Mauritania",
  "Mauritius",
  "Mexico",
  "Moldova",
  "Monaco",
  "Mongolia",
  "Montenegro",
  "Morocco",
  "Mozambique",
  "Myanmar",
  "Namibia",
  "Nepal",
  "Netherlands",
  "New Zealand",
  "Nicaragua",
  "Niger",
  "Nigeria",
  "North Korea",
  "North Macedonia",
  "Norway",
  "Oman",
  "Pakistan",
  "Panama",
  "Papua New Guinea",
  "Paraguay",
  "Peru",
  "Philippines",
  "Poland",
  "Portugal",
  "Qatar",
  "Romania",
  "Russia",
  "Rwanda",
  "Saudi Arabia",
  "Senegal",
  "Serbia",
  "Sierra Leone",
  "Singapore",
  "Slovakia",
  "Slovenia",
  "Solomon Islands",
  "Somalia",
  "South Africa",
  "South Korea",
  "South Sudan",
  "Spain",
  "Sri Lanka",
  "Sudan",
  "Suriname",
  "Sweden",
  "Switzerland",
  "Syria",
  "Taiwan",
  "Tajikistan",
  "Tanzania",
  "Thailand",
  "Timor-Leste",
  "Togo",
  "Trinidad and Tobago",
  "Tunisia",
  "Turkey",
  "Turkmenistan",
  "Uganda",
  "Ukraine",
  "United Arab Emirates",
  "United Kingdom",
  "United States",
  "Uruguay",
  "Uzbekistan",
  "Venezuela",
  "Vietnam",
  "Yemen",
  "Zambia",
  "Zimbabwe",
];

// ── Circular Upload Progress ──

function CircularProgress({ percent }: { percent: number }) {
  const radius = 18;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference - (percent / 100) * circumference;

  return (
    <svg className="h-12 w-12 -rotate-90" viewBox="0 0 44 44">
      <circle
        cx="22"
        cy="22"
        r={radius}
        fill="none"
        stroke="#e2e8f0"
        strokeWidth="3"
      />
      <circle
        cx="22"
        cy="22"
        r={radius}
        fill="none"
        stroke="#8B5CF6"
        strokeWidth="3"
        strokeLinecap="round"
        strokeDasharray={circumference}
        strokeDashoffset={offset}
        className="transition-all duration-300"
      />
      <text
        x="22"
        y="22"
        textAnchor="middle"
        dominantBaseline="central"
        className="fill-slate-700 font-medium"
        fontSize="10"
        transform="rotate(90 22 22)"
      >
        {percent}%
      </text>
    </svg>
  );
}

// ── Real File Upload Zone ──

function FileUploadZone({
  label,
  hint,
  accept,
  bucket,
  userId,
  onUploaded,
}: {
  label: string;
  hint?: string;
  accept?: string;
  bucket: "verification-documents";
  userId: string;
  onUploaded: (path: string) => void;
}) {
  const [state, setState] = useState<"idle" | "uploading" | "done" | "error">(
    "idle",
  );
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const abortRef = useRef<AbortController | null>(null);

  const handleFileSelect = useCallback(
    async (file: File) => {
      setState("uploading");
      setProgress(0);
      setError(null);

      abortRef.current = new AbortController();

      const result = await uploadFileWithProgress(
        bucket,
        userId,
        file,
        (percent) => setProgress(percent),
        abortRef.current.signal,
      );

      if (result.error) {
        setState("error");
        setError(result.error);
        return;
      }

      if (result.url) {
        setState("done");
        onUploaded(result.url);
      }
    },
    [bucket, userId, onUploaded],
  );

  const handleClick = useCallback(() => {
    if (state === "idle" || state === "error" || state === "done") {
      fileInputRef.current?.click();
    }
  }, [state]);

  return (
    <div className="space-y-1.5">
      <label className="text-sm font-medium text-slate-700 block">
        {label}
      </label>
      <input
        ref={fileInputRef}
        type="file"
        accept={accept}
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) handleFileSelect(file);
          e.target.value = "";
        }}
      />
      <button
        type="button"
        onClick={handleClick}
        disabled={state === "uploading"}
        className={`w-full flex flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed px-6 py-5 text-center transition-all duration-300 ${
          state === "done"
            ? "border-green-300 bg-green-50"
            : state === "uploading"
              ? "border-violet-300 bg-violet-50/30 cursor-wait"
              : state === "error"
                ? "border-red-300 bg-red-50 hover:border-red-400"
                : "border-slate-300 bg-slate-50 hover:border-violet-400 hover:bg-violet-50 active:bg-violet-50"
        }`}
      >
        {state === "done" ? (
          <div className="flex items-center gap-2 text-green-600">
            <CheckCircle2 className="h-5 w-5" />
            <span className="text-sm font-medium">File uploaded</span>
          </div>
        ) : state === "uploading" ? (
          <div className="flex flex-col items-center gap-2">
            <CircularProgress percent={progress} />
            <span className="text-xs text-slate-500">Uploading...</span>
          </div>
        ) : state === "error" ? (
          <div className="flex flex-col items-center gap-2">
            <AlertCircle className="h-7 w-7 text-red-400" />
            <p className="text-sm font-medium text-red-600">
              Upload failed — tap to retry
            </p>
            {error && <p className="text-xs text-red-500">{error}</p>}
          </div>
        ) : (
          <>
            <Upload className="h-7 w-7 text-violet-500" />
            {hint ? (
              <p className="text-sm font-medium text-slate-700">{hint}</p>
            ) : (
              <p className="text-sm font-medium text-slate-700">
                Tap to upload
              </p>
            )}
          </>
        )}
      </button>
    </div>
  );
}

// ── Selfie Upload Zone (with camera icon) ──

function SelfieUploadZone({
  userId,
  onUploaded,
}: {
  userId: string;
  onUploaded: (path: string) => void;
}) {
  const [state, setState] = useState<"idle" | "uploading" | "done" | "error">(
    "idle",
  );
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const abortRef = useRef<AbortController | null>(null);

  const handleFileSelect = useCallback(
    async (file: File) => {
      setState("uploading");
      setProgress(0);
      setError(null);

      abortRef.current = new AbortController();

      const result = await uploadFileWithProgress(
        "verification-documents",
        userId,
        file,
        (percent) => setProgress(percent),
        abortRef.current.signal,
      );

      if (result.error) {
        setState("error");
        setError(result.error);
        return;
      }

      if (result.url) {
        setState("done");
        onUploaded(result.url);
      }
    },
    [userId, onUploaded],
  );

  const handleClick = useCallback(() => {
    if (state === "idle" || state === "error" || state === "done") {
      fileInputRef.current?.click();
    }
  }, [state]);

  return (
    <div className="space-y-1.5">
      <label className="text-sm font-medium text-slate-700 block">
        Identification photo
      </label>
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) handleFileSelect(file);
          e.target.value = "";
        }}
      />
      <button
        type="button"
        onClick={handleClick}
        disabled={state === "uploading"}
        className={`w-full flex flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed px-6 py-5 text-center transition-all duration-300 ${
          state === "done"
            ? "border-green-300 bg-green-50"
            : state === "uploading"
              ? "border-violet-300 bg-violet-50/30 cursor-wait"
              : state === "error"
                ? "border-red-300 bg-red-50 hover:border-red-400"
                : "border-violet-300 bg-violet-50/50 hover:border-violet-400 hover:bg-violet-50 active:bg-violet-100"
        }`}
      >
        {state === "done" ? (
          <div className="flex items-center gap-2 text-green-600">
            <CheckCircle2 className="h-5 w-5" />
            <span className="text-sm font-medium">Photo uploaded</span>
          </div>
        ) : state === "uploading" ? (
          <div className="flex flex-col items-center gap-2">
            <CircularProgress percent={progress} />
            <span className="text-xs text-slate-500">Uploading...</span>
          </div>
        ) : state === "error" ? (
          <div className="flex flex-col items-center gap-2">
            <AlertCircle className="h-7 w-7 text-red-400" />
            <p className="text-sm font-medium text-red-600">
              Upload failed — tap to retry
            </p>
            {error && <p className="text-xs text-red-500">{error}</p>}
          </div>
        ) : (
          <>
            <div className="w-10 h-10 rounded-full bg-violet-100 flex items-center justify-center">
              <Camera className="h-5 w-5 text-violet-600" />
            </div>
            <p className="text-sm font-medium text-slate-700">
              Upload your identification selfie
            </p>
          </>
        )}
      </button>
    </div>
  );
}

// ── GNAF Address Helpers ──

interface AddressResult {
  sla: string;
  ssla?: string;
  pid: string;
  score: number;
}

// ── Step: Account Secured ──

type AccountSecuredVariant = "current" | "with-get-started";

interface AccountSecuredStepEntry {
  status: "done" | "current" | "upcoming";
  title: string;
  desc: string;
  subs?: string[];
}

function AccountSecuredStep({
  profile,
  variant = "current",
}: {
  profile: ProfileData;
  variant?: AccountSecuredVariant;
}) {
  const initial = profile.firstName?.charAt(0)?.toUpperCase() || "N";

  // T-022 — `with-get-started` is the 4-step variant rendered when the
  // bonus-program onboarding flag is ON. The Get Started step has no
  // sub-bullets (the feeling is "this is part of how Baby Bloom works",
  // not "here's what we're going to ask you to do"). The legacy 3-step
  // variant keeps the Residence/ID/DBS sub-bullets on the current Verify
  // step.
  const steps: AccountSecuredStepEntry[] =
    variant === "with-get-started"
      ? [
          {
            status: "done",
            title: "Account Secured",
            desc: "Your profile is protected",
          },
          {
            status: "current",
            title: "Get Started",
            desc: "Complete account setup",
          },
          {
            status: "upcoming",
            title: "Verify",
            desc: "Confirm your account details",
          },
          {
            status: "upcoming",
            title: "Connect",
            desc: "Start receiving family opportunities",
          },
        ]
      : [
          {
            status: "done",
            title: "Account Secured",
            desc: "Your profile is protected",
          },
          {
            status: "current",
            title: "Verify",
            desc: "Confirm your account details",
            subs: ["Residence", "ID", "DBS"],
          },
          {
            status: "upcoming",
            title: "Connect",
            desc: "Start receiving family opportunities",
          },
        ];

  return (
    <div className="flex flex-col items-center text-center gap-6 pt-4">
      {/* Profile card with pulsing verification badge */}
      <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-4 flex items-center gap-4 max-w-sm w-full">
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
            className="absolute -bottom-0.5 -right-0.5 flex items-center justify-center rounded-full bg-green-50 border border-green-200 ring-2 ring-white animate-[verifyPulse_2s_ease-in-out_infinite]"
            style={{ height: "22px", width: "22px" }}
          >
            <ShieldCheck className="h-3 w-3 text-green-700" />
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
        @media (prefers-reduced-motion: reduce) {
          .animate-\\[verifyPulse_2s_ease-in-out_infinite\\] {
            animation: none !important;
            opacity: 1 !important;
          }
        }
      `}</style>

      {/* Vertical stepper */}
      <div className="w-full max-w-xs mx-auto pt-2">
        {steps.map((s, i) => (
          <div key={s.title} className="flex items-stretch gap-4">
            <div className="flex flex-col items-center">
              {s.status === "done" ? (
                <div className="w-8 h-8 rounded-full bg-green-100 flex items-center justify-center shrink-0">
                  <CheckCircle2 className="w-5 h-5 text-green-600" />
                </div>
              ) : s.status === "current" ? (
                <div className="w-8 h-8 rounded-full border-[2.5px] border-violet-500 bg-white flex items-center justify-center shrink-0">
                  <div className="w-2.5 h-2.5 rounded-full bg-violet-500" />
                </div>
              ) : (
                <div className="w-8 h-8 rounded-full border-2 border-slate-200 bg-white shrink-0" />
              )}
              {i < steps.length - 1 && (
                <div
                  className={`w-0.5 flex-1 min-h-[28px] ${s.status === "done" ? "bg-green-200" : "bg-slate-200"}`}
                />
              )}
            </div>
            <div
              className={`text-left pb-5 ${i === steps.length - 1 ? "pb-0" : ""}`}
            >
              <p
                className={`text-sm font-semibold leading-tight ${
                  s.status === "done"
                    ? "text-green-700"
                    : s.status === "current"
                      ? "text-slate-800"
                      : "text-slate-500"
                }`}
              >
                {s.title}
              </p>
              <p
                className={`text-xs mt-0.5 ${s.status === "upcoming" ? "text-slate-500" : "text-slate-500"}`}
              >
                {s.desc}
              </p>
              {s.subs && s.subs.length > 0 && (
                <div className="mt-2.5 space-y-1.5">
                  {s.subs.map((sub) => (
                    <div key={sub} className="flex items-center gap-2">
                      <div className="w-1.5 h-1.5 rounded-full bg-violet-300 shrink-0" />
                      <span className="text-xs text-slate-500">{sub}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Step: Location ──

function LocationStep({
  onAddressSelected,
  initialAddress,
}: {
  onAddressSelected: (address: StoredAddress) => void;
  initialAddress: StoredAddress | null;
}) {
  const [addressQuery, setAddressQuery] = useState(
    initialAddress?.addressLine ?? "",
  );
  const [selectedAddress, setSelectedAddress] = useState<ParsedAddress | null>(
    initialAddress
      ? {
          line1: initialAddress.addressLine,
          line2: "",
          town: initialAddress.suburb,
          postcode: initialAddress.postcode,
        }
      : null,
  );
  const [addressResults, setAddressResults] = useState<AddressResult[]>([]);
  const [showDropdown, setShowDropdown] = useState(false);
  const [addressLoading, setAddressLoading] = useState(false);
  const [notInArea, setNotInArea] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [servedPrefixes, setServedPrefixes] = useState<Set<string>>(
    new Set(),
  );
  useEffect(() => {
    fetch("/api/london-districts")
      .then((res) => res.json())
      .then((data: { district: string; prefix: string; label: string }[]) => {
        setServedPrefixes(new Set(data.map((d) => d.prefix)));
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (
        dropdownRef.current &&
        !dropdownRef.current.contains(e.target as Node)
      ) {
        setShowDropdown(false);
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, []);

  const searchAddress = useCallback((query: string) => {
    if (query.trim().length < 4) {
      setAddressResults([]);
      setShowDropdown(false);
      return;
    }

    if (debounceRef.current) clearTimeout(debounceRef.current);

    debounceRef.current = setTimeout(async () => {
      setAddressLoading(true);
      try {
        const res = await fetch(
          `/api/address-search?q=${encodeURIComponent(query)}`,
        );
        if (!res.ok) {
          setAddressResults([]);
          setShowDropdown(false);
          return;
        }
        const data: AddressResult[] = await res.json();
        // The route already filters to GB and emits the UK address shape,
        // so there is nothing left to filter here (12.01).
        setAddressResults(data.slice(0, 8));
        setShowDropdown(data.length > 0);
      } catch {
        setAddressResults([]);
        setShowDropdown(false);
      } finally {
        setAddressLoading(false);
      }
    }, 180);
  }, []);

  function handleAddressChange(val: string) {
    setAddressQuery(val);
    setSelectedAddress(null);
    setNotInArea(false);
    searchAddress(val);
  }

  function handleAddressSelect(result: AddressResult) {
    const parsed = parseUkAddress(result.ssla || result.sla);
    if (!parsed) {
      setShowDropdown(false);
      return;
    }

    if (
      servedPrefixes.size > 0 &&
      toServedPrefix(parsed.postcode, servedPrefixes) === null
    ) {
      setNotInArea(true);
      setSelectedAddress(null);
      setAddressQuery(toTitleCase(result.ssla || result.sla));
      setShowDropdown(false);
      return;
    }

    setAddressQuery(formatAddressLine(parsed));
    setSelectedAddress(parsed);
    setShowDropdown(false);
    setAddressResults([]);
    setNotInArea(false);

    onAddressSelected({
      addressLine: formatAddressLine(parsed),
      suburb: parsed.town,
      state: BRAND.region,
      postcode: parsed.postcode,
    });
  }

  return (
    <div className="space-y-5">
      <div className="space-y-2">
        <div className="flex items-baseline justify-between">
          <label className="text-sm font-medium text-slate-700">Address</label>
          <span className="text-xs text-slate-400">London</span>
        </div>
        <div className="relative" ref={dropdownRef}>
          <div className="relative">
            <input
              type="text"
              placeholder="Start typing your address..."
              value={addressQuery}
              onChange={(e) => handleAddressChange(e.target.value)}
              onFocus={() => {
                if (addressResults.length > 0) setShowDropdown(true);
              }}
              autoComplete="off"
              className="w-full h-11 rounded-lg border border-slate-200 px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-violet-500 focus:border-transparent"
            />
            {addressLoading && (
              <Loader2 className="absolute right-3 top-1/2 -translate-y-1/2 h-4 w-4 animate-spin text-slate-400" />
            )}
          </div>
          {showDropdown && (
            <div className="absolute z-50 w-full max-h-48 overflow-y-auto rounded-lg border border-slate-200 bg-white shadow-lg bottom-full mb-1">
              {addressResults.map((r) => (
                <button
                  key={r.pid}
                  type="button"
                  onClick={() => handleAddressSelect(r)}
                  className="w-full px-4 py-2.5 text-left text-sm text-slate-700 hover:bg-violet-50 hover:text-violet-700 cursor-pointer"
                >
                  {toTitleCase(r.ssla || r.sla)}
                </button>
              ))}
            </div>
          )}
          {notInArea && (
            <p className="text-xs text-amber-600 mt-1.5">
              This address is outside our service area. We currently only
              operate in Greater London.
            </p>
          )}
        </div>
      </div>

      <div className="flex flex-col gap-1.5">
        <label className="text-sm font-medium text-slate-700">Area</label>
        <input
          type="text"
          value={selectedAddress?.town ?? ""}
          readOnly
          className={`w-full h-11 rounded-lg border px-4 py-3 text-sm ${
            selectedAddress
              ? "border-green-200 bg-green-50 text-slate-800"
              : "border-slate-200 bg-slate-50 text-slate-400"
          }`}
        />
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div className="flex flex-col gap-1.5">
          <label className="text-sm font-medium text-slate-700">County</label>
          <input
            type="text"
            value={selectedAddress ? BRAND.region : ""}
            readOnly
            className={`w-full h-11 rounded-lg border px-4 py-3 text-sm ${
              selectedAddress
                ? "border-green-200 bg-green-50 text-slate-800"
                : "border-slate-200 bg-slate-50 text-slate-400"
            }`}
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <label className="text-sm font-medium text-slate-700">Postcode</label>
          <input
            type="text"
            value={selectedAddress?.postcode ?? ""}
            readOnly
            className={`w-full h-11 rounded-lg border px-4 py-3 text-sm ${
              selectedAddress
                ? "border-green-200 bg-green-50 text-slate-800"
                : "border-slate-200 bg-slate-50 text-slate-400"
            }`}
          />
        </div>
      </div>
    </div>
  );
}

// ── Step: Identity ──

function IdentityStep({
  profile,
  userId,
  onSelfiePath,
  onPassportPath,
  selfiePath,
  passportPath,
  givenNames,
  setGivenNames,
  surname,
  setSurname,
  dob,
  setDob,
  passportCountry,
  setPassportCountry,
  idConfirmed,
  setIdConfirmed,
  biometricConsent,
  setBiometricConsent,
}: {
  profile: ProfileData;
  userId: string;
  onSelfiePath: (path: string) => void;
  onPassportPath: (path: string) => void;
  selfiePath: string | null;
  passportPath: string | null;
  givenNames: string;
  setGivenNames: (v: string) => void;
  surname: string;
  setSurname: (v: string) => void;
  dob: string;
  setDob: (v: string) => void;
  passportCountry: string;
  setPassportCountry: (v: string) => void;
  idConfirmed: boolean;
  setIdConfirmed: (v: boolean) => void;
  biometricConsent: boolean;
  setBiometricConsent: (v: boolean) => void;
}) {
  // 18+ validation
  const eighteenYearsAgo = new Date();
  eighteenYearsAgo.setFullYear(eighteenYearsAgo.getFullYear() - 18);
  const maxDob = eighteenYearsAgo.toISOString().split("T")[0];
  const [dobError, setDobError] = useState("");

  const handleDobChange = useCallback(
    (val: string) => {
      setDob(val);
      if (val && val > maxDob) {
        setDobError("You must be at least 18 years old");
      } else {
        setDobError("");
      }
    },
    [maxDob, setDob],
  );

  return (
    <div className="space-y-4">
      {/* Given Name(s) + Surname — side by side */}
      <div className="grid grid-cols-2 gap-3">
        <div className="flex flex-col gap-1.5">
          <label className="text-sm font-medium text-slate-700">
            Given Name(s)
          </label>
          <input
            type="text"
            value={givenNames}
            onChange={(e) => setGivenNames(e.target.value)}
            placeholder="As on passport"
            className="w-full h-11 rounded-lg border border-slate-200 px-3 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-violet-500 focus:border-transparent"
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <label className="text-sm font-medium text-slate-700">Surname</label>
          <input
            type="text"
            value={surname}
            onChange={(e) => setSurname(e.target.value)}
            placeholder="As on passport"
            className="w-full h-11 rounded-lg border border-slate-200 px-3 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-violet-500 focus:border-transparent"
          />
        </div>
      </div>

      {/* Date of Birth */}
      <div className="flex flex-col gap-1.5">
        <label className="text-sm font-medium text-slate-700">
          Date of Birth
        </label>
        <input
          type="date"
          value={dob}
          onChange={(e) => handleDobChange(e.target.value)}
          max={maxDob}
          className={`w-full h-11 rounded-lg border px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-violet-500 focus:border-transparent ${
            dobError ? "border-red-300" : "border-slate-200"
          }`}
        />
        {dobError && <p className="text-xs text-red-500 mt-1">{dobError}</p>}
      </div>

      {/* Selfie */}
      <SelfieUploadZone userId={userId} onUploaded={onSelfiePath} />

      {/* Selfie guidance — disappears after upload */}
      {!selfiePath && (
        <div className="rounded-lg bg-blue-50 border border-blue-200 p-3 text-xs text-blue-700 space-y-1">
          <p className="font-medium text-blue-800">This selfie should:</p>
          <ul className="list-disc list-inside space-y-0.5">
            <li>Be clear and front-facing</li>
            <li>Show your full face with a neutral expression</li>
            <li>Have no sunglasses, hats, or face coverings</li>
          </ul>
        </div>
      )}

      {/* Passport — revealed after selfie */}
      <div
        className={`space-y-4 transition-all duration-500 ${selfiePath ? "opacity-100 translate-y-0" : "opacity-0 translate-y-4 pointer-events-none h-0 overflow-hidden"}`}
      >
        <FileUploadZone
          label="Passport verification"
          hint="Upload your passport photo page"
          accept="image/*"
          bucket="verification-documents"
          userId={userId}
          onUploaded={onPassportPath}
        />

        {/* Passport guidance — disappears after upload */}
        {!passportPath && (
          <div className="rounded-lg bg-blue-50 border border-blue-200 p-3 text-xs text-blue-700 space-y-1">
            <p className="font-medium text-blue-800">This photo should:</p>
            <ul className="list-disc list-inside space-y-0.5">
              <li>Show the photo page of your passport</li>
              <li>Be flat and fully visible — no fingers or glare</li>
              <li>Have all text clearly readable</li>
            </ul>
          </div>
        )}
      </div>

      {/* Passport country + checkboxes — revealed after passport uploaded */}
      <div
        className={`space-y-4 transition-all duration-500 ${passportPath ? "opacity-100 translate-y-0" : "opacity-0 translate-y-4 pointer-events-none h-0 overflow-hidden"}`}
      >
        <div className="flex flex-col gap-1.5">
          <label className="text-sm font-medium text-slate-700">
            Passport Country of Issue
          </label>
          <select
            value={passportCountry}
            onChange={(e) => setPassportCountry(e.target.value)}
            className="w-full h-11 rounded-lg border border-slate-200 bg-white px-4 py-2.5 text-sm text-slate-800 focus:outline-none focus:ring-2 focus:ring-violet-500 focus:border-transparent"
          >
            <option value="" disabled>
              Select country of issue
            </option>
            {PASSPORT_COUNTRIES.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
        </div>

        <div className="space-y-1.5">
          <label className="flex items-start gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={idConfirmed}
              onChange={(e) => setIdConfirmed(e.target.checked)}
              className="mt-0.5 h-3.5 w-3.5 shrink-0 rounded border-slate-300 text-violet-600 focus:ring-violet-500 cursor-pointer"
            />
            <span className="text-xs text-slate-500 leading-relaxed">
              I confirm that the passport I have provided is genuine, valid, and
              issued to me.
            </span>
          </label>
          <label className="flex items-start gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={biometricConsent}
              onChange={(e) => setBiometricConsent(e.target.checked)}
              className="mt-0.5 h-3.5 w-3.5 shrink-0 rounded border-slate-300 text-violet-600 focus:ring-violet-500 cursor-pointer"
            />
            <span className="text-xs text-slate-500 leading-relaxed">
              I have read the{" "}
              <a
                href="/legal/biometric-notice?from=/nanny/onboarding-verification"
                className="text-violet-600 underline hover:text-violet-700"
                onClick={(e) => e.stopPropagation()}
              >
                Biometric Data Collection Notice
              </a>{" "}
              and consent to the collection and processing of my biometric data
              as described.
            </span>
          </label>
        </div>
      </div>
    </div>
  );
}

// ── Main Client Component ──

export function OnboardingVerificationClient({
  initialStep,
  verification,
  profile,
  userId,
}: Props) {
  const router = useRouter();
  const [step, setStep] = useState(initialStep);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Location state (deferred DB write) — initialize from DB if contact was saved
  const [storedAddress, setStoredAddress] = useState<StoredAddress | null>(
    verification?.contact_status === "saved" && verification.address_line
      ? {
          addressLine: verification.address_line,
          suburb: verification.city ?? "",
          state: verification.state ?? BRAND.region,
          postcode: verification.postcode ?? "",
        }
      : null,
  );

  // Identity state — pre-fill from verification if exists, else from profile
  const [givenNames, setGivenNames] = useState(
    verification?.given_names ?? profile.firstName,
  );
  const [surname, setSurname] = useState(
    verification?.surname ?? profile.lastName,
  );
  const [dob, setDob] = useState(
    verification?.date_of_birth ?? profile.dateOfBirth,
  );
  const [passportCountry, setPassportCountry] = useState(
    verification?.passport_country ?? "",
  );
  const [selfiePath, setSelfiePath] = useState<string | null>(
    verification?.identification_photo_url ?? null,
  );
  const [passportPath, setPassportPath] = useState<string | null>(
    verification?.passport_upload_url ?? null,
  );
  const [idConfirmed, setIdConfirmed] = useState(false);
  const [biometricConsent, setBiometricConsent] = useState(false);

  // DBS step state (3b: one page-1 upload + consent, inside DbsCertificateStep)
  const [dbsError, setDbsError] = useState<string | null>(null);

  // Processing outcome
  const [processingOutcome, setProcessingOutcome] = useState<
    "success" | "failure" | "review" | null
  >(null);

  // Step 0: Account Secured — user clicks CTA to advance

  // ── Submit handlers ──

  const handleIdentitySubmit = useCallback(async () => {
    if (
      !selfiePath ||
      !passportPath ||
      !passportCountry ||
      !givenNames.trim() ||
      !surname.trim() ||
      !dob
    ) {
      setError("Please complete all fields and uploads");
      return;
    }

    setSubmitting(true);
    setError(null);

    try {
      // 1. Submit identity (creates verifications record)
      const identityResult = await submitIdentitySection({
        surname: surname.trim(),
        given_names: givenNames.trim(),
        date_of_birth: dob,
        passport_country: passportCountry,
        passport_upload_url: passportPath,
        identification_photo_url: selfiePath,
      });

      if (!identityResult.success) {
        setError(identityResult.error || "Failed to submit identity");
        setSubmitting(false);
        return;
      }

      // 2. Submit contact section (deferred from location step)
      if (storedAddress) {
        const contactResult = await submitContactSection({
          phone_number: profile.mobileNumber || "",
          address_line: storedAddress.addressLine,
          city: storedAddress.suburb,
          state: storedAddress.state,
          postcode: storedAddress.postcode,
          country: BRAND.country,
        });

        if (!contactResult.success) {
          console.error(
            "[onboarding] Contact submit failed:",
            contactResult.error,
          );
          // Non-blocking — identity was already submitted
        }
      }

      // 3. Fire-and-forget AI verification
      if (identityResult.verificationId) {
        fetch("/api/run-verification", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            verificationId: identityResult.verificationId,
            phase: "identity",
          }),
        }).catch(() => {});
      }

      // 4. Advance to the DBS step
      setStep(3);
    } catch (err) {
      console.error("[onboarding] Identity submit error:", err);
      setError("An unexpected error occurred. Please try again.");
    } finally {
      setSubmitting(false);
    }
  }, [
    selfiePath,
    passportPath,
    passportCountry,
    givenNames,
    surname,
    dob,
    storedAddress,
    profile.mobileNumber,
  ]);

  const handleDbsSubmit = useCallback(async (certificatePath: string) => {
    setSubmitting(true);
    setDbsError(null);
    try {
      const result = await submitWWCCSection({ certificate_path: certificatePath, consent: true });
      if (!result.success) {
        setDbsError(result.error || "We couldn't send your certificate. Please try again.");
        return;
      }
      if (result.verificationId) fireDbsCheck(result.verificationId);
      setStep(4);
    } catch (err) {
      console.error("[onboarding] DBS submit error:", err);
      setDbsError("We couldn't send your certificate. Please try again.");
    } finally {
      setSubmitting(false);
    }
  }, []);

  const handleProcessingComplete = useCallback(
    (outcome: "success" | "failure" | "review") => {
      setProcessingOutcome(outcome);
      // Failures and reviews: auto-redirect after 2 seconds
      if (outcome === "failure" || outcome === "review") {
        setTimeout(() => router.push("/nanny/verification"), 2000);
      }
    },
    [router],
  );

  // ── Render by step ──

  // Step 0: Account Secured interstitial
  if (step === 0) {
    // T-022 — bonus-program onboarding flag. ON by default (env is unset
    // or anything non-'false'). The flag-off path falls back to the exact
    // pre-T-022 behaviour: 3-step stepper, "Verify Account" CTA wired to
    // setStep(1). Public env var because this gate lives in a client
    // component — the server-side `bonusProgramDisabled()` partner is
    // used by the new /nanny/onboarding/add-child page guard.
    const bonusProgramOn =
      process.env.NEXT_PUBLIC_BONUS_PROGRAM_ENABLED !== "false";

    return (
      <div className="min-h-screen bg-white">
        <main className="max-w-2xl mx-auto px-4 lg:px-6 pt-4">
          <div className="relative flex flex-col min-h-[calc(100vh-10rem)]">
            <VerifyLaterEscape />
            <div className="text-center pt-10 mb-2">
              <h2 className="text-xl sm:text-2xl font-semibold text-slate-800 leading-snug">
                Account secured!
              </h2>
              <p className="text-sm text-slate-500 mt-2 max-w-md mx-auto">
                {bonusProgramOn
                  ? "Here's what's next on your way to matching with families"
                  : "Verify your account now to connect with families"}
              </p>
            </div>
            <div className="flex-1 flex items-center justify-center pb-32">
              <div className="max-w-md mx-auto px-2">
                <AccountSecuredStep
                  profile={profile}
                  variant={bonusProgramOn ? "with-get-started" : "current"}
                />
              </div>
            </div>
          </div>

          <div className="fixed bottom-0 left-0 right-0 z-20 pt-3 pb-[66px] bg-gradient-to-t from-white from-70% to-transparent">
            <div className="max-w-md mx-auto px-2 space-y-6">
              <p className="text-[10px] text-slate-400 text-center whitespace-nowrap">
                {bonusProgramOn
                  ? "Verification is required before matching with new families"
                  : "We must verify all users before connecting them with a childcare position"}
              </p>
              <button
                type="button"
                onClick={
                  bonusProgramOn
                    ? () => router.push("/nanny/onboarding/add-child")
                    : () => setStep(1)
                }
                className="w-full bg-violet-600 hover:bg-violet-700 active:bg-violet-800 text-white h-11 rounded-lg font-medium text-sm transition-colors"
              >
                {bonusProgramOn ? "Get Started" : "Verify Account"}
              </button>
            </div>
          </div>
        </main>
      </div>
    );
  }

  // Step 1: Location
  if (step === 1) {
    return (
      <div className="min-h-screen bg-white">
        <main className="max-w-2xl mx-auto px-4 lg:px-6 pt-4">
          <div className="relative flex flex-col min-h-[calc(100vh-10rem)]">
            <VerifyLaterEscape />
            {/* No back nav — verification steps must complete in order
                so the nanny doesn't accidentally regress from an applied
                document upload back to the previous step. Bailey 2026-05-18. */}
            <div className="flex-1 pt-10 pb-6">
              <div className="text-center mb-6">
                <h2 className="text-xl sm:text-2xl font-semibold text-slate-800 leading-snug">
                  Verify your residence
                </h2>
              </div>
              <div className="max-w-md mx-auto px-2 pb-20">
                <LocationStep
                  onAddressSelected={setStoredAddress}
                  initialAddress={storedAddress}
                />
              </div>
            </div>
          </div>

          {storedAddress && (
            <div className="fixed bottom-0 left-0 right-0 z-20 pt-3 pb-[66px] bg-gradient-to-t from-white from-70% to-transparent">
              <div className="max-w-md mx-auto px-2">
                <button
                  type="button"
                  onClick={() => setStep(2)}
                  className="w-full bg-violet-600 hover:bg-violet-700 active:bg-violet-800 text-white h-11 rounded-lg font-medium text-sm transition-colors"
                >
                  Verify Residence
                </button>
              </div>
            </div>
          )}
        </main>
      </div>
    );
  }

  // Step 2: Identity
  if (step === 2) {
    return (
      <div className="min-h-screen bg-white">
        <main className="max-w-2xl mx-auto px-4 lg:px-6 pt-4">
          <div className="relative flex flex-col min-h-[calc(100vh-10rem)]">
            <VerifyLaterEscape />
            {/* No back nav per Bailey 2026-05-18 — see Step 1 above. */}
            <div className="flex-1 pt-10 pb-6">
              <div className="text-center mb-6">
                <h2 className="text-xl sm:text-2xl font-semibold text-slate-800 leading-snug">
                  Verify your identity
                </h2>
                <p className="text-sm text-slate-500 mt-2 max-w-sm mx-auto">
                  Every childcare professional and family is verified to the
                  same gold standard to keep both parties safe.
                </p>
              </div>
              <div className="max-w-md mx-auto px-2 pb-20">
                <IdentityStep
                  profile={profile}
                  userId={userId}
                  onSelfiePath={setSelfiePath}
                  onPassportPath={setPassportPath}
                  selfiePath={selfiePath}
                  passportPath={passportPath}
                  givenNames={givenNames}
                  setGivenNames={setGivenNames}
                  surname={surname}
                  setSurname={setSurname}
                  dob={dob}
                  setDob={setDob}
                  passportCountry={passportCountry}
                  setPassportCountry={setPassportCountry}
                  idConfirmed={idConfirmed}
                  setIdConfirmed={setIdConfirmed}
                  biometricConsent={biometricConsent}
                  setBiometricConsent={setBiometricConsent}
                />
              </div>
            </div>

            {error && (
              <div className="max-w-md mx-auto px-2 pb-4">
                <p className="text-sm text-red-600 bg-red-50 px-4 py-2 rounded-lg">
                  {error}
                </p>
              </div>
            )}
          </div>

          {selfiePath &&
            passportPath &&
            passportCountry &&
            idConfirmed &&
            biometricConsent &&
            givenNames.trim() &&
            surname.trim() &&
            dob && (
              <div className="fixed bottom-0 left-0 right-0 z-20 pt-3 pb-[66px] bg-gradient-to-t from-white from-70% to-transparent">
                <div className="max-w-md mx-auto px-2">
                  <button
                    type="button"
                    onClick={handleIdentitySubmit}
                    disabled={submitting}
                    className="w-full bg-violet-600 hover:bg-violet-700 active:bg-violet-800 text-white h-11 rounded-lg font-medium text-sm transition-colors disabled:opacity-60"
                  >
                    {submitting ? (
                      <span className="flex items-center justify-center gap-2">
                        <Loader2 className="w-4 h-4 animate-spin" />
                        Submitting...
                      </span>
                    ) : (
                      "Verify ID"
                    )}
                  </button>
                </div>
              </div>
            )}
        </main>
      </div>
    );
  }

  // Step 3: DBS certificate
  if (step === 3) {
    return (
      <div className="min-h-screen bg-white">
        <main className="max-w-2xl mx-auto px-4 lg:px-6 pt-4">
          <div className="relative flex flex-col min-h-[calc(100vh-10rem)]">
            <VerifyLaterEscape />
            {/* No back nav per Bailey 2026-05-18 — see Step 1 above. */}
            <div className="flex-1 pt-10 pb-6">
              <div className="text-center mb-6">
                <h2 className="text-xl sm:text-2xl font-semibold text-slate-800 leading-snug">
                  Enhanced DBS certificate
                </h2>
                <p className="text-sm text-slate-500 mt-2 max-w-sm mx-auto">
                  An enhanced DBS check is required to work with children in
                  the UK.
                </p>
              </div>
              <div className="max-w-md mx-auto px-2 pb-20">
                <DbsCertificateStep
                  userId={userId}
                  layout="onboarding"
                  submitting={submitting}
                  error={dbsError}
                  onSubmit={handleDbsSubmit}
                />
              </div>
            </div>
          </div>
        </main>
      </div>
    );
  }

  // Step 4: Processing
  if (step === 4) {
    return (
      <div className="min-h-screen bg-white">
        <main className="max-w-2xl mx-auto px-4 lg:px-6 pt-4">
          <div className="max-w-md mx-auto px-2">
            <VerificationProcessingStep
              profile={profile}
              onComplete={handleProcessingComplete}
            />
          </div>

          {processingOutcome === "success" && (
            <div className="fixed bottom-0 left-0 right-0 z-20 pt-3 pb-[66px] bg-gradient-to-t from-white from-70% to-transparent">
              <div className="max-w-md mx-auto px-2">
                <button
                  type="button"
                  onClick={() => router.push("/nanny")}
                  className="w-full bg-violet-600 hover:bg-violet-700 active:bg-violet-800 text-white h-11 rounded-lg font-medium text-sm transition-colors"
                >
                  Connect with families
                </button>
              </div>
            </div>
          )}
        </main>
      </div>
    );
  }

  return null;
}
