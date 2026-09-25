'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { CompoundPageShell } from '@/app/(funnel)/apply/components/shared/CompoundPageShell';
import { Lock, Upload, CheckCircle2, ShieldCheck, ChevronLeft, Loader2, Camera } from 'lucide-react';
import {
  formatAddressLine,
  parseUkAddress,
  toTitleCase,
  type ParsedAddress,
  toServedPrefix,
} from '@/lib/uk-contact';
import { BRAND } from '@/lib/constants';

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

const WWCC_METHODS = [
  { label: 'WWCC Grant Email', value: 'grant_email', desc: 'Upload your grant email as a PDF' },
  { label: 'Service NSW App', value: 'service_nsw', desc: 'Screenshot from your Service NSW wallet' },
  { label: 'Enter Manually (1-3 days)', value: 'manual', desc: 'Type your WWCC number and expiry date' },
] as const;

const STEPS = [
  { progress: 85, title: 'Secure your account', subtitle: 'Create a password to protect your profile' },
  { progress: 87, title: 'Verify your account', subtitle: '' },
  { progress: 90, title: 'Verify your residence', subtitle: '' },
  { progress: 93, title: 'Verify your identity', subtitle: 'Families need to know you\'re a real person. Upload your passport or ID and a quick selfie.' },
  { progress: 97, title: 'Working With Children Check', subtitle: 'A valid WWCC is required before you can receive job opportunities from families.' },
  { progress: 100, title: 'You\'re verified!', subtitle: 'Share your profile to get discovered by more families.' },
] as const;

// ── Dummy Upload Zone ──

function DummyUploadZone({ label, hint, onUploaded }: { label: string; hint?: string; onUploaded?: () => void }) {
  const upload = useSimulatedUpload();

  useEffect(() => {
    if (upload.state === 'done') onUploaded?.();
  }, [upload.state, onUploaded]);

  return (
    <div className="space-y-1.5">
      <label className="text-sm font-medium text-slate-700 block">{label}</label>
      <button
        type="button"
        onClick={() => upload.state === 'idle' && upload.startUpload()}
        disabled={upload.state === 'uploading'}
        className={`w-full flex flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed px-6 py-5 text-center transition-all duration-300 ${
          upload.state === 'done'
            ? 'border-green-300 bg-green-50'
            : upload.state === 'uploading'
            ? 'border-violet-300 bg-violet-50/30 cursor-wait'
            : 'border-slate-300 bg-slate-50 hover:border-violet-400 hover:bg-violet-50 active:bg-violet-50'
        }`}
      >
        {upload.state === 'done' ? (
          <div className="flex items-center gap-2 text-green-600">
            <CheckCircle2 className="h-5 w-5" />
            <span className="text-sm font-medium">File uploaded</span>
          </div>
        ) : upload.state === 'uploading' ? (
          <div className="flex flex-col items-center gap-2">
            <CircularProgress percent={upload.progress} />
            <span className="text-xs text-slate-500">Uploading...</span>
          </div>
        ) : (
          <>
            <Upload className="h-7 w-7 text-violet-500" />
            {hint ? (
              <p className="text-sm font-medium text-slate-700">{hint}</p>
            ) : (
              <p className="text-sm font-medium text-slate-700">Tap to upload</p>
            )}
          </>
        )}
      </button>
    </div>
  );
}

// ── Step Content Components ──

function SecureAccountStep() {
  return (
    <div className="flex flex-col gap-5">
      <div className="flex justify-center mb-1">
        <div className="w-12 h-12 bg-violet-100 rounded-full flex items-center justify-center">
          <Lock className="w-6 h-6 text-violet-600" />
        </div>
      </div>

      {/* Email */}
      <div className="flex flex-col gap-1.5">
        <label className="text-sm font-medium text-slate-700">Email</label>
        <input
          type="email"
          value="jessica@example.com"
          disabled
          className="w-full h-11 rounded-lg border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-500 cursor-not-allowed"
        />
      </div>

      {/* Password */}
      <div className="flex flex-col gap-1.5">
        <label className="text-sm font-medium text-slate-700">Create a password</label>
        <input
          type="password"
          placeholder="Minimum 8 characters"
          className="w-full h-11 rounded-lg border border-slate-200 px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-violet-500 focus:border-transparent"
        />
      </div>

      {/* Confirm Password */}
      <div className="flex flex-col gap-1.5">
        <label className="text-sm font-medium text-slate-700">Confirm your password</label>
        <input
          type="password"
          placeholder="Type your password again"
          className="w-full h-11 rounded-lg border border-slate-200 px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-violet-500 focus:border-transparent"
        />
      </div>

      {/* Consent checkboxes */}
      <div className="space-y-2.5">
        <label className="flex items-start gap-2.5 cursor-pointer">
          <input
            type="checkbox"
            className="mt-0.5 h-4 w-4 shrink-0 rounded border-slate-300 text-violet-600 focus:ring-violet-500 accent-violet-600 cursor-pointer"
          />
          <span className="text-xs text-slate-500 leading-relaxed">
            I agree to the Terms of Service and Privacy Policy
          </span>
        </label>
        <label className="flex items-start gap-2.5 cursor-pointer">
          <input
            type="checkbox"
            className="mt-0.5 h-4 w-4 shrink-0 rounded border-slate-300 text-violet-600 focus:ring-violet-500 accent-violet-600 cursor-pointer"
          />
          <span className="text-xs text-slate-500 leading-relaxed">
            I consent to background verification checks as part of the application process
          </span>
        </label>
      </div>
    </div>
  );
}

