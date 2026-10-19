import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { processScreenshotCheck } from '@/lib/actions/viral-loop';
import { shareLoopEnabled } from '@/lib/features/flags';

export const maxDuration = 30;

export async function POST(request: NextRequest) {
  // 5b (P-23): the share loop is hidden unless SHARE_LOOP_ENABLED is "true" — 404 before auth and any check.
  if (!shareLoopEnabled()) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }

  const supabase = createClient();
  const { data: { user }, error: authError } = await supabase.auth.getUser();

  if (authError || !user) {
    return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  }

  let shareId: string | null = null;

  try {
    const body = await request.json();
    shareId = body.shareId ?? null;
  } catch { /* no body */ }

  if (!shareId) {
    return NextResponse.json({ error: 'Missing shareId' }, { status: 400 });
  }

  try {
    console.log(`[check-share-screenshot] Starting check for share ${shareId}`);
    const result = await processScreenshotCheck(shareId);

    return NextResponse.json({
      success: result.success,
      approved: result.approved,
      error: result.error,
      failReason: result.failReason,
    });
  } catch (err) {
    console.error('[check-share-screenshot] Error:', err);
    return NextResponse.json(
      { success: false, approved: false, error: 'Screenshot check failed' },
      { status: 500 }
    );
  }
}
