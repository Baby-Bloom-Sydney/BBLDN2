"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { EmptyState } from "@/components/dashboard/EmptyState";
import {
  createBabysittingRequest,
  cancelBabysittingRequest,
  parentAcceptNanny,
  type BabysittingRequestWithSlots,
  type RequestingNanny,
} from "@/lib/actions/babysitting";
import {
  Baby,
  Plus,
  Clock,
  MapPin,
  PoundSterling,
  X,
  Loader2,
  ChevronRight,
  ChevronDown,
  Check,
  CheckCircle,
  AlertCircle,
  ArrowLeft,
  UserCheck,
  User,
  Star,
  Globe,
  Phone,
  Pencil,
  CreditCard,
} from "lucide-react";
import Link from "next/link";
import { recordInformedAction } from "@/lib/legal/record-consent";
import {
  formatAddressLine,
  parseUkAddress,
  toTitleCase,
  type ParsedAddress,
} from "@/lib/uk-contact";

// ── Time options (15-min intervals, 6am to 11:45pm) ──

const TIME_OPTIONS: { value: string; label: string }[] = [];
for (let h = 6; h < 24; h++) {
  for (let m = 0; m < 60; m += 15) {
    const hh = h.toString().padStart(2, "0");
    const mm = m.toString().padStart(2, "0");
    const ampm = h >= 12 ? "pm" : "am";
    const h12 = h > 12 ? h - 12 : h;
    const label = m === 0 ? `${h12}${ampm}` : `${h12}:${mm}${ampm}`;
    TIME_OPTIONS.push({ value: `${hh}:${mm}`, label });
  }
}

// ── Age options for children ──

const AGE_OPTIONS: { label: string; months: number }[] = [
  { label: "Newborn", months: 0 },
  { label: "3-6 months", months: 4 },
  { label: "6-12 months", months: 9 },
  { label: "1 year", months: 12 },
  { label: "2 years", months: 24 },
  { label: "3 years", months: 36 },
  { label: "4 years", months: 48 },
  { label: "5 years", months: 60 },
  { label: "6 years", months: 72 },
  { label: "7 years", months: 84 },
  { label: "8 years", months: 96 },
  { label: "9 years", months: 108 },
  { label: "10 years", months: 120 },
  { label: "11 years", months: 132 },
  { label: "12 years", months: 144 },
  { label: "13 years", months: 156 },
  { label: "14 years", months: 168 },
  { label: "15 years", months: 180 },
  { label: "16 years", months: 192 },
];

// ── Helpers ──

interface TimeSlotForm {
  id: number;
  date: string;
  startTime: string;
  endTime: string;
}

interface ChildForm {
  ageMonths: number;
  gender: string;
}

function calcAge(dob: string | null): number | null {
  if (!dob) return null;
  const birth = new Date(dob);
  const today = new Date();
  let age = today.getFullYear() - birth.getFullYear();
  const m = today.getMonth() - birth.getMonth();
  if (m < 0 || (m === 0 && today.getDate() < birth.getDate())) age--;
  return age;
}

function formatSlotDate(dateStr: string): string {
  const d = new Date(dateStr + "T00:00:00");
  return d.toLocaleDateString("en-GB", {
    weekday: "short",
    day: "numeric",
    month: "short",
  });
}

function formatTime(time: string): string {
  const [h, m] = time.split(":").map(Number);
  const ampm = h >= 12 ? "pm" : "am";
  const h12 = h === 0 ? 12 : h > 12 ? h - 12 : h;
  return m === 0
    ? `${h12}${ampm}`
    : `${h12}:${String(m).padStart(2, "0")}${ampm}`;
}

// ── GNAF Address Types ──

interface AddressrResult {
  sla: string;
  ssla?: string;
  pid: string;
  score: number;
}

// ── Main Component ──

interface ParentBabysittingClientProps {
  requests: BabysittingRequestWithSlots[];
  suburbs: Array<{ suburb: string; postcode: string }>;
}

