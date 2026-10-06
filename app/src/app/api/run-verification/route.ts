import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { runIdentityPhase, runWWCCDocPhase } from '@/lib/ai/verification-pipeline';

export const maxDuration = 120;

/**
 * POST /api/run-verification `{ verificationId, phase: 'identity' | 'wwcc' }` — runs one pipeline phase for the caller.
 *
 * Auth: signed in (401) and owner of the row (403). Ownership is read with the SESSION client
 * (`id = verificationId AND user_id = caller`), so RLS applies too; not found, someone else's row or a failed read
 * all answer 403 — fail closed (04-integration-design §7; 3h security review, fixed in 3c). Bad body → 400.
 * Never: runs a phase on another user's row, or trusts any field of the body beyond the id and the phase name.
 */
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

  if (typeof verificationId !== 'string' || !verificationId || typeof phase !== 'string' || !phase) {
    return NextResponse.json({ error: 'Missing verificationId or phase' }, { status: 400 });
  }

  // Ownership: a caller may only run her own verification row. Read with the session client (RLS applies too);
  // not found, someone else's or a failed read → 403 (fail closed). 04-integration-design §7.
  const { data: owned, error: ownErr } = await supabase
    .from('verifications')
    .select('id')
    .eq('id', verificationId)
    .eq('user_id', user.id)
    .maybeSingle();

  if (ownErr || !owned) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  try {
    if (phase === 'identity') {
      console.log(`[run-verification] Starting identity phase for ${verificationId}`);
      await runIdentityPhase(verificationId);
    } else if (phase === 'wwcc') {
      // Phase name kept (D-4): the DBS certificate phase.
      console.log(`[run-verification] Starting DBS certificate phase for ${verificationId}`);
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
