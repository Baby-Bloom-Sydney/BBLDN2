'use client';

import { useState, useCallback } from 'react';
import { StageProps } from '../../FunnelOrchestrator';
import { PhotoUpload } from '../../shared/PhotoUpload';
import { CompoundPageShell } from '../../shared/CompoundPageShell';
import { updateNannyLead } from '@/lib/actions/nanny-leads';
import { Button } from '@/components/ui/button';
import { Loader2 } from 'lucide-react';

export function N3Photos({ state, dispatch, goNext, goBack, progress, questionNumber }: StageProps) {
  const { about_you } = state;
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const update = useCallback(
    (payload: Partial<typeof about_you>) => {
      dispatch({ type: 'UPDATE_ABOUT_YOU', payload });
    },
    [dispatch]
  );

  const hasProfilePhoto = about_you.profile_picture_url !== null;

  const handleSubmit = async () => {
    if (!state.leadId || !hasProfilePhoto) return;

    setSubmitting(true);
    setError(null);

    const result = await updateNannyLead(state.leadId, {
      preferences: state.preferences,
      availability: state.availability,
      salary: state.salary,
      matching: state.matching,
      about_you: state.about_you,
      funnel_step: 'N3',
    });

    if (result.success) {
      goNext();
    } else {
      setError(result.error || 'Failed to save. Please try again.');
    }

    setSubmitting(false);
  };

  return (
    <CompoundPageShell
      title="Show Them Who You Are"
      subtitle="Now that we know which families to match you with, let's show them who will be caring for their little ones."
      progress={progress}
      showBack={true}
      onBack={goBack}
      questionNumber={questionNumber}
    >
      <div className="flex flex-col gap-6 items-center pt-4">
        {/* Profile picture (required) — centered, circular, larger */}
        <div className="flex flex-col items-center gap-2">
          <label className="text-sm font-medium text-slate-700">
            Profile picture <span className="text-red-400">*</span>
          </label>
          <PhotoUpload
            leadId={state.leadId}
            value={about_you.profile_picture_url}
            onChange={(url) => update({ profile_picture_url: url })}
            label="Profile photo"
            required
            circular
            size="lg"
          />
        </div>

        {/* Additional photos */}
        <div className="flex flex-col items-center gap-2">
          <label className="text-sm font-medium text-slate-700">
            Additional photos
          </label>
          <div className="grid grid-cols-3 gap-3 w-full max-w-xs">
            <PhotoUpload
              leadId={state.leadId}
              value={about_you.photo_1_url}
              onChange={(url) => update({ photo_1_url: url })}
              label="Photo 1"
            />
            <PhotoUpload
              leadId={state.leadId}
              value={about_you.photo_2_url}
              onChange={(url) => update({ photo_2_url: url })}
              label="Photo 2"
            />
            <PhotoUpload
              leadId={state.leadId}
              value={about_you.photo_3_url}
              onChange={(url) => update({ photo_3_url: url })}
              label="Photo 3"
            />
          </div>
          <p className="text-xs text-slate-500 text-center mt-1">
            Wholesome photos help families to connect with you before you have even met!
          </p>
        </div>

        {error && (
          <p className="text-sm text-red-600 bg-red-50 px-4 py-2 rounded-lg">{error}</p>
        )}

        <div className="fixed bottom-0 left-0 right-0 z-20 pt-3 pb-[66px] bg-gradient-to-t from-white from-70% to-transparent">
          <div className="max-w-md mx-auto px-4">
            <Button
              onClick={handleSubmit}
              disabled={!hasProfilePhoto || submitting}
              className="w-full bg-violet-600 hover:bg-violet-700 text-white h-11 px-6 rounded-lg font-medium text-sm disabled:opacity-50"
            >
              {submitting ? (
                <>
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  Saving...
                </>
              ) : (
                'Add photos'
              )}
            </Button>
          </div>
        </div>
      </div>
    </CompoundPageShell>
  );
}
