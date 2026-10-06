/**
 * Profile edit tags read 3a's lists (unit 3e, BB-LDN-3e-061026) — BUILD-PLAN P-2 (two ascending lists, array order =
 * display order) and E-2 (the qualification edit list is the ladder). Exact-list equality also proves the dropped
 * entries are gone without writing them here (LEDGER/2-0.md §8(3)).
 */
import { render, screen, fireEvent, within } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import type { NannyProfile } from '@/lib/actions/nanny';

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }) }));
vi.mock('next/image', () => ({ default: () => null }));
vi.mock('@/lib/supabase/client', () => ({ createClient: () => ({}) }));
vi.mock('@/lib/supabase/storage', () => ({ uploadFile: vi.fn() }));
vi.mock('@/lib/actions/nanny', () => ({
  updateNannyProfile: vi.fn(),
  updateNannyAIContent: vi.fn(),
  regenerateNannyAIContent: vi.fn(),
}));

import { NannyMyProfile } from './NannyMyProfile';

const profile = {
  first_name: 'Test',
  last_name: 'Nanny',
  email: 'nanny-3e@example.test',
  suburb: 'Camden',
  postcode: 'NW1',
  languages: [],
  role_types_preferred: [],
  level_of_support_offered: [],
  pay_frequency: [],
  personality_traits: [],
  professional_values: [],
  childcare_roles: [],
  highest_qualification: 'Level 3 early years educator (incl. NNEB / CACHE diploma)',
  certificates: ['First Aid', 'CPR'],
  assurances: ['Ofsted Childcare Register', 'References'],
  availability: null,
  ai_content: null,
  nanny_id: 'n1',
} as unknown as NannyProfile;

function openExperienceTab() {
  fireEvent.click(screen.getByRole('button', { name: 'Experience' }));
}

function tagsUnder(label: string): string[] {
  const block = screen.getByText(label, { selector: 'label' }).parentElement;
  if (!block) throw new Error(`no block for ${label}`);
  return within(block)
    .getAllByRole('button')
    .map((b) => b.textContent ?? '');
}

describe('NannyMyProfile — edit tags read 3a lists (P-2)', () => {
  it('offers exactly ASSURANCE_OPTIONS, References → Ofsted Childcare Register, in the edit tags', () => {
    render(<NannyMyProfile profile={profile} />);
    fireEvent.click(screen.getByTitle('Edit Profile'));
    openExperienceTab();
    expect(tagsUnder('Assurances')).toEqual([
      'References',
      'Food Hygiene (Level 2)',
      'Safeguarding / Child Protection training',
      'Common Core Skills',
      'Ofsted Childcare Register',
    ]);
  });

  it('offers exactly CERTIFICATE_OPTIONS in P-2 order in the edit tags', () => {
    render(<NannyMyProfile profile={profile} />);
    fireEvent.click(screen.getByTitle('Edit Profile'));
    openExperienceTab();
    expect(tagsUnder('Certificates')).toEqual([
      'CPR',
      'First Aid',
      'Emergency Paediatric First Aid (6-hour)',
      'Paediatric First Aid (12-hour)',
    ]);
  });

  it('shows stored certificates in P-2 order, whatever the stored order', () => {
    render(<NannyMyProfile profile={profile} />);
    openExperienceTab();
    const heading = screen.getByText('Safety & Assurance');
    const card = heading.closest('div.rounded-2xl');
    if (!(card instanceof HTMLElement)) throw new Error('no Safety & Assurance card');
    const text = card.textContent ?? '';
    expect(text.indexOf('CPR')).toBeGreaterThan(-1);
    expect(text.indexOf('CPR')).toBeLessThan(text.indexOf('First Aid'));
  });

  it('shows the ladder short label on the qualification badge', () => {
    render(<NannyMyProfile profile={profile} />);
    expect(screen.getAllByText('Level 3 Early Years').length).toBeGreaterThan(0);
  });
});
