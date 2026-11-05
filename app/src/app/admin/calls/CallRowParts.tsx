"use client";

/**
 * The pieces every /admin/calls row is made of, in the table and in the phone cards alike (plan C3; brief §0.9,
 * §3 admin 6; BB-wave1-041126/04c1-build): the time (London), the family (her name opens the drawer, the tags), her
 * position, the four links, and the Call control.
 *
 * The Call control is `renderCallControl(row)` — a `tel:` link by default; brief 05 passes its dialer instead.
 * Admin idiom: `StatusBadge` tags, violet-700 links, slate text (brief §7; plan §12 R16).
 */

import Link from "next/link";
import type { ReactNode } from "react";
import { Phone } from "lucide-react";
import { StatusBadge } from "@/components/dashboard/StatusBadge";
import { ADMIN_COPY, callControlLabel } from "@/lib/calls/copy";
import type { CallRowView } from "@/lib/calls/dashboard";
import { tagLabel, type CallTag, type ContactWords, type PositionSummary, type RowLinks } from "@/lib/calls/dashboard-row";

/** What a Call control is given: the family, her contact, and her booked call if any. */
export type CallControlTarget = Pick<CallRowView, "parentUserId" | "bookingId" | "contact">;
export type RenderCallControl = (target: CallControlTarget) => ReactNode;

const CALL_LINK =
  "inline-flex items-center gap-1.5 rounded-md border border-violet-200 bg-violet-50 px-2.5 py-1 text-sm font-medium text-violet-700 hover:bg-violet-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-violet-500";

/** The default: tap to call her mobile (`tel:` in E.164). */
export const defaultCallControl: RenderCallControl = ({ contact }) =>
  contact.mobile ? (
    <a href={contact.mobile.href} aria-label={callControlLabel(contact.name, contact.mobile.text)} className={CALL_LINK}>
      <Phone className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
      <span className="whitespace-nowrap">{contact.mobile.text}</span>
    </a>
  ) : (
    <span className="text-sm text-slate-500">{ADMIN_COPY.noMobile}</span>
  );

const TAG_VARIANT: Readonly<Record<CallTag, "failed" | "pending" | "verified" | "inactive">> = {
  blocked_over: "failed",
  overdue: "pending",
  cohort_prebook: "verified",
  test: "inactive",
};

export function TagBadges({ tags }: { readonly tags: readonly CallTag[] }) {
  if (tags.length === 0) return null;
  return (
    <span className="flex flex-wrap gap-1">
      {tags.map((tag) => (
        <StatusBadge key={tag} variant={TAG_VARIANT[tag]}>
          {tagLabel(tag)}
        </StatusBadge>
      ))}
    </span>
  );
}

/** Her name: the button that opens her drawer. */
export function FamilyButton({ name, onOpen }: { readonly name: string; readonly onOpen: () => void }) {
  return (
    <button
      type="button"
      onClick={onOpen}
      className="rounded-sm text-left font-medium text-violet-700 hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-violet-500"
    >
      {name}
    </button>
  );
}

/** Name (opens the drawer), tags, email and how she signed up. */
export function FamilyCell({ row, onOpen }: { readonly row: Pick<CallRowView, "contact" | "tags" | "signupType">; readonly onOpen: () => void }) {
  return (
    <div className="space-y-1">
      <FamilyButton name={row.contact.name} onOpen={onOpen} />
      <TagBadges tags={row.tags} />
      {row.contact.email && <p className="break-all text-xs text-slate-600">{row.contact.email}</p>}
      <p className="text-xs text-slate-500">{row.signupType}</p>
    </div>
  );
}

/** The booked time, or "Not booked" with when she signed up, her last attempt and any call-back. All London. */
export function WhenCell({ row }: { readonly row: Pick<CallRowView, "when" | "signedUp" | "lastTried" | "callBack"> }) {
  return (
    <div className="space-y-0.5">
      {row.when ? <p className="font-medium text-slate-900">{row.when}</p> : <p className="font-medium text-slate-500">{ADMIN_COPY.notBooked}</p>}
      {!row.when && row.signedUp && <p className="text-xs text-slate-500">{row.signedUp}</p>}
      {row.lastTried && <p className="text-xs text-slate-500">{row.lastTried}</p>}
      {row.callBack && <p className="text-xs font-medium text-amber-700">{row.callBack}</p>}
    </div>
  );
}

/** Area, hours a week, days, children's ages, start date — or "No position yet" (a quick-match sign-up). */
export function PositionCell({ position }: { readonly position: PositionSummary | null }) {
  if (position === null) return <p className="text-sm italic text-slate-500">{ADMIN_COPY.noPosition}</p>;
  const lines = [position.hours, position.days, position.children, position.starts].filter((l): l is string => l !== null);
  return (
    <div className="space-y-0.5">
      <p className="font-medium text-slate-900">{position.area}</p>
      {lines.map((line) => (
        <p key={line} className="text-xs text-slate-600">
          {line}
        </p>
      ))}
    </div>
  );
}

export function NanniesCell({ position }: { readonly position: PositionSummary | null }) {
  return <p className="text-sm text-slate-700">{position?.nannies ?? "—"}</p>;
}

const LINK = "font-medium text-violet-700 hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-violet-500 rounded-sm";

/** Profile · Account · Money · Position (brief §0.9); no Position link without a position. */
export function LinksRow({ links }: { readonly links: RowLinks }) {
  const all: readonly [string, string | null][] = [
    [ADMIN_COPY.linkProfile, links.profile],
    [ADMIN_COPY.linkAccount, links.account],
    [ADMIN_COPY.linkMoney, links.money],
    [ADMIN_COPY.linkPosition, links.position],
  ];
  return (
    <span className="flex flex-wrap gap-x-3 gap-y-1 text-xs">
      {all.flatMap(([label, href]) =>
        href === null
          ? []
          : [
              <Link key={label} href={href} className={LINK}>
                {label}
              </Link>,
            ],
      )}
    </span>
  );
}

/** Her contact, read-only: the Call control and her email. */
export function ContactLines({ contact, call }: { readonly contact: ContactWords; readonly call: ReactNode }) {
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-sm">
      {call}
      {contact.email && contact.emailHref && (
        <a href={contact.emailHref} className={`${LINK} break-all text-sm`}>
          {contact.email}
        </a>
      )}
    </div>
  );
}
