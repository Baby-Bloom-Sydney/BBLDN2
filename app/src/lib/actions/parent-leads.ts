'use server';

import { createAdminClient } from '@/lib/supabase/admin';

export async function saveParentLead(
  leadId: string,
  formData: Record<string, unknown>
): Promise<{ success: boolean; error: string | null; leadId?: string }> {
  const supabase = createAdminClient();

  const { error } = await supabase
    .from('parent_leads')
    .upsert(
      {
        id: leadId,
        form_data: formData,
        suburb: (formData.suburb as string) ?? null,
        postcode: (formData.postcode as string) ?? null,
      },
      { onConflict: 'id' }
    );

  if (error) {
    console.error('[saveParentLead] Error:', error);
    return { success: false, error: 'Failed to save your details. Please try again.' };
  }

  return { success: true, error: null, leadId };
}
