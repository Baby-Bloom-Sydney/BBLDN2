/**
 * Connection helpers for the server actions and routes (phone lookups, position summary, inbox messages, the
 * connection log). Server-only; not a server action.
 */
import { createAdminClient } from '@/lib/supabase/admin';

/**
 * Get a nanny's phone number from verifications table,
 * falling back to user_profiles.mobile_number.
 * Uses admin client since phone is sensitive data behind RLS.
 */
export async function getNannyPhone(nannyUserId: string): Promise<string | null> {
  const supabase = createAdminClient();

  // Try verifications first
  const { data } = await supabase
    .from('verifications')
    .select('phone_number')
    .eq('user_id', nannyUserId)
    .not('phone_number', 'is', null)
    .order('created_at', { ascending: false })
    .limit(1)
    .single();

  if (data?.phone_number) return data.phone_number;

  // Fallback to user_profiles.mobile_number
  const { data: profile } = await supabase
    .from('user_profiles')
    .select('mobile_number')
    .eq('user_id', nannyUserId)
    .single();

  return profile?.mobile_number ?? null;
}

/**
 * Get a position summary for display in nanny's inbox.
 * Returns position details + children ages.
 */
export async function getPositionSummary(positionId: string): Promise<{
  id: string;
  schedule_type: string | null;
  hours_per_week: number | null;
  days_required: string[] | null;
  hourly_rate: number | null;
  urgency: string | null;
  start_date: string | null;
  level_of_support: string[] | null;
  children: Array<{ age_months: number; gender: string | null }>;
} | null> {
  const supabase = createAdminClient();

  const { data: position, error } = await supabase
    .from('nanny_positions')
    .select('id, schedule_type, hours_per_week, days_required, hourly_rate, urgency, start_date, level_of_support')
    .eq('id', positionId)
    .single();

  if (error || !position) return null;

  const { data: children } = await supabase
    .from('position_children')
    .select('age_months, gender')
    .eq('position_id', positionId)
    .order('display_order', { ascending: true });

  return {
    ...position,
    children: children ?? [],
  };
}

/**
 * Create an inbox message for a user. Uses admin client to bypass RLS.
 */
export async function createInboxMessage(params: {
  userId: string;
  type: string;
  title: string;
  body: string;
  actionUrl?: string;
  referenceId?: string;
  referenceType?: string;
  metadata?: Record<string, unknown>;
}): Promise<void> {
  const supabase = createAdminClient();

  const { error } = await supabase.from('inbox_messages').insert({
    user_id: params.userId,
    type: params.type,
    title: params.title,
    body: params.body,
    action_url: params.actionUrl ?? null,
    reference_id: params.referenceId ?? null,
    reference_type: params.referenceType ?? null,
    metadata: params.metadata ?? {},
  });

  if (error) {
    console.error('[Inbox] Failed to create message:', error);
  }
}

/**
 * Log a connection event to connections_log. Uses admin client.
 */
export async function logConnectionEvent(params: {
  connectionRequestId: string;
  parentId: string;
  nannyId: string;
  eventType: string;
  eventData?: Record<string, unknown>;
}): Promise<void> {
  const supabase = createAdminClient();

  const { error } = await supabase.from('connections_log').insert({
    connection_request_id: params.connectionRequestId,
    parent_id: params.parentId,
    nanny_id: params.nannyId,
    event_type: params.eventType,
    event_data: params.eventData ?? {},
  });

  if (error) {
    console.error('[ConnectionsLog] Failed to log event:', error);
  }
}
