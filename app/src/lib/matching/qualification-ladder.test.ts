/**
 * One ladder, every reader (unit 3e, BB-LDN-3e-061026).
 * Pins QUESTIONS.md E-2 (scores Other 10 · L2 30 · L3 50 · L5 75 · L6 100), BUILD-PLAN P-6 (higher-qualification
 * bonus = Level 5 and Level 6), P-2 (certificate + assurance order = array order) and E-7 (the paediatric collapse).
 * The static block proves no reader redeclares a list 3a owns.
 *
 * The stale-data guard uses a neutral label not on the ladder rather than a retired Sydney label: the build never
 * writes an Australian literal to assert its absence (LEDGER/2-0.md §8(3)); any off-ladder value takes the same path.
 */
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, it, expect } from 'vitest';
import { QUAL_SCORES, OQ_BONUSES } from './constants';
import { calculateOverQualifiedMultiplier, scoreQualifications } from './scoring';
import { ladderShortLabel, displayCertificates } from './qualification-display';
import type { NannyCredentialData, NannyMatchData, PositionMatchData } from './types';

const OTHER = 'Other childcare qualification';
const L2 = 'Level 2 early years';
const L3 = 'Level 3 early years educator (incl. NNEB / CACHE diploma)';
const L5 = 'Level 5 / foundation degree in early years';
const L6 = 'Level 6 — degree in early years, EYTS or QTS';
const OFF_LADDER = 'A qualification label that is not on the ladder';

const position = {} as unknown as PositionMatchData;
const nanny = {} as unknown as NannyMatchData;
const qual = (qualification_type: string): NannyCredentialData => ({
  nanny_id: 'n1',
  credential_category: 'qualification',
  qualification_type,
  certification_type: null,
});
const cert = (certification_type: string): NannyCredentialData => ({
  nanny_id: 'n1',
  credential_category: 'certification',
  qualification_type: null,
  certification_type,
});
const oq = (creds: NannyCredentialData[]) => calculateOverQualifiedMultiplier(position, nanny, creds, null);

describe('the qualification ladder — scores (E-2)', () => {
  it.each([
    [OTHER, 10],
    [L2, 30],
    [L3, 50],
    [L5, 75],
    [L6, 100],
  ])('returns score for %s = %i through QUAL_SCORES', (label, score) => {
    expect(QUAL_SCORES[label]).toBe(score);
  });

  it('returns 0, and shows no label, when given a value not on the ladder (stale-data guard)', () => {
    expect(QUAL_SCORES[OFF_LADDER] ?? 0).toBe(0);
    expect(scoreQualifications([qual(OFF_LADDER)])).toBe(scoreQualifications([]));
    expect(ladderShortLabel(OFF_LADDER)).toBe('');
    expect(oq([qual(OFF_LADDER)]).bonuses).toEqual([]);
  });
});

describe('the higher-qualification bonus (P-6)', () => {
  it.each([L5, L6])('applies the bonus when the best qualification is %s', (label) => {
    expect(oq([qual(label)]).multiplier).toBeCloseTo(OQ_BONUSES.higherQualification, 10);
  });

  it.each([L3, L2, OTHER])('does not apply the bonus when the best qualification is %s', (label) => {
    expect(oq([qual(label)]).multiplier).toBe(1);
  });
});

describe('short labels', () => {
  it.each([
    ['No Qualifications', 'None'],
    [OTHER, 'Other qualification'],
    [L2, 'Level 2 Early Years'],
    [L3, 'Level 3 Early Years'],
    [L5, 'Level 5 Early Years'],
    [L6, 'Degree / EYTS / QTS'],
  ])('returns the short label for %s', (label, short) => {
    expect(ladderShortLabel(label)).toBe(short);
  });

  it('shows the short label in the match bonuses for a ranked rung, and none for Other', () => {
    expect(oq([qual(L3)]).bonuses).toEqual(['Level 3 Early Years']);
    expect(oq([qual(OTHER)]).bonuses).toEqual([]);
  });
});

describe('certificate display (E-7 collapse, P-2 order)', () => {
  it('returns "Paediatric First Aid" and hides plain "First Aid" when both are held', () => {
    expect(displayCertificates(['First Aid', 'Paediatric First Aid (12-hour)'])).toEqual(['Paediatric First Aid']);
  });

  it('collapses both paediatric courses into one label', () => {
    expect(
      displayCertificates(['Emergency Paediatric First Aid (6-hour)', 'CPR', 'Paediatric First Aid (12-hour)']),
    ).toEqual(['CPR', 'Paediatric First Aid']);
  });

  it('keeps plain "First Aid" when no paediatric course is held, in P-2 order', () => {
    expect(displayCertificates(['First Aid', 'CPR'])).toEqual(['CPR', 'First Aid']);
  });

  it('feeds the match bonuses through the same collapse', () => {
    expect(oq([cert('First Aid'), cert('Emergency Paediatric First Aid (6-hour)')]).bonuses).toEqual([
      'Paediatric First Aid',
    ]);
  });
});

// ── Static: declared vs used — no reader keeps its own copy of a list 3a owns ──

const SRC = path.resolve(__dirname, '..', '..');
const OWNER = path.join('lib', 'nanny-options.ts');

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return entry.name === 'node_modules' ? [] : sourceFiles(full);
    return /\.(ts|tsx)$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name) ? [full] : [];
  });
}

const files = sourceFiles(SRC).filter((f) => !f.endsWith(OWNER));
const read = (f: string) => readFileSync(f, 'utf8');
const rel = (f: string) => path.relative(SRC, f);

describe('static — no redeclared ladder, certificate, assurance or RTW list (declared vs used)', () => {
  it.each([
    ['CERT_ORDER', /\bCERT_ORDER\b/],
    ['a local ASSURANCE_OPTIONS list', /\bASSURANCE_OPTIONS\s*=\s*\[/],
    ['a local CERTIFICATE_OPTIONS list', /\bCERTIFICATE_OPTIONS\s*=\s*\[/],
    ['RESIDENCY_STATUS_OPTIONS', /\bRESIDENCY_STATUS_OPTIONS\b/],
    ['QUALIFICATION_OPTIONS', /\bQUALIFICATION_OPTIONS\b/],
    ['a local qualification rank map', /\b(?:MATCH_)?QUAL_RANK\b/],
    ['a local qualification abbreviation map', /\bQUAL_ABBREV\b/],
  ])('finds no %s outside lib/nanny-options.ts', (_name, pattern) => {
    const offenders = files.filter((f) => pattern.test(read(f))).map(rel);
    expect(offenders).toEqual([]);
  });

  it.each([
    'app/nanny/NannyHubClient.tsx',
    'app/nanny/profile/NannyMyProfile.tsx',
    'app/parent/browse/[id]/ParentNannyProfileView.tsx',
  ])('orders certificates in %s with byOptionOrder(CERTIFICATE_OPTIONS)', (file) => {
    expect(read(path.join(SRC, file))).toMatch(/byOptionOrder\(CERTIFICATE_OPTIONS\)/);
  });
});
