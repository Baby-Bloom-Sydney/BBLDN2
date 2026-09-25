'use client';

import { useState, useRef, useCallback, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { X } from 'lucide-react';
import { SENDERS } from "@/lib/constants";

interface BiometricConsentModalProps {
  open: boolean;
  onComplete: (data: {
    notice_opened_at: string;
    notice_scroll_completed_at: string;
    notice_time_spent_seconds: number;
    checkboxes_enabled_at: string;
  }) => void;
}

export function BiometricConsentModal({ open, onComplete }: BiometricConsentModalProps) {
  const [scrollPercent, setScrollPercent] = useState(0);
  const [scrollCompleted, setScrollCompleted] = useState(false);
  const [openedAt] = useState(() => new Date().toISOString());
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const sentinelRef = useRef<HTMLDivElement>(null);

  const handleScroll = useCallback(() => {
    const el = scrollContainerRef.current;
    if (!el) return;
    const percent = Math.round((el.scrollTop / (el.scrollHeight - el.clientHeight)) * 100);
    setScrollPercent(Math.min(percent, 100));
  }, []);

  useEffect(() => {
    if (!open || !sentinelRef.current) return;
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setScrollCompleted(true);
        }
      },
      { threshold: 0.5 }
    );
    observer.observe(sentinelRef.current);
    return () => observer.disconnect();
  }, [open]);

  const handleAcknowledge = () => {
    const now = new Date().toISOString();
    const timeSpent = Math.round((Date.now() - new Date(openedAt).getTime()) / 1000);
    onComplete({
      notice_opened_at: openedAt,
      notice_scroll_completed_at: now,
      notice_time_spent_seconds: timeSpent,
      checkboxes_enabled_at: now,
    });
  };

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 bg-white flex flex-col">
      {/* Header */}
      <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200">
        <h2 className="text-lg font-bold text-slate-900">Biometric Data Collection Notice</h2>
        <div className="flex items-center gap-3">
          <span className="text-xs text-slate-400">{scrollPercent}% read</span>
          <div className="w-20 h-1.5 bg-slate-100 rounded-full overflow-hidden">
            <div
              className="h-full bg-violet-500 rounded-full transition-all duration-300"
              style={{ width: `${scrollPercent}%` }}
            />
          </div>
        </div>
      </div>

      {/* Scrollable content */}
      <div
        ref={scrollContainerRef}
        onScroll={handleScroll}
        className="flex-1 overflow-y-auto px-6 py-6"
      >
        <div className="max-w-3xl mx-auto prose prose-slate prose-sm">
          <p className="text-sm text-slate-500 mb-6">
            Version 1.0 | Last updated: 13 March 2026
          </p>

          <h3>How We Verify Your Identity</h3>
          <p>Baby Bloom uses AI-assisted facial recognition to verify the identity of childcare professionals. This involves comparing a selfie photograph you provide with the photograph on your government-issued identity document (e.g., Australian Passport or NSW Photo ID).</p>
          <p>This process is a mandatory condition of using the Baby Bloom Platform as a childcare professional. We cannot verify your identity without collecting and processing your biometric data.</p>

          <h3>What Data We Collect</h3>
          <ul>
            <li>A selfie photograph (captured live during the verification process)</li>
            <li>A photograph or scan of your government-issued identity document</li>
            <li>Extracted facial geometry data (biometric template) derived from both images</li>
            <li>The AI-generated match confidence score</li>
          </ul>

          <h3>What We Compare</h3>
          <p>The selfie is compared against the identity document photo to verify that you are the person named on the document. The comparison produces a match confidence score (0-100%). Scores above 85% are automatically approved. Scores below 85% are referred for human review.</p>

          <h3>Overseas Processing and Your Risks</h3>
          <p>Your biometric data is transmitted to OpenAI (headquartered in San Francisco, United States) for AI processing. This means your sensitive personal information leaves Australia and is processed under United States law.</p>
          <p>By consenting to this process, you acknowledge:</p>
          <ul>
            <li>United States privacy laws differ from Australian privacy laws</li>
            <li>The Australian Privacy Principles (APPs) may not be enforceable in the United States</li>
            <li>OpenAI is bound by a Data Processing Agreement (DPA) with Baby Bloom, which requires them to process your data only for the purpose of identity verification and to delete it after processing</li>
            <li>In the event of a data breach by OpenAI, Baby Bloom will notify you and the Office of the Australian Information Commissioner (OAIC) as required by the Notifiable Data Breaches scheme</li>
          </ul>

          <h3>How AI and Human Review Work Together</h3>
          <p>AI is one layer of our verification process. The AI compares your selfie to your document photo and generates a match score. If the score is 85% or above, your identity is automatically verified. If the score is below 85%, a human reviewer at Baby Bloom will manually compare the images and make the final decision.</p>
          <p>Human reviewers:</p>
          <ul>
            <li>Are trained Baby Bloom staff members</li>
            <li>Are not bound by the AI&apos;s match score</li>
            <li>Make independent verification decisions</li>
            <li>Document their reasoning in the verification audit trail</li>
          </ul>

          <h3>How Long We Keep Your Identity Verification Data</h3>
          <table>
            <thead>
              <tr><th>Data Type</th><th>Retention Period</th></tr>
            </thead>
            <tbody>
              <tr><td>Selfie photograph</td><td>Deleted 90 days after account closure</td></tr>
              <tr><td>Identity document photo</td><td>Deleted 90 days after account closure</td></tr>
              <tr><td>Facial geometry (biometric template)</td><td>Deleted 90 days after account closure</td></tr>
              <tr><td>Verification result (name, doc type, doc number, date, match score)</td><td>Retained permanently in de-identified form</td></tr>
            </tbody>
          </table>

          <h3>Your Rights and Consequences of Withdrawing Biometric Consent</h3>
          <p>You have the right to:</p>
          <ul>
            <li><strong>Access</strong> your biometric data (request a copy of your selfie, document photo, and match score)</li>
            <li><strong>Delete</strong> your biometric data (request deletion at any time; we will delete within 30 days, except where required by law)</li>
            <li><strong>Withdraw consent</strong> for future biometric processing</li>
          </ul>
          <p>If you withdraw your biometric consent:</p>
          <ul>
            <li>Your identity verification will be revoked</li>
            <li>Your profile will be hidden from families</li>
            <li>You will not be able to receive connection requests or babysitting jobs</li>
            <li>You will need to re-verify if you wish to reactivate your profile</li>
          </ul>

          <h3>What If Your Verification Is Rejected?</h3>
          <p>If your verification is rejected, you may:</p>
          <ul>
            <li>Request a detailed explanation of why the verification failed</li>
            <li>Request a manual review by a different staff member within 14 days</li>
            <li>Resubmit with new, clearer photographs</li>
          </ul>

          <h3>Security of Your Biometric Data</h3>
          <p>Baby Bloom stores biometric data using AES-256 encryption at rest. Data is transmitted using TLS 1.2+ encryption in transit. Access to biometric data is restricted to authorised Baby Bloom staff with a legitimate need to access it for verification purposes.</p>

          <h3>Legal Basis for Biometric Verification</h3>
          <p>Baby Bloom collects your biometric data under Australian Privacy Principle (APP) 3.3 with your express consent. Biometric data is classified as &quot;sensitive information&quot; under the Privacy Act 1988 (Cth) and requires your explicit, informed, and voluntary consent before collection.</p>

          <h3>Liveness Detection and Spoofing Prevention</h3>
          <p>The selfie capture process includes liveness detection to prevent the use of static photographs, deepfakes, or pre-recorded video. If liveness detection fails, you will be asked to retake the selfie.</p>

          <h3>Complaints About Your Privacy Rights</h3>
          <p>If you believe Baby Bloom has breached the Australian Privacy Principles in relation to your biometric data, you may:</p>
          <ol>
            <li>Contact Baby Bloom&apos;s Privacy Officer at {SENDERS.privacy}</li>
            <li>Lodge a complaint with the Office of the Australian Information Commissioner (OAIC) at www.oaic.gov.au</li>
          </ol>

          {/* Sentinel for scroll detection */}
          <div ref={sentinelRef} className="h-1" />
        </div>
      </div>

      {/* Footer */}
      <div className="border-t border-slate-200 px-6 py-4 bg-white">
        <div className="max-w-3xl mx-auto">
          {scrollCompleted ? (
            <Button
              onClick={handleAcknowledge}
              className="w-full bg-violet-600 hover:bg-violet-700 text-white h-11"
            >
              I have read this notice
            </Button>
          ) : (
            <p className="text-center text-sm text-slate-400">
              Please scroll through the entire notice to continue
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
