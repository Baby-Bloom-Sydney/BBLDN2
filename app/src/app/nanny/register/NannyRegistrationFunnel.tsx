"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { FunnelProgress } from "@/components/ui/funnel-progress";
import { StepIntro } from "./steps/StepIntro";
import { StepExperience } from "./steps/StepExperience";
import { StepQualifications } from "./steps/StepQualifications";
import { StepPreferences } from "./steps/StepPreferences";
import { StepAvailability } from "./steps/StepAvailability";
import { StepSalary } from "./steps/StepSalary";
import { StepHelpfulInfo } from "./steps/StepHelpfulInfo";
import { StepResidency } from "./steps/StepResidency";
import { StepAboutYou } from "./steps/StepAboutYou";
import { StepReview } from "./steps/StepReview";
import { createNannyProfile, CreateNannyProfileData } from "@/lib/actions/nanny";
import { HOURLY_RATE_BOUNDS } from "@/lib/constants";
import { isLiveMode } from "@/components/dev/DevToolbar";
import { DevPrefill } from "@/components/dev/DevPrefill";

const isDevMode = process.env.NEXT_PUBLIC_DEV_MODE === 'true';

// ── Data interface: matches Wix "Nanny Applications" form exactly ──

export interface NannyRegistrationData {
  // Step 2 — Childcare Experience
  total_experience: string | null;         // "0"–"10+"
  nanny_experience: string | null;         // "0"–"10+"
  under_3_experience: string | null;       // "0"–"10+"
  newborn_experience: string | null;       // "0"–"10+"
  experience_details: string | null;       // free-text

  // Step 3 — Qualifications
  highest_qualification: string | null;    // dropdown value
  assurances: string[];                    // multi-select tags
  certificates: string[];                  // multi-select tags

  // Step 4 — Nannying Preferences
  role_types: string[];                    // multi-select tags
  level_of_support: string[];              // multi-select tags
  max_children: number | null;             // 1 | 2 | 3
  min_age: string | null;                  // tag value
  max_age: string | null;                  // tag value
  additional_needs: boolean | null;        // Yes / No

  // Step 5 — Availability
  available_days: string[];                // multi-select day tags
  monday_times: string[];
  tuesday_times: string[];
  wednesday_times: string[];
  thursday_times: string[];
  friday_times: string[];
  saturday_times: string[];
  sunday_times: string[];
  immediate_start: string | null;          // "Yes" | "At a later date"
  start_date: string | null;              // ISO date (if "At a later date")
  placement_ongoing: string | null;        // "Yes" | "Until a certain date"
  end_date: string | null;                // ISO date (if "Until a certain date")

  // Step 6 — Salary Expectations
  hourly_rate_min: string | null;          // "£15" | "£20" | "£25" | "£30"
  pay_frequency: string[];                 // multi-select tags

  // Step 7 — Helpful Information
  date_of_birth: string | null;            // ISO date
  languages: string[];                     // multi-select tags
  other_languages: string | null;          // free-text
  drivers_license: boolean | null;
  has_car: boolean | null;
  comfortable_with_pets: boolean | null;
  vaccination_status: boolean | null;
  non_smoker: boolean | null;

  // Step 8 — Residency Details
  nationality: string | null;              // dropdown
  residency_status: string | null;         // tag value (if not Australian)
  right_to_work: boolean | null;
  sydney_resident: boolean | null;
  suburb: string | null;
  postcode: string | null;

  // Step 9 — About You
  hobbies_interests: string | null;
  strengths_traits: string | null;
  skills_training: string | null;
  profile_picture_url: string | null;
  accuracy_confirmed: boolean;
}

export interface StepProps {
  data: Partial<NannyRegistrationData>;
  updateData: (data: Partial<NannyRegistrationData>) => void;
  goNext: () => void;
  goBack: () => void;
  isFirstStep?: boolean;
}

// ── Dev mock data ──

