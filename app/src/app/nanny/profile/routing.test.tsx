/**
 * The dead register flow is gone and its two entry links point at the funnel (unit 3e, BB-LDN-3e-061026) —
 * QUESTIONS.md E-4: an incomplete nanny is sent to `/apply`, which ends the `/nanny/profile` ↔ `/nanny/register` loop.
 */
import { render, screen } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

const h = vi.hoisted(() => ({
  redirect: vi.fn((url: string) => {
    throw new Error(`REDIRECT ${url}`);
  }),
  complete: false,
  nanny: null as Record<string, unknown> | null,
}));

vi.mock('next/navigation', () => ({ redirect: h.redirect, useRouter: () => ({ push: vi.fn() }) }));
vi.mock('@/lib/actions/nanny', () => ({
  isProfileComplete: async () => h.complete,
  getNannyProfile: async () => ({ data: null, error: 'not used' }),
}));
vi.mock('./NannyMyProfile', () => ({ NannyMyProfile: () => null }));

function chain(result: unknown) {
  const b: Record<string, unknown> = {
    select: () => b,
    eq: () => b,
    maybeSingle: async () => ({ data: result, error: null }),
  };
  return b;
}
vi.mock('@/lib/supabase/server', () => ({
  createClient: () => ({ auth: { getUser: async () => ({ data: { user: { id: 'u1' } } }) } }),
}));
vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: () => ({
    from: (table: string) => chain(table === 'user_roles' ? { role: 'nanny' } : h.nanny),
  }),
}));

beforeEach(() => {
  h.redirect.mockClear();
});

describe('register flow removed — entry points go to /apply (E-4)', () => {
  it('nanny/profile redirects to /apply when the profile is incomplete', async () => {
    h.complete = false;
    const { default: NannyProfilePage } = await import('./page');
    await expect(NannyProfilePage()).rejects.toThrow('REDIRECT /apply');
    expect(h.redirect).toHaveBeenCalledWith('/apply');
  });

  it('the public apply page CTA is /apply when the nanny is incomplete', async () => {
    h.nanny = {
      visible_in_bsr: false,
      identity_verified: false,
      wwcc_verified: false,
      total_experience_years: null,
      hourly_rate_min: null,
    };
    const { default: NannyApplyPage } = await import('@/app/(public)/nanny/apply/page');
    render(await NannyApplyPage());
    const cta = screen.getByRole('link', { name: /complete your profile/i });
    expect(cta.getAttribute('href')).toBe('/apply');
  });
});
