'use client';

import { StageProps } from '../../FunnelOrchestrator';
import { ParentNannyProfileView } from '@/app/parent/browse/[id]/ParentNannyProfileView';
import { PublicNannyProfile } from '@/lib/actions/nanny';
import { NannyLeadFunnelState } from '@/types/nanny-leads';
import { Button } from '@/components/ui/button';
import { Gift } from 'lucide-react';

// ── Map funnel state → PublicNannyProfile ──

const AGE_TO_MONTHS: Record<string, number> = {
  'Newborn': 0, '3 months': 3, '6 months': 6, '12 months': 12,
  '18 months': 18, '2 years': 24, '3 years': 36, '5 years': 60,
  '10 years': 120, '13 years': 156, '16 years': 192,
};

function funnelStateToProfile(state: NannyLeadFunnelState): PublicNannyProfile {
  const parseRate = (r: string | null): number | null => {
    if (!r) return null;
    const n = parseFloat(r.replace('£', ''));
    return isNaN(n) ? null : n;
  };

  const parseExp = (e: string | null): number | null => {
    if (!e) return null;
    if (e === '10+') return 10;
    return parseInt(e) || null;
  };

  return {
    nanny_id: state.leadId || 'preview',
    user_id: 'preview',
    first_name: state.first_name,
    last_name: state.last_name,
    suburb: state.residency.suburb || '',
    postcode: state.residency.postcode || '',
    profile_picture_url: state.about_you.profile_picture_url,
    date_of_birth: state.experience.date_of_birth,
    nationality: state.residency.nationality,
    total_experience_years: parseExp(state.experience.total_experience),
    nanny_experience_years: state.experience.childcare_roles
      .filter(r => r.role === 'Nanny')
      .reduce((sum, r) => sum + (r.duration || 0), 0) || null,
    under_3_experience_years: state.experience.under_3_experience,
    newborn_experience_years: state.experience.newborn_experience,
    experience_details: null,
    role_types_preferred: state.preferences.role_types,
    level_of_support_offered: state.identity.level_of_support,
    max_children: state.preferences.max_children,
    min_child_age_months: state.preferences.min_age ? (AGE_TO_MONTHS[state.preferences.min_age] ?? null) : null,
    max_child_age_months: state.preferences.max_age ? (AGE_TO_MONTHS[state.preferences.max_age] ?? null) : null,
    additional_needs_ok: state.preferences.additional_needs ?? false,
    hourly_rate_min: parseRate(state.salary.hourly_rate_min),
    pay_frequency: state.salary.pay_frequency,
    drivers_license: state.matching.drivers_license,
    has_car: state.matching.has_car,
    comfortable_with_pets: state.preferences.comfortable_with_pets,
    vaccination_status: state.matching.vaccination_status,
    non_smoker: state.matching.non_smoker,
    languages: state.matching.languages,
    hobbies_interests: null,
    strengths_traits: state.identity.personality_traits.length > 0
      ? state.identity.personality_traits.join(', ')
      : null,
    skills_training: null,
    verification_tier: 'tier1',
    verification_level: 0,
    ai_content: state.ai_content
      ? (state.ai_content as Record<string, unknown>)
      : {
          ...(state.ai_bio ? { parent_pitch: state.ai_bio } : {}),
        },
    availability: {
      days_available: state.availability.available_days,
      schedule: state.availability.day_times,
    },
    highest_qualification: null,
    certificates: [],
    motivation: state.identity?.motivation || null,
    personality_traits: state.identity?.personality_traits || null,
    professional_values: state.identity?.professional_values || null,
    childcare_roles: state.experience?.childcare_roles?.map((r: { role: string; duration: number }) => ({ role: r.role, duration: r.duration || 0 })) || null,
    additional_photos: [state.about_you?.photo_1_url, state.about_you?.photo_2_url, state.about_you?.photo_3_url].filter(Boolean) as string[],
    immediate_start: !!state.availability?.immediate_start,
  };
}

// ── Component ──

export function N4ProfileReview({ state, goNext }: StageProps) {
  const profile = funnelStateToProfile(state);

  return (
    <div className="relative min-h-screen pb-24">
      {/* ── Header ── */}
      <div className="max-w-2xl mx-auto px-4 pt-8 pb-2 text-center animate-in fade-in duration-500">
        <div className="mx-auto mb-4 w-12 h-12 rounded-full bg-violet-100 flex items-center justify-center">
          <Gift className="w-6 h-6 text-violet-600" />
        </div>
        <h1 className="text-2xl font-bold text-slate-800">
          Your profile is ready!
        </h1>
        <p className="mt-2 text-sm text-slate-500 leading-relaxed max-w-sm mx-auto">
          We&apos;ve built your professional childcare portfolio, ready to connect you with our network of families!
        </p>
      </div>

      {/* ── Profile (rises up) ── */}
      <div className="animate-in slide-in-from-bottom-6 fade-in duration-700 fill-mode-both px-4" style={{ animationDelay: '400ms' }}>
        <ParentNannyProfileView
          nanny={profile}
          isActiveNanny
        />
      </div>

      {/* ── Sticky CTA ── */}
      <div className="fixed bottom-0 left-0 right-0 z-20 pt-3 pb-[66px] bg-gradient-to-t from-white from-70% to-transparent">
        <div className="max-w-md mx-auto px-4">
          <Button
            onClick={goNext}
            className="w-full bg-violet-600 hover:bg-violet-700 text-white h-11 px-6 rounded-lg font-medium text-sm"
          >
            Secure Your Profile &amp; Start Matching
          </Button>
        </div>
      </div>
    </div>
  );
}
