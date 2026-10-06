"use client";

/**
 * Nanny "My profile" page — view and edit mode for her public profile.
 * Unit 3b (BB-LDN-3b-061026, brief change 10): the Safety & Assurance "Enhanced DBS" glance uses the same trigger as
 * the hub (`showsEnhancedDbsBadge`, level ≥ 3) instead of the stored verified flag. Qualification / certificate /
 * assurance lists here are 3e's.
 */
import { useState, useEffect, useTransition, useRef } from "react";
import Image from "next/image";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import { createClient } from "@/lib/supabase/client";
import { uploadFile } from "@/lib/supabase/storage";
import {
  NannyProfile,
  updateNannyProfile,
  updateNannyAIContent,
  regenerateNannyAIContent,
} from "@/lib/actions/nanny";
import {
  Pencil,
  X,
  Loader2,
  CheckCircle,
  RefreshCw,
  Camera,
  MapPin,
  ShieldCheck,
  Globe,
  Clock,
  Baby,
  Heart,
  Check,
  Sparkles,
  Stethoscope,
  CigaretteOff,
  PawPrint,
  Users,
  GraduationCap,
  Award,
  Briefcase,
  HandHeart,
  Smile,
  CalendarCheck,
  Accessibility,
  ThumbsUp,
  Languages,
  Car,
  Plus,
  Trash2,
  ChevronLeft,
  AlertTriangle,
} from "lucide-react";

import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";

import { Tag } from "@/components/profile/Tag";
import { GlanceItem } from "@/components/profile/GlanceItem";
import { StatBox } from "@/components/profile/StatBox";
import { AvailabilityGrid } from "@/components/profile/AvailabilityGrid";
import { ProfilePhotoViewer } from "@/components/profile/ProfilePhotoViewer";
import { computeAge, ageRangeToFriendly, childrenCountLabel, BADGE_ICONS } from "@/components/profile/profile-helpers";
import { checkAllFields } from "@/lib/profanity";
import { showsEnhancedDbsBadge } from "@/lib/dbs/nanny-display";

// ── Option constants ──

const QUALIFICATION_OPTIONS = [
  "Certificate III in Early Childhood Education and Care",
  "Certificate IV in Education Support",
  "Diploma of Early Childhood Education and Care",
  "Bachelor of Early Childhood Education (Or Equivalent)",
  "No Qualifications",
];
const CERTIFICATE_OPTIONS = ["CPR", "First Aid", "First Aid in Education & Care Setting", "Child Protection"];
const ROLE_TYPE_OPTIONS = ["Mothers Help", "Back-to-Work Support", "Pick Up & Drop Off", "Child Development", "Home Management"];
const LEVEL_OF_SUPPORT_OPTIONS = ["Supervision", "Engagement and Play", "Educational Support", "Developmental Assistance"];
const LANGUAGE_OPTIONS = ["English", "Foreign Language", "Multiple"];
const MIN_AGE_OPTIONS = [
  { label: "Newborn", months: 0 },
  { label: "3 months", months: 3 },
  { label: "6 months", months: 6 },
  { label: "12 months", months: 12 },
  { label: "18 months", months: 18 },
  { label: "2 years", months: 24 },
  { label: "3 years", months: 36 },
  { label: "5 years", months: 60 },
  { label: "10 years", months: 120 },
];
const MAX_AGE_OPTIONS = [
  { label: "12 months", months: 12 },
  { label: "3 years", months: 36 },
  { label: "5 years", months: 60 },
  { label: "10 years", months: 120 },
  { label: "13 years", months: 156 },
  { label: "16 years", months: 192 },
];

const MOTIVATION_OPTIONS = [
  "Supporting families",
  "Developing young minds",
  "Giving children the best possible start",
  "Making a real difference",
  "Other",
];
const ASSURANCE_OPTIONS = ["National Police Check", "References"];
const PERSONALITY_TRAIT_OPTIONS = [
  "Patient", "Creative", "Energetic", "Nurturing", "Calm", "Organised",
  "Warm", "Reliable", "Adaptable", "Empathetic", "Playful", "Attentive",
];
const PROFESSIONAL_VALUE_OPTIONS = [
  "Encouraging independence", "Being consistent and dependable", "Staying calm under pressure",
  "Teaching through play", "Taking accountability", "Adapting to each family's style",
  "Being in tune with a child's needs", "Anticipating needs", "Being open and transparent",
  "Understanding child development", "Following routines with care", "Adapting quickly to change",
];
const CHILDCARE_ROLE_OPTIONS = [
  "Nanny", "Babysitter", "Au pair", "Daycare", "Pre-school",
  "School teacher", "After-school care", "Other",
];

// ── Availability constants ──

const DAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"] as const;
const TIME_SLOTS = ["Morning (6am-10am)", "Midday (10am-2pm)", "Afternoon (2pm-6pm)", "Evening (6pm-10pm)"] as const;
const SLOT_LABELS = ["Morning", "Midday", "Afternoon", "Evening"];

// ── Tag UI ──

const TAG_ACTIVE = "bg-violet-600 text-white shadow-sm border-transparent";
const TAG_INACTIVE = "border-slate-200 text-slate-500 hover:text-slate-700 hover:bg-slate-50";

function MultiSelectTags({ options, selected, onChange, max }: {
  options: string[];
  selected: string[];
  onChange: (v: string[]) => void;
  max?: number;
}) {
  const toggle = (opt: string) => {
    if (selected.includes(opt)) {
      onChange(selected.filter((s) => s !== opt));
    } else {
      if (max && selected.length >= max) return;
      onChange([...selected, opt]);
    }
  };
  return (
    <div className="flex flex-wrap gap-1.5">
      {options.map((opt) => (
        <button
          key={opt}
          type="button"
          onClick={() => toggle(opt)}
          className={`rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors ${
            selected.includes(opt) ? TAG_ACTIVE : TAG_INACTIVE
          }`}
        >
          {opt}
        </button>
      ))}
    </div>
  );
}

function SingleSelectTags({ options, value, onChange }: {
  options: string[];
  value: string | null;
  onChange: (v: string) => void;
}) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {options.map((opt) => (
        <button
          key={opt}
          type="button"
          onClick={() => onChange(opt)}
          className={`rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors ${
            value === opt ? TAG_ACTIVE : TAG_INACTIVE
          }`}
        >
          {opt}
        </button>
      ))}
    </div>
  );
}

function BooleanTags({ value, onChange }: { value: boolean | null; onChange: (v: boolean) => void }) {
  return (
    <div className="flex gap-1.5">
      {[true, false].map((opt) => (
        <button
          key={String(opt)}
          type="button"
          onClick={() => onChange(opt)}
          className={`rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors ${
            value === opt ? TAG_ACTIVE : TAG_INACTIVE
          }`}
        >
          {opt ? "Yes" : "No"}
        </button>
      ))}
    </div>
  );
}

// ── HTML helpers ──

function htmlToPlainText(html: string): string {
  return html
    .replace(/<\/p>\s*<p[^>]*>/gi, "\n\n")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .trim();
}

function plainTextToHtml(text: string): string {
  return text
    .split(/\n\n+/)
    .map((para) => `<p>${para.replace(/\n/g, "<br>")}</p>`)
    .join("");
}

// ── Editable AI section ──

function EditableSection({
  html,
  editValue,
  onEdit,
}: {
  html: string;
  editValue: string | undefined;
  onEdit: (value: string) => void;
}) {
  const displayText = htmlToPlainText(editValue ?? html);

  return (
    <textarea
      value={displayText}
      onChange={(e) => onEdit(plainTextToHtml(e.target.value))}
      className="w-full rounded-lg border border-slate-200 bg-slate-50/50 px-3 py-2.5 text-sm text-slate-600 leading-relaxed focus:border-violet-400 focus:bg-white focus:ring-1 focus:ring-violet-400 outline-none resize-none transition-colors"
      rows={4}
    />
  );
}

// ── Editable availability grid ──

