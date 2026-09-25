'use client';

import { useState } from 'react';
import Link from 'next/link';
import type { RealPosition, RealApplicant } from './page';
import {
  MapPin, Clock, DollarSign, Car, IdCard, Cigarette,
  ChevronRight, X, ArrowLeft, CheckCircle2, Sparkles, CalendarDays,
  Phone, Briefcase, Baby, Users,
} from 'lucide-react';

// ═══════════════════════════════════════════════════════════════
// CONSTANTS
// ═══════════════════════════════════════════════════════════════

const DUMMY_AVAILABILITY: Record<string, string[]> = {
  monday: ['morning', 'midday'],
  wednesday: ['morning', 'midday', 'afternoon'],
  friday: ['morning', 'midday', 'afternoon', 'evening'],
};

const TIME_BRACKETS: Record<string, { label: string; sublabel: string; startHour: number; endHour: number }> = {
  morning: { label: 'Morning', sublabel: '6-10am', startHour: 6, endHour: 10 },
  midday: { label: 'Midday', sublabel: '10am-2pm', startHour: 10, endHour: 14 },
  afternoon: { label: 'Afternoon', sublabel: '2-6pm', startHour: 14, endHour: 18 },
  evening: { label: 'Evening', sublabel: '6-10pm', startHour: 18, endHour: 22 },
};

const BRACKET_KEYS = ['morning', 'midday', 'afternoon', 'evening'] as const;

const DAY_OPTIONS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
const DAY_SHORT: Record<string, string> = {
  Monday: 'Mon', Tuesday: 'Tue', Wednesday: 'Wed', Thursday: 'Thu',
  Friday: 'Fri', Saturday: 'Sat', Sunday: 'Sun',
};

const TIME_BLOCKS = [
  { key: 'morning', label: 'Morning', sub: '6–10am' },
  { key: 'midday', label: 'Midday', sub: '10am–2pm' },
  { key: 'afternoon', label: 'Afternoon', sub: '2–6pm' },
  { key: 'evening', label: 'Evening', sub: '6–10pm' },
];

// ═══════════════════════════════════════════════════════════════
// HELPERS
// ═══════════════════════════════════════════════════════════════

function formatAge(ageMonths: number): string {
  if (ageMonths < 12) return `${ageMonths}mo`;
  const years = Math.floor(ageMonths / 12);
  const rem = ageMonths % 12;
  return rem > 0 ? `${years}y ${rem}mo` : `${years}y`;
}

function ageGenderLabel(c: { age_months: number; gender: string | null }): string {
  const g = c.gender?.toLowerCase();
  const label = g === 'male' || g === 'boy' ? 'Boy' : g === 'female' || g === 'girl' ? 'Girl' : 'Child';
  return `${label} (${formatAge(c.age_months)})`;
}

function getProjectedDates(availability: Record<string, string[]>): Array<{ date: string; dayLabel: string; dayKey: string; brackets: string[] }> {
  const result: Array<{ date: string; dayLabel: string; dayKey: string; brackets: string[] }> = [];
  const today = new Date();
  for (let i = 0; i < 7; i++) {
    const d = new Date(today);
    d.setDate(d.getDate() + i);
    const dayName = d.toLocaleDateString('en-US', { weekday: 'long' }).toLowerCase();
    const brackets = availability[dayName];
    if (brackets && brackets.length > 0) {
      result.push({
        date: d.toISOString().split('T')[0],
        dayLabel: d.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' }),
        dayKey: dayName,
        brackets,
      });
    }
  }
  return result;
}

function getBracketTimeOptions(bracket: string): Array<{ hour: number; minute: number; label: string }> {
  const b = TIME_BRACKETS[bracket];
  if (!b) return [];
  const options: Array<{ hour: number; minute: number; label: string }> = [];
  for (let h = b.startHour; h < b.startHour + 3; h++) {
    for (let m = 0; m < 60; m += 15) {
      const hour12 = h % 12 || 12;
      const ampm = h < 12 ? 'AM' : 'PM';
      options.push({ hour: h, minute: m, label: `${hour12}:${m.toString().padStart(2, '0')} ${ampm}` });
    }
  }
  return options;
}

// ═══════════════════════════════════════════════════════════════
// SCHEDULE TABLE — shared component
// ═══════════════════════════════════════════════════════════════

