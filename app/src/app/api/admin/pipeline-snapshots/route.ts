import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/admin/require-admin';
import { createAdminClient } from '@/lib/supabase/admin';

export async function GET(request: NextRequest) {
  const gate = await requireAdmin();
  if (gate.error) {
    return NextResponse.json(
      { error: gate.error },
      { status: gate.error === 'Not authenticated' ? 401 : 403 },
    );
  }
  const { searchParams } = request.nextUrl;
  const sections = searchParams.get('sections')?.split(',').filter(Boolean) || [];
  const from = searchParams.get('from');
  const to = searchParams.get('to');

  if (sections.length === 0) {
    return NextResponse.json({ error: 'No sections specified' }, { status: 400 });
  }

  const admin = createAdminClient();

  let query = admin
    .from('pipeline_snapshots')
    .select('snapshot_date, section_key, stages')
    .in('section_key', sections)
    .order('snapshot_date', { ascending: true });

  if (from) query = query.gte('snapshot_date', from);
  if (to) query = query.lte('snapshot_date', to);

  const { data, error } = await query;

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json(data || []);
}
