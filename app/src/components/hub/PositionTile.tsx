'use client';

import Link from 'next/link';
import { ClipboardList, MapPin, Clock, Users, ArrowRight, Sparkles } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { trackEvent } from '@/lib/analytics/trackEvent';
import { legacyTierCheckoutEnabled } from '@/lib/features/flags';

export interface PositionSummary {
  suburb: string | null;
  hoursPerWeek: number | null;
  numChildren: number;
  childAges: string[];  // e.g. ["2 years", "4 months"]
  scheduleType: string | null;
}

interface PositionTileProps {
  hasPosition: boolean;
  positionSummary: PositionSummary | null;
  hasDfy: boolean;
}

export function PositionTile({ hasPosition, positionSummary, hasDfy }: PositionTileProps) {
  if (!hasPosition) {
    return (
      <div className="rounded-2xl border-dashed border-2 border-slate-300 bg-slate-50/50 p-8">
        <div className="flex flex-col items-center text-center space-y-6">
          {/* Icon */}
          <div className="w-20 h-20 rounded-full bg-violet-50 flex items-center justify-center">
            <ClipboardList className="w-10 h-10 text-violet-400" />
          </div>

          {/* Content */}
          <div className="space-y-2">
            <h3 className="text-xl font-semibold text-slate-900">
              Find Your Perfect Nanny
            </h3>
            <p className="text-slate-600 max-w-md">
              Tell us about your family&apos;s needs and we&apos;ll match you with the ideal nanny
            </p>
          </div>

          {/* CTA */}
          <Button
            asChild
            className="w-full bg-violet-600 hover:bg-violet-700 text-white font-medium"
            size="lg"
            onClick={() => trackEvent({ event_name: 'position_tile_get_started_clicked' })}
          >
            <Link href="/parent/request" className="flex items-center justify-center gap-2">
              Get Started
              <ArrowRight className="w-4 h-4" />
            </Link>
          </Button>
        </div>
      </div>
    );
  }

  // Active state - has position
  return (
    <div className="rounded-2xl border bg-white shadow-sm hover:shadow-lg hover:border-violet-200 transition-all p-6">
      {/* Header */}
      <div className="flex items-center gap-3 mb-6">
        <div className="w-12 h-12 rounded-full bg-violet-50 flex items-center justify-center flex-shrink-0">
          <ClipboardList className="w-6 h-6 text-violet-600" />
        </div>
        <h3 className="text-lg font-semibold text-slate-900">My Position</h3>
      </div>

      {/* Summary Grid */}
      <div className="grid grid-cols-2 gap-4 mb-6">
        {/* Location */}
        <div className="flex items-start gap-2">
          <MapPin className="w-4 h-4 text-violet-600 mt-0.5 flex-shrink-0" />
          <div className="min-w-0">
            <p className="text-xs text-slate-500 mb-0.5">Location</p>
            <p className="text-sm font-medium text-slate-900 truncate">
              {positionSummary?.suburb || 'Not set'}
            </p>
          </div>
        </div>

        {/* Hours */}
        <div className="flex items-start gap-2">
          <Clock className="w-4 h-4 text-violet-600 mt-0.5 flex-shrink-0" />
          <div className="min-w-0">
            <p className="text-xs text-slate-500 mb-0.5">Hours</p>
            <p className="text-sm font-medium text-slate-900">
              {positionSummary?.hoursPerWeek
                ? `${positionSummary.hoursPerWeek}/week`
                : 'Flexible'}
            </p>
          </div>
        </div>

        {/* Children */}
        <div className="flex items-start gap-2 col-span-2">
          <Users className="w-4 h-4 text-violet-600 mt-0.5 flex-shrink-0" />
          <div className="min-w-0 flex-1">
            <p className="text-xs text-slate-500 mb-0.5">Children</p>
            <p className="text-sm font-medium text-slate-900">
              {positionSummary?.numChildren || 0} {positionSummary?.numChildren === 1 ? 'child' : 'children'}
            </p>
            {positionSummary?.childAges && positionSummary.childAges.length > 0 && (
              <p className="text-xs text-slate-500 mt-1">
                Ages: {positionSummary.childAges.join(', ')}
              </p>
            )}
          </div>
        </div>
      </div>

      {/* CTAs */}
      <div className="flex gap-3">
        <Button
          asChild
          variant="outline"
          className="flex-1 border-violet-200 text-violet-600 hover:bg-violet-50 font-medium"
          onClick={() => trackEvent({ event_name: 'position_tile_view_position_clicked' })}
        >
          <Link href="/parent">
            View Position
          </Link>
        </Button>

        {hasDfy ? (
          <Button
            asChild
            className="flex-1 bg-violet-600 hover:bg-violet-700 text-white font-medium"
            onClick={() => trackEvent({ event_name: 'position_tile_view_matches_clicked' })}
          >
            <Link href="/parent/matches">
              View Matches
            </Link>
          </Button>
        ) : legacyTierCheckoutEnabled() ? (
          // 5g (P-23): the tier checkout is hidden unless LEGACY_TIER_CHECKOUT_ENABLED.
          <Button
            asChild
            className="flex-1 bg-violet-600 hover:bg-violet-700 text-white font-medium"
            onClick={() => trackEvent({ event_name: 'position_tile_find_nanny_clicked' })}
          >
            <Link href="/parent/matches/checkout" className="flex items-center justify-center gap-2">
              <Sparkles className="w-4 h-4" />
              Find Me a Nanny
            </Link>
          </Button>
        ) : null}
      </div>
    </div>
  );
}
