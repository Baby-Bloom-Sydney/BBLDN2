import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { runIdentityPhase, runWWCCDocPhase } from '@/lib/ai/verification-pipeline';

export const maxDuration = 120;

export async function POST(request: NextRequest) {
  const supabase = createClient();
  const { data: { user }, error: authError } = await supabase.auth.getUser();

  if (authError || !user) {
    return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  }

  let verificationId: string | null = null;
  let phase: string | null = null;

  try {
    const body = await request.json();
    verificationId = body.verificationId ?? null;
    phase = body.phase ?? null;
  } catch { /* no body */ }

  if (!verificationId || !phase) {
    return NextResponse.json({ error: 'Missing verificationId or phase' }, { status: 400 });
  }

  try {
    if (phase === 'identity') {
      console.log(`[run-verification] Starting identity phase for ${verificationId}`);
      await runIdentityPhase(verificationId);
    } else if (phase === 'wwcc') {
      console.log(`[run-verification] Starting WWCC doc phase for ${verificationId}`);
      await runWWCCDocPhase(verificationId);
    } else {
      return NextResponse.json({ error: `Unknown phase: ${phase}` }, { status: 400 });
    }

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error('[run-verification] Pipeline error:', err);
    return NextResponse.json({ error: 'Pipeline failed' }, { status: 500 });
  }
}