const DEV_MOCK_DATA: Partial<NannyRegistrationData> = {
  // Step 2
  total_experience: "5",
  nanny_experience: "3",
  under_3_experience: "2",
  newborn_experience: "1",
  experience_details: "Creche Worker at Little Stars (2 years), Early Childhood Educator at Bright Horizons (3 years)",
  // Step 3
  highest_qualification: "Certificate III in Early Childhood Education and Care",
  assurances: ["National Police Check", "References"],
  certificates: ["CPR", "First Aid", "Child Protection"],
  // Step 4
  role_types: ["Mothers Help", "Child Development"],
  level_of_support: ["Engagement and Play", "Educational Support"],
  max_children: 2,
  min_age: "Newborn",
  max_age: "5 years",
  additional_needs: true,
  // Step 5
  available_days: ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday"],
  monday_times: ["Morning (6am-10am)", "Midday (10am-2pm)", "Afternoon (2pm-6pm)"],
  tuesday_times: ["Morning (6am-10am)", "Midday (10am-2pm)", "Afternoon (2pm-6pm)"],
  wednesday_times: ["Morning (6am-10am)", "Midday (10am-2pm)"],
  thursday_times: ["Morning (6am-10am)", "Midday (10am-2pm)", "Afternoon (2pm-6pm)"],
  friday_times: ["Morning (6am-10am)", "Midday (10am-2pm)", "Afternoon (2pm-6pm)"],
  saturday_times: [],
  sunday_times: [],
  immediate_start: "Yes",
  start_date: null,
  placement_ongoing: "Yes",
  end_date: null,
  // Step 6
  hourly_rate_min: `£${HOURLY_RATE_BOUNDS.min.toFixed(2)}`,
  pay_frequency: ["Weekly"],
  // Step 7
  date_of_birth: "1998-03-15",
  languages: ["English", "Foreign Language"],
  other_languages: "French",
  drivers_license: true,
  has_car: true,
  comfortable_with_pets: true,
  vaccination_status: true,
  non_smoker: true,
  // Step 8
  nationality: "Australian",
  residency_status: null,
  right_to_work: true,
  sydney_resident: true,
  suburb: "Clapham",
  postcode: "SW4",
  // Step 9
  hobbies_interests: "Swimming, reading, arts and crafts, bushwalking, yoga",
  strengths_traits: "Patient, creative, reliable, strong communicator, great with routines",
  skills_training: "Certificate III in Early Childhood Education, infant sleep training techniques, Montessori-inspired activities",
  profile_picture_url: null,
  accuracy_confirmed: true,
};

// ── Step definitions (matches Wix form pages) ──

const STEPS = [
  { id: "intro", label: "Start" },
  { id: "experience", label: "Experience" },
  { id: "qualifications", label: "Qualifications" },
  { id: "preferences", label: "Preferences" },
  { id: "availability", label: "Availability" },
  { id: "salary", label: "Salary" },
  { id: "helpful-info", label: "Details" },
  { id: "residency", label: "Residency" },
  { id: "about-you", label: "About You" },
  { id: "review", label: "Review" },
];

interface NannyRegistrationFunnelProps {
  userId: string;
  initialData?: {
    first_name?: string;
    last_name?: string;
    email?: string;
  };
}

