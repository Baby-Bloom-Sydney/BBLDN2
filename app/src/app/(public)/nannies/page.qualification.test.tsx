/**
 * The public "top nannies" list breaks experience ties on the ladder rank (unit 3e, BB-LDN-3e-061026) — QUESTIONS.md
 * E-2. Same experience, so the order is decided by qualification alone: L6 → L3 → off-ladder.
 */
import { render, screen } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';

const ROWS: Record<string, unknown[]> = {
  nannies: ['off', 'l3', 'l6'].map((id) => ({
    id,
    user_id: `u-${id}`,
    total_experience_years: 4,
    under_3_experience_years: null,
    verification_level: 4,
    ai_content: null,
  })),
  user_profiles: ['off', 'l3', 'l6'].map((id) => ({
    user_id: `u-${id}`,
    first_name: id,
    suburb: 'Balham',
    profile_picture_url: null,
    date_of_birth: null,
  })),
  nanny_credentials: [
    { nanny_id: 'off', qualification_type: 'A label not on the ladder' },
    { nanny_id: 'l3', qualification_type: 'Level 3 early years educator (incl. NNEB / CACHE diploma)' },
    { nanny_id: 'l6', qualification_type: 'Level 6 — degree in early years, EYTS or QTS' },
  ],
};
function chain(table: string) {
  const b: Record<string, unknown> = {
    select: () => b,
    eq: () => b,
    in: () => b,
    then: (resolve: (v: unknown) => unknown) => resolve({ data: ROWS[table], error: null }),
  };
  return b;
}
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: () => ({ from: chain }) }));
vi.mock('@/components/landing/NannyPreviewCard', () => ({
  NannyPreviewCard: ({ nanny }: { nanny: { first_name: string } }) => <div data-testid="preview">{nanny.first_name}</div>,
}));

import BrowseNanniesPage from './page';

describe('(public)/nannies — qualification tiebreak uses the ladder rank', () => {
  it('orders equal-experience nannies L6 → L3 → off-ladder', async () => {
    render(await BrowseNanniesPage());
    expect(screen.getAllByTestId('preview').map((e) => e.textContent)).toEqual(['l6', 'l3', 'off']);
  });
});
