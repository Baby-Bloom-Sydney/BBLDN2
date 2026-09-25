"use client";

import {
  User,
  Briefcase,
  Calendar,
  PoundSterling,
  MapPin,
  Info,
  Globe,
  Heart,
  Check,
  X,
  Loader2,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { StepProps } from "../NannyRegistrationFunnel";

interface ReviewProps extends StepProps {
  onComplete: () => Promise<void>;
  isSubmitting: boolean;
}

function BooleanBadge({ value }: { value: boolean | null | undefined }) {
  if (value === true) {
    return (
      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-green-100 text-green-700 text-xs font-medium">
        <Check className="h-3 w-3" /> Yes
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-slate-100 text-slate-500 text-xs font-medium">
      <X className="h-3 w-3" /> No
    </span>
  );
}

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  if (value === null || value === undefined || value === "") return null;
  // Also skip arrays that are empty
  if (Array.isArray(value) && value.length === 0) return null;
  return (
    <div className="flex justify-between items-start gap-2 py-1 text-sm">
      <span className="text-slate-500 shrink-0">{label}</span>
      <span className="text-slate-800 text-right font-medium">{value}</span>
    </div>
  );
}

function SectionCard({
  icon: Icon,
  title,
  children,
}: {
  icon: React.ElementType;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-lg border border-slate-200 p-4 space-y-1">
      <div className="flex items-center gap-2 mb-2">
        <Icon className="h-4 w-4 text-violet-600" />
        <h3 className="text-sm font-semibold text-slate-700">{title}</h3>
      </div>
      {children}
    </div>
  );
}

function truncate(str: string | undefined | null, len = 80): string {
  if (!str) return "";
  return str.length > len ? str.slice(0, len) + "..." : str;
}

function formatDayTimes(
  days: string[] | undefined,
  timesMap: Record<string, string[] | undefined>
): string {
  if (!days || days.length === 0) return "None selected";
  const parts = days.map((day) => {
    const times = timesMap[day.toLowerCase()];
    if (!times || times.length === 0) return day;
    // Abbreviate time slots
    const abbrevs = times.map((t) =>
      t.includes("Morning")
        ? "AM"
        : t.includes("Midday")
        ? "Mid"
        : t.includes("Afternoon")
        ? "PM"
        : t.includes("Evening")
        ? "Eve"
        : t
    );
    return `${day.slice(0, 3)}: ${abbrevs.join(", ")}`;
  });
  return parts.join(" | ");
}

export function StepReview({ data, goBack, onComplete, isSubmitting }: ReviewProps) {
  const timesMap: Record<string, string[] | undefined> = {
    monday: data.monday_times,
    tuesday: data.tuesday_times,
    wednesday: data.wednesday_times,
    thursday: data.thursday_times,
    friday: data.friday_times,
    saturday: data.saturday_times,
    sunday: data.sunday_times,
  };

  return (
    <Card className="w-full max-w-2xl mx-auto">
      <CardHeader>
        <CardTitle className="text-2xl font-bold text-center text-slate-800">
          Review Your Application
        </CardTitle>
        <p className="text-center text-sm text-slate-500 mt-1">
          Check everything looks correct before submitting.
        </p>
      </CardHeader>
      <CardContent className="space-y-4">

        {/* AI bio info box */}
        <div className="flex gap-3 p-4 rounded-lg bg-violet-50 border border-violet-200">
          <Info className="h-5 w-5 text-violet-600 shrink-0 mt-0.5" />
          <p className="text-sm text-violet-800">
            After you complete registration, we&apos;ll generate a professional bio for your profile using AI. You can edit it anytime.
          </p>
        </div>

        {/* Experience */}
        <SectionCard icon={Briefcase} title="Experience">
          <Row label="Total experience" value={data.total_experience} />
          <Row label="Nanny experience" value={data.nanny_experience} />
          <Row label="Under 3 experience" value={data.under_3_experience} />
          <Row label="Newborn experience" value={data.newborn_experience} />
          <Row label="Experience details" value={truncate(data.experience_details)} />
        </SectionCard>

        {/* Qualifications */}
        <SectionCard icon={User} title="Qualifications">
          <Row label="Highest qualification" value={data.highest_qualification} />
          <Row label="Assurances" value={data.assurances?.join(", ")} />
          <Row label="Certificates" value={data.certificates?.join(", ")} />
        </SectionCard>

        {/* Preferences */}
        <SectionCard icon={Heart} title="Preferences">
          <Row label="Role types" value={data.role_types?.join(", ")} />
          <Row label="Support levels" value={data.level_of_support?.join(", ")} />
          <Row label="Max children" value={data.max_children} />
          <Row
            label="Child age range"
            value={
              data.min_age || data.max_age
                ? [data.min_age, data.max_age].filter(Boolean).join(" – ")
                : undefined
            }
          />
          <Row
            label="Additional needs"
            value={
              data.additional_needs !== null && data.additional_needs !== undefined ? (
                <BooleanBadge value={data.additional_needs} />
              ) : undefined
            }
          />
        </SectionCard>

        {/* Availability */}
        <SectionCard icon={Calendar} title="Availability">
          <Row
            label="Days & times"
            value={formatDayTimes(data.available_days, timesMap)}
          />
          <Row label="Immediate start" value={data.immediate_start} />
          {data.immediate_start === "At a later date" && (
            <Row label="Start date" value={data.start_date} />
          )}
          <Row label="Ongoing placement" value={data.placement_ongoing} />
          {data.placement_ongoing === "Until a certain date" && (
            <Row label="End date" value={data.end_date} />
          )}
        </SectionCard>

        {/* Salary */}
        <SectionCard icon={PoundSterling} title="Salary">
          <Row label="Minimum hourly rate" value={data.hourly_rate_min} />
          <Row label="Pay frequency" value={data.pay_frequency?.join(", ")} />
        </SectionCard>

        {/* Details */}
        <SectionCard icon={Info} title="Details">
          <Row label="Date of birth" value={data.date_of_birth} />
          <Row label="Languages" value={data.languages?.join(", ")} />
          <Row label="Other languages" value={data.other_languages} />
          <Row
            label="Driver's license"
            value={
              data.drivers_license !== null && data.drivers_license !== undefined ? (
                <BooleanBadge value={data.drivers_license} />
              ) : undefined
            }
          />
          <Row
            label="Has car"
            value={
              data.has_car !== null && data.has_car !== undefined ? (
                <BooleanBadge value={data.has_car} />
              ) : undefined
            }
          />
          <Row
            label="Comfortable with pets"
            value={
              data.comfortable_with_pets !== null && data.comfortable_with_pets !== undefined ? (
                <BooleanBadge value={data.comfortable_with_pets} />
              ) : undefined
            }
          />
          <Row
            label="Vaccinated"
            value={
              data.vaccination_status !== null && data.vaccination_status !== undefined ? (
                <BooleanBadge value={data.vaccination_status} />
              ) : undefined
            }
          />
          <Row
            label="Non-smoker"
            value={
              data.non_smoker !== null && data.non_smoker !== undefined ? (
                <BooleanBadge value={data.non_smoker} />
              ) : undefined
            }
          />
        </SectionCard>

        {/* Residency */}
        <SectionCard icon={Globe} title="Residency">
          <Row label="Nationality" value={data.nationality} />
          <Row label="Residency status" value={data.residency_status} />
          <Row
            label="Right to work"
            value={
              data.right_to_work !== null && data.right_to_work !== undefined ? (
                <BooleanBadge value={data.right_to_work} />
              ) : undefined
            }
          />
          <Row
            label="Sydney resident"
            value={
              data.sydney_resident !== null && data.sydney_resident !== undefined ? (
                <BooleanBadge value={data.sydney_resident} />
              ) : undefined
            }
          />
          {data.sydney_resident && (
            <>
              <Row label="Area" value={data.suburb} />
              <Row label="Postcode" value={data.postcode} />
            </>
          )}
        </SectionCard>

        {/* About You */}
        <SectionCard icon={MapPin} title="About You">
          {data.profile_picture_url && (
            <div className="flex items-center justify-between py-1 text-sm">
              <span className="text-slate-500">Photo</span>
              <span className="text-green-600 font-medium flex items-center gap-1">
                <Check className="h-3 w-3" /> Uploaded
              </span>
            </div>
          )}
          <Row label="Hobbies" value={truncate(data.hobbies_interests)} />
          <Row label="Strengths" value={truncate(data.strengths_traits)} />
          <Row label="Skills" value={truncate(data.skills_training)} />
          <Row
            label="Info confirmed"
            value={<BooleanBadge value={data.accuracy_confirmed} />}
          />
        </SectionCard>

        {/* Navigation */}
        <div className="flex gap-3 pt-2">
          <Button
            type="button"
            variant="outline"
            onClick={goBack}
            disabled={isSubmitting}
            className="flex-1"
          >
            Back
          </Button>
          <Button
            type="button"
            onClick={onComplete}
            disabled={isSubmitting}
            className="flex-1 bg-violet-600 hover:bg-violet-700 text-white disabled:opacity-70"
          >
            {isSubmitting ? (
              <span className="flex items-center gap-2">
                <Loader2 className="h-4 w-4 animate-spin" />
                Submitting...
              </span>
            ) : (
              "Complete Registration"
            )}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