const BRACKET_LABEL: Record<string, string> = {
  morning: 'Morning', midday: 'Midday', afternoon: 'Afternoon', evening: 'Evening',
};

function ScheduleGrid({ weeklyRoster, rosterByDay }: { weeklyRoster: string[]; rosterByDay: Record<string, string[]> }) {
  if (weeklyRoster.length === 0) return null;
  const sortedDays = DAY_OPTIONS.filter(d => weeklyRoster.includes(d));
  if (sortedDays.length === 0) return null;

  return (
    <div className="rounded-lg bg-violet-50 border border-violet-200 p-2.5">
      <div className="grid grid-cols-5 gap-x-1 gap-y-0.5 text-[10px]">
        <div />
        {BRACKET_KEYS.map((b) => (
          <div key={b} className="text-center text-violet-500 font-medium">
            {BRACKET_LABEL[b]}
          </div>
        ))}
        {sortedDays.map((day) => {
          const dayTimes = rosterByDay[day] ?? [];
          return (
            <div key={day} className="contents">
              <div className="text-violet-700 font-medium truncate pr-1 text-[11px]">{DAY_SHORT[day]}</div>
              {BRACKET_KEYS.map((b) => (
                <div key={b} className="flex items-center justify-center py-0.5">
                  <div className={`h-2.5 w-2.5 rounded-full ${
                    dayTimes.includes(b) ? 'bg-violet-400' : 'bg-violet-200'
                  }`} />
                </div>
              ))}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════
// NANNY VIEW — Position Tile (clickable, no apply button)
// ═══════════════════════════════════════════════════════════════

function PositionTile({ position }: { position: RealPosition }) {
  return (
    <Link
      href={`/position/${position.id}`}
      className="block rounded-xl border border-slate-200 bg-white shadow-sm overflow-hidden hover:border-violet-200 hover:shadow-md transition-all"
    >
      {/* Detail rows — compact, no dividers */}
      <div className="px-4 pt-3 pb-2 space-y-1.5">
        {/* Location + posted date */}
        <div className="flex items-start justify-between">
          {position.suburb && (
            <div className="flex items-center gap-2">
              <MapPin className="h-3.5 w-3.5 text-violet-500 flex-shrink-0" />
              <p className="text-sm font-medium text-slate-800">{position.suburb}</p>
            </div>
          )}
          <p className="text-[11px] text-slate-400 shrink-0 ml-2">
            {(() => {
              const days = Math.floor((Date.now() - new Date(position.created_at).getTime()) / 86400000);
              if (days === 0) return 'Today';
              if (days === 1) return '1 day ago';
              return `${days} days ago`;
            })()}
          </p>
        </div>

        {/* Children */}
        {position.children.length > 0 && (
          <div className="flex items-center gap-2">
            <Baby className="h-3.5 w-3.5 text-violet-500 flex-shrink-0" />
            <div>
              <p className="text-sm font-medium text-slate-800">
                {position.children.length} {position.children.length === 1 ? 'child' : 'children'}
              </p>
              <p className="text-[11px] text-slate-400">
                {position.children.map(c => ageGenderLabel(c)).join(', ')}
              </p>
            </div>
          </div>
        )}

        {/* Hours */}
        {position.hours_per_week && (
          <div className="flex items-center gap-2">
            <Clock className="h-3.5 w-3.5 text-violet-500 flex-shrink-0" />
            <div>
              <p className="text-sm font-medium text-slate-800">
                {position.hours_per_week} hrs/wk
              </p>
              <p className="text-[11px] text-slate-400">
                {position.schedule_type === 'Fixed' || position.schedule_type === 'Yes' ? 'Fixed schedule' : 'Flexible schedule'}
              </p>
            </div>
          </div>
        )}

        {/* Rate — hidden for AI/admin positions */}
        {position.hourly_rate && (!position.source || position.source === 'parent') && (
          <div className="flex items-center gap-2">
            <DollarSign className="h-3.5 w-3.5 text-violet-500 flex-shrink-0" />
            <p className="text-sm font-medium text-slate-800">${position.hourly_rate}/hr</p>
          </div>
        )}
      </div>

      {/* Schedule grid */}
      {position.weekly_roster.length > 0 && Object.keys(position.roster_by_day).length > 0 && (
        <div className="px-4 pb-3">
          <ScheduleGrid weeklyRoster={position.weekly_roster} rosterByDay={position.roster_by_day} />
        </div>
      )}

    </Link>
  );
}

function ConnectionCard({ position }: { position: RealPosition }) {
  return (
    <div className="rounded-lg border border-slate-100 bg-white p-3 cursor-pointer hover:bg-violet-50 hover:border-violet-200 transition-colors">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-full bg-violet-100 shrink-0">
            <span className="text-sm font-semibold text-violet-600">
              {(position.parent_last_name ?? position.parent_first_name).charAt(0)}
            </span>
          </div>
          <div>
            <p className="text-sm font-medium text-slate-900">
              {position.parent_last_name ? `${position.parent_last_name} Family` : `Family in ${position.suburb}`}
            </p>
            <div className="flex items-center gap-2 text-xs text-slate-500">
              {position.suburb && (
                <span className="flex items-center gap-1">
                  <MapPin className="h-3 w-3" />
                  {position.suburb}
                </span>
              )}
              {position.hourly_rate && (!position.source || position.source === 'parent') && (
                <span className="flex items-center gap-1">
                  <DollarSign className="h-3 w-3" />
                  ${position.hourly_rate}/hr
                </span>
              )}
              {position.hours_per_week && (
                <span className="flex items-center gap-1">
                  <Clock className="h-3 w-3" />
                  {position.hours_per_week}h/wk
                </span>
              )}
            </div>
          </div>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <span className="rounded-full px-2.5 py-1 text-xs font-medium whitespace-nowrap bg-violet-100 text-violet-700">
            Applied
          </span>
          <ChevronRight className="h-4 w-4 text-slate-300" />
        </div>
      </div>
    </div>
  );
}

function NannyView({ positions }: { positions: RealPosition[] }) {
  const [appliedIds, setAppliedIds] = useState<Set<string>>(new Set());
  const [unlocked, setUnlocked] = useState(false);

  const limitReached = !unlocked && appliedIds.size >= 3;
  const openPositions = positions.filter(p => !appliedIds.has(p.id));
  const appliedPositions = positions.filter(p => appliedIds.has(p.id));

  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
      {/* Limit Banner */}
      {limitReached && (
        <div className="rounded-lg border border-violet-100 bg-violet-50/50 p-4 text-center space-y-2 mb-4">
          <p className="text-sm text-slate-600">
            You&apos;ve reached your free application limit
          </p>
          <p className="text-sm text-slate-600">
            Share your profile to unlock unlimited applications and babysitting opportunities
          </p>
          <button
            type="button"
            onClick={() => setUnlocked(true)}
            className="inline-flex items-center gap-1.5 rounded-lg bg-violet-600 hover:bg-violet-700 active:bg-violet-800 px-5 py-2.5 text-sm font-medium text-white transition-colors"
          >
            <Sparkles className="h-3.5 w-3.5" />
            Unlock Unlimited Applications
          </button>
        </div>
      )}

      {/* Open Positions */}
      <div>
        {openPositions.length === 0 ? (
          <div className="text-center py-4">
            <p className="text-sm text-slate-400">No open positions right now</p>
            <p className="text-xs text-slate-400 mt-1">New positions are added regularly. Check back soon!</p>
          </div>
        ) : (
          <div className="space-y-3">
            {openPositions.map(p => (
              <PositionTile key={p.id} position={p} />
            ))}
          </div>
        )}
      </div>

      {/* Connections (Applied) — demo: click a position to "apply" */}
      {appliedPositions.length > 0 && (
        <div className="mt-5 pt-5 border-t border-slate-100">
          <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-3">
            Connections ({appliedPositions.length})
          </p>
          <div className="space-y-2">
            {appliedPositions.map(p => (
              <ConnectionCard key={p.id} position={p} />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════
// PARENT VIEW
// ═══════════════════════════════════════════════════════════════

function ApplicationCard({
  applicant,
  onReview,
  onDecline,
}: {
  applicant: RealApplicant;
  onReview: () => void;
  onDecline: () => void;
}) {
  const initial = applicant.first_name[0];
  const displayName = `${applicant.first_name} ${applicant.last_name[0]}.`;

  return (
    <div className="rounded-lg border border-slate-100 bg-white p-3 space-y-3">
      <div className="flex items-center gap-3">
        {applicant.profile_picture_url ? (
          <img src={applicant.profile_picture_url} alt={displayName} className="w-10 h-10 rounded-full object-cover shrink-0" />
        ) : (
          <div className="flex h-10 w-10 items-center justify-center rounded-full bg-violet-100 shrink-0">
            <span className="text-sm font-semibold text-violet-600">{initial}</span>
          </div>
        )}
        <div className="flex-1 min-w-0">
          <span className="text-sm font-medium text-slate-900 truncate block">{displayName}</span>
          <div className="flex items-center gap-2 text-xs text-slate-400">
            <span className="flex items-center gap-1"><MapPin className="w-2.5 h-2.5" />{applicant.suburb}</span>
            <span className="flex items-center gap-1"><DollarSign className="w-2.5 h-2.5" />${applicant.hourly_rate_min}/hr</span>
            <span className="flex items-center gap-1"><Briefcase className="w-2.5 h-2.5" />{applicant.total_experience_years}yrs</span>
          </div>
        </div>
        <span className="rounded-full px-2.5 py-1 text-xs font-medium whitespace-nowrap bg-amber-100 text-amber-700 shrink-0">
          Review
        </span>
      </div>
      <div className="flex gap-2">
        <button type="button" onClick={onReview} className="flex-1 h-9 rounded-lg bg-violet-600 hover:bg-violet-700 text-white text-xs font-medium transition-colors flex items-center justify-center gap-1">
          <CheckCircle2 className="w-3.5 h-3.5" /> Review
        </button>
        <button type="button" onClick={onDecline} className="flex-1 h-9 rounded-lg border border-slate-200 bg-white hover:bg-slate-50 text-slate-600 text-xs font-medium transition-colors flex items-center justify-center gap-1">
          <X className="w-3.5 h-3.5" /> Decline
        </button>
      </div>
    </div>
  );
}

function ReviewModal({
  applicant,
  onClose,
  onApprove,
  onDecline,
}: {
  applicant: RealApplicant;
  onClose: () => void;
  onApprove: (time: string) => void;
  onDecline: () => void;
}) {
  const [step, setStep] = useState<'overview' | 'timepicker'>('overview');
  const [selectedSlot, setSelectedSlot] = useState<{ date: string; dayLabel: string; bracket: string } | null>(null);
  const [selectedTime, setSelectedTime] = useState<{ hour: number; minute: number; label: string } | null>(null);

  const projectedDates = getProjectedDates(DUMMY_AVAILABILITY);
  const displayName = `${applicant.first_name} ${applicant.last_name[0]}.`;

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center">
      <div className="absolute inset-0 bg-black/50" onClick={onClose} />
      <div className="relative w-full max-w-md max-h-[90vh] overflow-y-auto overflow-x-hidden bg-white rounded-t-2xl sm:rounded-2xl shadow-lg">
        {/* Header — matches ConnectionDetailPopup */}
        <div className="sticky top-0 z-10 bg-white px-6 pt-6 pb-4">
          <div className="flex items-center gap-3">
            {step === 'timepicker' && (
              <button type="button" onClick={() => { setStep('overview'); setSelectedSlot(null); setSelectedTime(null); }} className="p-1 text-slate-400 hover:text-slate-600 -ml-1">
                <ArrowLeft className="h-5 w-5" />
              </button>
            )}
            {applicant.profile_picture_url ? (
              <img src={applicant.profile_picture_url} alt="" className="h-12 w-12 rounded-full object-cover" />
            ) : (
              <div className="flex h-12 w-12 items-center justify-center rounded-full bg-violet-100">
                <span className="text-lg font-semibold text-violet-600">{applicant.first_name.charAt(0)}</span>
              </div>
            )}
            <div className="flex-1 min-w-0">
              <p className="text-lg font-semibold text-slate-900 leading-tight">{displayName}</p>
              <p className="flex items-center gap-2 text-sm text-slate-500">
                <span className="flex items-center gap-1"><MapPin className="h-3 w-3" />{applicant.suburb}</span>
                <span>${applicant.hourly_rate_min}/hr</span>
              </p>
            </div>
            <button type="button" onClick={onClose} className="rounded-sm opacity-70 hover:opacity-100 transition-opacity text-slate-500 shrink-0">
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>

        {step === 'overview' && (
          <div className="px-6 pb-6 space-y-4">
            <div className="space-y-2">
              <p className="text-xs font-medium text-slate-400 uppercase tracking-wider">Quick Stats</p>
              <div className="grid grid-cols-2 gap-x-4 gap-y-1.5">
                <div className="flex items-center gap-2 text-sm text-slate-600"><Briefcase className="h-4 w-4 text-slate-400" />{applicant.total_experience_years} years exp</div>
                <div className="flex items-center gap-2 text-sm text-slate-600"><IdCard className="h-4 w-4 text-slate-400" />{applicant.drivers_license ? 'Has license' : 'No license'}</div>
                <div className="flex items-center gap-2 text-sm text-slate-600"><Car className="h-4 w-4 text-slate-400" />{applicant.has_car ? 'Has car' : 'No car'}</div>
                <div className="flex items-center gap-2 text-sm text-slate-600"><Cigarette className="h-4 w-4 text-slate-400" />{applicant.non_smoker ? 'Non-smoker' : 'Smoker'}</div>
              </div>
            </div>

            {applicant.message && (
              <div className="space-y-2">
                <p className="text-xs font-medium text-slate-400 uppercase tracking-wider">Message</p>
                <div className="rounded-lg border border-slate-200 bg-white px-3 py-2">
                  <p className="text-xs text-slate-700">{applicant.message}</p>
                </div>
              </div>
            )}

            <button type="button" onClick={() => alert('View Profile — links to /nannies/[id]')} className="text-xs font-medium text-violet-600 hover:text-violet-700 transition-colors">
              View Full Profile
            </button>

            <div className="space-y-3 border-t border-slate-100 pt-4">
              <button type="button" onClick={() => setStep('timepicker')} className="w-full h-10 rounded-lg bg-violet-600 hover:bg-violet-700 text-white font-medium text-sm transition-colors flex items-center justify-center gap-1.5">
                <CalendarDays className="h-4 w-4" /> Schedule Meet & Greet
              </button>
              <button type="button" onClick={onDecline} className="w-full text-center text-sm text-slate-400 hover:text-red-500 transition-colors">
                Decline Application
              </button>
            </div>
          </div>
        )}

        {step === 'timepicker' && (
          <div className="px-6 pb-6 space-y-4">
            <div>
              <p className="text-sm font-medium text-slate-800 mb-0.5">{applicant.first_name}&apos;s availability</p>
              <p className="text-xs text-slate-500">Select a time for your introductory phone call</p>
            </div>

            <div className="overflow-x-auto">
              <div className="grid grid-cols-[90px_repeat(4,1fr)] gap-1 mb-1">
                <div />
                {BRACKET_KEYS.map(bk => (
                  <div key={bk} className="text-center">
                    <p className="text-[11px] font-semibold text-slate-600">{TIME_BRACKETS[bk].label}</p>
                    <p className="text-[9px] text-slate-400">{TIME_BRACKETS[bk].sublabel}</p>
                  </div>
                ))}
              </div>
              {projectedDates.map(day => (
                <div key={day.date} className="grid grid-cols-[90px_repeat(4,1fr)] gap-1 mb-1">
                  <div className="flex items-center">
                    <p className="text-xs font-medium text-slate-600 truncate">{day.dayLabel}</p>
                  </div>
                  {BRACKET_KEYS.map(bk => {
                    const available = day.brackets.includes(bk);
                    const isSelected = selectedSlot?.date === day.date && selectedSlot?.bracket === bk;
                    return (
                      <button key={bk} type="button" onClick={() => { if (!available) return; setSelectedSlot({ date: day.date, dayLabel: day.dayLabel, bracket: bk }); setSelectedTime(null); }} disabled={!available}
                        className={`h-10 rounded-md border text-xs font-medium transition-colors ${isSelected ? 'bg-violet-600 text-white border-violet-600' : available ? 'bg-violet-50 text-violet-600 border-violet-200 hover:border-violet-400 cursor-pointer' : 'bg-slate-50 text-slate-200 border-slate-100 cursor-not-allowed'}`}
                      >
                        {isSelected ? '✓' : ''}
                      </button>
                    );
                  })}
                </div>
              ))}
            </div>

            {selectedSlot && (
              <div>
                <p className="text-xs font-medium text-slate-600 mb-2">Select a time — {selectedSlot.dayLabel}, {TIME_BRACKETS[selectedSlot.bracket].label}</p>
                <div className="grid grid-cols-4 gap-1.5">
                  {getBracketTimeOptions(selectedSlot.bracket).map(opt => {
                    const isTimeSelected = selectedTime?.hour === opt.hour && selectedTime?.minute === opt.minute;
                    return (
                      <button key={opt.label} type="button" onClick={() => setSelectedTime(opt)}
                        className={`h-9 rounded-md border text-xs font-medium transition-colors ${isTimeSelected ? 'bg-violet-600 text-white border-violet-600' : 'bg-white text-slate-600 border-slate-200 hover:border-violet-400 hover:text-violet-600'}`}
                      >
                        {opt.label}
                      </button>
                    );
                  })}
                </div>
              </div>
            )}

            {selectedSlot && selectedTime && (
              <div className="rounded-lg bg-green-50 border border-green-200 px-4 py-2.5 flex items-center gap-2">
                <CheckCircle2 className="h-4 w-4 text-green-600 flex-shrink-0" />
                <p className="text-sm font-medium text-green-700">{selectedSlot.dayLabel} at {selectedTime.label}</p>
              </div>
            )}

            <div className="flex gap-3">
              <button type="button" onClick={() => { setStep('overview'); setSelectedSlot(null); setSelectedTime(null); }} className="flex-1 h-10 rounded-lg border border-slate-200 bg-white hover:bg-slate-50 text-slate-600 font-medium text-sm transition-colors">
                Back
              </button>
              <button type="button" onClick={() => { if (selectedSlot && selectedTime) onApprove(`${selectedSlot.dayLabel} at ${selectedTime.label}`); }} disabled={!selectedSlot || !selectedTime}
                className={`flex-1 h-10 rounded-lg font-medium text-sm transition-colors ${selectedSlot && selectedTime ? 'bg-violet-600 hover:bg-violet-700 text-white' : 'bg-slate-100 text-slate-400 cursor-not-allowed'}`}
              >
                Approve & Schedule
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function DeclineConfirmation({ name, onConfirm, onCancel }: { name: string; onConfirm: () => void; onCancel: () => void }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/50" onClick={onCancel} />
      <div className="relative w-full max-w-sm bg-white rounded-2xl p-6 space-y-4 mx-4 shadow-lg">
        <p className="text-base font-semibold text-slate-800">Decline {name}&apos;s application?</p>
        <p className="text-sm text-slate-500">This will remove their application. They won&apos;t be notified of the reason.</p>
        <div className="flex gap-2">
          <button type="button" onClick={onCancel} className="flex-1 h-9 rounded-lg border border-slate-200 bg-white hover:bg-slate-50 text-slate-600 text-sm font-medium transition-colors">Cancel</button>
          <button type="button" onClick={onConfirm} className="flex-1 h-9 rounded-lg bg-red-500 hover:bg-red-600 text-white text-sm font-medium transition-colors">Decline</button>
        </div>
      </div>
    </div>
  );
}

function UpcomingIntroCard({ applicant, confirmedTime }: { applicant: RealApplicant; confirmedTime: string }) {
  const displayName = `${applicant.first_name} ${applicant.last_name[0]}.`;
  return (
    <div className="rounded-lg border border-slate-100 bg-white p-3 cursor-pointer hover:bg-violet-50 hover:border-violet-200 transition-colors">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          {applicant.profile_picture_url ? (
            <img src={applicant.profile_picture_url} alt="" className="h-10 w-10 rounded-full object-cover shrink-0" />
          ) : (
            <div className="flex h-10 w-10 items-center justify-center rounded-full bg-green-50 ring-2 ring-green-200 shrink-0">
              <span className="text-sm font-semibold text-green-600">{applicant.first_name.charAt(0)}</span>
            </div>
          )}
          <div>
            <p className="text-sm font-medium text-slate-900">{displayName}</p>
            <div className="flex items-center gap-2 text-xs text-slate-500">
              <span className="flex items-center gap-1 text-green-600 font-medium"><CalendarDays className="h-3 w-3" />{confirmedTime}</span>
              <span className="flex items-center gap-1"><Phone className="h-3 w-3" />Phone shared</span>
            </div>
          </div>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <span className="rounded-full px-2.5 py-1 text-xs font-medium whitespace-nowrap bg-violet-100 text-violet-700">Meet Scheduled</span>
          <ChevronRight className="h-4 w-4 text-slate-300" />
        </div>
      </div>
    </div>
  );
}

function ParentView({ applicants: initialApplicants }: { applicants: RealApplicant[] }) {
  const [applicants, setApplicants] = useState<RealApplicant[]>([...initialApplicants]);
  const [reviewingId, setReviewingId] = useState<string | null>(null);
  const [decliningId, setDecliningId] = useState<string | null>(null);
  const [approvedList, setApprovedList] = useState<Array<{ applicant: RealApplicant; confirmedTime: string }>>([]);

  const reviewingApplicant = applicants.find(a => a.request_id === reviewingId);
  const decliningApplicant = applicants.find(a => a.request_id === decliningId);

  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
      <div className="flex items-center gap-2 mb-4">
        <Users className="h-5 w-5 text-violet-600" />
        <p className="text-base font-semibold text-slate-800">Applications</p>
      </div>

      {applicants.length > 0 && (
        <div>
          <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-3">Pending Review ({applicants.length})</p>
          <div className="space-y-3">
            {applicants.map(a => (
              <ApplicationCard key={a.request_id} applicant={a} onReview={() => setReviewingId(a.request_id)} onDecline={() => setDecliningId(a.request_id)} />
            ))}
          </div>
        </div>
      )}

      {applicants.length === 0 && approvedList.length === 0 && (
        <div className="text-center py-4"><p className="text-sm text-slate-400">No applications yet</p></div>
      )}

      {approvedList.length > 0 && (
        <div className={applicants.length > 0 ? 'mt-5 pt-5 border-t border-slate-100' : ''}>
          <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-3">Upcoming Intros ({approvedList.length})</p>
          <div className="space-y-2">
            {approvedList.map(item => (
              <UpcomingIntroCard key={item.applicant.request_id} applicant={item.applicant} confirmedTime={item.confirmedTime} />
            ))}
          </div>
        </div>
      )}

      {reviewingApplicant && (
        <ReviewModal
          applicant={reviewingApplicant}
          onClose={() => setReviewingId(null)}
          onApprove={(time) => {
            setApprovedList(prev => [...prev, { applicant: reviewingApplicant, confirmedTime: time }]);
            setApplicants(prev => prev.filter(a => a.request_id !== reviewingApplicant.request_id));
            setReviewingId(null);
          }}
          onDecline={() => { setReviewingId(null); setDecliningId(reviewingApplicant.request_id); }}
        />
      )}

      {decliningApplicant && (
        <DeclineConfirmation
          name={`${decliningApplicant.first_name} ${decliningApplicant.last_name[0]}.`}
          onConfirm={() => { setApplicants(prev => prev.filter(a => a.request_id !== decliningApplicant.request_id)); setDecliningId(null); }}
          onCancel={() => setDecliningId(null)}
        />
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════
// MAIN CLIENT COMPONENT
// ═══════════════════════════════════════════════════════════════

export function PositionApplyClient({ positions, applicants }: { positions: RealPosition[]; applicants: RealApplicant[] }) {
  const [view, setView] = useState<'nanny' | 'parent'>('nanny');

  return (
    <div className="min-h-screen bg-slate-50">
      <div className="max-w-lg mx-auto px-4 py-6 space-y-4">
        <div className="text-center">
          <p className="text-xs font-medium text-violet-600 uppercase tracking-wider">Test Prototype</p>
          <h1 className="text-lg font-semibold text-slate-800 mt-1">Position Apply Flow</h1>
        </div>

        <div className="flex gap-1 rounded-xl bg-slate-100 p-1">
          <button type="button" onClick={() => setView('nanny')} className={`flex-1 rounded-lg px-4 py-2 text-sm font-medium transition-all ${view === 'nanny' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}>
            Nanny View
          </button>
          <button type="button" onClick={() => setView('parent')} className={`flex-1 rounded-lg px-4 py-2 text-sm font-medium transition-all ${view === 'parent' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}>
            Parent View
          </button>
        </div>

        {view === 'nanny' ? <NannyView positions={positions} /> : <ParentView applicants={applicants} />}
      </div>
    </div>
  );
}
