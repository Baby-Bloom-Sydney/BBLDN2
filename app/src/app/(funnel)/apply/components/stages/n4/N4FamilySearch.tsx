'use client';

import { useState, useEffect, useMemo, useRef } from 'react';
import { StageProps } from '../../FunnelOrchestrator';
import { AnimatedChecklist } from '../../shared/AnimatedChecklist';
import { generateOnboardingAIContent } from '@/lib/actions/nanny-onboarding-ai';
import { PartyPopper, Loader2 } from 'lucide-react';

const SPINNER_MESSAGES = [
  'Reviewing your experience...',
  'Nannies like you are in high demand in your area...',
  'Preparing something special for you...',
];

export function N4FamilySearch({ state, dispatch, goNext }: StageProps) {
  const [phase, setPhase] = useState<'checklist' | 'celebration'>('checklist');
  const [spinnerMsg, setSpinnerMsg] = useState(SPINNER_MESSAGES[0]);
  const [checklistDone, setChecklistDone] = useState(false);
  const bioGenStarted = useRef(false);
  const spinnerIdx = useRef(0);

  // Start AI content generation in background (with retry)
  useEffect(() => {
    if (bioGenStarted.current || !state.leadId) return;
    bioGenStarted.current = true;

    async function runWithRetry(leadId: string, attempts = 2) {
      for (let i = 0; i < attempts; i++) {
        try {
          const result = await generateOnboardingAIContent(leadId);
          if (result.success) {
            if (result.bio) dispatch({ type: 'SET_AI_BIO', payload: result.bio });
            if (result.aiContent) dispatch({ type: 'SET_AI_CONTENT', payload: result.aiContent });
            return;
          }
          console.error(`[N4] AI generation attempt ${i + 1} failed:`, result.error);
        } catch (err) {
          console.error(`[N4] AI generation attempt ${i + 1} threw:`, err);
        }
        // Wait 2s before retry
        if (i < attempts - 1) await new Promise((r) => setTimeout(r, 2000));
      }
      console.error('[N4] AI generation failed after all retries');
    }

    runWithRetry(state.leadId);
  }, [state.leadId, dispatch]);

  // After checklist completes, cycle spinner messages then show celebration
  useEffect(() => {
    if (!checklistDone) return;

    // Cycle through remaining spinner messages, then celebration
    const interval = setInterval(() => {
      spinnerIdx.current++;
      if (spinnerIdx.current >= SPINNER_MESSAGES.length) {
        clearInterval(interval);
        setPhase('celebration');
      } else {
        setSpinnerMsg(SPINNER_MESSAGES[spinnerIdx.current]);
      }
    }, 1500);

    return () => clearInterval(interval);
  }, [checklistDone]);

  // Auto-advance from celebration after 3 seconds
  useEffect(() => {
    if (phase !== 'celebration') return;
    const timer = setTimeout(goNext, 3000);
    return () => clearTimeout(timer);
  }, [phase, goNext]);

  // Build search items from N3 preferences
  const searchItems = useMemo(() => {
    const items: Array<{ label: string; value: string }> = [];
    const { preferences, residency, availability, salary } = state;

    if (preferences.role_types.length > 0) {
      items.push({
        label: 'Services',
        value: `Searching for ${preferences.role_types.join(', ')} positions...`,
      });
    }

    if (residency.suburb) {
      items.push({
        label: 'Location',
        value: `In ${residency.suburb} and surrounding areas...`,
      });
    }

    if (preferences.min_age || preferences.max_age) {
      const ageStr = preferences.min_age && preferences.max_age
        ? `Families with children aged ${preferences.min_age} – ${preferences.max_age}...`
        : preferences.min_age
        ? `Families with children from ${preferences.min_age}...`
        : `Families with children up to ${preferences.max_age}...`;
      items.push({ label: 'Age range', value: ageStr });
    }

    if (preferences.max_children) {
      items.push({
        label: 'Children',
        value: `Up to ${preferences.max_children} ${preferences.max_children === 1 ? 'child' : 'children'}...`,
      });
    }

    if (availability.available_days.length > 0) {
      const dayStr = availability.available_days.length >= 5
        ? 'Weekday positions...'
        : `${availability.available_days.slice(0, 3).join(', ')} positions...`;
      items.push({ label: 'Availability', value: dayStr });
    }

    if (salary.hourly_rate_min) {
      items.push({
        label: 'Rate',
        value: `Matching ${salary.hourly_rate_min}/hr roles...`,
      });
    }

    return items;
  }, [state]);

  if (phase === 'celebration') {
    return (
      <div className="flex flex-col items-center gap-6 py-16 animate-in fade-in zoom-in-95 duration-500">
        <div className="w-16 h-16 rounded-full bg-emerald-100 flex items-center justify-center">
          <PartyPopper className="w-8 h-8 text-emerald-600" />
        </div>
        <div className="text-center max-w-sm">
          <h2 className="text-2xl font-bold text-slate-800">
            Good news!
          </h2>
          <p className="mt-3 text-sm text-slate-600 leading-relaxed">
            There are multiple families looking for a nanny like you that match your requirements and availability.
          </p>
        </div>
      </div>
    );
  }

  // Combined checklist + spinner on one page
  return (
    <div className="flex flex-col items-center gap-8 py-8">
      <h2 className="text-xl font-semibold text-slate-700 text-center">
        Finding your perfect families...
      </h2>
      <div className="w-full max-w-md">
        <AnimatedChecklist
          items={searchItems}
          onComplete={() => setChecklistDone(true)}
          intervalMs={800}
        />
      </div>

      {/* Inline spinner appears below checklist after it completes */}
      {checklistDone && (
        <div className="flex items-center gap-3 animate-in fade-in duration-300">
          <Loader2 className="w-5 h-5 text-violet-500 animate-spin" />
          <p className="text-sm text-slate-600">{spinnerMsg}</p>
        </div>
      )}
    </div>
  );
}
