import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { createClient } from '@/lib/supabase/server';

const BUCKET = 'profile-pictures';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** An applicant's lead with no account yet, or a signed-in nanny. */
async function mayUpload(admin: ReturnType<typeof createAdminClient>, leadId: unknown): Promise<boolean> {
  if (typeof leadId === 'string' && UUID.test(leadId)) {
    const { data: lead } = await admin
      .from('nanny_leads')
      .select('id')
      .eq('id', leadId)
      .is('auth_user_id', null)
      .maybeSingle();
    if (lead) return true;
  }
  const { data: { user } } = await createClient().auth.getUser();
  if (!user) return false;
  const { data: nanny } = await admin.from('nannies').select('id').eq('user_id', user.id).maybeSingle();
  return Boolean(nanny);
}

export async function POST(request: NextRequest) {
  try {
    const formData = await request.formData();
    const file = formData.get('file') as File | null;
    const adminClient = createAdminClient();

    if (!(await mayUpload(adminClient, formData.get('leadId')))) {
      return NextResponse.json({ error: 'Not allowed to upload' }, { status: 401 });
    }

    if (!file) {
      return NextResponse.json({ error: 'No file provided' }, { status: 400 });
    }

    if (!file.type.startsWith('image/')) {
      return NextResponse.json({ error: 'File must be an image' }, { status: 400 });
    }

    // 10MB limit
    if (file.size > 10 * 1024 * 1024) {
      return NextResponse.json({ error: 'Image must be under 10MB' }, { status: 400 });
    }

    // One folder for every funnel photo: the lead id never goes in a path in this public bucket
    const folder = 'anonymous';
    const timestamp = Date.now();
    const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, '_');
    const filePath = `leads/${folder}/${timestamp}-${safeName}`;

    const buffer = Buffer.from(await file.arrayBuffer());

    const { error: uploadError } = await adminClient.storage
      .from(BUCKET)
      .upload(filePath, buffer, {
        contentType: file.type,
        cacheControl: '3600',
        upsert: false,
      });

    if (uploadError) {
      console.error('Supabase storage upload error:', uploadError);
      return NextResponse.json(
        { error: 'Failed to upload photo' },
        { status: 500 }
      );
    }

    const { data } = adminClient.storage.from(BUCKET).getPublicUrl(filePath);

    return NextResponse.json({
      url: data.publicUrl,
      path: filePath,
    });
  } catch (error) {
    console.error('Photo upload error:', error);
    return NextResponse.json(
      { error: 'Failed to upload photo' },
      { status: 500 }
    );
  }
}
