'use client';

import { useCallback, useEffect, useRef } from 'react';
import { StageProps } from '../../FunnelOrchestrator';
import { YesNoTags } from '../../shared/YesNoTags';
import { MultiSelectTags } from '../../shared/MultiSelectTags';
import { SingleSelectTags } from '../../shared/SingleSelectTags';
import { ProgressiveReveal } from '../../shared/ProgressiveReveal';
import { CompoundPageShell } from '../../shared/CompoundPageShell';
import { QUALIFICATION_OPTIONS, CERTIFICATE_OPTIONS } from '@/types/nanny-leads';
import { Label } from '@/components/ui/label';
import { AlertTriangle } from 'lucide-react';

export function N1Credentials({ state, dispatch, goNext, goBack, progress, questionNumber }: StageProps) {
  const { qualifications } = state;

  const update = useCallback(
    (payload: Partial<typeof qualifications>) => {
      dispatch({ type: 'UPDATE_QUALIFICATIONS', payload });
    },
    [dispatch]
  );

  const wwccBlocked = qualifications.wwcc === false;
  // Start as true if WWCC already answered (restored state) — prevents auto-advance on back-nav
  const autoAdvanced = useRef(qualifications.wwcc === true);

  // Auto-advance when WWCC is answered "Yes" (only on fresh tap, not page restore)
  useEffect(() => {
    if (qualifications.wwcc === true && !autoAdvanced.current) {
      autoAdvanced.current = true;
      const timer = setTimeout(goNext, 400);
      return () => clearTimeout(timer);
    }
    if (qualifications.wwcc !== true) {
      autoAdvanced.current = false;
    }
  }, [qualifications.wwcc, goNext]);

  // Show conditions — one question at a time
  const showQualification = qualifications.has_qualifications === true;
  const showCertificatesGate =
    qualifications.has_qualifications === false ||
    (qualifications.has_qualifications === true && qualifications.highest_qualification !== null);
  const showCertificates = qualifications.has_certificates === true;
  const showWwcc =
    qualifications.has_certificates === false ||
    (qualifications.has_certificates === true && qualifications.certificates.length > 0);

  return (
    <CompoundPageShell
      title="Your Credentials"
      progress={progress}
      showBack={true}
      onBack={goBack}
      questionNumber={questionNumber}
    >
      <div className="flex flex-col gap-5">
        {/* Qualifications gate */}
        <div className="flex flex-col gap-2">
          <Label className="text-sm font-medium text-slate-700">
            Do you have any childcare qualifications?
          </Label>
          <YesNoTags
            selected={qualifications.has_qualifications}
            onChange={(val) => {
              update({
                has_qualifications: val,
                highest_qualification: null,
                has_certificates: null,
                certificates: [],
                wwcc: null,
              });
            }}
          />
        </div>

        {/* Highest qualification */}
        <ProgressiveReveal show={showQualification}>
          <div className="flex flex-col gap-2 pt-2">
            <Label className="text-sm font-medium text-slate-700">
              What is the highest childcare qualification you currently hold?
            </Label>
            <SingleSelectTags
              options={QUALIFICATION_OPTIONS}
              selected={qualifications.highest_qualification}
              onChange={(val) => {
                update({
                  highest_qualification: val,
                  has_certificates: null,
                  certificates: [],
                  wwcc: null,
                });
              }}
            />
          </div>
        </ProgressiveReveal>

        {/* Certificates gate */}
        <ProgressiveReveal show={showCertificatesGate}>
          <div className="flex flex-col gap-2 pt-2">
            <Label className="text-sm font-medium text-slate-700">
              Do you hold any additional desirable certificates?
            </Label>
            <YesNoTags
              selected={qualifications.has_certificates}
              onChange={(val) => {
                update({
                  has_certificates: val,
                  certificates: [],
                  wwcc: null,
                });
              }}
            />
          </div>
        </ProgressiveReveal>

        {/* Certificates */}
        <ProgressiveReveal show={showCertificates}>
          <div className="flex flex-col gap-2 pt-2">
            <Label className="text-sm font-medium text-slate-700">
              Which certificates do you hold?
            </Label>
            <MultiSelectTags
              options={CERTIFICATE_OPTIONS}
              selected={qualifications.certificates}
              onChange={(val) => update({ certificates: val })}
            />
          </div>
        </ProgressiveReveal>

        {/* WWCC */}
        <ProgressiveReveal show={showWwcc}>
          <div className="flex flex-col gap-2 pt-2">
            <Label className="text-sm font-medium text-slate-700">
              Do you hold an enhanced DBS check?
            </Label>
            <YesNoTags
              selected={qualifications.wwcc}
              onChange={(val) => update({ wwcc: val })}
            />
          </div>
        </ProgressiveReveal>

        {/* WWCC blocked */}
        {wwccBlocked && (
          <div className="p-4 bg-amber-50 border border-amber-200 rounded-lg flex gap-3">
            <AlertTriangle className="w-5 h-5 text-amber-500 flex-shrink-0 mt-0.5" />
            <div className="flex flex-col gap-1">
              <p className="text-sm font-medium text-amber-800">
                An enhanced DBS check is required
              </p>
              <p className="text-sm text-amber-700">
                Baby Bloom can only accept childcare professionals who hold a valid enhanced DBS check.
                You can apply for one at{' '}
                <a
                  href="https://www.gov.uk/dbs-check-applicant-criminal-record"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="underline font-medium"
                >
                  GOV.UK
                </a>
                . Once you have your DBS check, come back and complete your application.
              </p>
              <p className="text-sm text-amber-700 mt-1">
                You can still complete the rest of your application — we&apos;ll save your progress.
              </p>
            </div>
          </div>
        )}

      </div>
    </CompoundPageShell>
  );
}
