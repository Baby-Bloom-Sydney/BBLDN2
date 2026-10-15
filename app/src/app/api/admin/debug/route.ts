import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/admin/require-admin';
import { createAdminClient } from '@/lib/supabase/admin';
import { openai } from '@/lib/ai/client';
import { generateOnboardingAIContent } from '@/lib/actions/nanny-onboarding-ai';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export async function GET(request: NextRequest) {
  const gate = await requireAdmin();
  if (gate.error) {
    return NextResponse.json(
      { error: gate.error },
      { status: gate.error === 'Not authenticated' ? 401 : 403 },
    );
  }
  const action = request.nextUrl.searchParams.get('action');
  const admin = createAdminClient();

  // Test OpenAI API
  if (action === 'test-openai') {
    try {
      const res = await openai.chat.completions.create({
        model: 'o4-mini',
        messages: [{ role: 'user', content: 'Say hello in one word.' }],
        max_completion_tokens: 50,
      });
      return NextResponse.json({ success: true, response: res.choices[0]?.message?.content });
    } catch (err: any) {
      return NextResponse.json({
        success: false,
        error: err.message,
        status: err.status,
        code: err.code,
        type: err.type,
      });
    }
  }

  // Trigger AI for a lead
  if (action === 'trigger-ai') {
    const leadId = request.nextUrl.searchParams.get('leadId');
    if (!leadId) return NextResponse.json({ error: 'Missing leadId' }, { status: 400 });
    const result = await generateOnboardingAIContent(leadId);
    return NextResponse.json(result);
  }

  // Default: analytics data check
  const now = new Date();
  const oneWeekAgo = new Date(now);
  oneWeekAgo.setDate(oneWeekAgo.getDate() - 7);

  const [totalVisits, totalUsers, recentLeads] = await Promise.all([
    admin.from('page_visits').select('*', { count: 'exact', head: true }),
    admin.from('user_roles').select('*', { count: 'exact', head: true }),
    admin.from('nanny_leads')
      .select('id, first_name, last_name, lead_status, funnel_step, ai_bio, ai_content, created_at')
      .order('created_at', { ascending: false })
      .limit(5),
  ]);

  return NextResponse.json({
    pageVisits: { count: totalVisits.count, error: totalVisits.error?.message ?? null },
    totalUsers: { count: totalUsers.count, error: totalUsers.error?.message ?? null },
    recentLeads: recentLeads.data?.map(l => ({
      id: l.id,
      name: `${l.first_name} ${l.last_name}`,
      status: l.lead_status,
      step: l.funnel_step,
      hasAiBio: !!l.ai_bio,
      hasAiContent: !!l.ai_content,
    })),
    leadsError: recentLeads.error?.message ?? null,
    timestamp: now.toISOString(),
  });
}
