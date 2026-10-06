/**
 * P7 "Where you are" — UK right to work (unit 3e, BB-LDN-3e-061026).
 * Pins QUESTIONS.md E-1 (British/Irish auto-yes; everyone else is asked; "no" never blocks), E-3 (four options, no
 * "Not sure"), D-5 (no evidence step) and E-6 (the London hard stop is unchanged).
 */
import { useReducer } from 'react';
import { render, screen, fireEvent, within } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { N1Location } from './N1Location';
import { funnelReducer } from '../../FunnelOrchestrator';
import { DEFAULT_FUNNEL_STATE, type NannyLeadFunnelState } from '@/types/nanny-leads';

const RTW_QUESTION = 'Do you have the right to work in the UK?';
const LONDON_QUESTION = 'Are you currently living in London?';
const RTW_LABELS = [
  'British or Irish citizen',
  'Settled or pre-settled status, or indefinite leave',
  'A visa that lets me work in the UK',
  "I don't currently have the right to work in the UK",
];

const DISTRICTS = [{ district: 'Camden', prefix: 'NW1', label: 'Camden, NW1' }];

let latest: NannyLeadFunnelState = DEFAULT_FUNNEL_STATE;
const goNext = vi.fn();

function Harness() {
  const [state, dispatch] = useReducer(funnelReducer, DEFAULT_FUNNEL_STATE);
  latest = state;
  return (
    <N1Location
      state={state}
      dispatch={dispatch}
      goNext={goNext}
      goBack={vi.fn()}
      goToPage={vi.fn()}
      progress={0}
      questionNumber="7"
    />
  );
}

/** The ProgressiveReveal wrapper around a question — hidden questions stay in the DOM at max-h-0. */
function revealOf(question: string): HTMLElement {
  const wrapper = screen.getByText(question).closest('div.transition-all');
  if (!(wrapper instanceof HTMLElement)) throw new Error(`no reveal wrapper for ${question}`);
  return wrapper;
}
const isShown = (question: string) => !revealOf(question).className.includes('max-h-0');

function pickNationality(value: string) {
  fireEvent.change(screen.getByRole('combobox'), { target: { value } });
}

beforeEach(() => {
  goNext.mockReset();
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => ({ json: async () => DISTRICTS })),
  );
});

describe('N1Location — UK right to work (E-1, E-3)', () => {
  it.each(['British', 'Irish'])(
    'returns right_to_work=true and residency_status=citizen without showing the RTW question when nationality is %s',
    (nationality) => {
      render(<Harness />);
      pickNationality(nationality);
      expect(latest.residency.residency_status).toBe('citizen');
      expect(latest.residency.right_to_work).toBe(true);
      expect(isShown(RTW_QUESTION)).toBe(false);
      expect(isShown(LONDON_QUESTION)).toBe(true);
    },
  );

  it.each(['Australian', 'American', 'Polish'])(
    'shows the RTW question when nationality is %s',
    (nationality) => {
      render(<Harness />);
      pickNationality(nationality);
      expect(isShown(RTW_QUESTION)).toBe(true);
      expect(latest.residency.residency_status).toBeNull();
      expect(latest.residency.right_to_work).toBeNull();
    },
  );

  it.each([
    ['citizen', RTW_LABELS[0]],
    ['settled', RTW_LABELS[1]],
    ['visa_with_rtw', RTW_LABELS[2]],
  ])('returns right_to_work=true when the option is %s', (key, label) => {
    render(<Harness />);
    pickNationality('Polish');
    fireEvent.click(within(revealOf(RTW_QUESTION)).getByRole('button', { name: label }));
    expect(latest.residency.residency_status).toBe(key);
    expect(latest.residency.right_to_work).toBe(true);
  });

  it('returns right_to_work=false and still enables Continue when the option is no_rtw', async () => {
    render(<Harness />);
    pickNationality('Polish');
    fireEvent.click(within(revealOf(RTW_QUESTION)).getByRole('button', { name: RTW_LABELS[3] }));
    expect(latest.residency.residency_status).toBe('no_rtw');
    expect(latest.residency.right_to_work).toBe(false);
    expect(isShown(LONDON_QUESTION)).toBe(true);

    fireEvent.click(within(revealOf(LONDON_QUESTION)).getByRole('button', { name: 'Yes' }));
    await screen.findByPlaceholderText('Start typing your area or postcode');
    // districts load on mount; wait for the fetch promise chain to settle before typing
    await new Promise((r) => setTimeout(r, 0));
    fireEvent.change(screen.getByPlaceholderText('Start typing your area or postcode'), {
      target: { value: 'Cam' },
    });
    fireEvent.click(await screen.findByRole('button', { name: 'Camden, NW1' }));

    const cont = screen.getByRole('button', { name: 'Continue' });
    fireEvent.click(cont);
    expect(goNext).toHaveBeenCalledTimes(1);
  });

  it('offers exactly four options, with no "Not sure", when the RTW question shows', () => {
    render(<Harness />);
    pickNationality('American');
    const options = within(revealOf(RTW_QUESTION))
      .getAllByRole('button')
      .map((b) => b.textContent);
    expect(options).toEqual(RTW_LABELS);
    expect(options.some((o) => /not sure/i.test(o ?? ''))).toBe(false);
  });

  it.each(['British', 'Irish', 'Australian', 'American', 'Polish'])(
    'never asks a residency-status question for nationality %s',
    (nationality) => {
      render(<Harness />);
      pickNationality(nationality);
      expect(screen.queryByText(/residency status/i)).toBeNull();
    },
  );

  it('shows the London hard stop with no Continue when "living in London?" is No (E-6)', () => {
    render(<Harness />);
    pickNationality('British');
    fireEvent.click(within(revealOf(LONDON_QUESTION)).getByRole('button', { name: 'No' }));
    expect(screen.getByText(/currently only available in London/)).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Continue' })).toBeNull();
  });

  it('lists British and Irish first in the nationality list', () => {
    render(<Harness />);
    const values = within(screen.getByRole('combobox'))
      .getAllByRole('option')
      .map((o) => (o as HTMLOptionElement).value)
      .filter(Boolean);
    expect(values.slice(0, 2)).toEqual(['British', 'Irish']);
  });
});