export function NannyRegistrationFunnel({ initialData }: NannyRegistrationFunnelProps) {
  const router = useRouter();
  const [currentStep, setCurrentStep] = useState(0);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const defaultData: Partial<NannyRegistrationData> = isDevMode
    ? { ...DEV_MOCK_DATA }
    : {
        available_days: [],
        monday_times: [],
        tuesday_times: [],
        wednesday_times: [],
        thursday_times: [],
        friday_times: [],
        saturday_times: [],
        sunday_times: [],
        assurances: [],
        certificates: [],
        role_types: [],
        level_of_support: [],
        pay_frequency: [],
        languages: [],
        accuracy_confirmed: false,
      };

  const [formData, setFormData] = useState<Partial<NannyRegistrationData>>(defaultData);

  const goNext = () => setCurrentStep((s) => Math.min(s + 1, STEPS.length - 1));
  const goBack = () => setCurrentStep((s) => Math.max(s - 1, 0));

  const updateData = (stepData: Partial<NannyRegistrationData>) => {
    setFormData((prev) => ({ ...prev, ...stepData }));
  };

  // Convert age display strings (e.g. "Newborn", "3 months", "5 years") to integer months
  function ageStringToMonths(s: string | null | undefined): number | null {
    if (!s) return null;
    if (s === "Newborn") return 0;
    const monthMatch = s.match(/^(\d+)\s*months?$/i);
    if (monthMatch) return parseInt(monthMatch[1]);
    const yearMatch = s.match(/^(\d+)\s*years?$/i);
    if (yearMatch) return parseInt(yearMatch[1]) * 12;
    return null;
  }

  // Build JSONB schedule object from per-day time arrays
  function buildSchedule(fd: Partial<NannyRegistrationData>): Record<string, string[]> {
    const schedule: Record<string, string[]> = {};
    const dayFields = {
      monday: 'monday_times', tuesday: 'tuesday_times', wednesday: 'wednesday_times',
      thursday: 'thursday_times', friday: 'friday_times', saturday: 'saturday_times',
      sunday: 'sunday_times',
    } as const;
    for (const [day, field] of Object.entries(dayFields)) {
      const times = fd[field as keyof NannyRegistrationData] as string[] | undefined;
      if (times && times.length > 0) schedule[day] = times;
    }
    return schedule;
  }

  // Transform form data → server action format
  function toCreateData(fd: Partial<NannyRegistrationData>): CreateNannyProfileData {
    const parseRate = (s: string | null | undefined): number | null => {
      if (!s) return null;
      const n = parseFloat(s.replace("£", ""));
      return isNaN(n) ? null : n;
    };

    return {
      first_name: initialData?.first_name || "",
      last_name: initialData?.last_name || "",
      date_of_birth: fd.date_of_birth ?? null,
      suburb: fd.suburb || "",
      postcode: fd.postcode || "",
      profile_picture_url: fd.profile_picture_url ?? null,

      nationality: fd.nationality ?? null,
      languages: fd.languages ?? [],

      total_experience_years: fd.total_experience ? parseInt(fd.total_experience) || 0 : null,
      nanny_experience_years: fd.nanny_experience ? parseInt(fd.nanny_experience) || 0 : null,
      under_3_experience_years: fd.under_3_experience ? parseInt(fd.under_3_experience) || 0 : null,
      newborn_experience_years: fd.newborn_experience ? parseInt(fd.newborn_experience) || 0 : null,
      experience_details: fd.experience_details ?? null,

      role_types_preferred: fd.role_types ?? [],
      level_of_support_offered: fd.level_of_support ?? [],

      hourly_rate_min: parseRate(fd.hourly_rate_min),
      pay_frequency: fd.pay_frequency ?? [],
      immediate_start_available: fd.immediate_start === "Yes",
      placement_ongoing_preferred: fd.placement_ongoing === "Yes",
      start_date_earliest: fd.start_date ?? null,
      end_date_latest: fd.end_date ?? null,

      max_children: fd.max_children ?? null,
      min_child_age_months: ageStringToMonths(fd.min_age),
      max_child_age_months: ageStringToMonths(fd.max_age),
      additional_needs_ok: fd.additional_needs ?? false,

      sydney_resident: fd.sydney_resident ?? false,
      residency_status: fd.residency_status ?? null,
      right_to_work: fd.right_to_work ?? false,
      drivers_license: fd.drivers_license ?? false,
      has_car: fd.has_car ?? false,
      comfortable_with_pets: fd.comfortable_with_pets ?? false,
      vaccination_status: fd.vaccination_status ?? false,
      non_smoker: fd.non_smoker ?? false,

      hobbies_interests: fd.hobbies_interests ?? null,
      strengths_traits: fd.strengths_traits ?? null,
      skills_training: fd.skills_training ?? null,

      highest_qualification: fd.highest_qualification ?? null,
      certificates: fd.certificates ?? [],
      assurances: fd.assurances ?? [],
      available_days: fd.available_days ?? [],
      schedule: buildSchedule(fd),
    };
  }

  const handleComplete = async () => {
    if (isDevMode && !isLiveMode()) {
      router.push("/nanny/profile");
      return;
    }

    setIsSubmitting(true);
    setError(null);

    const result = await createNannyProfile(toCreateData(formData));

    if (result.success) {
      router.push("/nanny/profile");
    } else {
      setError(result.error || "Failed to create profile");
      setIsSubmitting(false);
    }
  };

  const stepProps: StepProps = {
    data: formData,
    updateData,
    goNext,
    goBack,
    isFirstStep: currentStep === 0,
  };

  return (
    <div className="mx-auto max-w-3xl">
      <FunnelProgress currentStep={currentStep} steps={STEPS} />

      {error && (
        <div className="mb-4 rounded-lg bg-red-50 p-4 text-red-600">
          {error}
        </div>
      )}

      {currentStep === 0 && <StepIntro {...stepProps} />}
      {currentStep === 1 && <StepExperience {...stepProps} />}
      {currentStep === 2 && <StepQualifications {...stepProps} />}
      {currentStep === 3 && <StepPreferences {...stepProps} />}
      {currentStep === 4 && <StepAvailability {...stepProps} />}
      {currentStep === 5 && <StepSalary {...stepProps} />}
      {currentStep === 6 && <StepHelpfulInfo {...stepProps} />}
      {currentStep === 7 && <StepResidency {...stepProps} />}
      {currentStep === 8 && <StepAboutYou {...stepProps} />}
      {currentStep === 9 && (
        <StepReview
          {...stepProps}
          onComplete={handleComplete}
          isSubmitting={isSubmitting}
        />
      )}

      <DevPrefill onPrefill={() => setFormData({ ...DEV_MOCK_DATA })} />
    </div>
  );
}
