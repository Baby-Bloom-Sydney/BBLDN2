/**
 * P6 "Your credentials" — DfE ladder, P-2 certificates, the enhanced-DBS gate (unit 3e, BB-LDN-3e-061026).
 * Pins QUESTIONS.md E-2 (ladder labels), BUILD-PLAN P-2 (certificate list, ascending), E-5 (DBS link) and D-1 / E-6
 * (No refuses with no Continue). Expected labels are the brief's text, not read back from the constant.
 */
import { useReducer } from 'react';
import { render, screen, fireEvent, within } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { N1Credentials } from './N1Credentials';
import { funnelReducer } from '../../FunnelOrchestrator';
import { DEFAULT_FUNNEL_STATE } from '@/types/nanny-leads';
import { DBS_LINKS } from '@/lib/constants';

const QUAL_Q = 'Do you have any childcare qualifications?';
const HIGHEST_Q = 'What is the highest childcare qualification you currently hold?';
const CERT_GATE_Q = 'Do you hold any additional desirable certificates?';
const CERT_Q = 'Which certificates do you hold?';
const DBS_Q = 'Do you hold an enhanced DBS check?';

const LADDER_FUNNEL_LABELS = [
  'Other childcare qualification',
  'Level 2 early years',
  'Level 3 early years educator (incl. NNEB / CACHE diploma)',
  'Level 5 / foundation degree in early years',
  'Level 6 — degree in early years, EYTS or QTS',
];
const CERTIFICATES_IN_ORDER = [
  'CPR',
  'First Aid',
  'Emergency Paediatric First Aid (6-hour)',
  'Paediatric First Aid (12-hour)',
];

const goNext = vi.fn();

function Harness() {
  const [state, dispatch] = useReducer(funnelReducer, DEFAULT_FUNNEL_STATE);
  return (
    <N1Credentials
      state={state}
      dispatch={dispatch}
      goNext={goNext}
      goBack={vi.fn()}
      goToPage={vi.fn()}
      progress={0}
      questionNumber="6"
    />
  );
}

/** The block holding one question (label + its tags). */
function blockOf(question: string): HTMLElement {
  const block = screen.getByText(question).parentElement;
  if (!block) throw new Error(`no block for ${question}`);
  return block;
}
const optionsOf = (question: string) =>
  within(blockOf(question))
    .getAllByRole('button')
    .map((b) => b.textContent);

beforeEach(() => goNext.mockReset());

describe('N1Credentials — London ladder, P-2 certificates, DBS gate', () => {
  it('offers exactly the five ladder labels when "any childcare qualifications?" is Yes', () => {
    render(<Harness />);
    fireEvent.click(within(blockOf(QUAL_Q)).getByRole('button', { name: 'Yes' }));
    expect(optionsOf(HIGHEST_Q)).toEqual(LADDER_FUNNEL_LABELS);
  });

  it('offers exactly CERTIFICATE_OPTIONS, in P-2 order, when "additional certificates?" is Yes', () => {
    render(<Harness />);
    fireEvent.click(within(blockOf(QUAL_Q)).getByRole('button', { name: 'Yes' }));
    fireEvent.click(within(blockOf(HIGHEST_Q)).getByRole('button', { name: LADDER_FUNNEL_LABELS[2] }));
    fireEvent.click(within(blockOf(CERT_GATE_Q)).getByRole('button', { name: 'Yes' }));
    expect(optionsOf(CERT_Q)).toEqual(CERTIFICATES_IN_ORDER);
  });

  it('links the no-DBS card to DBS_LINKS.getEnhanced when the answer is No', () => {
    render(<Harness />);
    fireEvent.click(within(blockOf(QUAL_Q)).getByRole('button', { name: 'No' }));
    fireEvent.click(within(blockOf(CERT_GATE_Q)).getByRole('button', { name: 'No' }));
    fireEvent.click(within(blockOf(DBS_Q)).getByRole('button', { name: 'No' }));
    expect(screen.getByText('An enhanced DBS check is required')).toBeTruthy();
    const link = screen.getByRole('link');
    expect(link.getAttribute('href')).toBe(DBS_LINKS.getEnhanced);
  });

  it('shows no Continue when the DBS answer is No (D-1)', async () => {
    render(<Harness />);
    fireEvent.click(within(blockOf(QUAL_Q)).getByRole('button', { name: 'No' }));
    fireEvent.click(within(blockOf(CERT_GATE_Q)).getByRole('button', { name: 'No' }));
    fireEvent.click(within(blockOf(DBS_Q)).getByRole('button', { name: 'No' }));
    await new Promise((r) => setTimeout(r, 500));
    expect(screen.queryByRole('button', { name: /continue/i })).toBeNull();
    expect(goNext).not.toHaveBeenCalled();
  });
});
