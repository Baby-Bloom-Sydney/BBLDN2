"use client";

import { type PublicBsrProfile } from "@/lib/actions/babysitting";
import { useAuth } from "@/contexts/AuthContext";
import {
  MapPin,
  Calendar,
  Clock,
  PoundSterling,
  Baby,
  FileText,
  ArrowRight,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import Link from "next/link";
import { formatClockTime as formatTime } from "@/lib/timezone";

function formatDate(dateStr: string): string {
  const d = new Date(dateStr + "T00:00:00");
  const days = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  return `${days[d.getDay()]} ${d.getDate()} ${months[d.getMonth()]}`;
}

function ageDisplay(months: number): string {
  if (months < 12) return `${months}mo`;
  const years = Math.floor(months / 12);
  const rem = months % 12;
  return rem > 0 ? `${years}y ${rem}mo` : `${years}y`;
}

interface Props {
  bsr: PublicBsrProfile;
}

export function BsrJobView({ bsr }: Props) {
  const { user, role } = useAuth();

  // "Get a babysitter" link destination
  const getBabysitterHref = !user
    ? '/login'
    : role === 'parent'
      ? '/parent/babysitting'
      : '/nanny/babysitting';


  return (
    <div className="mx-auto max-w-2xl px-4 py-4 space-y-3 flex flex-col min-h-[calc(100dvh-56px)]">
      {/* Header */}
      <div className="w-full max-w-[23rem] mx-auto">
        <h1 className="text-base font-bold text-slate-800 leading-tight">
          The {bsr.parent_last_name ?? bsr.parent_first_name} family need a babysitter
        </h1>
        <p className="text-xs text-slate-500">
          Posted by {bsr.parent_first_name}
        </p>
      </div>

      {/* OG Preview Image */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={`/api/og/babysitting/${bsr.id}`}
        alt="Babysitter Needed"
        className="w-full max-w-[23rem] mx-auto rounded-xl border border-slate-200 shadow-sm"
      />

      {/* Details Card */}
      <div className="w-full rounded-xl border border-slate-200 bg-white shadow-sm divide-y divide-slate-100 max-w-[23rem] mx-auto">
        {/* Location */}
        <div className="flex items-center gap-2.5 px-4 py-2.5">
          <MapPin className="h-4 w-4 text-violet-500 flex-shrink-0" />
          <p className="text-sm font-medium text-slate-800">{bsr.suburb}</p>
        </div>

        {/* Time Slots */}
        {bsr.time_slots.length > 0 && (
          <div className="px-4 py-2.5">
            <div className="flex items-start gap-2.5">
              <Calendar className="h-4 w-4 text-violet-500 flex-shrink-0 mt-0.5" />
              <div className="space-y-1 flex-1">
                {bsr.time_slots.map((slot, i) => (
                  <div key={i} className="flex items-center justify-between">
                    <p className="text-sm font-medium text-slate-800">
                      {formatDate(slot.slot_date)}
                    </p>
                    <div className="flex items-center gap-1 text-xs text-slate-600">
                      <Clock className="h-3 w-3" />
                      {formatTime(slot.start_time)} – {formatTime(slot.end_time)}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* Rate */}
        {bsr.hourly_rate && (
          <div className="flex items-center gap-2.5 px-4 py-2.5">
            <PoundSterling className="h-4 w-4 text-violet-500 flex-shrink-0" />
            <div>
              <p className="text-sm font-medium text-slate-800">£{bsr.hourly_rate}/hr</p>
              {bsr.estimated_hours && (
                <p className="text-[11px] text-slate-400">
                  ~{bsr.estimated_hours}hrs (£{Math.round(bsr.hourly_rate * bsr.estimated_hours)} total)
                </p>
              )}
            </div>
          </div>
        )}

        {/* Children */}
        {bsr.children.length > 0 && (
          <div className="flex items-center gap-2.5 px-4 py-2.5">
            <Baby className="h-4 w-4 text-violet-500 flex-shrink-0" />
            <div>
              <p className="text-sm font-medium text-slate-800">
                {bsr.children.length} {bsr.children.length === 1 ? "child" : "children"}
              </p>
              <p className="text-[11px] text-slate-400">
                {bsr.children.map((c) => {
                  const g = c.gender?.toLowerCase();
                  const label = g === 'male' || g === 'boy' ? 'Boy' : g === 'female' || g === 'girl' ? 'Girl' : 'Child';
                  return `${label} (${ageDisplay(c.ageMonths)})`;
                }).join(", ")}
              </p>
            </div>
          </div>
        )}

        {/* Special Requirements */}
        {bsr.special_requirements && (
          <div className="flex items-start gap-2.5 px-4 py-2.5">
            <FileText className="h-4 w-4 text-violet-500 flex-shrink-0 mt-0.5" />
            <div>
              <p className="text-[11px] text-slate-400 mb-0.5">Special requirements</p>
              <p className="text-sm text-slate-700">{bsr.special_requirements}</p>
            </div>
          </div>
        )}
      </div>

      {/* CTA */}
      <div className="w-full max-w-[23rem] mx-auto">
        <Link href="/apply">
          <Button
            className="w-full bg-violet-600 hover:bg-violet-700 text-white h-10 text-sm"
          >
            Babysit for the {bsr.parent_last_name ?? bsr.parent_first_name} family <ArrowRight className="ml-2 h-4 w-4" />
          </Button>
        </Link>
      </div>

      {/* Childcare Professional Ad Tile */}
      <Link
        href="/apply"
        className="flex items-center justify-between max-w-sm mx-auto w-full rounded-xl overflow-hidden shadow-sm hover:shadow-md transition-shadow px-4 py-3"
        style={{ background: 'linear-gradient(135deg, #EDE9FE 0%, #DDD6FE 50%, #C4B5FD 100%)' }}
      >
        <div>
          <p className="text-sm font-bold text-violet-900 leading-snug">Childcare Professional?</p>
          <p className="text-xs text-violet-700 mt-0.5">Help us to develop young minds</p>
        </div>
        <div className="shrink-0 ml-3 inline-flex items-center gap-1 bg-white text-violet-700 text-xs font-bold px-3 py-1.5 rounded-lg shadow-sm">
          Apply <ArrowRight className="h-3 w-3" />
        </div>
      </Link>

      {/* Get a babysitter — below the ad tile */}
      <Link
        href={getBabysitterHref}
        className="text-xs text-violet-600 hover:underline text-center block w-full max-w-[23rem] mx-auto"
      >
        Get a babysitter
      </Link>

    </div>
  );
}