function AccountSecuredStep() {
  const steps = [
    { status: 'done' as const, title: 'Account Secured', desc: 'Your profile is protected' },
    { status: 'current' as const, title: 'Verify', desc: 'Confirm your account details' },
    { status: 'upcoming' as const, title: 'Connect', desc: 'Start receiving family opportunities' },
  ];

  return (
    <div className="flex flex-col items-center text-center gap-6 pt-4">
      {/* Profile card with pulsing verification badge */}
      <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-4 flex items-center gap-4 max-w-sm w-full">
        <div className="relative shrink-0">
          <div className="w-14 h-14 rounded-full overflow-hidden border-2 border-violet-200 bg-violet-100 flex items-center justify-center">
            <span className="text-xl font-bold text-violet-600">J</span>
          </div>
          {/* Pulsing verification badge */}
          <div className="absolute -bottom-0.5 -right-0.5 flex items-center justify-center rounded-full bg-green-50 border border-green-200 ring-2 ring-white animate-[verifyPulse_2s_ease-in-out_infinite]" style={{ height: '22px', width: '22px' }}>
            <ShieldCheck className="h-3 w-3 text-green-700" />
          </div>
        </div>
        <div className="text-left flex-1 min-w-0">
          <p className="font-semibold text-slate-800 text-sm">Jessica</p>
          <p className="text-xs text-slate-500 line-clamp-2">
            Professional nanny with a passion for early childhood development
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
        {steps.map((s, i) => (
          <div key={s.title} className="flex items-stretch gap-4">
            {/* Icon column with connecting line */}
            <div className="flex flex-col items-center">
              {/* Node */}
              {s.status === 'done' ? (
                <div className="w-8 h-8 rounded-full bg-green-100 flex items-center justify-center shrink-0">
                  <CheckCircle2 className="w-5 h-5 text-green-600" />
                </div>
              ) : s.status === 'current' ? (
                <div className="w-8 h-8 rounded-full border-[2.5px] border-violet-500 bg-white flex items-center justify-center shrink-0">
                  <div className="w-2.5 h-2.5 rounded-full bg-violet-500" />
                </div>
              ) : (
                <div className="w-8 h-8 rounded-full border-2 border-slate-200 bg-white shrink-0" />
              )}
              {/* Connector line */}
              {i < steps.length - 1 && (
                <div className={`w-0.5 flex-1 min-h-[28px] ${
                  s.status === 'done' ? 'bg-green-200' : 'bg-slate-200'
                }`} />
              )}
            </div>

            {/* Text */}
            <div className={`text-left pb-5 ${i === steps.length - 1 ? 'pb-0' : ''}`}>
              <p className={`text-sm font-semibold leading-tight ${
                s.status === 'done' ? 'text-green-700'
                  : s.status === 'current' ? 'text-slate-800'
                  : 'text-slate-400'
              }`}>
                {s.title}
              </p>
              <p className={`text-xs mt-0.5 ${
                s.status === 'upcoming' ? 'text-slate-300' : 'text-slate-500'
              }`}>
                {s.desc}
              </p>
              {/* Sub-steps for Verify */}
              {s.status === 'current' && (
                <div className="mt-2.5 space-y-1.5">
                  {['Residence', 'ID', 'WWCC'].map((sub) => (
                    <div key={sub} className="flex items-center gap-2">
                      <div className="w-1.5 h-1.5 rounded-full bg-violet-300 shrink-0" />
                      <span className="text-xs text-slate-500">{sub}</span>
                    </div>
                  ))}
                </div>
              )}
              {/* Note under Connect */}
              {s.status === 'upcoming' && (
                <p className="text-xs text-slate-300 mt-1 italic">
                  Only verified nannies can connect with families.
                </p>
              )}
            </div>
          </div>
        ))}
      </div>

    </div>
  );
}

// ── GNAF Address Helpers (from ContactSection) ──

interface AddressResult {
  sla: string;
  ssla?: string;
  pid: string;
  score: number;
}

function LocationStep() {
  const [addressQuery, setAddressQuery] = useState('');
  const [selectedAddress, setSelectedAddress] = useState<ParsedAddress | null>(null);
  const [addressResults, setAddressResults] = useState<AddressResult[]>([]);
  const [showDropdown, setShowDropdown] = useState(false);
  const [addressLoading, setAddressLoading] = useState(false);
  const [notInArea, setNotInArea] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [servedPrefixes, setServedPrefixes] = useState<Set<string>>(new Set());
  useEffect(() => {
    fetch('/api/london-districts')
      .then((res) => res.json())
      .then((data: { district: string; prefix: string; label: string }[]) => {
        setServedPrefixes(new Set(data.map((d) => d.prefix)));
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setShowDropdown(false);
      }
    }
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
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
        const res = await fetch(`/api/address-search?q=${encodeURIComponent(query)}`);
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
    }, 300);
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
  }

  return (
    <div className="space-y-5">
      {/* Address autocomplete */}
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
              This address is outside our service area. We currently only operate in Greater London.
            </p>
          )}
        </div>
      </div>

      {/* Pre-populated address fields */}
      <div className="flex flex-col gap-1.5">
        <label className="text-sm font-medium text-slate-700">Suburb</label>
        <input
          type="text"
          value={selectedAddress?.town ?? ''}
          readOnly
          placeholder=""
          className={`w-full h-11 rounded-lg border px-4 py-3 text-sm ${
            selectedAddress ? 'border-green-200 bg-green-50 text-slate-800' : 'border-slate-200 bg-slate-50 text-slate-400'
          }`}
        />
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div className="flex flex-col gap-1.5">
          <label className="text-sm font-medium text-slate-700">County</label>
          <input
            type="text"
            value={selectedAddress ? BRAND.region : ''}
            readOnly
            placeholder=""
            className={`w-full h-11 rounded-lg border px-4 py-3 text-sm ${
              selectedAddress ? 'border-green-200 bg-green-50 text-slate-800' : 'border-slate-200 bg-slate-50 text-slate-400'
            }`}
          />
        </div>

        <div className="flex flex-col gap-1.5">
          <label className="text-sm font-medium text-slate-700">Postcode</label>
          <input
            type="text"
            value={selectedAddress?.postcode ?? ''}
            readOnly
            placeholder=""
            className={`w-full h-11 rounded-lg border px-4 py-3 text-sm ${
              selectedAddress ? 'border-green-200 bg-green-50 text-slate-800' : 'border-slate-200 bg-slate-50 text-slate-400'
            }`}
          />
        </div>
      </div>

    </div>
  );
}

