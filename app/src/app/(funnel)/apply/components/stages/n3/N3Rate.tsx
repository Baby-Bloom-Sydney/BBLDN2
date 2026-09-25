'use client';

import { useCallback } from 'react';
import { StageProps } from '../../FunnelOrchestrator';
import { MultiSelectTags } from '../../shared/MultiSelectTags';
import { ProgressiveReveal } from '../../shared/ProgressiveReveal';
import { CompoundPageShell } from '../../shared/CompoundPageShell';
import { PAY_FREQUENCY_OPTIONS } from '@/types/nanny-leads';
import { HOURLY_RATE_BOUNDS } from '@/lib/constants';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';

export function N3Rate({ state, dispatch, goNext, goBack, progress, questionNumber }: StageProps) {
  const { salary } = state;

  const update = useCallback(
    (payload: Partial<typeof salary>) => {
      dispatch({ type: 'UPDATE_SALARY', payload });
    },
    [dispatch]
  );

  const rateValue = salary.hourly_rate_min ? parseFloat(salary.hourly_rate_min.replace('£', '')) : 0;
  const hasRate = rateValue >= HOURLY_RATE_BOUNDS.min;

  const canContinue = hasRate && salary.pay_frequency.length > 0;

  const roundToQuarter = (val: number) => Math.ceil(val * 4) / 4;

  return (
    <CompoundPageShell
      title="Your Rate"
      progress={progress}
      showBack={true}
      onBack={goBack}
      questionNumber={questionNumber}
    >
      <div className="flex flex-col gap-5">
        {/* Hourly rate */}
        <div className="flex flex-col gap-2">
          <Label className="text-sm font-medium text-slate-700">
            What hourly rate are you looking for?
          </Label>
          <div className="relative">
            <span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500 font-medium">£</span>
            <input
              type="number"
              min={HOURLY_RATE_BOUNDS.min}
              max={HOURLY_RATE_BOUNDS.max}
              step={0.25}
              value={rateValue || ''}
              onChange={(e) => {
                const val = e.target.value;
                update({ hourly_rate_min: val ? `£${val}` : null });
              }}
              onBlur={() => {
                if (rateValue > 0) {
                  const clamped = Math.min(
                    Math.max(rateValue, HOURLY_RATE_BOUNDS.min),
                    HOURLY_RATE_BOUNDS.max
                  );
                  const rounded = roundToQuarter(clamped);
                  update({ hourly_rate_min: `£${rounded.toFixed(2)}` });
                }
              }}
              placeholder={HOURLY_RATE_BOUNDS.min.toFixed(2)}
              className="w-full pl-8 pr-4 h-11 rounded-lg border border-slate-200 text-sm text-slate-800 focus:border-violet-500 focus:ring-1 focus:ring-violet-500 outline-none"
            />
          </div>
          {salary.hourly_rate_min &&
            rateValue > 0 &&
            rateValue < HOURLY_RATE_BOUNDS.min && (
              <p className="text-xs text-amber-600">
                Minimum rate is £{HOURLY_RATE_BOUNDS.min.toFixed(2)}
              </p>
            )}
          {salary.hourly_rate_min && rateValue > HOURLY_RATE_BOUNDS.max && (
            <p className="text-xs text-amber-600">
              Maximum rate is £{HOURLY_RATE_BOUNDS.max.toFixed(2)}
            </p>
          )}
        </div>

        {/* Pay frequency */}
        <ProgressiveReveal show={hasRate}>
          <div className="flex flex-col gap-2 pt-2">
            <Label className="text-sm font-medium text-slate-700">
              How often are you comfortable with being paid?
            </Label>
            <MultiSelectTags
              options={PAY_FREQUENCY_OPTIONS}
              selected={salary.pay_frequency}
              onChange={(val) => update({ pay_frequency: val })}
            />
          </div>
        </ProgressiveReveal>

        {canContinue && (
          <div className="fixed bottom-0 left-0 right-0 z-20 pt-3 pb-[66px] bg-gradient-to-t from-white from-70% to-transparent">
            <div className="max-w-md mx-auto px-4">
              <Button
                onClick={goNext}
                className="w-full bg-violet-600 hover:bg-violet-700 text-white h-11 px-6 rounded-lg font-medium text-sm"
              >
                Continue
              </Button>
            </div>
          </div>
        )}
      </div>
    </CompoundPageShell>
  );
}