function EditableAvailabilityGrid({
  form,
  update,
}: {
  form: { available_days: string[]; schedule: Record<string, string[]> };
  update: (key: "available_days" | "schedule", value: string[] | Record<string, string[]>) => void;
}) {
  const toggleCell = (day: string, slotIndex: number) => {
    const dayKey = day.toLowerCase();
    const slot = TIME_SLOTS[slotIndex];
    const currentSlots = form.schedule[dayKey] || [];
    const isActive = form.available_days.includes(day) && currentSlots.includes(slot);

    if (isActive) {
      const newSlots = currentSlots.filter((s) => s !== slot);
      const newSchedule = { ...form.schedule, [dayKey]: newSlots };
      if (newSlots.length === 0) {
        update("available_days", form.available_days.filter((d) => d !== day));
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
        const { [dayKey]: _removed, ...rest } = newSchedule;
        update("schedule", rest);
      } else {
        update("schedule", newSchedule);
      }
    } else {
      const newDays = form.available_days.includes(day) ? form.available_days : [...form.available_days, day];
      update("available_days", newDays);
      update("schedule", { ...form.schedule, [dayKey]: [...currentSlots, slot] });
    }
  };

  return (
    <div className="overflow-x-auto -mx-1">
      <table className="w-full text-sm">
        <thead>
          <tr>
            <th className="py-2 pr-3 text-left text-xs font-medium text-slate-400" />
            {SLOT_LABELS.map((label) => (
              <th key={label} className="px-1.5 py-2 text-center text-xs font-medium text-slate-400">{label}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {DAYS.map((day) => {
            const dayKey = day.toLowerCase();
            const currentSlots = form.schedule[dayKey] || [];
            const isDayAvailable = form.available_days.includes(day);
            return (
              <tr key={day}>
                <td className="py-1.5 pr-3 font-medium text-slate-600 text-sm whitespace-nowrap">{day.slice(0, 3)}</td>
                {TIME_SLOTS.map((slot, i) => {
                  const active = isDayAvailable && currentSlots.includes(slot);
                  return (
                    <td key={i} className="px-1.5 py-1.5 text-center">
                      <button
                        type="button"
                        onClick={() => toggleCell(day, i)}
                        className={cn(
                          "inline-flex h-8 w-8 items-center justify-center rounded-lg text-xs font-medium transition-all",
                          active
                            ? "bg-violet-500 text-white shadow-sm hover:bg-violet-600"
                            : "bg-slate-50 text-slate-300 hover:bg-violet-100 hover:text-violet-500"
                        )}
                      >
                        {active ? <Check className="h-3.5 w-3.5" /> : "–"}
                      </button>
                    </td>
                  );
                })}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

// ── Photo upload slot ──

function PhotoSlot({
  url,
  onUpload,
  onRemove,
  uploading,
  shape = "square",
  size = "md",
}: {
  url: string | null;
  onUpload: (file: File) => void;
  onRemove: () => void;
  uploading: boolean;
  shape?: "circle" | "square";
  size?: "sm" | "md" | "lg";
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const dims = size === "lg" ? "h-32 w-32" : size === "md" ? "h-20 w-20" : "h-16 w-16";

  return (
    <div className="relative group">
      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) onUpload(file);
          if (inputRef.current) inputRef.current.value = "";
        }}
        className="hidden"
      />
      <div
        className={cn(
          dims,
          "overflow-hidden border-2 border-dashed border-slate-200 bg-slate-50 flex items-center justify-center cursor-pointer hover:border-violet-300 transition-colors",
          shape === "circle" ? "rounded-full" : "rounded-xl",
        )}
        onClick={() => !uploading && inputRef.current?.click()}
      >
        {uploading ? (
          <Loader2 className="h-5 w-5 animate-spin text-slate-400" />
        ) : url ? (
          <img src={url} alt="" className="h-full w-full object-cover" />
        ) : (
          <Camera className="h-5 w-5 text-slate-300" />
        )}
      </div>
      {url && !uploading && (
        <button
          type="button"
          onClick={(e) => { e.stopPropagation(); onRemove(); }}
          className="absolute -top-1.5 -right-1.5 flex h-5 w-5 items-center justify-center rounded-full bg-red-500 text-white opacity-0 group-hover:opacity-100 transition-opacity shadow-sm"
        >
          <X className="h-3 w-3" />
        </button>
      )}
    </div>
  );
}

// ── Tab definitions ──

const PROFILE_TABS = [
  { id: "about" as const, label: "About" },
  { id: "experience" as const, label: "Experience" },
  { id: "availability" as const, label: "Availability" },
];
type ProfileTabId = (typeof PROFILE_TABS)[number]["id"];

// ══════════════════════════════════════════════════════════════════════════════
//  MAIN COMPONENT
// ══════════════════════════════════════════════════════════════════════════════

export function NannyMyProfile({ profile }: { profile: NannyProfile }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  const [editMode, setEditMode] = useState(false);
  const [activeTab, setActiveTab] = useState<ProfileTabId>("about");
  const [saveStatus, setSaveStatus] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [error, setError] = useState<string | null>(null);
  const [showRegenOffer, setShowRegenOffer] = useState(false);
  const [regenModalOpen, setRegenModalOpen] = useState(false);
  const [regenStepIndex, setRegenStepIndex] = useState(0);
  const [regenResult, setRegenResult] = useState<"pending" | "success" | "error">("pending");
  const [regenErrorMsg, setRegenErrorMsg] = useState<string | null>(null);
  const [photoViewerOpen, setPhotoViewerOpen] = useState(false);
  const [photoViewerIndex, setPhotoViewerIndex] = useState(0);

  // AI content edits
  const [aiEdits, setAiEdits] = useState<Record<string, string>>({});

  // Photo upload state
  const profilePhotoRef = useRef<HTMLInputElement>(null);
  const [photoUploading, setPhotoUploading] = useState(false);
  const [newProfilePicUrl, setNewProfilePicUrl] = useState<string | null>(null);
  const [photoSlotUploading, setPhotoSlotUploading] = useState<Record<string, boolean>>({});
  const [newPhoto1, setNewPhoto1] = useState<string | null>(null);
  const [newPhoto2, setNewPhoto2] = useState<string | null>(null);
  const [newPhoto3, setNewPhoto3] = useState<string | null>(null);

  // ── Derived data ──

  const nannyId = profile.nanny_id;
  const age = computeAge(profile.date_of_birth);
  const aiContent = profile.ai_content as Record<string, unknown> | null;
  const isVerified = (profile.verification_level ?? 0) >= 3;

  // AI content extraction (V2 field paths)
  const ai = aiContent;
  const bioSummary = ai?.bio_summary;
  const bioObj = (typeof bioSummary === "object" && bioSummary !== null ? bioSummary : null) as Record<string, string> | null;
  const headline = (ai?.headline as string) || null;
  const aiAbout = bioObj?.about || null;
  const aiPersonality = bioObj?.personality || null;
  const aiValues = bioObj?.values || null;
  const aiBackground = bioObj?.background || null;
  const aiWhatIOffer = bioObj?.what_i_offer || null;
  const aiExperience = (ai?.experience_summary as string) || null;

  // Badge pills
  const traitBadges: { icon: string; label: string; primary?: boolean }[] = [];
  if (profile.total_experience_years && profile.total_experience_years > 0)
    traitBadges.push({ icon: "Clock", label: `${profile.total_experience_years}${profile.total_experience_years === 1 ? 'yr' : 'yrs'} experience`, primary: true });
  if (profile.under_3_experience_years && profile.under_3_experience_years > 0)
    traitBadges.push({ icon: "Baby", label: `Toddlers, ${profile.under_3_experience_years}${profile.under_3_experience_years === 1 ? 'yr' : 'yrs'}`, primary: true });
  if (profile.newborn_experience_years && profile.newborn_experience_years > 0)
    traitBadges.push({ icon: "Baby", label: `Babies, ${profile.newborn_experience_years}${profile.newborn_experience_years === 1 ? 'yr' : 'yrs'}`, primary: true });
  if (profile.highest_qualification) {
    let qual = profile.highest_qualification;
    if (qual.startsWith("Bachelor")) qual = "Bachelors";
    else if (qual.startsWith("Diploma")) qual = "Diploma";
    else if (qual.startsWith("Certificate IV")) qual = "Cert IV";
    else if (qual.startsWith("Certificate III")) qual = "Cert III";
    traitBadges.push({ icon: "GraduationCap", label: qual });
  }

  // Stat boxes
  const statBoxes: { value: number; label: string }[] = [];
  if (profile.total_experience_years && profile.total_experience_years > 0)
    statBoxes.push({ value: profile.total_experience_years, label: "Years Childcare" });
  if (profile.under_3_experience_years && profile.under_3_experience_years > 0)
    statBoxes.push({ value: profile.under_3_experience_years, label: "Years Under 3s" });
  if (profile.newborn_experience_years && profile.newborn_experience_years > 0)
    statBoxes.push({ value: profile.newborn_experience_years, label: "Years Newborns" });

  // Photos
  const profilePicUrl = newProfilePicUrl || profile.profile_picture_url;
  const photo1Url = newPhoto1 !== null ? newPhoto1 : profile.photo_1_url;
  const photo2Url = newPhoto2 !== null ? newPhoto2 : profile.photo_2_url;
  const photo3Url = newPhoto3 !== null ? newPhoto3 : profile.photo_3_url;
  const additionalPhotos = [photo1Url, photo2Url, photo3Url].filter(Boolean) as string[];

  // Languages for display — filter out preset category labels
  const displayLanguages = (profile.languages || []).filter(
    (l: string) => l !== "Foreign Language" && l !== "Multiple"
  );

  // Regeneration rolling status messages
  const REGEN_STEPS = [
    "Analysing your profile information...",
    "Understanding your unique qualities...",
    "Crafting your personality story...",
    "Writing your experience narrative...",
    "Composing your headline...",
    "Generating your bio for families...",
    "Polishing the finishing touches...",
  ];

  // ── Form state ──

  // Determine if motivation is a custom "Other" value
  const presetMotivations = MOTIVATION_OPTIONS.filter((o) => o !== "Other");
  const initialMotivation = profile.motivation || null;
  const initialMotivationIsOther = initialMotivation !== null && !presetMotivations.includes(initialMotivation);

  const buildInitialForm = () => ({
    total_experience_years: profile.total_experience_years,
    under_3_experience_years: profile.under_3_experience_years,
    newborn_experience_years: profile.newborn_experience_years,
    highest_qualification: profile.highest_qualification || null,
    certificates: profile.certificates || [],
    assurances: profile.assurances || [],
    role_types_preferred: profile.role_types_preferred || [],
    level_of_support_offered: profile.level_of_support_offered || [],
    max_children: profile.max_children,
    min_child_age_months: profile.min_child_age_months,
    max_child_age_months: profile.max_child_age_months,
    additional_needs_ok: profile.additional_needs_ok ?? false,
    hourly_rate_min: profile.hourly_rate_min,
    available_days: profile.availability?.days_available || [],
    schedule: (profile.availability?.schedule || {}) as Record<string, string[]>,
    immediate_start_available: profile.immediate_start_available ?? false,
    languages: (profile.languages || []).filter((l: string) => LANGUAGE_OPTIONS.includes(l)),
    language_details: (profile.languages || []).filter((l: string) => !LANGUAGE_OPTIONS.includes(l)).join(", "),
    drivers_license: profile.drivers_license,
    has_car: profile.has_car,
    comfortable_with_pets: profile.comfortable_with_pets,
    vaccination_status: profile.vaccination_status,
    non_smoker: profile.non_smoker,
    // V2 fields
    motivation: initialMotivationIsOther ? "Other" : (initialMotivation),
    motivation_other: initialMotivationIsOther ? initialMotivation : "",
    personality_traits: profile.personality_traits || [],
    professional_values: profile.professional_values || [],
    childcare_roles: (profile.childcare_roles || []) as { role: string; role_other?: string; duration: number }[],
  });

  const [form, setForm] = useState(buildInitialForm);

  const update = <K extends keyof typeof form>(key: K, value: (typeof form)[K]) => {
    setForm((prev) => ({ ...prev, [key]: value }));
    setSaveStatus("idle");
  };

  const setAiEdit = (key: string, value: string) => {
    setAiEdits((prev) => ({ ...prev, [key]: value }));
    setSaveStatus("idle");
  };

  // ── Regen modal step cycling ──
  useEffect(() => {
    if (!regenModalOpen || regenResult !== "pending") return;
    const interval = setInterval(() => {
      setRegenStepIndex((prev) => (prev + 1) % REGEN_STEPS.length);
    }, 2500);
    return () => clearInterval(interval);
  }, [regenModalOpen, regenResult, REGEN_STEPS.length]);

  // ── Photo upload handler ──

  const handlePhotoUpload = async (
    file: File,
    setUrl: (url: string | null) => void,
    slotKey?: string,
  ) => {
    if (!file.type.startsWith("image/")) { setError("Please select an image file"); return; }
    if (file.size > 5 * 1024 * 1024) { setError("Image must be under 5MB"); return; }

    if (slotKey) setPhotoSlotUploading((p) => ({ ...p, [slotKey]: true }));
    else setPhotoUploading(true);
    setError(null);

    try {
      const supabase = createClient();
      const { data: { user: authUser } } = await supabase.auth.getUser();
      if (!authUser) { setError("You must be logged in"); return; }

      const result = await uploadFile("profile-pictures", authUser.id, file);
      if (result.error || !result.url) { setError(result.error || "Upload failed"); return; }

      setUrl(result.url);
      setSaveStatus("idle");
    } catch {
      setError("Upload failed — please try again");
    } finally {
      if (slotKey) setPhotoSlotUploading((p) => ({ ...p, [slotKey]: false }));
      else setPhotoUploading(false);
    }
  };

  // ── Save / Discard ──

  // Field key → user-friendly label mapping for profanity errors
  const FIELD_LABELS: Record<string, string> = {
    motivation_other: "What drives me",
    language_details: "Languages",
    headline: "Headline",
    "bio_summary.about": "About section",
    "bio_summary.personality": "Personality section",
    "bio_summary.values": "Values section",
    "bio_summary.background": "Background section",
    "bio_summary.what_i_offer": "What I Offer section",
    experience_summary: "Experience section",
  };

  const handleSave = () => {
    // Validate required "Other" / language details fields
    if (form.motivation === "Other" && !form.motivation_other.trim()) {
      setError("Please fill in what drives you, or select a different option.");
      setSaveStatus("error");
      return;
    }
    if ((form.languages.includes("Foreign Language") || form.languages.includes("Multiple")) && !form.language_details.trim()) {
      setError("Please specify which language(s) you speak.");
      setSaveStatus("error");
      return;
    }

    // Client-side profanity check on all user-editable text
    const textFields: Record<string, string | undefined> = {};

    // Motivation "Other" custom text
    if (form.motivation === "Other" && form.motivation_other) {
      textFields["motivation_other"] = form.motivation_other;
    }

    // Childcare role "Other" text
    form.childcare_roles.forEach((role, i) => {
      if (role.role === "Other" && role.role_other) {
        textFields[`role_other_${i}`] = role.role_other;
        FIELD_LABELS[`role_other_${i}`] = "Childcare role (Other)";
      }
    });

    // Language details
    if (form.language_details) {
      textFields["language_details"] = form.language_details;
    }

    // AI content edits
    for (const [key, value] of Object.entries(aiEdits)) {
      if (value) textFields[key] = value;
    }

    const profanityResult = checkAllFields(textFields);
    if (!profanityResult.clean) {
      const friendlyNames = profanityResult.offendingFields
        .map((f) => FIELD_LABELS[f] || f)
        .join(", ");
      setError(`Please remove inappropriate language from: ${friendlyNames}`);
      setSaveStatus("error");
      return;
    }

    setSaveStatus("saving");
    setError(null);
    startTransition(async () => {
      // Combine language presets + custom language names
      const combinedLanguages = [...form.languages];
      if ((combinedLanguages.includes("Foreign Language") || combinedLanguages.includes("Multiple")) && form.language_details.trim()) {
        const customs = form.language_details.split(",").map((s: string) => s.trim()).filter(Boolean);
        combinedLanguages.push(...customs);
      }

      const result = await updateNannyProfile({
        ...(newProfilePicUrl ? { profile_picture_url: newProfilePicUrl } : {}),
        total_experience_years: form.total_experience_years,
        under_3_experience_years: form.under_3_experience_years,
        newborn_experience_years: form.newborn_experience_years,
        highest_qualification: form.highest_qualification,
        certificates: form.certificates,
        role_types_preferred: form.role_types_preferred,
        level_of_support_offered: form.level_of_support_offered,
        max_children: form.max_children,
        min_child_age_months: form.min_child_age_months,
        max_child_age_months: form.max_child_age_months,
        additional_needs_ok: form.additional_needs_ok,
        hourly_rate_min: form.hourly_rate_min,
        available_days: form.available_days,
        schedule: form.schedule,
        immediate_start_available: form.immediate_start_available,
        languages: combinedLanguages,
        drivers_license: form.drivers_license,
        has_car: form.has_car,
        comfortable_with_pets: form.comfortable_with_pets,
        vaccination_status: form.vaccination_status,
        non_smoker: form.non_smoker,
        assurances: form.assurances.length > 0 ? form.assurances : [],
        // V2 fields
        motivation: form.motivation === "Other" ? (form.motivation_other || null) : form.motivation,
        personality_traits: form.personality_traits.length > 0 ? form.personality_traits : null,
        professional_values: form.professional_values.length > 0 ? form.professional_values : null,
        childcare_roles: form.childcare_roles.length > 0 ? form.childcare_roles : null,
        photo_1_url: newPhoto1 !== null ? (newPhoto1 || null) : undefined,
        photo_2_url: newPhoto2 !== null ? (newPhoto2 || null) : undefined,
        photo_3_url: newPhoto3 !== null ? (newPhoto3 || null) : undefined,
      });

      if (!result.success) {
        setSaveStatus("error");
        setError(result.error);
        return;
      }

      // Save AI edits if any
      if (Object.keys(aiEdits).length > 0) {
        const aiUpdates: Record<string, unknown> = {};
        for (const [key, value] of Object.entries(aiEdits)) {
          if (key.includes(".")) {
            const [parent, child] = key.split(".");
            aiUpdates[parent] = { ...(aiUpdates[parent] as Record<string, unknown> || {}), [child]: value };
          } else {
            aiUpdates[key] = value;
          }
        }
        const aiResult = await updateNannyAIContent(nannyId, aiUpdates);
        if (!aiResult.success) {
          setSaveStatus("error");
          setError(aiResult.error);
          return;
        }
      }

      setSaveStatus("saved");
      setEditMode(false);
      setAiEdits({});
      router.refresh();
      setShowRegenOffer(true);
    });
  };

  const handleDiscard = () => {
    setForm(buildInitialForm());
    setAiEdits({});
    setNewProfilePicUrl(null);
    setNewPhoto1(null);
    setNewPhoto2(null);
    setNewPhoto3(null);
    setEditMode(false);
    setSaveStatus("idle");
    setError(null);
  };

  const handleRegenerate = async () => {
    setShowRegenOffer(false);
    setRegenModalOpen(true);
    setRegenStepIndex(0);
    setRegenResult("pending");
    setRegenErrorMsg(null);

    const [result] = await Promise.all([
      regenerateNannyAIContent(),
      new Promise((resolve) => setTimeout(resolve, 1500)), // minimum spinner time
    ]);

    if (result.success) {
      setRegenResult("success");
      setTimeout(() => {
        setRegenModalOpen(false);
        router.refresh();
      }, 2000);
    } else {
      setRegenResult("error");
      setRegenErrorMsg(
        result.error || "We were unable to regenerate your profile at this time. Please try again later."
      );
    }
  };

  const enterEditMode = () => {
    setEditMode(true);
    setSaveStatus("idle");
    setAiEdits({});
    setNewProfilePicUrl(null);
    setNewPhoto1(null);
    setNewPhoto2(null);
    setNewPhoto3(null);
  };

  // ══════════════════════════════════════════════════════════════════════════
  //  RENDER
  // ══════════════════════════════════════════════════════════════════════════

  return (
    <div className={cn("mx-auto max-w-2xl space-y-3", editMode && "pb-20")}>

      {/* ── Back to hub ── */}
      <Link
        href="/nanny"
        className="inline-flex items-center gap-1 text-sm text-slate-400 hover:text-slate-600 transition-colors mb-1"
      >
        <ChevronLeft className="h-4 w-4" /> Back
      </Link>

      {/* ══════════════════════════════════════════════════════════════════════
          HERO CARD
         ══════════════════════════════════════════════════════════════════════ */}
      <div className="relative rounded-2xl border border-slate-200 bg-white shadow-sm overflow-hidden">
        {isVerified && (
          <span className="absolute top-3 right-3 z-10 inline-flex items-center gap-1.5 rounded-full bg-green-50 border border-green-200 px-3 py-1 text-xs font-semibold text-green-700">
            <ShieldCheck className="h-3.5 w-3.5" /> Verified
          </span>
        )}
        <div className="h-12 bg-gradient-to-br from-violet-50 to-violet-100/50" />

        <div className="relative px-5 pb-5">
          {/* Edit pencil / Cancel */}
          {!editMode ? (
            <button
              onClick={enterEditMode}
              className="absolute top-14 right-4 flex h-7 w-7 items-center justify-center rounded-lg text-slate-300 hover:text-violet-600 hover:bg-slate-50 transition-colors z-10"
              title="Edit Profile"
            >
              <Pencil className="h-3.5 w-3.5" />
            </button>
          ) : (
            <button
              onClick={handleDiscard}
              className="absolute top-14 right-4 flex h-7 w-7 items-center justify-center rounded-lg text-slate-300 hover:text-red-500 hover:bg-red-50 transition-colors z-10"
              title="Cancel Editing"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          )}

          <div className="flex items-end gap-4 -mt-10">
            {/* Profile picture */}
            <div className="relative shrink-0">
              <div className="relative h-32 w-32 overflow-hidden rounded-full border-4 border-white bg-violet-50 shadow-md">
                {profilePicUrl ? (
                  <img
                    src={profilePicUrl}
                    alt={`${profile.first_name}'s photo`}
                    className="h-full w-full object-cover"
                  />
                ) : (
                  <div className="flex h-full w-full items-center justify-center text-3xl font-bold text-violet-300">
                    {profile.first_name[0]}
                  </div>
                )}
                {editMode && (
                  <>
                    <input
                      ref={profilePhotoRef}
                      type="file"
                      accept="image/*"
                      onChange={(e) => {
                        const file = e.target.files?.[0];
                        if (file) handlePhotoUpload(file, setNewProfilePicUrl);
                        if (profilePhotoRef.current) profilePhotoRef.current.value = "";
                      }}
                      className="hidden"
                    />
                    <button
                      type="button"
                      onClick={() => profilePhotoRef.current?.click()}
                      disabled={photoUploading}
                      className={cn(
                        "absolute inset-0 flex items-center justify-center bg-black/40 transition-opacity cursor-pointer rounded-full",
                        photoUploading ? "opacity-100" : "opacity-0 hover:opacity-100"
                      )}
                    >
                      {photoUploading ? (
                        <Loader2 className="h-6 w-6 animate-spin text-white" />
                      ) : (
                        <Camera className="h-6 w-6 text-white" />
                      )}
                    </button>
                  </>
                )}
              </div>
              {isVerified && (
                <div className="absolute bottom-2 right-0 flex h-7 w-7 items-center justify-center rounded-full bg-green-50 border border-green-200 ring-2 ring-white">
                  <ShieldCheck className="h-4 w-4 text-green-700" />
                </div>
              )}
            </div>

            <div className="flex-1 min-w-0 pb-1 pt-4">
              <h1 className="text-2xl font-bold text-slate-900">
                {profile.first_name.charAt(0).toUpperCase() + profile.first_name.slice(1)}{age ? `, ${age}` : ""}
              </h1>
              <div className="mt-1 flex items-center justify-between gap-2">
                <div className="min-w-0 pr-2">
                  {profile.nationality && (
                    <p className="flex items-center gap-1 text-sm text-slate-500 mt-0.5">
                      <Globe className="h-3.5 w-3.5 shrink-0" /> <span className="truncate">{profile.nationality}</span>
                    </p>
                  )}
                  {displayLanguages.length > 0 && (
                    <p className="flex items-center gap-1 text-xs text-slate-400 mt-0.5">
                      <Languages className="h-3 w-3 shrink-0" />
                      <span className="truncate">{displayLanguages.join(", ")}</span>
                    </p>
                  )}
                  {profile.suburb && (
                    <p className="flex items-center gap-1 text-sm text-slate-500 mt-0.5">
                      <MapPin className="h-3.5 w-3.5 shrink-0" /> <span className="truncate">{profile.suburb}</span>
                    </p>
                  )}
                </div>

                {/* Photo fan */}
                {additionalPhotos.length > 0 && !editMode && (
                  <button
                    onClick={() => { setPhotoViewerIndex(0); setPhotoViewerOpen(true); }}
                    className="relative shrink-0 w-[84px] h-[48px] cursor-pointer group"
                  >
                    {additionalPhotos.slice(0, 3).map((url, i) => {
                      const rotations = ["-rotate-[15deg]", "rotate-0", "rotate-[15deg]"];
                      const offsets = ["left-0", "left-4", "left-8"];
                      const zIndexes = ["z-[3]", "z-[2]", "z-[1]"];
                      return (
                        <div
                          key={i}
                          className={cn(
                            "absolute top-0 h-11 w-11 overflow-hidden rounded-lg border-2 border-white shadow-md transition-transform group-hover:scale-105",
                            rotations[i], offsets[i], zIndexes[i],
                          )}
                        >
                          <img src={url} alt={`Photo ${i + 1}`} className="h-full w-full object-cover" />
                        </div>
                      );
                    })}
                  </button>
                )}
              </div>
            </div>
          </div>

          {/* Additional photos edit row */}
          {editMode && (
            <div className="mt-3 flex items-center gap-3">
              <Label className="text-xs text-slate-500 shrink-0">Additional Photos</Label>
              <div className="flex gap-2">
                <PhotoSlot
                  url={photo1Url}
                  onUpload={(f) => handlePhotoUpload(f, setNewPhoto1, "p1")}
                  onRemove={() => setNewPhoto1("")}
                  uploading={photoSlotUploading["p1"] || false}
                  size="sm"
                />
                <PhotoSlot
                  url={photo2Url}
                  onUpload={(f) => handlePhotoUpload(f, setNewPhoto2, "p2")}
                  onRemove={() => setNewPhoto2("")}
                  uploading={photoSlotUploading["p2"] || false}
                  size="sm"
                />
                <PhotoSlot
                  url={photo3Url}
                  onUpload={(f) => handlePhotoUpload(f, setNewPhoto3, "p3")}
                  onRemove={() => setNewPhoto3("")}
                  uploading={photoSlotUploading["p3"] || false}
                  size="sm"
                />
              </div>
            </div>
          )}

          {/* Headline */}
          {editMode && headline ? (
            <div className="mt-3">
              <EditableSection
                html={headline}
                editValue={aiEdits["headline"]}
                onEdit={(v) => setAiEdit("headline", v)}
              />
            </div>
          ) : headline ? (
            <div
              className="mt-3 text-sm text-slate-600 leading-relaxed [&_p]:mb-0"
              dangerouslySetInnerHTML={{ __html: headline }}
            />
          ) : null}

          {/* Badges */}
          {traitBadges.length > 0 && (
            <div className="mt-3 flex flex-wrap gap-1 sm:gap-1.5">
              {traitBadges.map((badge, i) => {
                const Icon = BADGE_ICONS[badge.icon] || Check;
                return (
                  <span
                    key={i}
                    className={cn(
                      "inline-flex items-center tracking-tight whitespace-nowrap shrink-0 gap-0.5 sm:gap-1.5 rounded-full px-1.5 sm:px-2.5 py-0.5 sm:py-1 text-[9px] sm:text-[10px] md:text-xs font-medium",
                      badge.primary
                        ? "bg-violet-50 text-violet-700 border border-violet-200"
                        : "bg-slate-50 text-slate-600 border border-slate-200"
                    )}
                  >
                    <Icon className="h-2.5 w-2.5 sm:h-3 sm:w-3 shrink-0" /> {badge.label}
                  </span>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {/* ═══════════════════════════════════════════════════════════════════
          TAB BAR
         ═══════════════════════════════════════════════════════════════════ */}
      <div className="flex gap-1 rounded-xl bg-slate-100 p-1">
        {PROFILE_TABS.map((tab) => {
          const isActive = activeTab === tab.id;
          return (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={cn(
                "flex-1 rounded-lg px-4 py-2 text-sm font-medium transition-all",
                isActive
                  ? "bg-white text-slate-900 shadow-sm"
                  : "text-slate-500 hover:text-slate-700"
              )}
            >
              {tab.label}
            </button>
          );
        })}
      </div>

      {/* ═══════════════════════════════════════════════════════════════════
          ABOUT TAB
         ═══════════════════════════════════════════════════════════════════ */}
      {activeTab === "about" && (
        <div className="space-y-3">

          {/* 1. About */}
          {(aiAbout || profile.motivation || editMode) && (
            <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
              <div className="flex items-center gap-2 mb-3">
                <Sparkles className="h-4 w-4 text-violet-400" />
                <h3 className="text-sm font-semibold text-slate-900">About {profile.first_name}</h3>
              </div>
              {editMode && aiAbout ? (
                <EditableSection html={aiAbout} editValue={aiEdits["bio_summary.about"]} onEdit={(v) => setAiEdit("bio_summary.about", v)} />
              ) : aiAbout ? (
                <div className="text-sm text-slate-600 leading-relaxed [&_p]:mb-2 [&_p:last-child]:mb-0" dangerouslySetInnerHTML={{ __html: aiAbout }} />
              ) : null}
              {editMode ? (
                <div className="mt-3 space-y-2">
                  <Label className="text-xs text-slate-500 mb-1.5 block">What drives me</Label>
                  <SingleSelectTags options={MOTIVATION_OPTIONS} value={form.motivation} onChange={(v) => { update("motivation", v); if (v !== "Other") update("motivation_other", ""); }} />
                  {form.motivation === "Other" && (
                    <div className="relative">
                      <Input
                        value={form.motivation_other}
                        onChange={(e) => {
                          if (e.target.value.length <= 50) update("motivation_other", e.target.value);
                        }}
                        placeholder="Tell us what drives you..."
                        className="pr-14 text-sm"
                        maxLength={50}
                      />
                      <span className={cn(
                        "absolute right-3 top-1/2 -translate-y-1/2 text-xs tabular-nums",
                        (form.motivation_other?.length || 0) >= 45 ? "text-red-400" : "text-slate-300"
                      )}>
                        {50 - (form.motivation_other?.length || 0)}
                      </span>
                    </div>
                  )}
                </div>
              ) : profile.motivation ? (
                <div className="mt-3 flex items-center gap-2 rounded-lg bg-violet-50/50 border border-violet-100 px-3 py-2">
                  <Heart className="h-3.5 w-3.5 text-violet-400 shrink-0" />
                  <p className="text-xs text-violet-600">
                    <span className="font-medium">What drives me:</span> {profile.motivation}
                  </p>
                </div>
              ) : null}
            </div>
          )}

          {/* 2. Personality */}
          {(aiPersonality || (profile.personality_traits && profile.personality_traits.length > 0) || editMode) && (
            <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
              <div className="flex items-center gap-2 mb-3">
                <Smile className="h-4 w-4 text-violet-500" />
                <h3 className="text-sm font-semibold text-slate-900">Personality</h3>
              </div>
              {editMode && aiPersonality ? (
                <EditableSection html={aiPersonality} editValue={aiEdits["bio_summary.personality"]} onEdit={(v) => setAiEdit("bio_summary.personality", v)} />
              ) : aiPersonality ? (
                <div className="text-sm text-slate-600 leading-relaxed mb-3 [&_p]:mb-2 [&_p:last-child]:mb-0" dangerouslySetInnerHTML={{ __html: aiPersonality }} />
              ) : null}
              {editMode ? (
                <div className="mt-3">
                  <Label className="text-xs text-slate-500 mb-1.5 block">Personality traits (pick up to 5)</Label>
                  <MultiSelectTags options={PERSONALITY_TRAIT_OPTIONS} selected={form.personality_traits as string[]} onChange={(v) => update("personality_traits", v)} max={5} />
                </div>
              ) : profile.personality_traits && profile.personality_traits.length > 0 ? (
                <div className="flex flex-wrap gap-1.5">
                  {profile.personality_traits.map((trait) => (
                    <Tag key={trait} variant="violet">{trait}</Tag>
                  ))}
                </div>
              ) : null}
            </div>
          )}

          {/* 3. Values */}
          {(aiValues || (profile.professional_values && profile.professional_values.length > 0) || editMode) && (
            <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
              <div className="flex items-center gap-2 mb-3">
                <HandHeart className="h-4 w-4 text-violet-400" />
                <h3 className="text-sm font-semibold text-slate-900">My Values</h3>
              </div>
              {editMode && aiValues ? (
                <EditableSection html={aiValues} editValue={aiEdits["bio_summary.values"]} onEdit={(v) => setAiEdit("bio_summary.values", v)} />
              ) : aiValues ? (
                <div className="text-sm text-slate-600 leading-relaxed mb-3 [&_p]:mb-2 [&_p:last-child]:mb-0" dangerouslySetInnerHTML={{ __html: aiValues }} />
              ) : null}
              {editMode ? (
                <div className="mt-3">
                  <Label className="text-xs text-slate-500 mb-1.5 block">Professional values (pick up to 5)</Label>
                  <MultiSelectTags options={PROFESSIONAL_VALUE_OPTIONS} selected={form.professional_values as string[]} onChange={(v) => update("professional_values", v)} max={5} />
                </div>
              ) : profile.professional_values && profile.professional_values.length > 0 ? (
                <div className="flex flex-wrap gap-1.5">
                  {profile.professional_values.map((value) => (
                    <Tag key={value} variant="violet">{value}</Tag>
                  ))}
                </div>
              ) : null}
            </div>
          )}

          {/* 4. What I Offer */}
          {(aiWhatIOffer || (profile.role_types_preferred && profile.role_types_preferred.length > 0) || editMode) && (
            <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
              <div className="flex items-center gap-2 mb-3">
                <Briefcase className="h-4 w-4 text-violet-400" />
                <h3 className="text-sm font-semibold text-slate-900">What I Offer</h3>
              </div>
              {editMode && aiWhatIOffer ? (
                <EditableSection html={aiWhatIOffer} editValue={aiEdits["bio_summary.what_i_offer"]} onEdit={(v) => setAiEdit("bio_summary.what_i_offer", v)} />
              ) : aiWhatIOffer ? (
                <div className="text-sm text-slate-600 leading-relaxed mb-3 [&_p]:mb-2 [&_p:last-child]:mb-0" dangerouslySetInnerHTML={{ __html: aiWhatIOffer }} />
              ) : null}
              {editMode ? (
                <div className="mt-3 space-y-3">
                  <div>
                    <Label className="text-xs text-slate-500 mb-1.5 block">Role types</Label>
                    <MultiSelectTags options={ROLE_TYPE_OPTIONS} selected={form.role_types_preferred} onChange={(v) => update("role_types_preferred", v)} />
                  </div>
                  <div>
                    <Label className="text-xs text-slate-500 mb-1.5 block">Level of support</Label>
                    <MultiSelectTags options={LEVEL_OF_SUPPORT_OPTIONS} selected={form.level_of_support_offered} onChange={(v) => update("level_of_support_offered", v)} />
                  </div>
                </div>
              ) : (
                <div className="flex flex-wrap gap-1.5">
                  {profile.role_types_preferred?.map((tag) => (
                    <Tag key={tag} variant="violet">{tag}</Tag>
                  ))}
                  {profile.level_of_support_offered?.map((s) => (
                    <Tag key={s} variant="violet">{s}</Tag>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* ═══════════════════════════════════════════════════════════════════
          EXPERIENCE TAB
         ═══════════════════════════════════════════════════════════════════ */}
      {activeTab === "experience" && (
        <div className="space-y-3">

          {/* 1. Experience */}
          <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
            <div className="flex items-center gap-2 mb-3">
              <Briefcase className="h-4 w-4 text-violet-400" />
              <h3 className="text-sm font-semibold text-slate-900">Experience</h3>
            </div>
            {editMode && aiExperience ? (
              <EditableSection html={aiExperience} editValue={aiEdits["experience_summary"]} onEdit={(v) => setAiEdit("experience_summary", v)} />
            ) : aiExperience ? (
              <div className="text-sm text-slate-600 leading-relaxed mb-4 [&_p]:mb-2 [&_p:last-child]:mb-0" dangerouslySetInnerHTML={{ __html: aiExperience }} />
            ) : !editMode && profile.total_experience_years ? (
              <div className="space-y-1 text-sm text-slate-600 mb-4">
                {profile.total_experience_years != null && <p>{profile.total_experience_years} years total childcare experience</p>}
              </div>
            ) : null}
            {editMode ? (
              <div className="mt-3 space-y-4">
                {(["total_experience_years", "under_3_experience_years", "newborn_experience_years"] as const).map((key) => {
                  const labels: Record<string, string> = {
                    total_experience_years: "Total Childcare Experience",
                    under_3_experience_years: "Under 3s Experience",
                    newborn_experience_years: "Newborn Experience",
                  };
                  return (
                    <div key={key}>
                      <div className="flex items-center justify-between mb-1">
                        <Label className="text-xs text-slate-500">{labels[key]}</Label>
                        <span className="text-xs font-medium text-violet-600">
                          {form[key] !== null ? (form[key]! >= 10 ? "10+" : `${form[key]}`) : "0"} years
                        </span>
                      </div>
                      <input
                        type="range"
                        min={0}
                        max={10}
                        step={1}
                        value={form[key] ?? 0}
                        onChange={(e) => update(key, parseInt(e.target.value))}
                        className="w-full h-2 bg-slate-200 rounded-full appearance-none cursor-pointer accent-violet-600 [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:h-4 [&::-webkit-slider-thumb]:w-4 [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-violet-600"
                      />
                    </div>
                  );
                })}
              </div>
            ) : statBoxes.length > 0 ? (
              <div className={cn(
                "grid gap-2.5",
                statBoxes.length === 1 && "grid-cols-1 max-w-[200px]",
                statBoxes.length === 2 && "grid-cols-2",
                statBoxes.length === 3 && "grid-cols-3",
              )}>
                {statBoxes.map((s) => (
                  <StatBox key={s.label} value={s.value} label={s.label} />
                ))}
              </div>
            ) : null}
          </div>

          {/* 2. Background */}
          <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
            <div className="flex items-center gap-2 mb-3">
              <CalendarCheck className="h-4 w-4 text-violet-400" />
              <h3 className="text-sm font-semibold text-slate-900">Background</h3>
            </div>
            {editMode && aiBackground ? (
              <EditableSection html={aiBackground} editValue={aiEdits["bio_summary.background"]} onEdit={(v) => setAiEdit("bio_summary.background", v)} />
            ) : aiBackground ? (
              <div className="text-sm text-slate-600 leading-relaxed mb-4 [&_p]:mb-2 [&_p:last-child]:mb-0" dangerouslySetInnerHTML={{ __html: aiBackground }} />
            ) : null}
            {editMode ? (
              <div className="mt-3 space-y-4">
                <div>
                  <Label className="text-xs text-slate-500 mb-1.5 block">Highest Qualification</Label>
                  <select
                    value={form.highest_qualification || ""}
                    onChange={(e) => update("highest_qualification", e.target.value || null)}
                    className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2.5 text-sm focus:border-violet-500 focus:ring-1 focus:ring-violet-500 outline-none"
                  >
                    <option value="">Select...</option>
                    {QUALIFICATION_OPTIONS.map((q) => <option key={q} value={q}>{q}</option>)}
                  </select>
                </div>
                <div>
                  <Label className="text-xs text-slate-500 mb-1.5 block">Childcare Roles</Label>
                  <div className="space-y-2">
                    {form.childcare_roles.map((role, idx) => (
                      <div key={idx} className="rounded-lg bg-slate-50 px-3 py-2 space-y-2">
                        <div className="flex items-center gap-2">
                          <select
                            value={role.role}
                            onChange={(e) => {
                              const updated = [...form.childcare_roles];
                              updated[idx] = { ...updated[idx], role: e.target.value, role_other: e.target.value === "Other" ? updated[idx].role_other : undefined };
                              update("childcare_roles", updated);
                            }}
                            className="flex-1 rounded-lg border border-slate-200 bg-white px-2 py-1.5 text-sm outline-none focus:border-violet-500"
                          >
                            <option value="">Select role...</option>
                            {CHILDCARE_ROLE_OPTIONS.map((o) => <option key={o} value={o}>{o}</option>)}
                          </select>
                          <div className="flex items-center gap-1.5 shrink-0">
                            <input
                              type="number"
                              min={0}
                              max={20}
                              value={role.duration}
                              onChange={(e) => {
                                const updated = [...form.childcare_roles];
                                updated[idx] = { ...updated[idx], duration: parseInt(e.target.value) || 0 };
                                update("childcare_roles", updated);
                              }}
                              className="w-14 rounded-lg border border-slate-200 bg-white px-2 py-1.5 text-sm text-center outline-none focus:border-violet-500"
                            />
                            <span className="text-xs text-slate-400">yrs</span>
                          </div>
                          {form.childcare_roles.length > 1 && (
                            <button
                              type="button"
                              onClick={() => update("childcare_roles", form.childcare_roles.filter((_, i) => i !== idx))}
                              className="p-1 rounded hover:bg-red-50 text-slate-300 hover:text-red-500 transition-colors"
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                            </button>
                          )}
                        </div>
                        {role.role === "Other" && (
                          <Input
                            value={role.role_other || ""}
                            onChange={(e) => {
                              const updated = [...form.childcare_roles];
                              updated[idx] = { ...updated[idx], role_other: e.target.value };
                              update("childcare_roles", updated);
                            }}
                            placeholder="Please specify the role..."
                            className="text-sm"
                          />
                        )}
                      </div>
                    ))}
                    <button
                      type="button"
                      onClick={() => update("childcare_roles", [...form.childcare_roles, { role: "", duration: 1 }])}
                      className="flex items-center gap-1.5 text-xs text-violet-600 hover:text-violet-700 font-medium"
                    >
                      <Plus className="h-3.5 w-3.5" /> Add role
                    </button>
                  </div>
                </div>
              </div>
            ) : (
              <>
                {profile.highest_qualification && (
                  <div className="flex items-start gap-2.5 rounded-lg bg-violet-50 border border-violet-100 px-3 py-2.5 mb-3">
                    <GraduationCap className="h-4 w-4 text-violet-500 mt-0.5 shrink-0" />
                    <span className="text-sm font-medium text-violet-700">{profile.highest_qualification}</span>
                  </div>
                )}
                {profile.childcare_roles && profile.childcare_roles.length > 0 && (
                  <div className="space-y-2">
                    {profile.childcare_roles.map((role, idx) => (
                      <div key={`${role.role}-${idx}`} className="flex items-center justify-between rounded-lg bg-slate-50 px-3 py-2.5">
                        <span className="text-sm font-medium text-slate-700">
                          {role.role === "Other" && (role as { role_other?: string }).role_other
                            ? (role as { role_other?: string }).role_other
                            : role.role}
                        </span>
                        <span className="text-xs text-slate-500">{role.duration} {role.duration === 1 ? "year" : "years"}</span>
                      </div>
                    ))}
                  </div>
                )}
              </>
            )}
          </div>

          {/* 3. Safety & Assurance */}
          {(() => {
            const CERT_ORDER = [
              "First Aid in Education & Care Setting",
              "First Aid",
              "CPR",
              "Child Protection",
            ];
            const currentCerts = editMode ? form.certificates : profile.certificates;
            const orderedCerts = CERT_ORDER.filter((c) => currentCerts.includes(c));
            const otherCerts = currentCerts.filter((c) => !CERT_ORDER.includes(c));
            const currentVax = editMode ? form.vaccination_status : profile.vaccination_status;
            const currentNonSmoker = editMode ? form.non_smoker : profile.non_smoker;
            const showDbsGlance = showsEnhancedDbsBadge(profile.verification_level);
            const hasItems = showDbsGlance || orderedCerts.length > 0 || otherCerts.length > 0 || currentVax || currentNonSmoker || editMode;
            if (!hasItems) return null;
            return (
              <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
                <div className="flex items-center gap-2 mb-3">
                  <ShieldCheck className="h-4 w-4 text-violet-400" />
                  <h3 className="text-sm font-semibold text-slate-900">Safety & Assurance</h3>
                </div>
                {editMode ? (
                  <div className="space-y-4">
                    <div>
                      <Label className="text-xs text-slate-500 mb-1.5 block">Certificates</Label>
                      <MultiSelectTags options={CERTIFICATE_OPTIONS} selected={form.certificates} onChange={(v) => update("certificates", v)} />
                    </div>
                    <div>
                      <Label className="text-xs text-slate-500 mb-1.5 block">Assurances</Label>
                      <MultiSelectTags options={ASSURANCE_OPTIONS} selected={form.assurances} onChange={(v) => update("assurances", v)} />
                    </div>
                    <div className="grid grid-cols-2 gap-4">
                      <div>
                        <Label className="text-xs text-slate-500 mb-1.5 block">Fully Vaccinated</Label>
                        <BooleanTags value={form.vaccination_status} onChange={(v) => update("vaccination_status", v)} />
                      </div>
                      <div>
                        <Label className="text-xs text-slate-500 mb-1.5 block">Non-Smoker</Label>
                        <BooleanTags value={form.non_smoker} onChange={(v) => update("non_smoker", v)} />
                      </div>
                    </div>
                  </div>
                ) : (
                  <div className="grid grid-cols-2 gap-2">
                    {showDbsGlance && (
                      <GlanceItem icon={ShieldCheck} label="Enhanced DBS" variant="green" />
                    )}
                    {orderedCerts.map((cert) => (
                      <GlanceItem key={cert} icon={Award} label={cert} variant="green" />
                    ))}
                    {otherCerts.map((cert) => (
                      <GlanceItem key={cert} icon={Award} label={cert} variant="green" />
                    ))}
                    {currentVax && <GlanceItem icon={Stethoscope} label="Fully Vaccinated" variant="green" />}
                    {currentNonSmoker && <GlanceItem icon={CigaretteOff} label="Non-Smoker" variant="green" />}
                  </div>
                )}
              </div>
            );
          })()}

          {/* 4. Good to Know */}
          <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
            <div className="flex items-center gap-2 mb-4">
              <ThumbsUp className="h-4 w-4 text-violet-400" />
              <h3 className="text-sm font-semibold text-slate-900">Good to Know</h3>
            </div>
            {editMode ? (
              <div className="space-y-4">
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <Label className="text-xs text-slate-500 mb-1.5 block">Min Child Age</Label>
                    <select
                      value={form.min_child_age_months ?? ""}
                      onChange={(e) => update("min_child_age_months", e.target.value ? parseInt(e.target.value) : null)}
                      className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm focus:border-violet-500 focus:ring-1 focus:ring-violet-500 outline-none"
                    >
                      <option value="">Any</option>
                      {MIN_AGE_OPTIONS.map((o) => <option key={o.months} value={o.months}>{o.label}</option>)}
                    </select>
                  </div>
                  <div>
                    <Label className="text-xs text-slate-500 mb-1.5 block">Max Child Age</Label>
                    <select
                      value={form.max_child_age_months ?? ""}
                      onChange={(e) => update("max_child_age_months", e.target.value ? parseInt(e.target.value) : null)}
                      className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm focus:border-violet-500 focus:ring-1 focus:ring-violet-500 outline-none"
                    >
                      <option value="">Any</option>
                      {MAX_AGE_OPTIONS.map((o) => <option key={o.months} value={o.months}>{o.label}</option>)}
                    </select>
                  </div>
                </div>
                <div>
                  <Label className="text-xs text-slate-500 mb-1.5 block">Max Children</Label>
                  <SingleSelectTags options={["1", "2", "3"]} value={form.max_children != null ? String(form.max_children) : null} onChange={(v) => update("max_children", parseInt(v))} />
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <Label className="text-xs text-slate-500 mb-1.5 block">Additional Needs</Label>
                    <BooleanTags value={form.additional_needs_ok} onChange={(v) => update("additional_needs_ok", v)} />
                  </div>
                  <div>
                    <Label className="text-xs text-slate-500 mb-1.5 block">Comfortable with Pets</Label>
                    <BooleanTags value={form.comfortable_with_pets} onChange={(v) => update("comfortable_with_pets", v)} />
                  </div>
                  <div>
                    <Label className="text-xs text-slate-500 mb-1.5 block">Driver&apos;s License</Label>
                    <BooleanTags value={form.drivers_license} onChange={(v) => update("drivers_license", v)} />
                  </div>
                  <div>
                    <Label className="text-xs text-slate-500 mb-1.5 block">Access to Car</Label>
                    <BooleanTags value={form.has_car} onChange={(v) => update("has_car", v)} />
                  </div>
                </div>
                <div>
                  <Label className="text-xs text-slate-500 mb-1.5 block">Hourly Rate ($)</Label>
                  <Input
                    type="number"
                    min={25}
                    step={0.25}
                    value={form.hourly_rate_min ?? ""}
                    onChange={(e) => update("hourly_rate_min", e.target.value ? parseFloat(e.target.value) : null)}
                    className="max-w-[200px]"
                  />
                </div>
                <div>
                  <Label className="text-xs text-slate-500 mb-1.5 block">Languages</Label>
                  <MultiSelectTags options={LANGUAGE_OPTIONS} selected={form.languages} onChange={(v) => update("languages", v)} />
                  {(form.languages.includes("Foreign Language") || form.languages.includes("Multiple")) && (
                    <div className="mt-2">
                      <Input
                        value={form.language_details}
                        onChange={(e) => update("language_details", e.target.value)}
                        placeholder={form.languages.includes("Multiple") ? "e.g. Mandarin, French, Spanish" : "e.g. Mandarin"}
                        className="text-sm"
                      />
                      <p className="text-xs text-slate-400 mt-1">Please specify which language(s)</p>
                    </div>
                  )}
                </div>
              </div>
            ) : (
              <>
                <h4 className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-2">Best with supporting</h4>
                <div className="grid grid-cols-2 gap-2 mb-4">
                  {profile.min_child_age_months != null && profile.max_child_age_months != null && (
                    <GlanceItem icon={Baby} label={ageRangeToFriendly(profile.min_child_age_months, profile.max_child_age_months)} />
                  )}
                  {profile.max_children != null && (
                    <GlanceItem icon={Users} label={childrenCountLabel(profile.max_children)} />
                  )}
                </div>
                {(profile.additional_needs_ok || profile.comfortable_with_pets) && (
                  <>
                    <h4 className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-2">Can support</h4>
                    <div className="grid grid-cols-2 gap-2 mb-4">
                      {profile.additional_needs_ok && <GlanceItem icon={Accessibility} label="Children with additional needs" />}
                      {profile.comfortable_with_pets && <GlanceItem icon={PawPrint} label="Families with pets" />}
                    </div>
                  </>
                )}
                {(profile.drivers_license || profile.has_car) && (
                  <>
                    <h4 className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-2">Additionally</h4>
                    <div className="grid grid-cols-2 gap-2">
                      {profile.drivers_license && <GlanceItem icon={Car} label="I have my driver's license" />}
                      {profile.has_car && <GlanceItem icon={Car} label="I have my own car" />}
                    </div>
                  </>
                )}
              </>
            )}
          </div>
        </div>
      )}

      {/* ═══════════════════════════════════════════════════════════════════
          AVAILABILITY TAB
         ═══════════════════════════════════════════════════════════════════ */}
      {activeTab === "availability" && (
        <div className="space-y-3">
          <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-2">
                <Clock className="h-4 w-4 text-violet-400" />
                <h3 className="text-sm font-semibold text-slate-900">Availability</h3>
              </div>
              {!editMode && profile.immediate_start_available && (
                <span className="inline-flex items-center gap-1.5 rounded-full bg-green-50 border border-green-200 px-2.5 py-1 text-xs font-medium text-green-700">
                  <CalendarCheck className="h-3 w-3" /> Can start immediately
                </span>
              )}
            </div>
            {editMode ? (
              <div className="space-y-4">
                <div>
                  <p className="text-xs text-slate-400 mb-2">Click cells to toggle availability</p>
                  <EditableAvailabilityGrid
                    form={{ available_days: form.available_days, schedule: form.schedule }}
                    update={(key, value) => {
                      if (key === "available_days") update("available_days", value as string[]);
                      else update("schedule", value as Record<string, string[]>);
                    }}
                  />
                </div>
                <div className="border-t border-slate-100 pt-4">
                  <div>
                    <Label className="text-xs text-slate-500 mb-1.5 block">Immediate Start Available?</Label>
                    <BooleanTags value={form.immediate_start_available} onChange={(v) => update("immediate_start_available", v)} />
                  </div>
                </div>
              </div>
            ) : profile.availability?.schedule && Object.keys(profile.availability.schedule).length > 0 ? (
              <AvailabilityGrid schedule={profile.availability.schedule} firstName={profile.first_name} />
            ) : (
              <p className="text-sm text-slate-400 italic">Availability not set yet.</p>
            )}
          </div>
        </div>
      )}

      {/* ── Error display ── */}
      {error && !editMode && (
        <p className="text-sm text-red-500 text-center">{error}</p>
      )}

      {/* ═══════════════════════════════════════════════════════════════════
          STICKY SAVE / DISCARD BANNER
         ═══════════════════════════════════════════════════════════════════ */}
      {editMode && (
        <div className="fixed bottom-0 left-0 right-0 z-50 border-t border-slate-200 bg-white/95 backdrop-blur-sm shadow-[0_-4px_12px_rgba(0,0,0,0.06)]">
          <div className="mx-auto max-w-2xl flex items-center justify-between px-5 py-3">
            <div className="flex items-center gap-2 text-sm">
              {saveStatus === "saved" && (
                <>
                  <CheckCircle className="h-4 w-4 text-green-500" />
                  <span className="text-green-600 font-medium">Saved</span>
                </>
              )}
              {saveStatus === "error" && <span className="text-red-500 text-xs">{error}</span>}
            </div>
            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={handleDiscard}
                className="text-slate-500"
              >
                Discard Changes
              </Button>
              <Button
                size="sm"
                onClick={handleSave}
                disabled={isPending || saveStatus === "saving"}
                className="bg-violet-600 hover:bg-violet-700 text-white"
              >
                {saveStatus === "saving" ? (
                  <><Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />Saving...</>
                ) : (
                  "Save"
                )}
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* Regenerate offer dialog — shown after saving */}
      <Dialog open={showRegenOffer} onOpenChange={setShowRegenOffer}>
        <DialogContent className="sm:max-w-md">
          <DialogTitle className="text-lg font-semibold text-slate-900 flex items-center gap-2">
            <CheckCircle className="h-5 w-5 text-green-500" />
            Changes Saved
          </DialogTitle>
          <DialogDescription className="text-sm text-slate-600 leading-relaxed">
            Would you like us to regenerate your AI profile to reflect your updated information?
            <span className="block mt-2 text-xs text-slate-400">
              Note: you can only regenerate once per day.
            </span>
          </DialogDescription>
          <div className="flex justify-end gap-2 mt-4">
            <Button variant="outline" size="sm" onClick={() => setShowRegenOffer(false)}>
              Maybe Later
            </Button>
            <Button
              size="sm"
              onClick={handleRegenerate}
              className="bg-violet-600 hover:bg-violet-700 text-white"
            >
              <RefreshCw className="mr-1.5 h-3.5 w-3.5" /> Yes, Regenerate
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Regeneration progress modal — non-closable */}
      <Dialog open={regenModalOpen} onOpenChange={() => {}}>
        <DialogContent
          className="sm:max-w-sm [&>button]:hidden"
          onPointerDownOutside={(e: Event) => e.preventDefault()}
          onEscapeKeyDown={(e: Event) => e.preventDefault()}
        >
          <DialogTitle className="sr-only">Regenerating Profile</DialogTitle>
          <DialogDescription className="sr-only">Please wait while we regenerate your profile</DialogDescription>

          {regenResult === "pending" && (
            <div className="flex flex-col items-center py-8 gap-5">
              <div className="relative h-16 w-16">
                <div className="absolute inset-0 rounded-full border-4 border-violet-100" />
                <div className="absolute inset-0 rounded-full border-4 border-violet-500 border-t-transparent animate-spin" />
                <Sparkles className="absolute inset-0 m-auto h-6 w-6 text-violet-500" />
              </div>
              <div className="text-center space-y-1">
                <h3 className="text-base font-semibold text-slate-900">Regenerating Your Profile</h3>
                <p className="text-sm text-violet-600 min-h-[20px] transition-opacity duration-300">
                  {REGEN_STEPS[regenStepIndex]}
                </p>
              </div>
            </div>
          )}

          {regenResult === "success" && (
            <div className="flex flex-col items-center py-8 gap-5">
              <div className="h-16 w-16 rounded-full bg-green-50 flex items-center justify-center">
                <CheckCircle className="h-8 w-8 text-green-500" />
              </div>
              <div className="text-center space-y-1">
                <h3 className="text-base font-semibold text-slate-900">Profile Regenerated!</h3>
                <p className="text-sm text-slate-500">Your profile has been updated with fresh content.</p>
              </div>
            </div>
          )}

          {regenResult === "error" && (
            <div className="flex flex-col items-center py-8 gap-5">
              <div className="h-16 w-16 rounded-full bg-red-50 flex items-center justify-center">
                <AlertTriangle className="h-8 w-8 text-red-400" />
              </div>
              <div className="text-center space-y-1">
                <h3 className="text-base font-semibold text-slate-900">Unable to Regenerate</h3>
                <p className="text-sm text-slate-500">{regenErrorMsg}</p>
              </div>
              <Button
                size="sm"
                variant="outline"
                onClick={() => setRegenModalOpen(false)}
              >
                Close
              </Button>
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* Photo viewer */}
      <ProfilePhotoViewer
        photos={additionalPhotos}
        open={photoViewerOpen}
        index={photoViewerIndex}
        firstName={profile.first_name}
        onClose={() => setPhotoViewerOpen(false)}
        onIndexChange={setPhotoViewerIndex}
      />
    </div>
  );
}
