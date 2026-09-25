import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { computeSnapshot } from '@/lib/analytics/compute-snapshot';

/**
 * Cron endpoint: takes a daily snapshot of all pipeline metrics.
 * Stores one row per section per day in pipeline_snapshots.
 *
 * Called by Vercel Cron daily at 00:00 UTC = midnight London
 * (01:00 during BST — Vercel cron is UTC-only).
 * Also callable manually: GET /api/cron/snapshot-pipeline
 */
export async function GET(request: NextRequest) {
  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret) {
    const authHeader = request.headers.get('authorization');
    if (authHeader !== `Bearer ${cronSecret}`) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
  }

  try {
    const sections = await computeSnapshot();
    const supabase = createAdminClient();
    const today = new Date().toISOString().slice(0, 10); // YYYY-MM-DD

    // Upsert each section (ON CONFLICT update stages)
    let upserted = 0;
    for (const section of sections) {
      const { error } = await supabase
        .from('pipeline_snapshots')
        .upsert(
          {
            snapshot_date: today,
            section_key: section.section_key,
            stages: section.stages,
          },
          { onConflict: 'snapshot_date,section_key' }
        );

      if (error) {
        console.error(`[SnapshotPipeline] Error upserting ${section.section_key}:`, error.message);
      } else {
        upserted++;
      }
    }

    console.log(`[SnapshotPipeline] Upserted ${upserted}/${sections.length} sections for ${today}`);
    return NextResponse.json({ date: today, sections: upserted, total: sections.length });
  } catch (err: any) {
    console.error('[SnapshotPipeline] Fatal error:', err.message);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
