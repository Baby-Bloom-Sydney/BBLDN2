/**
 * The admin gate every admin server action calls first (unit 3d, brief change 1 — moved unchanged out of
 * `lib/actions/admin.ts` so `lib/actions/admin-dbs.ts` shares it).
 *
 * Plain server module, deliberately NOT `'use server'`: a `'use server'` export is callable from the browser, and this
 * helper must never be an action of its own.
 *
 * Contract
 * - Input: the request's session (cookie client). Output: `{ userId, error: null }` for `admin` / `super_admin`;
 *   otherwise `{ userId: '', error }` — "Not authenticated" or "Not authorized — admin role required".
 * - Fails closed: no session, no role row, or any other role → error.
 * - Never: trusts a client-supplied user id, or uses the service-role client to read the role.
 */
import { createClient } from '@/lib/supabase/server';

export async function requireAdmin(): Promise<{ userId: string; error: string | null }> {
  const supabase = createClient();
  const { data: { user }, error: authError } = await supabase.auth.getUser();
  if (authError || !user) return { userId: '', error: 'Not authenticated' };

  const { data: role } = await supabase
    .from('user_roles')
    .select('role')
    .eq('user_id', user.id)
    .single();

  if (!role || !['admin', 'super_admin'].includes(role.role)) {
    return { userId: '', error: 'Not authorized — admin role required' };
  }
  return { userId: user.id, error: null };
}
