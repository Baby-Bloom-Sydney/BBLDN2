/**
 * Parent-facing qualification / certificate readers read 3a's constants (unit 3e, BB-LDN-3e-061026) — QUESTIONS.md
 * E-2 (ladder rank + short label), BUILD-PLAN P-2 (certificate order = array order, unknown values last).
 */
import { render, screen, fireEvent, within } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import type { MatchResult } from '@/lib/matching/types';
import type { PublicNannyProfile } from '@/lib/actions/nanny';

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn() }), usePathname: () => '/' }));
vi.mock('@/app/brandkit1/NannyMatchCardBK', () => ({
  NannyMatchCardBK: ({ match }: { match: MatchResult }) => <div data-testid="match">{match.nannyId}</div>,
}));
vi.mock('@/components/ConnectModal', () => ({ ConnectModal: () => null }));
vi.mock('@/app/brandkit1/NannyCardBK', () => ({
  NannyCardBK: ({ nanny }: { nanny: { id: string } }) => <div data-testid="card">{nanny.id}</div>,
}));
const browse = vi.hoisted(() => ({ nannies: [] as Array<{ id: string; highest_qualification: string | null }>, matches: [] as unknown[] }));
vi.mock('@/lib/actions/browse', () => ({
  fetchBrowseNannies: async () => ({ nannies: browse.nannies, total: browse.nannies.length }),
}));
vi.mock('@/lib/actions/matching', () => ({
  getMatchesForPosition: async () => ({ data: { matches: browse.matches, stats: { totalEligible: 3, returned: 3 } } }),
}));
vi.mock('@/lib/actions/parent', () => ({ getPosition: async () => ({ data: { id: 'p1' } }) }));
vi.mock('@/components/landing/InlineQuickMatch', () => ({ InlineQuickMatch: () => null }));

import { BrowseMatchesClient } from './BrowseMatchesClient';
import { ParentNannyProfileView } from './[id]/ParentNannyProfileView';
import { NannyPreviewCard } from '@/components/landing/NannyPreviewCard';
import { abbreviateQualification } from '@/app/brandkit1/ExpandableBadges';
import { BrowseNanniesTab } from '@/components/parent/BrowseNanniesTab';

const L3 = 'Level 3 early years educator (incl. NNEB / CACHE diploma)';
const L6 = 'Level 6 — degree in early years, EYTS or QTS';

describe('BrowseMatchesClient — Qualifications sort uses the ladder rank', () => {
  it('orders L6 before L3 before an off-ladder value', () => {
    const m = (nannyId: string, highestQualification: string | null) =>
      ({ nannyId, highestQualification, finalScore: 50, distanceKm: 1 }) as unknown as MatchResult;
    render(
      <BrowseMatchesClient
        matches={[m('off', 'A label not on the ladder'), m('l3', L3), m('l6', L6)]}
        stats={{ totalEligible: 3, returned: 3 }}
      />,
    );
    fireEvent.click(screen.getByTitle('Qualifications'));
    expect(screen.getAllByTestId('match').map((e) => e.textContent)).toEqual(['l6', 'l3', 'off']);
  });
});

describe('ParentNannyProfileView — certificates in P-2 order', () => {
  it('lists stored certificates in CERTIFICATE_OPTIONS order with unknown values last', () => {
    const nanny = {
      nanny_id: 'n1',
      user_id: 'u1',
      first_name: 'walk',
      last_name: 'nanny',
      suburb: 'Balham',
      certificates: ['A certificate not on the list', 'Paediatric First Aid (12-hour)', 'CPR'],
      languages: [],
      role_types_preferred: [],
      level_of_support_offered: [],
      pay_frequency: [],
    } as unknown as PublicNannyProfile;
    render(<ParentNannyProfileView nanny={nanny} />);
    fireEvent.click(screen.getAllByRole('button', { name: 'Experience' })[0]);
    const card = screen.getByText('Safety & Assurance').closest('div.rounded-2xl');
    if (!(card instanceof HTMLElement)) throw new Error('no Safety & Assurance card');
    const text = card.textContent ?? '';
    const at = (s: string) => text.indexOf(s);
    expect(at('CPR')).toBeGreaterThan(-1);
    expect(at('CPR')).toBeLessThan(at('Paediatric First Aid (12-hour)'));
    expect(at('Paediatric First Aid (12-hour)')).toBeLessThan(at('A certificate not on the list'));
  });
});

describe('card badges read the ladder short label', () => {
  it('NannyPreviewCard shows "Degree / EYTS / QTS" for Level 6', () => {
    render(
      <NannyPreviewCard
        nanny={{
          id: 'n1',
          first_name: 'Walk',
          suburb: 'Balham',
          profile_picture_url: null,
          age: null,
          total_experience_years: null,
          under_3_experience_years: null,
          newborn_experience_years: null,
          highest_qualification: L6,
          verified: false,
          ai_headline: null,
        }}
      />,
    );
    expect(within(document.body).getByText('Degree / EYTS / QTS')).toBeTruthy();
  });

  it('abbreviateQualification returns the short label, and nothing for "No Qualifications"', () => {
    expect(abbreviateQualification(L3)).toBe('Level 3 Early Years');
    expect(abbreviateQualification('No Qualifications')).toBe('');
  });
});

describe('BrowseNanniesTab — both Qualification sorts use the ladder rank', () => {
  it('orders all nannies L6 → L3 → off-ladder on "Qualification"', async () => {
    browse.nannies = [
      { id: 'off', highest_qualification: 'A label not on the ladder' },
      { id: 'l3', highest_qualification: L3 },
      { id: 'l6', highest_qualification: L6 },
    ];
    render(<BrowseNanniesTab />);
    fireEvent.click(await screen.findByTitle('Qualification'));
    await screen.findAllByTestId('card');
    await new Promise((r) => setTimeout(r, 0));
    expect(screen.getAllByTestId('card').map((e) => e.textContent)).toEqual(['l6', 'l3', 'off']);
  });

  it('orders matches L6 → L3 → off-ladder on "Qualifications"', async () => {
    const m = (nannyId: string, highestQualification: string) =>
      ({ nannyId, highestQualification, finalScore: 50, distanceKm: 1, nanny: {} }) as unknown as MatchResult;
    browse.matches = [m('off', 'A label not on the ladder'), m('l3', L3), m('l6', L6)];
    render(<BrowseNanniesTab initialView="matches" />);
    await screen.findAllByTestId('match');
    fireEvent.click(screen.getByTitle('Qualifications'));
    expect(screen.getAllByTestId('match').map((e) => e.textContent)).toEqual(['l6', 'l3', 'off']);
  });
});