export function ParentBabysittingClient({
  requests,
  suburbs,
}: ParentBabysittingClientProps) {
  const router = useRouter();
  const [view, setView] = useState<"list" | "create">("create");
  const [selectedRequest, setSelectedRequest] =
    useState<BabysittingRequestWithSlots | null>(null);
  const [showPast, setShowPast] = useState(false);

  // Create form state
  const [formStep, setFormStep] = useState(1);
  const [slots, setSlots] = useState<TimeSlotForm[]>([
    { id: 1, date: "", startTime: "18:00", endTime: "22:00" },
  ]);
  const [addressQuery, setAddressQuery] = useState("");
  const [selectedAddress, setSelectedAddress] = useState<ParsedAddress | null>(
    null,
  );
  const [addressResults, setAddressResults] = useState<AddressrResult[]>([]);
  const [showAddressDropdown, setShowAddressDropdown] = useState(false);
  const [addressLoading, setAddressLoading] = useState(false);
  const [notInArea, setNotInArea] = useState(false);
  const addressDropdownRef = useRef<HTMLDivElement>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [numChildren, setNumChildren] = useState(0);
  const [children, setChildren] = useState<ChildForm[]>([]);
  const [hourlyRate, setHourlyRate] = useState(35);
  const [specialRequirements, setSpecialRequirements] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  // Close suburb dropdown on outside click
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (
        addressDropdownRef.current &&
        !addressDropdownRef.current.contains(e.target as Node)
      ) {
        setShowAddressDropdown(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  // GNAF address search — debounced, NSW only
  const searchAddress = useCallback((query: string) => {
    if (query.trim().length < 4) {
      setAddressResults([]);
      setShowAddressDropdown(false);
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
          setShowAddressDropdown(false);
          return;
        }
        const data: AddressrResult[] = await res.json();
        const nswOnly = data.filter((r) => r.sla.includes(" NSW "));
        setAddressResults(nswOnly.slice(0, 8));
        setShowAddressDropdown(nswOnly.length > 0);
      } catch {
        setAddressResults([]);
        setShowAddressDropdown(false);
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

  function handleAddressSelect(result: AddressrResult) {
    const parsed = parseUkAddress(result.ssla || result.sla);
    if (!parsed) {
      setShowAddressDropdown(false);
      return;
    }

    // Cross-reference with sydney_postcodes for canonical suburb name
    const byPostcode = suburbs.filter((s) => s.postcode === parsed.postcode);
    if (byPostcode.length === 0) {
      setNotInArea(true);
      setSelectedAddress(null);
      setAddressQuery(toTitleCase(result.ssla || result.sla));
      setShowAddressDropdown(false);
      return;
    }

    const exact = byPostcode.find(
      (s) => s.suburb.toLowerCase() === parsed.town.toLowerCase(),
    );
    const canonical = exact || byPostcode[0];

    setAddressQuery(formatAddressLine(parsed));
    setSelectedAddress({
      line1: formatAddressLine(parsed),
      line2: "",
      town: canonical.suburb,
      postcode: canonical.postcode,
    });
    setShowAddressDropdown(false);
    setAddressResults([]);
    setNotInArea(false);
  }

  const nextSlotId =
    slots.length > 0 ? Math.max(...slots.map((s) => s.id)) + 1 : 1;

  // Calculate estimated total
  let totalMinutes = 0;
  for (const slot of slots) {
    if (slot.startTime && slot.endTime && slot.startTime < slot.endTime) {
      const [sh, sm] = slot.startTime.split(":").map(Number);
      const [eh, em] = slot.endTime.split(":").map(Number);
      totalMinutes += eh * 60 + em - (sh * 60 + sm);
    }
  }
  const estimatedHours = Math.round((totalMinutes / 60) * 10) / 10;
  const estimatedTotal = Math.round(estimatedHours * hourlyRate);

  const handleSelectChildren = (num: number) => {
    setNumChildren(num);
    const newChildren: ChildForm[] = [];
    for (let i = 0; i < num; i++) {
      newChildren.push(children[i] ?? { ageMonths: 12, gender: "Boy" });
    }
    setChildren(newChildren);
  };

  const updateChild = (
    index: number,
    field: keyof ChildForm,
    value: string | number,
  ) => {
    setChildren(
      children.map((c, i) => (i === index ? { ...c, [field]: value } : c)),
    );
  };

  const addSlot = () => {
    if (slots.length >= 7) return;
    setSlots([
      ...slots,
      { id: nextSlotId, date: "", startTime: "18:00", endTime: "22:00" },
    ]);
  };

  const removeSlot = (id: number) => {
    if (slots.length <= 1) return;
    setSlots(slots.filter((s) => s.id !== id));
  };

  const updateSlot = (id: number, field: keyof TimeSlotForm, value: string) => {
    setSlots(slots.map((s) => (s.id === id ? { ...s, [field]: value } : s)));
  };

  const resetForm = () => {
    setFormStep(1);
    setSlots([{ id: 1, date: "", startTime: "18:00", endTime: "22:00" }]);
    setAddressQuery("");
    setSelectedAddress(null);
    setAddressResults([]);
    setNotInArea(false);
    setNumChildren(0);
    setChildren([]);
    setHourlyRate(35);
    setSpecialRequirements("");
    setFormError(null);
  };

  const validateStep = (step: number): string | null => {
    if (step === 1) {
      if (numChildren === 0 || children.length === 0)
        return "Please select the number of children";
    }
    if (step === 2) {
      if (!selectedAddress) return "Please select an address from the dropdown";
    }
    if (step === 3) {
      for (const slot of slots) {
        if (!slot.date) return "Please select a date for all time slots";
        if (slot.startTime >= slot.endTime)
          return "End time must be after start time for all slots";
      }
    }
    return null;
  };

  const goNext = () => {
    const err = validateStep(formStep);
    if (err) {
      setFormError(err);
      return;
    }
    setFormError(null);
    setFormStep(formStep + 1);
  };

  const goBack = () => {
    setFormError(null);
    setFormStep(formStep - 1);
  };

  const handleSubmit = async () => {
    setFormError(null);
    setSubmitting(true);
    const result = await createBabysittingRequest({
      timeSlots: slots.map((s) => ({
        date: s.date,
        startTime: s.startTime,
        endTime: s.endTime,
      })),
      children: children.map((c) => ({
        ageMonths: c.ageMonths,
        gender: c.gender,
      })),
      suburb: selectedAddress!.town,
      postcode: selectedAddress!.postcode,
      address: selectedAddress!.line1,
      hourlyRate,
      specialRequirements: specialRequirements || undefined,
    });
    setSubmitting(false);

    if (!result.success) {
      setFormError(result.error || "Failed to create request");
      return;
    }

    // Redirect to payment page
    window.location.href = `/parent/babysitting/${result.requestId}/payment`;
  };

  const ageLabel = (months: number) =>
    AGE_OPTIONS.find((o) => o.months === months)?.label ?? `${months}m`;

  // Sort by earliest upcoming slot date (chronological)
  const sortByNextSlot = (
    a: BabysittingRequestWithSlots,
    b: BabysittingRequestWithSlots,
  ) => {
    const aDate =
      a.slots.length > 0
        ? a.slots.reduce(
            (min, s) => (s.slot_date < min ? s.slot_date : min),
            a.slots[0].slot_date,
          )
        : "9999";
    const bDate =
      b.slots.length > 0
        ? b.slots.reduce(
            (min, s) => (s.slot_date < min ? s.slot_date : min),
            b.slots[0].slot_date,
          )
        : "9999";
    return aDate.localeCompare(bDate);
  };

  // Group requests by status
  const pendingPayment = requests
    .filter((r) => r.status === "pending_payment")
    .sort(sortByNextSlot);
  const active = requests
    .filter((r) => r.status === "open")
    .sort(sortByNextSlot);
  const filled = requests
    .filter((r) => r.status === "filled")
    .sort(sortByNextSlot);
  const past = requests.filter((r) =>
    ["expired", "cancelled", "nanny_cancelled", "completed"].includes(r.status),
  );

  // Min date = tomorrow, max date = 4 weeks from now
  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  const minDate = tomorrow.toISOString().split("T")[0];
  const maxDateObj = new Date();
  maxDateObj.setDate(maxDateObj.getDate() + 28);
  const maxDate = maxDateObj.toISOString().split("T")[0];

  // ── Create Form View ──

  if (view === "create") {
    const stepTitles = [
      "Children",
      "Location",
      "Date & Time",
      "Babysitter Rate",
      "Review",
    ];
    return (
      <div className="space-y-6">
        <div className="flex items-center gap-3">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              if (formStep > 1) {
                goBack();
              } else {
                router.push("/parent");
              }
            }}
          >
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <div className="flex-1">
            <h1 className="text-2xl font-bold text-slate-900">New Request</h1>
            <p className="mt-1 text-slate-500">
              Step {formStep} of 5 — {stepTitles[formStep - 1]}
            </p>
          </div>
        </div>

        {/* Progress dots */}
        <div className="flex items-center justify-center gap-2">
          {[1, 2, 3, 4, 5].map((s) => (
            <div
              key={s}
              className={`h-2 rounded-full transition-all ${
                s === formStep
                  ? "w-8 bg-violet-500"
                  : s < formStep
                    ? "w-2 bg-violet-300"
                    : "w-2 bg-slate-200"
              }`}
            />
          ))}
        </div>

        <Card>
          <CardContent className="pt-6 space-y-6">
            {/* ── Step 1: Children ── */}
            {formStep === 1 && (
              <div className="space-y-3">
                <p className="text-sm text-slate-600">
                  How many children would you require a babysitter for?
                </p>
                <div className="flex gap-2">
                  {[1, 2, 3].map((n) => (
                    <button
                      key={n}
                      type="button"
                      onClick={() => handleSelectChildren(n)}
                      className={`flex-1 rounded-lg border-2 py-2.5 text-sm font-semibold transition-colors ${
                        numChildren === n
                          ? "border-violet-500 bg-violet-500 text-white"
                          : "border-slate-200 bg-white text-slate-700 hover:border-violet-300"
                      }`}
                    >
                      {n}
                    </button>
                  ))}
                </div>
                {children.map((child, i) => (
                  <div
                    key={i}
                    className="rounded-lg border border-slate-200 bg-slate-50 p-3"
                  >
                    <p className="text-xs font-semibold text-slate-500 mb-2">
                      Child {i + 1}
                    </p>
                    <div className="grid grid-cols-2 gap-2">
                      <div>
                        <label className="text-xs text-slate-500">Age</label>
                        <select
                          value={child.ageMonths}
                          onChange={(e) =>
                            updateChild(
                              i,
                              "ageMonths",
                              parseInt(e.target.value),
                            )
                          }
                          className="w-full rounded-md border border-slate-200 bg-white px-3 py-2 text-sm"
                        >
                          {AGE_OPTIONS.map((opt) => (
                            <option key={opt.months} value={opt.months}>
                              {opt.label}
                            </option>
                          ))}
                        </select>
                      </div>
                      <div>
                        <label className="text-xs text-slate-500">Gender</label>
                        <select
                          value={child.gender}
                          onChange={(e) =>
                            updateChild(i, "gender", e.target.value)
                          }
                          className="w-full rounded-md border border-slate-200 bg-white px-3 py-2 text-sm"
                        >
                          <option value="Boy">Boy</option>
                          <option value="Girl">Girl</option>
                        </select>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}

            {/* ── Step 2: Location ── */}
            {formStep === 2 && (
              <div className="space-y-4">
                <p className="text-sm text-slate-600">
                  Where will the babysitting take place?
                </p>
                <div className="space-y-2">
                  <div className="flex items-baseline justify-between">
                    <Label className="text-xs font-semibold text-slate-500 uppercase tracking-wide">
                      Address
                    </Label>
                    <span className="text-xs text-slate-400">NSW only</span>
                  </div>
                  <div className="relative" ref={addressDropdownRef}>
                    <div className="relative">
                      <Input
                        placeholder="Start typing your address..."
                        value={addressQuery}
                        onChange={(e) => handleAddressChange(e.target.value)}
                        onFocus={() => {
                          if (addressResults.length > 0)
                            setShowAddressDropdown(true);
                        }}
                        autoComplete="off"
                      />
                      {addressLoading && (
                        <Loader2 className="absolute right-3 top-1/2 -translate-y-1/2 h-4 w-4 animate-spin text-slate-400" />
                      )}
                    </div>
                    {showAddressDropdown && (
                      <div
                        className={`absolute z-50 w-full max-h-48 overflow-y-auto rounded-lg border border-slate-200 bg-white shadow-lg bottom-full mb-1`}
                      >
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
                    {selectedAddress && (
                      <p className="text-xs text-green-600 font-medium mt-1.5 flex items-center gap-1">
                        {selectedAddress.line1}, {selectedAddress.town} NSW{" "}
                        {selectedAddress.postcode}
                        <Check className="h-3 w-3" />
                      </p>
                    )}
                    {notInArea && (
                      <p className="text-xs text-amber-600 mt-1.5">
                        This address is outside our service area. We currently
                        only operate in Greater Sydney, NSW.
                      </p>
                    )}
                  </div>
                </div>
              </div>
            )}

            {/* ── Step 3: Date & Time ── */}
            {formStep === 3 && (
              <div className="space-y-3">
                <p className="text-sm text-slate-600">
                  When do you need a babysitter?
                </p>
                {slots.map((slot) => (
                  <div
                    key={slot.id}
                    className="relative rounded-lg border border-slate-200 bg-slate-50 p-3 space-y-2"
                  >
                    {slots.length > 1 && (
                      <button
                        type="button"
                        onClick={() => removeSlot(slot.id)}
                        className="absolute top-2 right-2 h-6 w-6 flex items-center justify-center rounded-full bg-red-100 text-red-500 hover:bg-red-200 transition-colors"
                      >
                        <X className="h-3 w-3" />
                      </button>
                    )}
                    <div>
                      <label className="text-xs text-slate-500">Date</label>
                      <Input
                        type="date"
                        min={minDate}
                        max={maxDate}
                        value={slot.date}
                        onChange={(e) =>
                          updateSlot(slot.id, "date", e.target.value)
                        }
                        className="bg-white"
                      />
                    </div>
                    <div className="grid grid-cols-2 gap-2">
                      <div>
                        <label className="text-xs text-slate-500">Start</label>
                        <select
                          value={slot.startTime}
                          onChange={(e) =>
                            updateSlot(slot.id, "startTime", e.target.value)
                          }
                          className="w-full rounded-md border border-slate-200 bg-white px-3 py-2 text-sm"
                        >
                          {TIME_OPTIONS.map((opt) => (
                            <option key={opt.value} value={opt.value}>
                              {opt.label}
                            </option>
                          ))}
                        </select>
                      </div>
                      <div>
                        <label className="text-xs text-slate-500">End</label>
                        <select
                          value={slot.endTime}
                          onChange={(e) =>
                            updateSlot(slot.id, "endTime", e.target.value)
                          }
                          className="w-full rounded-md border border-slate-200 bg-white px-3 py-2 text-sm"
                        >
                          {TIME_OPTIONS.map((opt) => (
                            <option key={opt.value} value={opt.value}>
                              {opt.label}
                            </option>
                          ))}
                        </select>
                      </div>
                    </div>
                  </div>
                ))}
                {slots.length < 7 && (
                  <button
                    type="button"
                    onClick={addSlot}
                    className="w-full rounded-lg border border-dashed border-violet-300 py-2.5 text-sm font-semibold text-violet-600 hover:bg-violet-50 transition-colors"
                  >
                    <Plus className="inline h-4 w-4 mr-1" />
                    Add Time Slot
                  </button>
                )}
                {estimatedHours > 0 && (
                  <div className="rounded-lg bg-violet-50 border border-violet-200 px-4 py-3">
                    <div className="flex justify-between text-sm">
                      <span className="text-violet-700">Total hours</span>
                      <span className="font-semibold text-violet-800">
                        {estimatedHours} hrs
                      </span>
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* ── Step 4: Babysitter Rate ── */}
            {formStep === 4 && (
              <div className="space-y-4">
                <p className="text-sm text-slate-600">
                  What hourly rate would you like to offer?
                </p>
                <div className="flex items-center gap-3 rounded-lg border border-slate-200 bg-white px-4 py-3">
                  <input
                    type="range"
                    min={35}
                    max={100}
                    value={hourlyRate}
                    onChange={(e) => setHourlyRate(parseInt(e.target.value))}
                    className="flex-1 accent-violet-500"
                  />
                  <span className="text-lg font-bold text-slate-900 w-16 text-right">
                    £{hourlyRate}
                  </span>
                </div>

                {/* Date/time preview + estimated total */}
                {slots.some((s) => s.date) && (
                  <div className="rounded-lg bg-slate-50 border border-slate-200 px-4 py-3 space-y-2">
                    <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide">
                      Your dates
                    </p>
                    {slots
                      .filter((s) => s.date)
                      .map((slot) => (
                        <div
                          key={slot.id}
                          className="flex justify-between text-sm text-slate-600"
                        >
                          <span>{formatSlotDate(slot.date)}</span>
                          <span className="text-slate-400">
                            {formatTime(slot.startTime)} –{" "}
                            {formatTime(slot.endTime)}
                          </span>
                        </div>
                      ))}
                  </div>
                )}

                {estimatedHours > 0 && (
                  <div className="rounded-lg bg-green-50 border border-green-200 px-4 py-3">
                    <div className="flex justify-between text-sm">
                      <span className="text-green-700">Total Hours</span>
                      <span className="font-semibold text-green-800">
                        {estimatedHours}
                      </span>
                    </div>
                    <div className="flex justify-between text-sm mt-1">
                      <span className="text-green-700 font-semibold">
                        Est. Total Pay
                      </span>
                      <span className="font-bold text-green-800 text-base">
                        £{estimatedTotal}
                      </span>
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* ── Step 5: Review ── */}
            {formStep === 5 && (
              <div className="space-y-4">
                {/* Children */}
                <div className="flex items-start justify-between">
                  <div>
                    <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-1">
                      Children
                    </p>
                    <p className="text-sm text-slate-700">
                      {children
                        .map((c) => `${ageLabel(c.ageMonths)} (${c.gender})`)
                        .join(", ")}
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => setFormStep(1)}
                    className="text-violet-500 hover:text-violet-700 p-1"
                  >
                    <Pencil className="h-3.5 w-3.5" />
                  </button>
                </div>
                <hr className="border-slate-200" />

                {/* Location */}
                <div className="flex items-start justify-between">
                  <div>
                    <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-1">
                      Location
                    </p>
                    <p className="text-sm text-slate-700">
                      {selectedAddress?.line1}
                    </p>
                    <p className="text-sm text-slate-500">
                      {selectedAddress?.town}, NSW {selectedAddress?.postcode}
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => setFormStep(2)}
                    className="text-violet-500 hover:text-violet-700 p-1"
                  >
                    <Pencil className="h-3.5 w-3.5" />
                  </button>
                </div>
                <hr className="border-slate-200" />

                {/* Date & Time */}
                <div className="flex items-start justify-between">
                  <div>
                    <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-1">
                      Date & Time
                    </p>
                    <div className="space-y-1">
                      {slots.map((slot) => (
                        <p key={slot.id} className="text-sm text-slate-700">
                          {slot.date ? formatSlotDate(slot.date) : "No date"} —{" "}
                          {formatTime(slot.startTime)} to{" "}
                          {formatTime(slot.endTime)}
                        </p>
                      ))}
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => setFormStep(3)}
                    className="text-violet-500 hover:text-violet-700 p-1"
                  >
                    <Pencil className="h-3.5 w-3.5" />
                  </button>
                </div>
                <hr className="border-slate-200" />

                {/* Babysitter Rate */}
                <div className="flex items-start justify-between">
                  <div>
                    <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-1">
                      Babysitter Rate
                    </p>
                    <p className="text-sm text-slate-700">
                      £{hourlyRate}/hr
                      {estimatedHours > 0 && (
                        <span className="text-slate-500">
                          {" "}
                          — Est. £{estimatedTotal} ({estimatedHours} hrs)
                        </span>
                      )}
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => setFormStep(4)}
                    className="text-violet-500 hover:text-violet-700 p-1"
                  >
                    <Pencil className="h-3.5 w-3.5" />
                  </button>
                </div>
                <hr className="border-slate-200" />

                {/* Notes (optional) */}
                <div className="space-y-2">
                  <Label className="text-xs font-semibold text-slate-500 uppercase tracking-wide">
                    Anything else? (optional)
                  </Label>
                  <Textarea
                    placeholder="Any special requirements or notes for the babysitter..."
                    value={specialRequirements}
                    onChange={(e) => setSpecialRequirements(e.target.value)}
                    rows={3}
                  />
                </div>
              </div>
            )}

            {/* Error */}
            {formError && (
              <div className="flex items-center gap-2 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
                <AlertCircle className="h-4 w-4 flex-shrink-0" />
                {formError}
              </div>
            )}

            {/* Navigation */}
            <div className="flex gap-3">
              {formStep > 1 && formStep < 5 && (
                <Button variant="outline" className="flex-1" onClick={goBack}>
                  Back
                </Button>
              )}
              {formStep < 5 && (
                <Button
                  className="flex-1 bg-violet-500 hover:bg-violet-600"
                  onClick={goNext}
                >
                  Next
                </Button>
              )}
              {formStep === 5 && (
                <Button
                  className="w-full bg-violet-500 hover:bg-violet-600"
                  disabled={submitting}
                  onClick={handleSubmit}
                >
                  {submitting ? (
                    <>
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      Creating request...
                    </>
                  ) : (
                    <>
                      <Baby className="mr-2 h-4 w-4" />
                      Find Babysitter
                    </>
                  )}
                </Button>
              )}
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  // ── List View ──

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Babysitting</h1>
          <p className="mt-1 text-slate-500">
            Request one-time babysitting help
          </p>
        </div>
        <Button
          className="bg-violet-500 hover:bg-violet-600"
          onClick={() => setView("create")}
        >
          <Plus className="mr-2 h-4 w-4" />
          Find Babysitter
        </Button>
      </div>

      {/* Detail Modal */}
      {selectedRequest && (
        <BSRDetailModal
          request={selectedRequest}
          onClose={() => setSelectedRequest(null)}
          onAction={() => {
            setSelectedRequest(null);
            router.refresh();
          }}
        />
      )}

      {requests.length === 0 ? (
        <>
          <EmptyState
            icon={Baby}
            title="No babysitting requests"
            description="Need a nanny for a date night or special occasion? Create a babysitting request and we'll notify verified nannies in your area."
            actionLabel="Create Request"
            onAction={() => setView("create")}
          />
          <Card className="border-violet-200 bg-violet-50">
            <CardHeader>
              <CardTitle className="text-violet-900">
                How Babysitting Requests Work
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid gap-6 sm:grid-cols-3">
                <div className="space-y-2">
                  <div className="flex h-10 w-10 items-center justify-center rounded-full bg-violet-200">
                    <Clock className="h-5 w-5 text-violet-700" />
                  </div>
                  <h4 className="font-medium text-violet-900">
                    1. Submit Request
                  </h4>
                  <p className="text-sm text-violet-700">
                    Choose your preferred dates and time slots (up to 7 options)
                  </p>
                </div>
                <div className="space-y-2">
                  <div className="flex h-10 w-10 items-center justify-center rounded-full bg-violet-200">
                    <MapPin className="h-5 w-5 text-violet-700" />
                  </div>
                  <h4 className="font-medium text-violet-900">
                    2. Nannies Notified
                  </h4>
                  <p className="text-sm text-violet-700">
                    We notify the 20 closest verified nannies in your area
                  </p>
                </div>
                <div className="space-y-2">
                  <div className="flex h-10 w-10 items-center justify-center rounded-full bg-violet-200">
                    <CheckCircle className="h-5 w-5 text-violet-700" />
                  </div>
                  <h4 className="font-medium text-violet-900">3. You Choose</h4>
                  <p className="text-sm text-violet-700">
                    Review nanny profiles and pick the best fit for your family
                  </p>
                </div>
              </div>
            </CardContent>
          </Card>
        </>
      ) : (
        <div className="space-y-8">
          {/* Pending Payment */}
          {pendingPayment.length > 0 && (
            <section className="space-y-4">
              <h2 className="flex items-center gap-2 text-lg font-semibold text-violet-700">
                <CreditCard className="h-5 w-5" />
                Pending Payment ({pendingPayment.length})
              </h2>
              <div className="grid gap-3">
                {pendingPayment.map((req) => {
                  const firstSlot =
                    req.slots.length > 0
                      ? req.slots.reduce(
                          (min, s) => (s.slot_date < min.slot_date ? s : min),
                          req.slots[0],
                        )
                      : null;
                  return (
                    <div
                      key={req.id}
                      className="cursor-pointer rounded-xl border border-violet-200 bg-white p-4 shadow-sm hover:shadow-md transition-shadow"
                      onClick={() => {
                        window.location.href = `/parent/babysitting/${req.id}/payment`;
                      }}
                    >
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-3">
                          <div className="flex h-10 w-10 items-center justify-center rounded-full bg-violet-100">
                            <CreditCard className="h-5 w-5 text-violet-600" />
                          </div>
                          <div>
                            <p className="font-medium text-slate-800">
                              {firstSlot
                                ? formatSlotDate(firstSlot.slot_date)
                                : "Babysitting Request"}
                              {firstSlot &&
                                ` · ${formatTime(firstSlot.start_time)}`}
                            </p>
                            <p className="text-sm text-slate-500">
                              {req.suburb}
                            </p>
                          </div>
                        </div>
                        <div className="flex items-center gap-2">
                          <span className="inline-block rounded-full bg-violet-100 px-2.5 py-1 text-xs font-medium text-violet-700">
                            Checkout
                          </span>
                          <ChevronRight className="h-4 w-4 text-slate-400" />
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </section>
          )}

          {/* Active — awaiting nanny */}
          {active.length > 0 && (
            <section className="space-y-4">
              <h2 className="flex items-center gap-2 text-lg font-semibold text-amber-700">
                <Clock className="h-5 w-5" />
                Awaiting Response ({active.length})
              </h2>
              <div className="grid gap-3">
                {active.map((req) => (
                  <BSRTile
                    key={req.id}
                    request={req}
                    onClick={() => setSelectedRequest(req)}
                  />
                ))}
              </div>
            </section>
          )}

          {/* Filled — nanny confirmed */}
          {filled.length > 0 && (
            <section className="space-y-4">
              <h2 className="flex items-center gap-2 text-lg font-semibold text-green-700">
                <CheckCircle className="h-5 w-5" />
                Babysitting Bookings ({filled.length})
              </h2>
              <div className="grid gap-3">
                {filled.map((req) => (
                  <BSRTile
                    key={req.id}
                    request={req}
                    onClick={() => setSelectedRequest(req)}
                  />
                ))}
              </div>
            </section>
          )}

          {/* Past (collapsible) */}
          {past.length > 0 && (
            <section className="space-y-4">
              <button
                onClick={() => setShowPast(!showPast)}
                className="flex items-center gap-2 text-lg font-semibold text-slate-500 hover:text-slate-700 transition-colors"
              >
                {showPast ? (
                  <ChevronDown className="h-5 w-5" />
                ) : (
                  <ChevronRight className="h-5 w-5" />
                )}
                Past ({past.length})
              </button>
              {showPast && (
                <div className="grid gap-2">
                  {past.map((req) => (
                    <BSRTile
                      key={req.id}
                      request={req}
                      onClick={() => setSelectedRequest(req)}
                    />
                  ))}
                </div>
              )}
            </section>
          )}
        </div>
      )}
    </div>
  );
}

// ── BSR Tile (compact list item) ──

function BSRTile({
  request,
  onClick,
}: {
  request: BabysittingRequestWithSlots;
  onClick: () => void;
}) {
  const isOpen = request.status === "open";
  const isFilled = request.status === "filled";
  const isPast = [
    "expired",
    "cancelled",
    "nanny_cancelled",
    "completed",
  ].includes(request.status);
  const borderColor = isOpen
    ? "border-amber-200"
    : isFilled
      ? "border-green-200"
      : "border-slate-200";

  const statusConfig: Record<string, { label: string; style: string }> = {
    completed: { label: "Completed", style: "bg-green-100 text-green-700" },
    expired: { label: "Expired", style: "bg-amber-100 text-amber-800" },
    cancelled: { label: "Cancelled", style: "bg-slate-100 text-slate-600" },
    nanny_cancelled: {
      label: "Nanny Cancelled",
      style: "bg-red-100 text-red-700",
    },
  };

  const firstSlot = request.slots?.[0];

  return (
    <button
      onClick={onClick}
      className={`w-full text-left rounded-lg border ${borderColor} bg-white p-4 hover:bg-slate-50 transition-colors cursor-pointer ${
        isPast ? "opacity-75" : ""
      }`}
    >
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 mb-1">
            {isFilled && request.acceptedNanny ? (
              <div className="flex items-center gap-2">
                {request.acceptedNanny.profilePicUrl ? (
                  <img
                    src={request.acceptedNanny.profilePicUrl}
                    alt=""
                    className="h-8 w-8 rounded-full object-cover"
                  />
                ) : (
                  <div className="flex h-8 w-8 items-center justify-center rounded-full bg-green-100">
                    <span className="text-xs font-semibold text-green-600">
                      {request.acceptedNanny.firstName[0]}
                    </span>
                  </div>
                )}
                <p className="text-sm font-medium text-slate-900">
                  {request.acceptedNanny.firstName}
                  {calcAge(request.acceptedNanny.dateOfBirth) !== null
                    ? `, ${calcAge(request.acceptedNanny.dateOfBirth)}`
                    : ""}
                </p>
              </div>
            ) : (
              firstSlot && (
                <p className="text-sm font-medium text-slate-900">
                  {formatSlotDate(firstSlot.slot_date)}
                  {request.slots.length > 1 && (
                    <span className="text-slate-400">
                      {" "}
                      +{request.slots.length - 1} more
                    </span>
                  )}
                </p>
              )
            )}
          </div>
          {firstSlot && (
            <p className="text-xs text-slate-500">
              {isFilled && formatSlotDate(firstSlot.slot_date)}
              {isFilled && " · "}
              {formatTime(firstSlot.start_time)} –{" "}
              {formatTime(firstSlot.end_time)}
              {request.suburb && <span> · {request.suburb}</span>}
            </p>
          )}
        </div>
        <div className="flex items-center gap-2 flex-shrink-0">
          {isOpen && request.requestingNannies.length > 0 && (
            <span className="flex items-center gap-1 rounded-full bg-violet-100 px-2 py-0.5 text-xs font-medium text-violet-700">
              <User className="h-3 w-3" />
              {request.requestingNannies.length} request
              {request.requestingNannies.length > 1 ? "s" : ""}
            </span>
          )}
          {isFilled && (
            <span className="flex items-center gap-1 rounded-full bg-green-100 px-2 py-0.5 text-xs font-medium text-green-700">
              <CheckCircle className="h-3 w-3" />
              Confirmed
            </span>
          )}
          {isPast && statusConfig[request.status] && (
            <span
              className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${
                statusConfig[request.status].style
              }`}
            >
              {statusConfig[request.status].label}
            </span>
          )}
          <ChevronRight className="h-4 w-4 text-slate-300" />
        </div>
      </div>
    </button>
  );
}

// ── BSR Detail Modal ──

function BSRDetailModal({
  request,
  onClose,
  onAction,
}: {
  request: BabysittingRequestWithSlots;
  onClose: () => void;
  onAction: () => void;
}) {
  const [showConfirmCancel, setShowConfirmCancel] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedNanny, setSelectedNanny] = useState<RequestingNanny | null>(
    null,
  );
  const [acceptingNanny, setAcceptingNanny] = useState(false);
  const [confirmedNannyInfo, setConfirmedNannyInfo] = useState<{
    phone?: string;
    firstName?: string;
  } | null>(null);

  const isOpen = request.status === "open";
  const isFilled = request.status === "filled";
  const isPast = [
    "expired",
    "cancelled",
    "nanny_cancelled",
    "completed",
  ].includes(request.status);

  const handleCancel = async () => {
    setCancelling(true);
    setError(null);
    const result = await cancelBabysittingRequest(request.id);
    setCancelling(false);
    if (!result.success) {
      setError(result.error || "Failed to cancel");
    } else {
      onAction();
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <Card className="w-full max-w-lg max-h-[90vh] overflow-y-auto">
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle className="text-base">
              {isFilled ? "Babysitting Booking" : "Babysitting Request"}
            </CardTitle>
            <Button variant="ghost" size="sm" onClick={onClose}>
              <X className="h-4 w-4" />
            </Button>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* Status */}
          {isOpen && (
            <div className="space-y-2">
              <span className="inline-block rounded-full bg-amber-50 px-2.5 py-1 text-xs font-medium text-amber-700">
                Awaiting Babysitters
              </span>
            </div>
          )}

          {/* Requesting Nannies */}
          {isOpen && request.requestingNannies.length > 0 && (
            <div className="space-y-2">
              <p className="text-sm font-medium text-slate-700 flex items-center gap-1.5">
                <User className="h-3.5 w-3.5" />
                Nannies Requesting ({request.requestingNannies.length})
              </p>
              <div className="rounded-lg border border-slate-200 bg-slate-50 divide-y divide-slate-200">
                {request.requestingNannies.map((nanny) => (
                  <button
                    key={nanny.nannyId}
                    onClick={() => setSelectedNanny(nanny)}
                    className="w-full flex items-center gap-3 px-3 py-2.5 text-left hover:bg-slate-100 transition-colors cursor-pointer"
                  >
                    {nanny.profilePicUrl ? (
                      <img
                        src={nanny.profilePicUrl}
                        alt=""
                        className="h-9 w-9 rounded-full object-cover flex-shrink-0"
                      />
                    ) : (
                      <div className="flex h-9 w-9 items-center justify-center rounded-full bg-violet-100 flex-shrink-0">
                        <span className="text-xs font-semibold text-violet-600">
                          {nanny.firstName[0]}
                        </span>
                      </div>
                    )}
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium text-slate-900 truncate">
                        {nanny.firstName}
                        {calcAge(nanny.dateOfBirth) !== null
                          ? `, ${calcAge(nanny.dateOfBirth)}`
                          : ""}
                      </p>
                      <p className="text-xs text-slate-500">
                        {nanny.distanceKm !== null && (
                          <span>
                            {nanny.distanceKm < 1 ? "<1" : nanny.distanceKm} km
                          </span>
                        )}
                        {nanny.experienceYears && (
                          <span> · {nanny.experienceYears}yr exp</span>
                        )}
                      </p>
                    </div>
                    <ChevronRight className="h-4 w-4 text-slate-300 flex-shrink-0" />
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Nanny Mini Popup */}
          {selectedNanny && (
            <NannyMiniPopup
              nanny={selectedNanny}
              accepting={acceptingNanny}
              error={error}
              onAccept={async () => {
                setAcceptingNanny(true);
                setError(null);

                // Record informed consent — non-blocking
                recordInformedAction({
                  agreementId: "AGR-07",
                  buttonText: "Accept Babysitter",
                  modalContentVersion: "v3.0-2026-03-23",
                  relatedEntityId: request.id,
                }).catch(() => {});

                const result = await parentAcceptNanny(
                  request.id,
                  selectedNanny.nannyId,
                );
                setAcceptingNanny(false);
                if (!result.success) {
                  setError(result.error || "Failed to accept nanny");
                } else {
                  setSelectedNanny(null);
                  setConfirmedNannyInfo({
                    phone: result.nannyPhone,
                    firstName: result.nannyFirstName,
                  });
                }
              }}
              onClose={() => {
                setSelectedNanny(null);
                setError(null);
              }}
            />
          )}

          {/* Confirmation popup after accepting */}
          {confirmedNannyInfo && (
            <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50 p-4">
              <Card className="w-full max-w-sm">
                <CardContent className="pt-6 space-y-4 text-center">
                  <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-green-100">
                    <CheckCircle className="h-6 w-6 text-green-600" />
                  </div>
                  <h3 className="text-lg font-semibold text-slate-900">
                    Babysitter Confirmed!
                  </h3>
                  {confirmedNannyInfo.firstName && (
                    <p className="text-slate-600">
                      {confirmedNannyInfo.firstName} has been confirmed for your
                      babysitting job.
                    </p>
                  )}
                  {confirmedNannyInfo.phone && (
                    <div className="rounded-lg bg-violet-50 border border-violet-200 p-4 space-y-2">
                      <p className="text-sm font-medium text-slate-700 flex items-center justify-center gap-2">
                        <Phone className="h-4 w-4 text-violet-500" />
                        {confirmedNannyInfo.phone}
                      </p>
                    </div>
                  )}
                  <p className="text-sm text-slate-500">
                    Please contact your babysitter directly to confirm all the
                    details.
                  </p>
                  <Button
                    className="w-full bg-violet-500 hover:bg-violet-600"
                    onClick={() => {
                      setConfirmedNannyInfo(null);
                      onAction();
                    }}
                  >
                    Done
                  </Button>
                </CardContent>
              </Card>
            </div>
          )}

          {isFilled && request.acceptedNanny && (
            <div className="space-y-3">
              <span className="inline-block rounded-full bg-green-50 px-2.5 py-1 text-xs font-medium text-green-700">
                Confirmed
              </span>
              <div className="flex items-center gap-3 rounded-lg border border-green-200 bg-green-50 p-3">
                {request.acceptedNanny.profilePicUrl ? (
                  <img
                    src={request.acceptedNanny.profilePicUrl}
                    alt=""
                    className="h-10 w-10 rounded-full object-cover"
                  />
                ) : (
                  <div className="flex h-10 w-10 items-center justify-center rounded-full bg-green-200">
                    <UserCheck className="h-5 w-5 text-green-700" />
                  </div>
                )}
                <div className="flex-1">
                  <p className="text-sm font-medium text-green-900">
                    {request.acceptedNanny.firstName}
                    {calcAge(request.acceptedNanny.dateOfBirth) !== null
                      ? `, ${calcAge(request.acceptedNanny.dateOfBirth)}`
                      : ""}
                  </p>
                  {request.acceptedNanny.distanceKm !== null && (
                    <p className="text-xs text-green-700">
                      {request.acceptedNanny.distanceKm < 1
                        ? "<1 km"
                        : `${request.acceptedNanny.distanceKm} km`}{" "}
                      away
                    </p>
                  )}
                </div>
                <a
                  href={`/nannies/${request.accepted_nanny_id}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-sm font-medium text-green-700 hover:text-green-900 transition-colors"
                >
                  View Profile
                </a>
              </div>
              <div className="rounded-lg bg-violet-50 border border-violet-200 p-3">
                <p className="text-sm font-medium text-slate-700 flex items-center gap-2">
                  <Phone className="h-4 w-4 text-violet-500" />
                  {request.acceptedNanny.phone ?? "Phone not available"}
                </p>
                <p className="text-xs text-slate-500 mt-1">
                  Please contact your babysitter directly to confirm all
                  details.
                </p>
              </div>
            </div>
          )}

          {isPast && (
            <div>
              {request.status === "expired" && (
                <span className="inline-block rounded-full bg-amber-100 px-2.5 py-1 text-xs font-medium text-amber-800">
                  Expired
                </span>
              )}
              {request.status === "cancelled" && (
                <span className="inline-block rounded-full bg-slate-100 px-2.5 py-1 text-xs font-medium text-slate-600">
                  Cancelled
                </span>
              )}
              {request.status === "nanny_cancelled" && (
                <span className="inline-block rounded-full bg-red-100 px-2.5 py-1 text-xs font-medium text-red-700">
                  Nanny Cancelled
                </span>
              )}
              {request.status === "completed" && (
                <span className="inline-block rounded-full bg-green-100 px-2.5 py-1 text-xs font-medium text-green-700">
                  Completed
                </span>
              )}
            </div>
          )}

          <div className="rounded-lg border border-slate-200 bg-slate-50 divide-y divide-slate-200">
            {request.slots.map((slot) => (
              <div
                key={slot.id}
                className="flex items-center justify-between px-3 py-2.5"
              >
                <span className="text-sm text-slate-700">
                  {formatSlotDate(slot.slot_date)}
                </span>
                <span className="text-sm text-slate-500">
                  {formatTime(slot.start_time)} – {formatTime(slot.end_time)}
                </span>
              </div>
            ))}
          </div>

          {/* Details */}
          <div className="space-y-2 text-sm text-slate-500">
            <div className="flex items-center gap-2">
              <MapPin className="h-3.5 w-3.5" />
              <span>
                {request.address && <>{request.address}, </>}
                {request.suburb} {request.postcode}
              </span>
            </div>
            {(() => {
              let mins = 0;
              for (const s of request.slots) {
                if (s.start_time && s.end_time) {
                  const [sh, sm] = s.start_time.split(":").map(Number);
                  const [eh, em] = s.end_time.split(":").map(Number);
                  mins += eh * 60 + em - (sh * 60 + sm);
                }
              }
              const hrs = Math.round((mins / 60) * 10) / 10;
              return hrs > 0 ? (
                <div className="flex items-center gap-2">
                  <Clock className="h-3.5 w-3.5" />
                  {hrs} hrs total
                </div>
              ) : null;
            })()}
            {request.hourly_rate && (
              <div className="flex items-center gap-2">
                <PoundSterling className="h-3.5 w-3.5" />£{request.hourly_rate}/hr
                {(() => {
                  let mins = 0;
                  for (const s of request.slots) {
                    if (s.start_time && s.end_time) {
                      const [sh, sm] = s.start_time.split(":").map(Number);
                      const [eh, em] = s.end_time.split(":").map(Number);
                      mins += eh * 60 + em - (sh * 60 + sm);
                    }
                  }
                  const hrs = Math.round((mins / 60) * 10) / 10;
                  const est = Math.round(hrs * request.hourly_rate!);
                  return hrs > 0 ? <span> (est. £{est})</span> : null;
                })()}
              </div>
            )}
            {request.special_requirements && (
              <p className="text-sm text-slate-600 italic">
                &ldquo;{request.special_requirements}&rdquo;
              </p>
            )}
          </div>

          {error && <p className="text-sm text-red-600">{error}</p>}

          {/* Cancel */}
          {(isOpen || isFilled) && !showConfirmCancel && (
            <Button
              variant="outline"
              size="sm"
              className="text-slate-500"
              onClick={() => setShowConfirmCancel(true)}
            >
              {isFilled ? "Cancel Booking" : "Cancel Request"}
            </Button>
          )}

          {(isOpen || isFilled) && showConfirmCancel && (
            <div className="flex items-center gap-2">
              <p className="text-sm text-slate-600">
                {isFilled ? "Cancel this booking?" : "Cancel this request?"}
              </p>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setShowConfirmCancel(false)}
              >
                No
              </Button>
              <Button
                variant="destructive"
                size="sm"
                disabled={cancelling}
                onClick={handleCancel}
              >
                {cancelling ? (
                  <Loader2 className="h-3 w-3 animate-spin" />
                ) : (
                  <>
                    <X className="mr-1 h-3 w-3" />
                    Yes, Cancel
                  </>
                )}
              </Button>
            </div>
          )}

          <p className="text-xs text-slate-400">
            Created{" "}
            {new Date(request.created_at).toLocaleDateString("en-GB", {
              day: "numeric",
              month: "short",
              year: "numeric",
            })}
          </p>
        </CardContent>
      </Card>
    </div>
  );
}

// ── Nanny Mini Popup (overlays detail modal) ──

function NannyMiniPopup({
  nanny,
  accepting,
  error,
  onAccept,
  onClose,
}: {
  nanny: RequestingNanny;
  accepting: boolean;
  error: string | null;
  onAccept: () => void;
  onClose: () => void;
}) {
  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50 p-4">
      <Card className="w-full max-w-sm">
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle className="text-base">Nanny Profile</CardTitle>
            <Button variant="ghost" size="sm" onClick={onClose}>
              <X className="h-4 w-4" />
            </Button>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* Photo + Name */}
          <div className="flex items-center gap-3">
            {nanny.profilePicUrl ? (
              <img
                src={nanny.profilePicUrl}
                alt=""
                className="h-14 w-14 rounded-full object-cover"
              />
            ) : (
              <div className="flex h-14 w-14 items-center justify-center rounded-full bg-violet-100">
                <span className="text-lg font-semibold text-violet-600">
                  {nanny.firstName[0]}
                </span>
              </div>
            )}
            <div>
              <p className="text-base font-semibold text-slate-900">
                {nanny.firstName}
                {calcAge(nanny.dateOfBirth) !== null
                  ? `, ${calcAge(nanny.dateOfBirth)}`
                  : ""}
              </p>
              {nanny.suburb && (
                <p className="text-sm text-slate-500">{nanny.suburb}</p>
              )}
            </div>
          </div>

          {/* Brief Info */}
          <div className="space-y-1.5 text-sm text-slate-600">
            {nanny.distanceKm !== null && (
              <p className="flex items-center gap-1.5">
                <MapPin className="h-3.5 w-3.5 text-slate-400" />
                {nanny.distanceKm < 1 ? "<1" : nanny.distanceKm} km away
              </p>
            )}
            {nanny.experienceYears && (
              <p className="flex items-center gap-1.5">
                <Star className="h-3.5 w-3.5 text-slate-400" />
                {nanny.experienceYears} years experience
              </p>
            )}
            {nanny.languages && nanny.languages.length > 0 && (
              <p className="flex items-center gap-1.5">
                <Globe className="h-3.5 w-3.5 text-slate-400" />
                {nanny.languages.join(", ")}
              </p>
            )}
          </div>

          {/* AI Headline */}
          {nanny.aiHeadline && (
            <p className="text-sm text-slate-500 italic line-clamp-3">
              {nanny.aiHeadline.replace(/<[^>]*>/g, "")}
            </p>
          )}

          {error && (
            <div className="flex items-center gap-2 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
              <AlertCircle className="h-4 w-4 flex-shrink-0" />
              {error}
            </div>
          )}

          {/* Actions */}
          <div className="space-y-2">
            <p className="text-[10px] text-slate-400 text-center">
              By accepting, your full booking address will be shared with your
              babysitter.{" "}
              <Link
                href="/legal/client-terms"
                target="_blank"
                className="text-violet-500 hover:underline"
              >
                Terms
              </Link>{" "}
              &amp;{" "}
              <Link
                href="/legal/privacy-policy"
                target="_blank"
                className="text-violet-500 hover:underline"
              >
                Privacy Policy
              </Link>
              .
            </p>
            <Button
              className="w-full bg-violet-500 hover:bg-violet-600"
              disabled={accepting}
              onClick={onAccept}
            >
              {accepting ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <CheckCircle className="mr-2 h-4 w-4" />
              )}
              Accept Babysitter
            </Button>
            <a
              href={`/nannies/${nanny.nannyId}`}
              target="_blank"
              rel="noopener noreferrer"
              className="block w-full text-center rounded-md border border-slate-200 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 transition-colors"
            >
              View Full Profile
            </a>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
