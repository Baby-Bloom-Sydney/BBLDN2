"use client";

/**
 * The row drawer (plan C4; brief §3 admin 2–4, §0.10, §0.11; BB-wave1-041126/04c1-build), drawn inside the leads
 * drawer's `Sheet` by `CallsClient`. A sticky header — her name, tags, how and when she signed up, the four links —
 * then: contact (the Call control), her matchmaker call (book, move or cancel on her behalf), the outcome form, her
 * position and nannies, the deposit (read-only), and every past attempt. Every time is London, and it says so.
 *
 * After any write `onChanged` refreshes the page (the server re-reads her). The picker and the form are not remounted
 * by that refresh, so their status lines ("Booked — the family is emailed.", "Saved.") stay; the picker takes the
 * fresh days from its props.
 */

import { ADMIN_COPY } from "@/lib/calls/copy";
import type { FamilyPanel } from "@/lib/calls/family-panel";
import { ContactLines, LinksRow, PositionCell, TagBadges, type RenderCallControl } from "./CallRowParts";
import { AttemptList, PanelBlock } from "./CallRowPanelParts";
import { OnBehalfPicker } from "./OnBehalfPicker";
import { OutcomeForm } from "./OutcomeForm";

export interface CallRowPanelProps {
  readonly panel: FamilyPanel;
  readonly renderCallControl: RenderCallControl;
  readonly onChanged: () => void;
}

function Header({ panel }: { readonly panel: FamilyPanel }) {
  return (
    <div className="sticky top-0 z-10 space-y-2 border-b border-slate-200 bg-white px-4 py-3 pr-12">
      <h2 className="text-lg font-semibold text-slate-900">{panel.contact.name}</h2>
      <TagBadges tags={panel.tags} />
      <p className="text-xs text-slate-500">{[panel.signupType, panel.signedUp].filter(Boolean).join(" · ")}</p>
      <LinksRow links={panel.links} />
    </div>
  );
}

export function CallRowPanel({ panel, renderCallControl, onChanged }: CallRowPanelProps) {
  const booking = panel.booking;
  const target = { parentUserId: panel.parentUserId, bookingId: booking?.bookingId ?? null, contact: panel.contact };
  return (
    <div className="flex h-full flex-col">
      <Header panel={panel} />
      {/* The body scrolls itself (the leads drawer's model), so the header and the close button stay in view. */}
      <div className="min-h-0 flex-1 overflow-y-auto space-y-5 px-4 pb-24 pt-4">
        <p className="text-xs text-slate-500">{ADMIN_COPY.londonNote}</p>
        <PanelBlock title={ADMIN_COPY.panelContact}>
          <ContactLines contact={panel.contact} call={renderCallControl(target)} />
        </PanelBlock>
        <PanelBlock title={ADMIN_COPY.panelBooking}>
          <OnBehalfPicker parentUserId={panel.parentUserId} booking={booking} days={panel.days} onChanged={onChanged} />
        </PanelBlock>
        <OutcomeForm parentUserId={panel.parentUserId} bookingId={booking?.bookingId ?? null} onSaved={onChanged} />
        <PanelBlock title={ADMIN_COPY.panelPosition}>
          <PositionCell position={panel.position} />
          {panel.position && <p className="text-sm text-slate-700">{panel.position.nannies}</p>}
        </PanelBlock>
        <PanelBlock title={ADMIN_COPY.panelDeposit}>
          <p className="text-sm text-slate-700">{panel.deposit}</p>
        </PanelBlock>
        <PanelBlock title={ADMIN_COPY.panelAttempts}>
          <AttemptList attempts={panel.attempts} />
        </PanelBlock>
      </div>
    </div>
  );
}
