import { NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';

// Cache the response for 24 hours (132 rows, tiny payload).
// The whole table is returned; every consumer filters client-side.
export const revalidate = 86400;

export async function GET() {
  const supabase = createAdminClient();
  const { data, error } = await supabase
    .from('london_districts')
    .select('district, prefix, label')
    .order('district');

  if (error) {
    console.error('[london-districts] Error:', error);
    return NextResponse.json([], { status: 500 });
  }

  return NextResponse.json(data ?? []);
}
