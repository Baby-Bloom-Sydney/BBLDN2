/**
 * The live AI checklist's "Accreditations" block lists certificates in 3a's order (unit 3e, BB-LDN-3e-061026) —
 * BUILD-PLAN P-2. The brief named the V1 block in `lib/actions/nanny.ts`; that generator was reachable only from the
 * deleted `createNannyProfile`, so the order is pinned on `generateV2Checklist`, the one every live caller uses
 * (LEDGER/3e.md §2(2)).
 */
import { describe, it, expect } from 'vitest';
import { generateV2Checklist } from './nanny-profile-prompts';

const base = {
  personalityTraits: [],
  childcareRoles: [],
  totalExperience: null,
  under3Experience: null,
  newbornExperience: null,
  highestQualification: null,
  roleTypes: [],
  levelOfSupport: [],
  minAge: null,
  maxAge: null,
  driversLicense: null,
  hasCar: null,
  comfortableWithPets: null,
  vaccinationStatus: null,
  nonSmoker: null,
};

describe('generateV2Checklist — Accreditations order (P-2)', () => {
  it('lists stored certificates in CERTIFICATE_OPTIONS order, whatever the stored order', () => {
    const html = generateV2Checklist({
      ...base,
      certificates: ['Paediatric First Aid (12-hour)', 'First Aid', 'CPR'],
    } as Parameters<typeof generateV2Checklist>[0]);
    const block = html.split('<strong>Accreditations</strong>')[1] ?? '';
    const items = block.split('<br>').filter((l) => l.startsWith('✅')).map((l) => l.slice(2));
    expect(items).toEqual(['CPR', 'First Aid', 'Paediatric First Aid (12-hour)']);
  });
});
