// ── Pre-auth matchmaking — runs scoring against parent_leads form data ──

import { createAdminClient } from '@/lib/supabase/admin';
import { AGE_RANGE_TO_MONTHS, buildScheduleJson } from '@/lib/actions/position-utils';
import type { TypeformFormData } from '@/app/parent/request/questions';
import type { PositionMatchData, PositionChildData, MatchingResult } from './types';
import { fetchAndScoreNannies } from './engine';

/**
 * Run full matchmaking for a pre-auth parent lead.
 * Reads form_data from parent_leads, constructs position data in memory,
 * and runs the same scoring pipeline as authenticated matching.
 */
export async function runPreAuthMatching(leadId: string): Promise<MatchingResult> {
  const supabase = createAdminClient();

  // Fetch the lead's form data
  const { data: lead, error } = await supabase
    .from('parent_leads')
    .select('form_data')
    .eq('id', leadId)
    .single();

  if (error || !lead?.form_data) {
    console.error('[runPreAuthMatching] Lead fetch error:', error);
    return { matches: [], totalEligible: 0 };
  }

  const fd = lead.form_data as Record<string, unknown>;

  // ── Map form_data → PositionMatchData ──
  const position: PositionMatchData = {
    id: 'pre-auth',
    parent_id: 'pre-auth',
    drivers_license_required: fd.drivers_license_required === 'Yes',
    car_required: fd.car_required === 'Yes',
    vaccination_required: false,
    non_smoker_required: false,
    comfortable_with_pets_required: false,
    minimum_age_requirement: fd.minimum_age ? parseInt(fd.minimum_age as string) : null,
    years_of_experience: fd.years_of_experience ? parseInt(fd.years_of_experience as string) : null,
    language_preference: (fd.language_preference as string) ?? null,
    language_preference_details: (fd.language_preference_details as string) ?? null,
    reason_for_nanny: fd.reason_for_nanny ? [fd.reason_for_nanny as string] : null,
    schedule_type: (fd.schedule_type as string) ?? null,
    urgency: (fd.urgency as string) ?? null,
    suburb: (fd.suburb as string) ?? null,
    postcode: (fd.postcode as string) ?? null,
    details: {
      child_needs: fd.child_needs_yn === 'Yes',
      focus_type: (fd.focus_type as string) ?? null,
      support_type: (fd.support_type as string) ?? null,
    },
  };

  // ── Build children array ──
  const children: PositionChildData[] = [];
  const numChildren = (fd.num_children as number) ?? 0;

  const childAgeFields = ['child_a_age', 'child_b_age', 'child_c_age'] as const;
  for (let i = 0; i < Math.min(numChildren, 3); i++) {
    const ageRange = fd[childAgeFields[i]] as string | undefined;
    if (ageRange && AGE_RANGE_TO_MONTHS[ageRange] != null) {
      children.push({ age_months: AGE_RANGE_TO_MONTHS[ageRange] });
    }
  }

  // ── Build schedule ──
  const positionSchedule = buildScheduleJson(fd as Partial<TypeformFormData>);
  const schedule = Object.keys(positionSchedule).length > 0 ? positionSchedule : null;

  return fetchAndScoreNannies(position, children, schedule);
}
