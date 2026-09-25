import { createAdminClient } from '@/lib/supabase/admin';
import { PositionApplyClient } from './PositionApplyClient';

export interface RealPosition {
  id: string;
  parent_id: string;
  suburb: string | null;
  schedule_type: string | null;
  hourly_rate: number | null;
  hours_per_week: number | null;
  days_required: string[] | null;
  urgency: string | null;
  start_date: string | null;
  placement_length: string | null;
  description: string | null;
  level_of_support: string[] | null;
  reason_for_nanny: string[] | null;
  drivers_license_required: boolean | null;
  car_required: boolean | null;
  non_smoker_required: boolean | null;
  vaccination_required: boolean | null;
  comfortable_with_pets_required: boolean | null;
  language_preference: string | null;
  qualification_requirement: string | null;
  certificate_requirements: string[] | null;
  details: Record<string, unknown> | null;
  status: string;
  source: string | null;
  created_at: string;
  children: Array<{ age_months: number; gender: string | null }>;
  parent_first_name: string;
  parent_last_name: string | null;
  // Roster from form_data or position_schedule
  weekly_roster: string[];
  roster_by_day: Record<string, string[]>;
}

export interface RealApplicant {
  request_id: string;
  connection_stage: number;
  status: string;
  message: string | null;
  expires_at: string;
  created_at: string;
  nanny_id: string;
  hourly_rate_min: number;
  total_experience_years: number;
  drivers_license: boolean;
  has_car: boolean;
  non_smoker: boolean;
  vaccination_status: boolean;
  first_name: string;
  last_name: string;
  suburb: string;
  profile_picture_url: string | null;
}

async function fetchActivePositions(): Promise<RealPosition[]> {
  const admin = createAdminClient();

  const { data: positions, error } = await admin
    .from('nanny_positions')
    .select('*')
    .in('status', ['active', 'filled'])
    .order('created_at', { ascending: false });

  if (error || !positions) return [];

  const result: RealPosition[] = [];

  for (const pos of positions) {
    // Get children
    const { data: children } = await admin
      .from('position_children')
      .select('age_months, gender')
      .eq('position_id', pos.id)
      .order('display_order', { ascending: true });

    // Get parent/family name
    let parentFirstName = 'A family';
    let parentLastName: string | null = null;

    if (pos.family_display_name) {
      // AI/admin position — use display name
      parentFirstName = pos.family_display_name;
      parentLastName = null;
    } else {
      // Parent position — look up from parents → user_profiles
      const { data: parent } = await admin
        .from('parents')
        .select('user_id')
        .eq('id', pos.parent_id)
        .single();

      if (parent) {
        const { data: profile } = await admin
          .from('user_profiles')
          .select('first_name, last_name')
          .eq('user_id', parent.user_id)
          .maybeSingle();

        if (profile) {
          parentFirstName = profile.first_name ?? 'A family';
          parentLastName = profile.last_name ?? null;
        }
      }
    }

    // Extract roster — from position_schedule for AI/admin positions, from form_data for parent positions
    let weeklyRoster: string[] = [];
    const rosterByDay: Record<string, string[]> = {};

    if (pos.source && pos.source !== 'parent') {
      // AI/admin position — read from position_schedule table
      const { data: scheduleRow } = await admin
        .from('position_schedule')
        .select('schedule')
        .eq('position_id', pos.id)
        .maybeSingle();

      if (scheduleRow?.schedule) {
        const schedule = scheduleRow.schedule as Record<string, string[]>;
        for (const [day, brackets] of Object.entries(schedule)) {
          const titleDay = day.charAt(0).toUpperCase() + day.slice(1);
          weeklyRoster.push(titleDay);
          rosterByDay[titleDay] = brackets;
        }
      } else {
        weeklyRoster = pos.days_required ?? [];
      }
    } else {
      // Parent position — read from form_data
      const details = pos.details as Record<string, unknown> | null;
      const formData = (details?.form_data ?? {}) as Record<string, unknown>;
      weeklyRoster = (formData.weekly_roster as string[]) ?? pos.days_required ?? [];
      const DAY_ROSTER_FIELD: Record<string, string> = {
        Monday: 'monday_roster', Tuesday: 'tuesday_roster', Wednesday: 'wednesday_roster',
        Thursday: 'thursday_roster', Friday: 'friday_roster', Saturday: 'saturday_roster', Sunday: 'sunday_roster',
      };
      for (const day of weeklyRoster) {
        const field = DAY_ROSTER_FIELD[day];
        if (field && formData[field]) {
          rosterByDay[day] = formData[field] as string[];
        }
      }
    }

    result.push({
      id: pos.id,
      parent_id: pos.parent_id,
      suburb: pos.suburb,
      schedule_type: pos.schedule_type,
      hourly_rate: pos.hourly_rate ? Number(pos.hourly_rate) : null,
      hours_per_week: pos.hours_per_week,
      days_required: pos.days_required,
      urgency: pos.urgency,
      start_date: pos.start_date,
      placement_length: pos.placement_length,
      description: pos.description,
      level_of_support: pos.level_of_support,
      reason_for_nanny: pos.reason_for_nanny,
      drivers_license_required: pos.drivers_license_required,
      car_required: pos.car_required,
      non_smoker_required: pos.non_smoker_required,
      vaccination_required: pos.vaccination_required,
      comfortable_with_pets_required: pos.comfortable_with_pets_required,
      language_preference: pos.language_preference,
      qualification_requirement: pos.qualification_requirement,
      certificate_requirements: pos.certificate_requirements,
      details: pos.details,
      status: pos.status,
      source: pos.source ?? null,
      created_at: pos.created_at,
      children: children ?? [],
      parent_first_name: parentFirstName,
      parent_last_name: parentLastName,
      weekly_roster: weeklyRoster,
      roster_by_day: rosterByDay,
    });
  }

  return result;
}

export default async function PositionApplyTestPage() {
  const positions = await fetchActivePositions();

  // Dummy applicants for parent view demo
  const applicants: RealApplicant[] = [
    {
      request_id: 'req-1', connection_stage: 5, status: 'pending', message: null,
      expires_at: '2026-04-07T10:00:00Z', created_at: '2026-03-31T10:00:00Z',
      nanny_id: 'nan-1', hourly_rate_min: 28, total_experience_years: 5,
      drivers_license: true, has_car: true, non_smoker: true, vaccination_status: true,
      first_name: 'Jessica', last_name: 'Miller', suburb: 'Clapham', profile_picture_url: null,
    },
    {
      request_id: 'req-2', connection_stage: 5, status: 'pending',
      message: 'I love working with young children and have extensive newborn experience!',
      expires_at: '2026-04-06T14:30:00Z', created_at: '2026-03-30T14:30:00Z',
      nanny_id: 'nan-2', hourly_rate_min: 28, total_experience_years: 8,
      drivers_license: true, has_car: false, non_smoker: true, vaccination_status: true,
      first_name: 'Sarah', last_name: 'Kim', suburb: 'Hackney', profile_picture_url: null,
    },
  ];

  return <PositionApplyClient positions={positions} applicants={applicants} />;
}
