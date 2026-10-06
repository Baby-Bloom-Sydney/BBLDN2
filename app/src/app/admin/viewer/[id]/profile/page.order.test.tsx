/**
 * Admin viewer profile lists stored certificates and assurances in 3a's order (unit 3e, BB-LDN-3e-061026) —
 * BUILD-PLAN P-2: array order = display order, whatever the insert order; an unknown stored value goes last.
 */
import { describe, it, expect, vi } from 'vitest';
import type { ReactElement } from 'react';

vi.mock('next/navigation', () => ({ redirect: vi.fn() }));
vi.mock('@/app/nanny/profile/NannyMyProfile', () => ({ NannyMyProfile: () => null }));
vi.mock('@/lib/supabase/server', () => ({
  createClient: () => ({ auth: { getUser: async () => ({ data: { user: { id: 'admin-1' } } }) } }),
}));

const ROWS: Record<string, unknown> = {
  user_roles: { role: 'nanny' },
  user_profiles: { first_name: 'Test', last_name: 'Nanny', profile_picture_url: null },
  nannies: { id: 'n1', profile_picture_url: null, ai_content: null },
  nanny_credentials: [
    { credential_category: 'certification', qualification_type: null, certification_type: 'Paediatric First Aid (12-hour)' },
    { credential_category: 'certification', qualification_type: null, certification_type: 'A stored value not on the list' },
    { credential_category: 'certification', qualification_type: null, certification_type: 'CPR' },
  ],
  nanny_assurances: [
    { assurance_type: 'Ofsted Childcare Register' },
    { assurance_type: 'References' },
    { assurance_type: 'Food Hygiene (Level 2)' },
  ],
  nanny_availability: null,
};

function chain(table: string) {
  const done = async () => ({ data: ROWS[table], error: null });
  const b: Record<string, unknown> = {
    select: () => b,
    eq: () => b,
    single: done,
    maybeSingle: done,
    then: (resolve: (v: unknown) => unknown) => resolve({ data: ROWS[table], error: null }),
  };
  return b;
}
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: () => ({ from: chain }) }));

import AdminViewerProfilePage from './page';

describe('admin viewer profile — stored lists in P-2 order', () => {
  it('lists stored certificates and assurances in constant order, whatever the insert order', async () => {
    const el = (await AdminViewerProfilePage({ params: { id: 'u1' } })) as ReactElement<{
      profile: { certificates: string[]; assurances: string[] };
    }>;
    expect(el.props.profile.certificates).toEqual([
      'CPR',
      'Paediatric First Aid (12-hour)',
      'A stored value not on the list',
    ]);
    expect(el.props.profile.assurances).toEqual(['References', 'Food Hygiene (Level 2)', 'Ofsted Childcare Register']);
  });
});
