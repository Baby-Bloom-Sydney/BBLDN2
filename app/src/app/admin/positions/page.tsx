import { Suspense } from 'react';
import { createAdminClient } from '@/lib/supabase/admin';
import { AdminPositionsClient } from './AdminPositionsClient';

export const dynamic = 'force-dynamic';

export interface PositionChild {
  age_months: number;
  gender: string | null;
}

export interface PositionConnection {
  id: string;
  nanny_id: string;
  nanny_name: string;
  connection_stage: number | null;
  source: string | null;
  confirmed_time: string | null;
  created_at: string;
  responded_at: string | null;
}

export interface AdminPosition {
  id: string;
  parent_id: string;
  parent_name: string | null;
  parent_user_id: string | null;
  suburb: string | null;
  hourly_rate: number | null;
  hours_per_week: number | null;
  status: string;
  stage: number | null;
  position_status: number | null;
  source: string;
  family_display_name: string | null;
  days_required: string[] | null;
  schedule_type: string | null;
  placement_length: string | null;
  description: string | null;
  dfy_activated_at: string | null;
  dfy_tier: string | null;
  expires_at: string | null;
  created_at: string;
  schedule: Record<string, string[]> | null;
  children: PositionChild[];
  connections: PositionConnection[];
}

async function getPositionsData(): Promise<AdminPosition[]> {
  const admin = createAdminClient();

  // Fetch all in parallel
  const [positionsRes, childrenRes, connectionsRes, schedulesRes, nanniesRes, parentsRes] = await Promise.all([
    admin
      .from('nanny_positions')
      .select('id, parent_id, suburb, hourly_rate, hours_per_week, status, stage, position_status, source, family_display_name, days_required, schedule_type, placement_length, description, dfy_activated_at, dfy_tier, expires_at, created_at')
      .order('created_at', { ascending: false }),

    admin
      .from('position_children')
      .select('position_id, age_months, gender')
      .order('display_order', { ascending: true }),

    admin
      .from('connection_requests')
      .select('id, position_id, nanny_id, connection_stage, source, confirmed_time, created_at, responded_at')
      .not('position_id', 'is', null)
      .order('created_at', { ascending: false }),

    admin
      .from('position_schedule')
      .select('position_id, schedule'),

    // Nanny user_ids for name lookup
    admin
      .from('nannies')
      .select('id, user_id'),

    // Parent user_ids for name lookup
    admin
      .from('parents')
      .select('id, user_id'),
  ]);

  const positions = positionsRes.data ?? [];
  const allChildren = childrenRes.data ?? [];
  const allConnections = connectionsRes.data ?? [];
  const allSchedules = schedulesRes.data ?? [];
  const nannies = nanniesRes.data ?? [];
  const parents = parentsRes.data ?? [];

  // Build schedule lookup
  const scheduleByPosition = new Map<string, Record<string, string[]>>();
  for (const s of allSchedules) {
    scheduleByPosition.set(s.position_id, s.schedule as Record<string, string[]>);
  }

  // Fetch user profiles for all nanny and parent user_ids
  const nannyUserIds = nannies.map((n: { user_id: string }) => n.user_id);
  const parentUserIds = parents.map((p: { user_id: string }) => p.user_id);
  const allUserIds = [...new Set([...nannyUserIds, ...parentUserIds])];

  const { data: profiles } = await admin
    .from('user_profiles')
    .select('user_id, first_name, last_name')
    .in('user_id', allUserIds);

  // Build lookup maps
  const profileMap = new Map<string, { first_name: string | null; last_name: string | null }>();
  for (const p of profiles ?? []) {
    profileMap.set(p.user_id, { first_name: p.first_name, last_name: p.last_name });
  }

  const nannyUserIdMap = new Map<string, string>(); // nanny.id → user_id
  for (const n of nannies) {
    nannyUserIdMap.set(n.id, n.user_id);
  }

  const parentUserIdMap = new Map<string, string>(); // parent.id → user_id
  for (const p of parents) {
    parentUserIdMap.set(p.id, p.user_id);
  }

  // Group children by position
  const childrenByPosition = new Map<string, PositionChild[]>();
  for (const c of allChildren) {
    const list = childrenByPosition.get(c.position_id) ?? [];
    list.push({ age_months: c.age_months, gender: c.gender });
    childrenByPosition.set(c.position_id, list);
  }

  // Group connections by position with nanny names
  const connectionsByPosition = new Map<string, PositionConnection[]>();
  for (const conn of allConnections) {
    if (!conn.position_id) continue;
    const nannyUserId = nannyUserIdMap.get(conn.nanny_id);
    const nannyProfile = nannyUserId ? profileMap.get(nannyUserId) : null;
    const nannyName = nannyProfile
      ? [nannyProfile.first_name, nannyProfile.last_name].filter(Boolean).join(' ')
      : 'Unknown';

    const list = connectionsByPosition.get(conn.position_id) ?? [];
    list.push({
      id: conn.id,
      nanny_id: conn.nanny_id,
      nanny_name: nannyName,
      connection_stage: conn.connection_stage,
      source: conn.source,
      confirmed_time: conn.confirmed_time,
      created_at: conn.created_at,
      responded_at: conn.responded_at,
    });
    connectionsByPosition.set(conn.position_id, list);
  }

  // Assemble final data
  return positions.map((pos: Record<string, unknown>) => {
    const parentUserId = parentUserIdMap.get(pos.parent_id as string);
    const parentProfile = parentUserId ? profileMap.get(parentUserId) : null;
    const parentName = parentProfile
      ? [parentProfile.first_name, parentProfile.last_name].filter(Boolean).join(' ')
      : null;

    return {
      id: pos.id as string,
      parent_id: pos.parent_id as string,
      parent_name: parentName,
      parent_user_id: parentUserId ?? null,
      suburb: pos.suburb as string | null,
      hourly_rate: pos.hourly_rate ? Number(pos.hourly_rate) : null,
      hours_per_week: pos.hours_per_week as number | null,
      status: pos.status as string,
      stage: pos.stage as number | null,
      position_status: pos.position_status as number | null,
      source: (pos.source as string) ?? 'parent',
      family_display_name: pos.family_display_name as string | null,
      days_required: pos.days_required as string[] | null,
      schedule_type: pos.schedule_type as string | null,
      placement_length: pos.placement_length as string | null,
      description: pos.description as string | null,
      dfy_activated_at: pos.dfy_activated_at as string | null,
      dfy_tier: pos.dfy_tier as string | null,
      expires_at: pos.expires_at as string | null,
      created_at: pos.created_at as string,
      schedule: scheduleByPosition.get(pos.id as string) ?? null,
      children: childrenByPosition.get(pos.id as string) ?? [],
      connections: connectionsByPosition.get(pos.id as string) ?? [],
    };
  });
}

interface AdminPositionsPageProps {
  searchParams?: Record<string, string | string[] | undefined>;
}

/** `?openPosition=<id>` (brief 04 §0.9), first value only; the client ignores it while CALL_BOOKING_ENABLED is off. */
function openPositionParam(searchParams: AdminPositionsPageProps['searchParams']): string | null {
  const v = searchParams?.openPosition;
  if (typeof v === 'string') return v;
  return Array.isArray(v) && typeof v[0] === 'string' ? v[0] : null;
}

export default async function AdminPositionsPage({ searchParams }: AdminPositionsPageProps = {}) {
  const positions = await getPositionsData();

  return (
    <Suspense fallback={<div className="p-6 text-slate-500">Loading positions...</div>}>
      <AdminPositionsClient positions={positions} openPositionId={openPositionParam(searchParams)} />
    </Suspense>
  );
}
