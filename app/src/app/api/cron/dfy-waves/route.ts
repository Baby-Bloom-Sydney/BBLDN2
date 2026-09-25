import { NextRequest, NextResponse } from 'next/server';
import { processDfyWaves } from '@/lib/actions/matching';

/**
 * Cron endpoint: processes pending DFY email waves.
 *
 * Wave schedule:
 * - Wave 1 (Day 0): Sent immediately by triggerDfyMatchmaking()
 * - Wave 2 (Day 2): Next 20 nannies, if <10 interested responses
 * - Wave 3 (Day 5): Next 20 nannies, if <10 interested responses
 *
 * Called by Vercel Cron daily at 19:00 UTC = 7:00 PM London
 * (8:00 PM during BST — Vercel cron is UTC-only).
 * Also triggered lazily by getDfyStatus() on parent page visit.
 */
export async function GET(request: NextRequest) {
  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret) {
    const authHeader = request.headers.get('authorization');
    if (authHeader !== `Bearer ${cronSecret}`) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
  }

  const { processed } = await processDfyWaves();

  console.log(`[DFY-Waves] Processed: ${processed} waves`);
  return NextResponse.json({ processed });
}
