'use client';

import Link from 'next/link';
import { ShieldAlert, ArrowRight } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { trackEvent } from '@/lib/analytics/trackEvent';

interface VerificationBannerProps {
  /** Nanny only — London parents are never verified (LDN2 3h, H-5). */
  role: 'nanny';
  message: string;
  submessage?: string;
}

export function VerificationBanner({ role, message, submessage }: VerificationBannerProps) {
  const trackingEvent = 'banner_verify_cta_clicked';

  return (
    <div className="rounded-lg border border-amber-200 bg-amber-50 p-4 flex items-center justify-between gap-4">
      <div className="flex items-center gap-3">
        <ShieldAlert className="h-5 w-5 text-amber-600 flex-shrink-0" />
        <div>
          <p className="text-sm font-medium text-amber-800">{message}</p>
          {submessage && (
            <p className="text-xs text-amber-600 mt-0.5">{submessage}</p>
          )}
        </div>
      </div>
      <Button
        asChild
        size="sm"
        className="bg-violet-600 hover:bg-violet-700 text-white flex-shrink-0"
      >
        <Link
          href={`/${role}/verification`}
          onClick={() => trackEvent({ event_name: trackingEvent, user_role: role })}
          className="flex items-center gap-1"
        >
          Verify Now <ArrowRight className="h-3 w-3" />
        </Link>
      </Button>
    </div>
  );
}