// ── Circular Upload Progress ──

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

// Hook to simulate upload progress
function useSimulatedUpload() {
  const [state, setState] = useState<'idle' | 'uploading' | 'done'>('idle');
  const [progress, setProgress] = useState(0);

  const startUpload = useCallback(() => {
    setState('uploading');
    setProgress(0);
    let current = 0;
    const interval = setInterval(() => {
      current += Math.random() * 15 + 5;
      if (current >= 100) {
        current = 100;
        clearInterval(interval);
        setProgress(100);
        setTimeout(() => setState('done'), 200);
      } else {
        setProgress(Math.round(current));
      }
    }, 150);
  }, []);

  return { state, progress, startUpload };
}

function IdentityStep() {
  const selfie = useSimulatedUpload();
  const passport = useSimulatedUpload();
  const [idConfirmed, setIdConfirmed] = useState(false);
  const [biometricConsent, setBiometricConsent] = useState(false);
  const [givenNames, setGivenNames] = useState('Jessica');
  const [surname, setSurname] = useState('Thompson');
  const [dob, setDob] = useState('1998-06-14');
  const [passportCountry, setPassportCountry] = useState('');

  // 18+ validation: max date is 18 years ago today
  const eighteenYearsAgo = new Date();
  eighteenYearsAgo.setFullYear(eighteenYearsAgo.getFullYear() - 18);
  const maxDob = eighteenYearsAgo.toISOString().split('T')[0];
  const [dobError, setDobError] = useState('');

  const handleDobChange = useCallback((val: string) => {
    setDob(val);
    if (val && val > maxDob) {
      setDobError('You must be at least 18 years old');
    } else {
      setDobError('');
    }
  }, [maxDob]);

  return (
    <div className="space-y-4">
      {/* Given Name(s) + Surname — side by side */}
      <div className="grid grid-cols-2 gap-3">
        <div className="flex flex-col gap-1.5">
          <label className="text-sm font-medium text-slate-700">Given Name(s)</label>
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
        <label className="text-sm font-medium text-slate-700">Date of Birth</label>
        <input
          type="date"
          value={dob}
          onChange={(e) => handleDobChange(e.target.value)}
          max={maxDob}
          className={`w-full h-11 rounded-lg border px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-violet-500 focus:border-transparent ${
            dobError ? 'border-red-300' : 'border-slate-200'
          }`}
        />
        {dobError && <p className="text-xs text-red-500 mt-1">{dobError}</p>}
      </div>

      {/* Selfie */}
      <div className="space-y-1.5">
        <label className="text-sm font-medium text-slate-700 block">Identification photo</label>
        <button
          type="button"
          onClick={() => selfie.state === 'idle' && selfie.startUpload()}
          disabled={selfie.state === 'uploading'}
          className={`w-full flex flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed px-6 py-5 text-center transition-all duration-300 ${
            selfie.state === 'done'
              ? 'border-green-300 bg-green-50'
              : selfie.state === 'uploading'
              ? 'border-violet-300 bg-violet-50/30 cursor-wait'
              : 'border-violet-300 bg-violet-50/50 hover:border-violet-400 hover:bg-violet-50 active:bg-violet-100'
          }`}
        >
          {selfie.state === 'done' ? (
            <div className="flex items-center gap-2 text-green-600">
              <CheckCircle2 className="h-5 w-5" />
              <span className="text-sm font-medium">Photo uploaded</span>
            </div>
          ) : selfie.state === 'uploading' ? (
            <div className="flex flex-col items-center gap-2">
              <CircularProgress percent={selfie.progress} />
              <span className="text-xs text-slate-500">Uploading...</span>
            </div>
          ) : (
            <>
              <div className="w-10 h-10 rounded-full bg-violet-100 flex items-center justify-center">
                <Camera className="h-5 w-5 text-violet-600" />
              </div>
              <p className="text-sm font-medium text-slate-700">Upload your identification selfie</p>
            </>
          )}
        </button>
      </div>

      {/* Selfie guidance — disappears after upload */}
      {selfie.state === 'idle' && (
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
      <div className={`space-y-4 transition-all duration-500 ${selfie.state === 'done' ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-4 pointer-events-none h-0 overflow-hidden'}`}>
        <div className="space-y-1.5">
          <label className="text-sm font-medium text-slate-700 block">Passport verification</label>
          <button
            type="button"
            onClick={() => passport.state === 'idle' && passport.startUpload()}
            disabled={passport.state === 'uploading'}
            className={`w-full flex flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed px-6 py-5 text-center transition-colors ${
              passport.state === 'done'
                ? 'border-green-300 bg-green-50'
                : passport.state === 'uploading'
                ? 'border-violet-300 bg-violet-50/30 cursor-wait'
                : 'border-slate-300 bg-slate-50 hover:border-violet-400 hover:bg-violet-50 active:bg-violet-50'
            }`}
          >
            {passport.state === 'done' ? (
              <div className="flex items-center gap-2 text-green-600">
                <CheckCircle2 className="h-5 w-5" />
                <span className="text-sm font-medium">Passport uploaded</span>
              </div>
            ) : passport.state === 'uploading' ? (
              <div className="flex flex-col items-center gap-2">
                <CircularProgress percent={passport.progress} />
                <span className="text-xs text-slate-500">Uploading...</span>
              </div>
            ) : (
              <>
                <Upload className="h-7 w-7 text-violet-500" />
                <p className="text-sm font-medium text-slate-700">Upload your passport photo page</p>
              </>
            )}
          </button>
        </div>

        {/* Passport guidance — disappears after upload */}
        {passport.state === 'idle' && (
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
      <div className={`space-y-4 transition-all duration-500 ${passport.state === 'done' ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-4 pointer-events-none h-0 overflow-hidden'}`}>
        {/* Passport Country of Issue */}
        <div className="flex flex-col gap-1.5">
          <label className="text-sm font-medium text-slate-700">Passport Country of Issue</label>
          <select
            value={passportCountry}
            onChange={(e) => setPassportCountry(e.target.value)}
            className="w-full h-11 rounded-lg border border-slate-200 bg-white px-4 py-2.5 text-sm text-slate-800 focus:outline-none focus:ring-2 focus:ring-violet-500 focus:border-transparent"
          >
            <option value="" disabled>Select country of issue</option>
            {PASSPORT_COUNTRIES.map((c) => (
              <option key={c} value={c}>{c}</option>
            ))}
          </select>
        </div>

        {/* Checkboxes */}
        <div className="space-y-2">
          <label className="flex items-start gap-2.5 cursor-pointer">
            <input
              type="checkbox"
              checked={idConfirmed}
              onChange={(e) => setIdConfirmed(e.target.checked)}
              className="mt-0.5 h-4 w-4 shrink-0 rounded border-slate-300 text-violet-600 focus:ring-violet-500 accent-violet-600 cursor-pointer"
            />
            <span className="text-xs text-slate-500 leading-relaxed">
              I confirm that the passport I have provided is genuine, valid, and issued to me.
            </span>
          </label>
          <label className="flex items-start gap-2.5 cursor-pointer">
            <input
              type="checkbox"
              checked={biometricConsent}
              onChange={(e) => setBiometricConsent(e.target.checked)}
              className="mt-0.5 h-4 w-4 shrink-0 rounded border-slate-300 text-violet-600 focus:ring-violet-500 accent-violet-600 cursor-pointer"
            />
            <span className="text-xs text-slate-500 leading-relaxed">
              I consent to the collection and processing of my biometric data for identity verification.
            </span>
          </label>
        </div>
      </div>
    </div>
  );
}

function WWCCStep({ onNoWwccChange }: { onNoWwccChange: (noWwcc: boolean) => void }) {
  const [method, setMethod] = useState<string | null>(null);
  const [noWwcc, setNoWwcc] = useState(false);
  const [grantUploaded, setGrantUploaded] = useState(false);
  const [snsUploaded, setSnsUploaded] = useState(false);
  const [manualNumber, setManualNumber] = useState('');
  const [manualExpiry, setManualExpiry] = useState('');

  const showCheckbox =
    (method === 'grant_email' && grantUploaded) ||
    (method === 'service_nsw' && snsUploaded) ||
    (method === 'manual' && manualNumber.trim() !== '' && manualExpiry !== '');

  function handleNoWwcc() {
    const next = !noWwcc;
    setNoWwcc(next);
    onNoWwccChange(next);
    if (next) setMethod(null);
  }

  return (
    <div className="space-y-5">
      {/* No WWCC amber warning */}
      {noWwcc && (
        <div className="rounded-xl bg-amber-50 border border-amber-200 p-4 text-sm text-amber-800 space-y-2">
          <p className="font-medium">An enhanced DBS check is required to work with children in the UK.</p>
          <p className="text-xs text-amber-700">
            You cannot proceed without a valid Working With Children Check. You can apply for one through the NSW Office of the Children&apos;s Guardian.
          </p>
          <a
            href="https://www.service.nsw.gov.au/transaction/apply-for-a-working-with-children-check"
            target="_blank"
            rel="noopener noreferrer"
            className="inline-block text-xs font-medium text-amber-800 underline hover:text-amber-900"
          >
            Apply for a WWCC on Service NSW &rarr;
          </a>
        </div>
      )}

      {/* Method selector */}
      {!noWwcc && (
        <div className="space-y-2.5">
          <p className="text-sm font-medium text-slate-700">Choose your verification method</p>
          <div className="space-y-2">
            {WWCC_METHODS.filter((m) => !method || m.value === method).map((m) => (
              <button
                key={m.value}
                type="button"
                onClick={() => setMethod(method === m.value ? null : m.value)}
                className={`w-full text-left rounded-xl border p-4 transition-all ${
                  method === m.value
                    ? 'border-violet-500 bg-violet-50 ring-1 ring-violet-500'
                    : 'border-slate-200 bg-white hover:border-slate-300 active:bg-slate-50'
                }`}
              >
                <p className={`text-sm font-medium ${method === m.value ? 'text-violet-700' : 'text-slate-800'}`}>
                  {m.label}
                </p>
                <p className="text-xs text-slate-500 mt-0.5">{m.desc}</p>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Conditional content */}
      {!noWwcc && method === 'grant_email' && (
        <div className="space-y-3">
          <div className="rounded-xl bg-blue-50 border border-blue-100 p-4 text-xs text-blue-700 space-y-1.5">
            <p className="font-medium text-blue-800">How to upload your grant email:</p>
            <ol className="list-decimal list-inside space-y-0.5 text-blue-600">
              <li>Find the email from WWCCNotification@ocg.nsw.gov.au</li>
              <li>Open the email and click Print</li>
              <li>Choose &quot;Save as PDF&quot;</li>
              <li>Upload the PDF below</li>
            </ol>
          </div>
          <DummyUploadZone
            label="WWCC Grant Email PDF"
            hint="Upload WWCC Grant Email PDF"
            onUploaded={() => setGrantUploaded(true)}
          />
        </div>
      )}

      {!noWwcc && method === 'service_nsw' && (
        <div className="space-y-3">
          <div className="rounded-xl bg-blue-50 border border-blue-100 p-4 text-xs text-blue-700 space-y-1.5">
            <p className="font-medium text-blue-800">How to upload your Service NSW screenshot:</p>
            <ol className="list-decimal list-inside space-y-0.5 text-blue-600">
              <li>Open your Service NSW app Digital Wallet</li>
              <li>Find your Working With Children Check</li>
              <li>Take a full, unedited screenshot</li>
              <li>Upload the screenshot below</li>
            </ol>
          </div>
          <DummyUploadZone
            label="Service NSW Screenshot"
            hint="Upload Service NSW WWCC Screenshot"
            onUploaded={() => setSnsUploaded(true)}
          />
        </div>
      )}

      {!noWwcc && method === 'manual' && (
        <div className="space-y-4">
          <div className="rounded-xl bg-blue-50 border border-blue-100 p-4 text-xs text-blue-700 space-y-1.5">
            <p className="font-medium text-blue-800">Manual entry requirements:</p>
            <ul className="list-disc list-inside space-y-0.5 text-blue-600">
              <li>WWCC number (e.g. WWC1234567A)</li>
              <li>Expiry date</li>
              <li>Must match the details on your official WWCC</li>
            </ul>
          </div>

          <div className="flex flex-col gap-1.5">
            <label className="text-sm font-medium text-slate-700">WWCC Number</label>
            <input
              type="text"
              placeholder="e.g. WWC1234567A"
              value={manualNumber}
              onChange={(e) => setManualNumber(e.target.value)}
              className="w-full h-11 rounded-lg border border-slate-200 px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-violet-500 focus:border-transparent uppercase"
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <label className="text-sm font-medium text-slate-700">Expiry Date</label>
            <input
              type="date"
              value={manualExpiry}
              onChange={(e) => setManualExpiry(e.target.value)}
              className="w-full h-11 rounded-lg border border-slate-200 px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-violet-500 focus:border-transparent"
            />
          </div>
        </div>
      )}

      {/* Confirmation checkbox — appears after input is complete for any method */}
      {!noWwcc && showCheckbox && (
        <div className="transition-all duration-300">
          <label className="flex items-start gap-2.5 cursor-pointer">
            <input
              type="checkbox"
              className="mt-0.5 h-4 w-4 shrink-0 rounded border-slate-300 text-violet-600 focus:ring-violet-500 accent-violet-600 cursor-pointer"
            />
            <span className="text-xs text-slate-500 leading-relaxed">
              I confirm that the WWCC I have provided is genuine, valid, and issued to me.
            </span>
          </label>
        </div>
      )}

      {/* No WWCC toggle — hidden once a method is selected */}
      {(!method || noWwcc) && (
        <button
          type="button"
          onClick={handleNoWwcc}
          className="w-full text-center text-xs text-slate-400 hover:text-violet-600 underline transition-colors"
        >
          {noWwcc ? 'I have a valid WWCC' : 'I don\u2019t have a valid WWCC'}
        </button>
      )}
    </div>
  );
}

/*
 * ── PRODUCTION MIGRATION RULES (Step 5: Verification Processing) ──
 *
 * 1. PROCESSING ORDER: Residence → Identity → WWCC. Same order as existing system.
 *
 * 2. RESIDENCE CHECK: No AI call needed — just address validation/save.
 *    Calls submitContactSection() with address data. Always passes unless
 *    address is outside service area (already validated on the residence page).
 *
 * 3. IDENTITY CHECK: Fire the AI verification call (passport OCR + selfie
 *    face match) as soon as the Identity step (step 3) is submitted — NOT
 *    here on this page. It runs in the background while user fills out WWCC.
 *    By the time they reach this page, identity check may already be done.
 *    Uses submitIdentitySection() + /api/run-verification with phase "identity".
 *
 * 4. WWCC CHECK: Fire as soon as WWCC step (step 4) is submitted.
 *    Uses submitWWCCSection(). Processing time depends on method:
 *    - Grant email PDF: AI parses the PDF
 *    - Service NSW screenshot: AI reads the screenshot
 *    - Manual entry: queued for manual review (1-3 days)
 *
 * 5. DISPLAY TIMING: Even if a check completed instantly or in background,
 *    show a minimum simulated duration so the user sees the verification
 *    happening. Residence: 1 second. Identity: 3 seconds. WWCC: real time.
 *
 * 6. FAILURE HANDLING:
 *    - If identity fails → WWCC check is blocked. Show message:
 *      "We're unable to verify your WWCC without first confirming your identity."
 *    - Any failure → redirect to /nanny/verification which shows the correct
 *      status and retry options based on verification_status codes.
 *    - The existing verification page's accordion handles all retry flows,
 *      guidance messages, and manual review submissions.
 *
 * 7. STATUS CODES: Same verification_status values as existing system.
 *    identity_status: not_started | pending | processing | verified | failed | rejected | review
 *    wwcc_status: not_started | pending | processing | verified | failed | rejected | review
 *    All status updates go through the same server actions.
 *
 * 8. SUCCESS: All checks pass → redirect to /nanny/share (share profile page).
 *    Share page is positioned as a reward after verification.
 *
 * ─── PRODUCTION UI: FAILURE STATES ───
 *
 * This demo only shows the happy path. In production, the stepper and sub-steps
 * need adequate labels, colours, and icons for failure scenarios:
 *
 * - FAILED SUB-STEP: Red X icon (not green check), red text label
 *   e.g. "Identity — Failed" in red instead of green
 *
 * - FAILED MAIN STEP: "Verify" label changes to "Verification Issue" in red/amber.
 *   The stepper node should show a red/amber warning icon instead of spinner or check.
 *
 * - BLOCKED SUB-STEP: If identity fails, WWCC sub-step should show as blocked/skipped
 *   (grey with a lock icon or dash) with text like "WWCC — Blocked (identity required)"
 *
 * - PROFILE CARD BADGE: On failure, badge should turn amber/red (not green).
 *   Card border should match (amber/red instead of green).
 *
 * - HEADER: "Verifying your account" → "We ran into an issue" or similar.
 *   Subheader should explain what went wrong and what to do next.
 *
 * - CTA: "Connect with families" should NOT appear on failure.
 *   Instead show "Review & Retry" button → redirects to /nanny/verification
 *   where the accordion page handles retries, guidance, and manual review.
 *
 * - PARTIAL FAILURE: If residence passes but identity fails, show residence as
 *   green (done) and identity as red (failed). Don't reset completed steps.
 *
 * - MANUAL REVIEW: WWCC manual entry goes to "review" status (1-3 days).
 *   Sub-step should show amber clock icon with "WWCC — Under Review".
 *   Main step label: "Verification Pending". CTA: "Continue to Hub" (not connect).
 */

function VerificationProcessingStep({ onVerified }: { onVerified: () => void }) {
  // Sub-step progression: 0=none done, 1=residence done, 2=identity done, 3=wwcc done
  const [subStepsDone, setSubStepsDone] = useState(0);
  const allVerified = subStepsDone >= 3;

  useEffect(() => {
    if (allVerified) onVerified();
  }, [allVerified, onVerified]);

  const SUB_STEP_TIMINGS = [1000, 3000, 2500]; // Residence, Identity, WWCC

  useEffect(() => {
    if (subStepsDone >= 3) return;

    const timer = setTimeout(() => {
      setSubStepsDone((s) => s + 1);
    }, SUB_STEP_TIMINGS[subStepsDone]);

    return () => clearTimeout(timer);
  }, [subStepsDone]);

  const subSteps = [
    { label: 'Residence', status: subStepsDone > 0 ? 'done' : subStepsDone === 0 ? 'current' : 'upcoming' },
    { label: 'ID', status: subStepsDone > 1 ? 'done' : subStepsDone === 1 ? 'current' : 'upcoming' },
    { label: 'WWCC', status: subStepsDone > 2 ? 'done' : subStepsDone === 2 ? 'current' : 'upcoming' },
  ] as const;

  const mainSteps = [
    { status: 'done' as const, title: 'Account Secured', desc: 'Your profile is protected', spinning: false },
    { status: (allVerified ? 'done' : 'current') as 'done' | 'current', title: allVerified ? 'Verified' : 'Verifying', desc: allVerified ? 'Verification complete' : 'Confirming your account details', spinning: !allVerified },
    { status: (allVerified ? 'current' : 'upcoming') as 'current' | 'upcoming', title: 'Connect', desc: 'Start receiving family opportunities', spinning: false },
  ];

  return (
    <div className="flex flex-col items-center text-center min-h-[calc(100vh-6rem)]">
      {/* Header — pinned to top */}
      <div className="pt-8 pb-4">
        <h2 className="text-xl sm:text-2xl font-semibold text-slate-800 leading-snug">
          {allVerified ? 'You\u2019re verified!' : 'Verifying your account'}
        </h2>
        <p className="text-sm text-slate-500 mt-2">
          {allVerified
            ? 'You are now able to connect with families looking for childcare'
            : 'This only takes a moment.'}
        </p>
      </div>

      {/* Card + stepper — centered vertically in remaining space */}
      <div className="flex-1 flex flex-col items-center justify-center gap-6 w-full pb-24">

      {/* Profile card with verification badge */}
      <div className={`bg-white rounded-xl border shadow-sm p-4 flex items-center gap-4 max-w-sm w-full transition-colors duration-700 ${
        allVerified ? 'border-green-300' : 'border-slate-200'
      }`}>
        <div className="relative shrink-0">
          <div className="w-14 h-14 rounded-full overflow-hidden border-2 border-violet-200 bg-violet-100 flex items-center justify-center">
            <span className="text-xl font-bold text-violet-600">J</span>
          </div>
          {/* Verification badge — pulses until verified, then stays solid green */}
          <div className={`absolute -bottom-0.5 -right-0.5 flex items-center justify-center rounded-full border ring-2 ring-white ${
            allVerified
              ? 'bg-green-50 border-green-200'
              : 'bg-green-50 border-green-200 animate-[verifyPulse_2s_ease-in-out_infinite]'
          }`} style={{ height: '22px', width: '22px' }}>
            <ShieldCheck className="h-3 w-3 text-green-700" />
          </div>
        </div>
        <div className="text-left flex-1 min-w-0">
          <p className="font-semibold text-slate-800 text-sm">Jessica</p>
          <p className="text-xs text-slate-500 line-clamp-2">
            Professional nanny with a passion for early childhood development
          </p>
        </div>
      </div>

      <style>{`
        @keyframes verifyPulse {
          0%, 100% { opacity: 0; }
          30%, 70% { opacity: 1; }
        }
      `}</style>

      {/* Vertical stepper — same pattern as AccountSecuredStep */}
      <div className="w-full max-w-xs mx-auto pt-2">
        {mainSteps.map((s, i) => (
          <div key={s.title} className="flex items-stretch gap-4">
            {/* Icon column with connecting line */}
            <div className="flex flex-col items-center">
              {/* Node */}
              {s.status === 'done' ? (
                <div className="w-8 h-8 rounded-full bg-green-100 flex items-center justify-center shrink-0 transition-colors duration-500">
                  <CheckCircle2 className="w-5 h-5 text-green-600" />
                </div>
              ) : s.status === 'current' && s.spinning ? (
                <div className="w-8 h-8 rounded-full border-[2.5px] border-violet-500 bg-white flex items-center justify-center shrink-0">
                  <Loader2 className="w-4 h-4 text-violet-500 animate-spin" />
                </div>
              ) : s.status === 'current' ? (
                <div className="w-8 h-8 rounded-full border-[2.5px] border-violet-500 bg-white flex items-center justify-center shrink-0">
                  <div className="w-2.5 h-2.5 rounded-full bg-violet-500" />
                </div>
              ) : (
                <div className="w-8 h-8 rounded-full border-2 border-slate-200 bg-white shrink-0" />
              )}
              {/* Connector line */}
              {i < mainSteps.length - 1 && (
                <div className={`w-0.5 flex-1 min-h-[28px] transition-colors duration-500 ${
                  s.status === 'done' ? 'bg-green-200' : 'bg-slate-200'
                }`} />
              )}
            </div>

            {/* Text */}
            <div className={`text-left pb-5 ${i === mainSteps.length - 1 ? 'pb-0' : ''}`}>
              <p className={`text-sm font-semibold leading-tight transition-colors duration-500 ${
                s.status === 'done' ? 'text-green-700'
                  : s.status === 'current' ? 'text-slate-800'
                  : 'text-slate-400'
              }`}>
                {s.title}
              </p>
              <p className={`text-xs mt-0.5 transition-colors duration-500 ${
                s.status === 'upcoming' ? 'text-slate-300' : 'text-slate-500'
              }`}>
                {s.desc}
              </p>

              {/* Sub-steps under Verify */}
              {i === 1 && (
                <div className="mt-2.5 space-y-1.5">
                  {subSteps.map((sub) => (
                    <div key={sub.label} className="flex items-center gap-2">
                      {sub.status === 'done' ? (
                        <CheckCircle2 className="w-3.5 h-3.5 text-green-500 shrink-0" />
                      ) : sub.status === 'current' ? (
                        <Loader2 className="w-3.5 h-3.5 text-violet-500 animate-spin shrink-0" />
                      ) : (
                        <div className="w-1.5 h-1.5 rounded-full bg-slate-300 shrink-0 ml-1 mr-0.5" />
                      )}
                      <span className={`text-xs transition-colors duration-300 ${
                        sub.status === 'done' ? 'text-green-600' :
                        sub.status === 'current' ? 'text-violet-600 font-medium' :
                        'text-slate-400'
                      }`}>
                        {sub.label}
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

// ── Main Page ──

export default function OnboardingVerificationTestPage() {
  const [step, setStep] = useState(0);
  const [wwccBlocked, setWwccBlocked] = useState(false);
  const [verificationComplete, setVerificationComplete] = useState(false);
  const current = STEPS[step];

  const isLastStep = step === STEPS.length - 1;
  const showBottomButton = !isLastStep; // Share step has its own buttons

  // Step 2 (Residence) renders without CompoundPageShell — no progress bar, with back button
  if (step === 2) {
    return (
      <div className="min-h-screen bg-white">
        <main className="max-w-2xl mx-auto px-4 lg:px-6 pt-4">
          <div className="relative flex flex-col min-h-[calc(100vh-10rem)]">
            {/* Back button */}
            <button
              type="button"
              onClick={() => setStep(1)}
              className="absolute top-3 left-0 p-1.5 text-slate-400 hover:text-slate-600 transition-colors z-10"
            >
              <ChevronLeft className="h-5 w-5" />
            </button>

            <div className="flex-1 pt-10 pb-6">
              <div className="text-center mb-6">
                <h2 className="text-xl sm:text-2xl font-semibold text-slate-800 leading-snug">
                  {current.title}
                </h2>
              </div>
              <div className="max-w-md mx-auto px-2 pb-20">
                <LocationStep />
              </div>
            </div>
          </div>

          <div className="fixed bottom-0 left-0 right-0 z-20 pt-3 pb-[66px] bg-gradient-to-t from-white from-70% to-transparent">
            <div className="max-w-md mx-auto px-2">
              <button
                type="button"
                onClick={() => setStep(3)}
                className="w-full bg-violet-600 hover:bg-violet-700 active:bg-violet-800 text-white h-11 rounded-lg font-medium text-sm transition-colors"
              >
                Verify Residence
              </button>
            </div>
          </div>
        </main>
      </div>
    );
  }

  // Step 1 (Account Secured interstitial) renders without CompoundPageShell — no progress bar
  if (step === 1) {
    return (
      <div className="min-h-screen bg-white">
        <main className="max-w-2xl mx-auto px-4 lg:px-6 pt-4">
          <div className="flex flex-col min-h-[calc(100vh-10rem)]">
            <div className="text-center pt-10 mb-2">
              <h2 className="text-xl sm:text-2xl font-semibold text-slate-800 leading-snug">
                {current.title}
              </h2>
              <p className="text-sm text-slate-500 mt-2 max-w-md mx-auto">
                Complete verification now to start receiving opportunities.
              </p>
            </div>
            <div className="flex-1 flex items-center justify-center pb-24">
              <div className="max-w-md mx-auto px-2">
                <AccountSecuredStep />
              </div>
            </div>
          </div>

          <div className="fixed bottom-0 left-0 right-0 z-20 pt-3 pb-[66px] bg-gradient-to-t from-white from-70% to-transparent">
            <div className="max-w-md mx-auto px-2">
              <button
                type="button"
                onClick={() => setStep(2)}
                className="w-full bg-violet-600 hover:bg-violet-700 active:bg-violet-800 text-white h-11 rounded-lg font-medium text-sm transition-colors"
              >
                Verify Account
              </button>
            </div>
          </div>
        </main>
      </div>
    );
  }

  // Step 5 (Verification Processing) renders without CompoundPageShell — no progress bar
  if (step === 5) {
    return (
      <div className="min-h-screen bg-white">
        <main className="max-w-2xl mx-auto px-4 lg:px-6 pt-4">
          <div className="max-w-md mx-auto px-2">
            <VerificationProcessingStep onVerified={() => setVerificationComplete(true)} />
          </div>

          {verificationComplete && (
            <div className="fixed bottom-0 left-0 right-0 z-20 pt-3 pb-[66px] bg-gradient-to-t from-white from-70% to-transparent">
              <div className="max-w-md mx-auto px-2">
                <button
                  type="button"
                  onClick={() => alert('Test complete! In production this redirects to the connect/share flow.')}
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

  // Step 4 (WWCC) renders without CompoundPageShell — no progress bar
  if (step === 4) {
    return (
      <div className="min-h-screen bg-white">
        <main className="max-w-2xl mx-auto px-4 lg:px-6 pt-4">
          <div className="relative flex flex-col min-h-[calc(100vh-10rem)]">
            {/* Back button */}
            <button
              type="button"
              onClick={() => setStep(3)}
              className="absolute top-3 left-0 p-1.5 text-slate-400 hover:text-slate-600 transition-colors z-10"
            >
              <ChevronLeft className="h-5 w-5" />
            </button>

            <div className="flex-1 pt-10 pb-6">
              <div className="text-center mb-6">
                <h2 className="text-xl sm:text-2xl font-semibold text-slate-800 leading-snug">
                  Working With Children Check
                </h2>
                <p className="text-sm text-slate-500 mt-2 max-w-sm mx-auto">
                  An enhanced DBS check is required to work with children in the UK.
                </p>
              </div>
              <div className="max-w-md mx-auto px-2 pb-20">
                <WWCCStep onNoWwccChange={setWwccBlocked} />
              </div>
            </div>
          </div>

          <div className="fixed bottom-0 left-0 right-0 z-20 pt-3 pb-[66px] bg-gradient-to-t from-white from-70% to-transparent">
            <div className="max-w-md mx-auto px-2">
              <button
                type="button"
                onClick={() => !wwccBlocked && setStep(5)}
                disabled={wwccBlocked}
                className={`w-full h-11 rounded-lg font-medium text-sm transition-colors ${
                  wwccBlocked
                    ? 'bg-slate-200 text-slate-400 cursor-not-allowed'
                    : 'bg-violet-600 hover:bg-violet-700 active:bg-violet-800 text-white'
                }`}
              >
                Verify WWCC
              </button>
            </div>
          </div>
        </main>
      </div>
    );
  }

  // Step 3 (Identity) renders without CompoundPageShell — no progress bar
  if (step === 3) {
    return (
      <div className="min-h-screen bg-white">
        <main className="max-w-2xl mx-auto px-4 lg:px-6 pt-4">
          <div className="relative flex flex-col min-h-[calc(100vh-10rem)]">
            {/* Back button */}
            <button
              type="button"
              onClick={() => setStep(2)}
              className="absolute top-3 left-0 p-1.5 text-slate-400 hover:text-slate-600 transition-colors z-10"
            >
              <ChevronLeft className="h-5 w-5" />
            </button>

            <div className="flex-1 pt-10 pb-6">
              <div className="text-center mb-6">
                <h2 className="text-xl sm:text-2xl font-semibold text-slate-800 leading-snug">
                  Verify your identity
                </h2>
                <p className="text-sm text-slate-500 mt-2 max-w-sm mx-auto">
                  Every childcare professional and family is verified to the same gold standard to keep both parties safe.
                </p>
              </div>
              <div className="max-w-md mx-auto px-2 pb-20">
                <IdentityStep />
              </div>
            </div>
          </div>

          <div className="fixed bottom-0 left-0 right-0 z-20 pt-3 pb-[66px] bg-gradient-to-t from-white from-70% to-transparent">
            <div className="max-w-md mx-auto px-2">
              <button
                type="button"
                onClick={() => setStep(4)}
                className="w-full bg-violet-600 hover:bg-violet-700 active:bg-violet-800 text-white h-11 rounded-lg font-medium text-sm transition-colors"
              >
                Verify ID
              </button>
            </div>
          </div>
        </main>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-white">
      <main className="max-w-2xl mx-auto px-4 lg:px-6 pt-4">
        <CompoundPageShell
          title={current.title}
          subtitle={current.subtitle}
          progress={current.progress}
          showBack={false}
          onBack={() => {}}
        >
          {step === 0 && <SecureAccountStep />}
        </CompoundPageShell>

        {/* Fixed bottom continue button */}
        {showBottomButton && step === 0 && (
          <div className="fixed bottom-0 left-0 right-0 z-20 pt-3 pb-[66px] bg-gradient-to-t from-white from-70% to-transparent">
            <div className="max-w-md mx-auto px-2">
              <button
                type="button"
                onClick={() => setStep((s) => Math.min(STEPS.length - 1, s + 1))}
                className="w-full bg-violet-600 hover:bg-violet-700 active:bg-violet-800 text-white h-11 rounded-lg font-medium text-sm transition-colors"
              >
                Secure My Account
              </button>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
