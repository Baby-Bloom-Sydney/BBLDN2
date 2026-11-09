'use server';

import { createClient } from '@/lib/supabase/server';
import { revalidatePath } from 'next/cache';
import { getParentId } from './parent';

export interface InterviewRequest {
  id: string;
  parent_id: string;
  nanny_id: string;
  position_id: string | null;
  status: 'pending' | 'accepted' | 'declined' | 'cancelled';
  proposed_times: string[];
  selected_time: string | null;
  message: string | null;
  created_at: string;
  updated_at: string;
}

export interface InterviewRequestWithDetails extends InterviewRequest {
  nanny?: {
    id: string;
    first_name: string;
    last_name: string;
    suburb: string;
    hourly_rate_min: number | null;
  };
  parent?: {
    id: string;
    first_name: string;
    last_name: string;
    suburb: string;
  };
}

async function getNannyId(): Promise<string | null> {
  const supabase = createClient();

  const { data: { user }, error: authError } = await supabase.auth.getUser();
  if (authError || !user) return null;

  const { data: nanny, error } = await supabase
    .from('nannies')
    .select('id')
    .eq('user_id', user.id)
    .single();

  if (error || !nanny) return null;
  return nanny.id;
}

export async function createInterviewRequest(
  nannyId: string,
  proposedTimes: string[],
  message?: string
): Promise<{ success: boolean; error: string | null; requestId?: string }> {
  const supabase = createClient();

  const parentId = await getParentId();
  if (!parentId) {
    return { success: false, error: 'Not authenticated as parent' };
  }

  // Get parent's active position
  const { data: position } = await supabase
    .from('nanny_positions')
    .select('id')
    .eq('parent_id', parentId)
    .eq('status', 'active')
    .single();

  // Check if request already exists
  const { data: existing } = await supabase
    .from('interview_requests')
    .select('id, status')
    .eq('parent_id', parentId)
    .eq('nanny_id', nannyId)
    .in('status', ['pending', 'accepted'])
    .single();

  if (existing) {
    return { success: false, error: 'You already have an active interview request with this nanny' };
  }

  // Create the request
  const { data: request, error } = await supabase
    .from('interview_requests')
    .insert({
      parent_id: parentId,
      nanny_id: nannyId,
      position_id: position?.id || null,
      status: 'pending',
      proposed_times: proposedTimes,
      message: message || null,
    })
    .select('id')
    .single();

  if (error) {
    console.error('Interview request create error:', error);
    return { success: false, error: 'Failed to create interview request' };
  }

  revalidatePath('/parent/interviews');
  revalidatePath('/parent/browse');
  return { success: true, error: null, requestId: request.id };
}

export async function getParentInterviewRequests(): Promise<{ data: InterviewRequestWithDetails[]; error: string | null }> {
  const supabase = createClient();

  const parentId = await getParentId();
  if (!parentId) {
    return { data: [], error: 'Not authenticated as parent' };
  }

  const { data, error } = await supabase
    .from('interview_requests')
    .select(`
      *,
      nannies!inner (
        id,
        user_profiles!inner (
          first_name,
          last_name,
          suburb
        ),
        hourly_rate_min
      )
    `)
    .eq('parent_id', parentId)
    .order('created_at', { ascending: false });

  if (error) {
    console.error('Parent interview requests fetch error:', error);
    return { data: [], error: 'Failed to fetch interview requests' };
  }

  // Transform data
  const requests = (data || []).map((req) => {
    const nannyProfile = req.nannies.user_profiles as unknown as {
      first_name: string;
      last_name: string;
      suburb: string;
    };
    return {
      ...req,
      nanny: {
        id: req.nannies.id,
        first_name: nannyProfile.first_name,
        last_name: (nannyProfile.last_name ?? "").charAt(0),
        suburb: nannyProfile.suburb,
        hourly_rate_min: req.nannies.hourly_rate_min,
      },
      nannies: undefined,
    };
  });

  return { data: requests, error: null };
}

export async function getNannyInterviewRequests(): Promise<{ data: InterviewRequestWithDetails[]; error: string | null }> {
  const supabase = createClient();

  const nannyId = await getNannyId();
  if (!nannyId) {
    return { data: [], error: 'Not authenticated as nanny' };
  }

  const { data, error } = await supabase
    .from('interview_requests')
    .select(`
      *,
      parents!inner (
        id,
        user_profiles!inner (
          first_name,
          last_name,
          suburb
        )
      )
    `)
    .eq('nanny_id', nannyId)
    .order('created_at', { ascending: false });

  if (error) {
    console.error('Nanny interview requests fetch error:', error);
    return { data: [], error: 'Failed to fetch interview requests' };
  }

  // Transform data
  const requests = (data || []).map((req) => {
    const parentProfile = req.parents.user_profiles as unknown as {
      first_name: string;
      last_name: string;
      suburb: string;
    };
    return {
      ...req,
      parent: {
        id: req.parents.id,
        first_name: parentProfile.first_name,
        last_name: (parentProfile.last_name ?? "").charAt(0),
        suburb: parentProfile.suburb,
      },
      parents: undefined,
    };
  });

  return { data: requests, error: null };
}

export async function acceptInterviewRequest(
  requestId: string,
  selectedTime: string
): Promise<{ success: boolean; error: string | null }> {
  const supabase = createClient();

  const nannyId = await getNannyId();
  if (!nannyId) {
    return { success: false, error: 'Not authenticated as nanny' };
  }

  const { error } = await supabase
    .from('interview_requests')
    .update({
      status: 'accepted',
      selected_time: selectedTime,
    })
    .eq('id', requestId)
    .eq('nanny_id', nannyId)
    .eq('status', 'pending');

  if (error) {
    console.error('Interview accept error:', error);
    return { success: false, error: 'Failed to accept interview request' };
  }

  revalidatePath('/nanny/interviews');
  return { success: true, error: null };
}

export async function declineInterviewRequest(
  requestId: string
): Promise<{ success: boolean; error: string | null }> {
  const supabase = createClient();

  const nannyId = await getNannyId();
  if (!nannyId) {
    return { success: false, error: 'Not authenticated as nanny' };
  }

  const { error } = await supabase
    .from('interview_requests')
    .update({ status: 'declined' })
    .eq('id', requestId)
    .eq('nanny_id', nannyId)
    .eq('status', 'pending');

  if (error) {
    console.error('Interview decline error:', error);
    return { success: false, error: 'Failed to decline interview request' };
  }

  revalidatePath('/nanny/interviews');
  return { success: true, error: null };
}

export async function cancelInterviewRequest(
  requestId: string
): Promise<{ success: boolean; error: string | null }> {
  const supabase = createClient();

  const parentId = await getParentId();
  if (!parentId) {
    return { success: false, error: 'Not authenticated as parent' };
  }

  const { error } = await supabase
    .from('interview_requests')
    .update({ status: 'cancelled' })
    .eq('id', requestId)
    .eq('parent_id', parentId)
    .in('status', ['pending', 'accepted']);

  if (error) {
    console.error('Interview cancel error:', error);
    return { success: false, error: 'Failed to cancel interview request' };
  }

  revalidatePath('/parent/interviews');
  return { success: true, error: null };
}
