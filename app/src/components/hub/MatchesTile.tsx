'use client';

import Link from 'next/link';
import { Filter, Lock, Sparkles, CheckCircle2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { trackEvent } from '@/lib/analytics/trackEvent';
import { legacyTierCheckoutEnabled } from '@/lib/features/flags';

interface MatchesTileProps {
  hasPosition: boolean;
  hasDfy: boolean;
}

export function MatchesTile({ hasPosition, hasDfy }: MatchesTileProps) {
  // Locked state - no position created yet
  if (!hasPosition) {
    return (
      <div className="rounded-2xl border bg-slate-50 border-slate-200 opacity-60 p-8 relative overflow-hidden">
        {/* Lock overlay */}
        <div className="absolute top-6 right-6">
          <div className="w-12 h-12 rounded-full bg-slate-200 flex items-center justify-center">
            <Lock className="w-6 h-6 text-slate-400" />
          </div>
        </div>

        <div className="flex flex-col space-y-6 max-w-sm">
          {/* Content */}
          <div className="space-y-2">
            <h3 className="text-xl font-semibold text-slate-900">
              Matchmaking
            </h3>
            <p className="text-slate-600">
              Create a position first to unlock personalised nanny matches
            </p>
          </div>

          {/* CTA */}
          <Button
            asChild
            variant="secondary"
            className="w-full sm:w-auto bg-slate-200 hover:bg-slate-300 text-slate-700 font-medium"
            onClick={() => trackEvent({ event_name: 'matches_tile_create_position_clicked' })}
          >
            <Link href="/parent/request">
              Create Position
            </Link>
          </Button>
        </div>
      </div>
    );
  }

  // DFY active state
  if (hasDfy) {
    return (
      <div className="rounded-2xl border border-green-200 bg-white shadow-sm hover:shadow-lg hover:border-green-300 transition-all p-6">
        {/* Header with badge */}
        <div className="flex items-start justify-between mb-4">
          <div className="w-12 h-12 rounded-full bg-violet-50 flex items-center justify-center flex-shrink-0">
            <Filter className="w-6 h-6 text-violet-600" />
          </div>
          <div className="flex items-center gap-1.5 px-3 py-1 rounded-full bg-green-50 border border-green-200">
            <CheckCircle2 className="w-3.5 h-3.5 text-green-600" />
            <span className="text-xs font-medium text-green-700">Active</span>
          </div>
        </div>

        {/* Content */}
        <div className="space-y-3 mb-6">
          <h3 className="text-lg font-semibold text-slate-900">
            We&apos;re Finding Your Nanny
          </h3>
          <p className="text-slate-600">
            Our team is reviewing and reaching out to the best matches for you
          </p>
        </div>

        {/* CTA */}
        <Button
          asChild
          className="w-full bg-violet-600 hover:bg-violet-700 text-white font-medium"
          size="lg"
          onClick={() => trackEvent({ event_name: 'matches_tile_dfy_view_matches_clicked' })}
        >
          <Link href="/parent/matches">
            View Matches
          </Link>
        </Button>
      </div>
    );
  }

  // Active state, no DFY
  return (
    <div className="rounded-2xl border bg-white shadow-sm hover:shadow-lg hover:border-violet-200 transition-all p-8">
      <div className="flex flex-col items-center text-center space-y-6">
        {/* Icon */}
        <div className="w-20 h-20 rounded-full bg-violet-50 flex items-center justify-center">
          <Filter className="w-10 h-10 text-violet-600" />
        </div>

        {/* Content */}
        <div className="space-y-2">
          <h3 className="text-xl font-semibold text-slate-900">
            Find Your Match
          </h3>
          <p className="text-slate-600 max-w-md">
            Let us find the best nannies for your family based on your position
          </p>
        </div>

        {/* Primary CTA — 5g (P-23): the tier checkout is hidden unless LEGACY_TIER_CHECKOUT_ENABLED. */}
        {legacyTierCheckoutEnabled() && (
          <Button
            asChild
            className="w-full bg-violet-600 hover:bg-violet-700 text-white font-medium"
            size="lg"
            onClick={() => trackEvent({ event_name: 'matches_tile_find_nanny_clicked' })}
          >
            <Link href="/parent/matches/checkout" className="flex items-center justify-center gap-2">
              <Sparkles className="w-5 h-5" />
              Find Me a Nanny
            </Link>
          </Button>
        )}

        {/* Secondary link */}
        <Link
          href="/parent/matches"
          className="text-sm text-slate-500 hover:text-violet-600 transition-colors font-medium"
          onClick={() => trackEvent({ event_name: 'matches_tile_browse_clicked' })}
        >
          Browse yourself
        </Link>
      </div>
    </div>
  );
}
