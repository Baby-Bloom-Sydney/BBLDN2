import { notFound } from 'next/navigation';
import { requireAdmin } from '@/lib/admin/require-admin';
import { ProfileTestClient } from './ProfileTestClient';

/**
 * Demo sandbox — admin only (5a, R-1). The middleware already admits only
 * admins to this path; this check is the second lock: anyone else gets a 404.
 */
export default async function ProfileTestPage() {
  const { error } = await requireAdmin();
  if (error) notFound();

  return (
    <div className="mx-auto max-w-2xl space-y-3 py-6 px-4">
      <div className="mb-4 rounded-lg border border-amber-200 bg-amber-50 px-4 py-2">
        <p className="text-xs text-amber-700 font-medium">Profile Test Page — brainstorming sandbox with mock data</p>
      </div>
      <ProfileTestClient />
    </div>
  );
}
