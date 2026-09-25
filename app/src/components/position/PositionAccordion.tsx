"use client";

import { useState } from "react";
import {
  ChevronDown,
  ChevronUp,
  Briefcase,
  Baby,
  MapPin,
  Clock,
  DollarSign,
} from "lucide-react";

export interface PositionAccordionData {
  scheduleType: string | null;
  hoursPerWeek: number | null;
  daysRequired: string[] | null;
  schedule: Record<string, string[]> | null;
  levelOfSupport: string[] | null;
  hourlyRate: number | null;
  children: { ageMonths: number; gender: string | null }[];
  urgency: string | null;
  startDate: string | null;
  placementLength: string | null;
  reasonForNanny: string[] | null;
  languagePreference: string | null;
  languagePreferenceDetails: string | null;
  qualificationRequirement: string | null;
  certificateRequirements: string[] | null;
  vaccinationRequired: boolean | null;
  driversLicenseRequired: boolean | null;
  carRequired: boolean | null;
  comfortableWithPetsRequired: boolean | null;
  nonSmokerRequired: boolean | null;
  otherRequirements: string | null;
  suburb: string | null;
  description: string | null;
  yearsOfExperience: number | null;
  focusType: string | null;
  supportType: string | null;
  childNeeds: boolean;
  childNeedsDetails: string | null;
  source: string | null;
}

function ageDisplay(months: number): string {
  if (months < 12) return `${months}mo`;
  const years = Math.floor(months / 12);
  const rem = months % 12;
  return rem > 0 ? `${years}y ${rem}mo` : `${years}y`;
}

const DAY_OPTIONS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
const DAY_SHORT: Record<string, string> = {
  Monday: 'Mon', Tuesday: 'Tue', Wednesday: 'Wed', Thursday: 'Thu',
  Friday: 'Fri', Saturday: 'Sat', Sunday: 'Sun',
};
const BRACKET_KEYS = ['morning', 'midday', 'afternoon', 'evening'] as const;
const BRACKET_LABEL: Record<string, string> = {
  morning: 'Morning', midday: 'Midday', afternoon: 'Afternoon', evening: 'Evening',
};

function MiniScheduleGrid({ daysRequired, schedule }: { daysRequired: string[] | null; schedule: Record<string, string[]> | null }) {
  const weeklyRoster = schedule && Object.keys(schedule).length > 0
    ? DAY_OPTIONS.filter(d => Object.keys(schedule).some(k => k.toLowerCase() === d.toLowerCase()))
    : (daysRequired ?? []);
  if (weeklyRoster.length === 0) return null;

  const sortedDays = DAY_OPTIONS.filter(d => weeklyRoster.includes(d));
  if (sortedDays.length === 0) return null;

  const getScheduleForDay = (day: string): string[] => {
    if (!schedule) return [];
    const key = Object.keys(schedule).find(k => k.toLowerCase() === day.toLowerCase());
    return key ? schedule[key] : [];
  };

  return (
    <div className="rounded-md bg-violet-50 border border-violet-200 p-2">
      <div className="grid grid-cols-5 gap-x-0.5 gap-y-0.5 text-[9px]">
        <div />
        {BRACKET_KEYS.map((b) => (
          <div key={b} className="text-center text-violet-500 font-medium">
            {BRACKET_LABEL[b]}
          </div>
        ))}
        {sortedDays.map((day) => {
          const dayTimes = getScheduleForDay(day);
          return (
            <div key={day} className="contents">
              <div className="text-violet-700 font-medium truncate pr-0.5 text-[10px]">{DAY_SHORT[day]}</div>
              {BRACKET_KEYS.map((b) => (
                <div key={b} className="flex items-center justify-center py-0.5">
                  <div className={`h-2 w-2 rounded-full ${
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

function buildWhatYouGet(p: PositionAccordionData): string[] {
  const items: string[] = [];
  const isFixed = p.scheduleType === 'Fixed' || p.scheduleType === 'Yes';
  const isOngoing = p.placementLength === 'Ongoing';
  if (isFixed && isOngoing) items.push('Consistent days and hours, every week');
  else if (isFixed) items.push('Set days and hours for the duration of the role');
  else if (isOngoing) items.push('Ongoing role with flexible hours that suit you both');
  else items.push('Flexible arrangement — days and times can be worked out together');
  if (p.hourlyRate && (!p.source || p.source === 'parent')) items.push(`Competitive pay at $${p.hourlyRate}/hr`);
  items.push('A family that values and respects their nanny');
  if (p.urgency === 'Immediately' || p.urgency === 'As soon as possible') {
    items.push('Start right away — the family is ready for you');
  } else if (p.startDate) {
    const d = new Date(p.startDate);
    const label = d.toLocaleDateString('en-GB', { day: 'numeric', month: 'long' });
    items.push(`Start date: ${label}`);
  }
  if (isOngoing) items.push('Long-term position — not just a short gig');
  return items;
}

function buildLookingFor(p: PositionAccordionData): string[] {
  const items: string[] = [];

  // Experience — based on years_of_experience + child ages
  if (p.yearsOfExperience) {
    if (p.children.some(c => c.ageMonths < 12)) {
      items.push(`${p.yearsOfExperience}+ years experience preferred, ideally with newborns or babies`);
    } else if (p.children.some(c => c.ageMonths < 24)) {
      items.push(`${p.yearsOfExperience}+ years experience preferred, ideally with babies or toddlers`);
    } else {
      items.push(`${p.yearsOfExperience}+ years of childcare experience preferred`);
    }
  } else {
    if (p.children.some(c => c.ageMonths < 12)) items.push('Experience with newborns or babies is a plus');
    else if (p.children.some(c => c.ageMonths < 24)) items.push('Experience with babies or toddlers is a plus');
  }

  // Care role
  if (p.levelOfSupport && p.levelOfSupport.length > 0) {
    const roles = p.levelOfSupport.map(s => s.toLowerCase());
    if (roles.includes('primary carer')) items.push('Confident being the sole carer during your hours');
    else if (roles.includes('shared care')) items.push('Happy working alongside a parent in a shared care setup');
    else if (roles.includes('mothers help') || roles.includes("mother's help")) items.push('Comfortable in a mother\'s help role, working alongside Mum');
  }

  // Focus type
  if (p.focusType === 'Educational play') {
    items.push('A focus on educational play and creative learning activities');
  } else if (p.focusType === 'Just supervision') {
    items.push('Keeping the kids safe, happy, and entertained');
  }

  // Support type
  if (p.supportType === 'Tailored developmental support') {
    items.push('Comfortable providing tailored developmental support');
  }

  // Qualifications
  items.push('Formal qualifications not required, but experience is valued');
  items.push('First Aid certificate is a plus but not essential');

  // Driver / car
  if (p.driversLicenseRequired && p.carRequired) items.push('Driver\'s license and own car needed for school runs and activities');
  else if (p.carRequired) items.push('Own car needed — some driving to activities involved');
  else if (p.driversLicenseRequired) items.push('Driver\'s license required');
  else items.push('No car or license needed');

  // Pets
  if (p.comfortableWithPetsRequired) items.push('The family has pets — must be comfortable around animals');

  // Additional needs
  if (p.childNeeds) {
    if (p.childNeedsDetails) {
      items.push(`Comfortable supporting a child with additional needs — ${p.childNeedsDetails}`);
    } else {
      items.push('Comfortable supporting a child with additional needs');
    }
  }

  // Language
  if (p.languagePreference && p.languagePreference !== 'English') {
    if (p.languagePreferenceDetails) {
      items.push(`${p.languagePreferenceDetails} speaker preferred`);
    } else {
      items.push('Bilingual or multilingual preferred');
    }
  }

  return items;
}

export function PositionAccordion({ position }: { position: PositionAccordionData }) {
  const [expanded, setExpanded] = useState(false);

  return (
    <div className="rounded-lg bg-slate-50 border border-slate-200">
      {/* Header — always visible, click to expand */}
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center justify-between p-3"
      >
        <p className="text-xs font-medium text-slate-600 flex items-center gap-1">
          <Briefcase className="h-3 w-3" /> Position Details
        </p>
        <span className="text-xs text-violet-600 flex items-center gap-1">
          {expanded ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
        </span>
      </button>

      {/* Expanded — mirrors the job page card layout, scaled down */}
      {expanded && (
        <div className="border-t border-slate-200">
          <div className="px-3 pt-2.5 pb-2 space-y-1.5">
            {/* Location */}
            {position.suburb && (
              <div className="flex items-center gap-1.5">
                <MapPin className="h-3 w-3 text-violet-500 shrink-0" />
                <p className="text-xs font-medium text-slate-800">{position.suburb}</p>
              </div>
            )}

            {/* Children */}
            {position.children.length > 0 && (
              <div className="flex items-center gap-1.5">
                <Baby className="h-3 w-3 text-violet-500 shrink-0" />
                <div>
                  <p className="text-xs font-medium text-slate-800">
                    {position.children.length} {position.children.length === 1 ? "child" : "children"}
                  </p>
                  <p className="text-[10px] text-slate-400">
                    {position.children.map((c) => {
                      const g = c.gender?.toLowerCase();
                      const label = g === 'male' || g === 'boy' ? 'Boy' : g === 'female' || g === 'girl' ? 'Girl' : 'Child';
                      return `${label} (${ageDisplay(c.ageMonths)})`;
                    }).join(", ")}
                  </p>
                </div>
              </div>
            )}

            {/* Hours */}
            {position.hoursPerWeek && (
              <div className="flex items-center gap-1.5">
                <Clock className="h-3 w-3 text-violet-500 shrink-0" />
                <div>
                  <p className="text-xs font-medium text-slate-800">{position.hoursPerWeek} hrs/wk</p>
                  <p className="text-[10px] text-slate-400">
                    {position.scheduleType === 'Fixed' || position.scheduleType === 'Yes' ? 'Fixed schedule' : 'Flexible schedule'}
                  </p>
                </div>
              </div>
            )}

            {/* Rate */}
            {position.hourlyRate && (
              <div className="flex items-center gap-1.5">
                <DollarSign className="h-3 w-3 text-violet-500 shrink-0" />
                <p className="text-xs font-medium text-slate-800">${position.hourlyRate}/hr</p>
              </div>
            )}
          </div>

          {/* Schedule grid */}
          {(position.schedule || position.daysRequired) && (
            <div className="px-3 pb-2.5">
              <MiniScheduleGrid daysRequired={position.daysRequired} schedule={position.schedule} />
            </div>
          )}

          {/* What you get + What the family is looking for */}
          <div className="px-3 pb-3 pt-1 border-t border-slate-100 space-y-2.5">
            {(() => {
              const whatYouGet = buildWhatYouGet(position);
              return whatYouGet.length > 0 ? (
                <div>
                  <p className="text-xs font-medium text-slate-800 mb-1">What you get</p>
                  <ul className="space-y-0.5">
                    {whatYouGet.map((item, i) => (
                      <li key={i} className="flex items-start gap-1.5 text-[11px] text-slate-700 leading-snug">
                        <span className="mt-1 h-1.5 w-1.5 rounded-full bg-green-400 shrink-0" />
                        {item}
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null;
            })()}

            {(() => {
              const lookingFor = buildLookingFor(position);
              return lookingFor.length > 0 ? (
                <div>
                  <p className="text-xs font-medium text-slate-800 mb-1">What the family is looking for</p>
                  <ul className="space-y-0.5">
                    {lookingFor.map((item, i) => (
                      <li key={i} className="flex items-start gap-1.5 text-[11px] text-slate-700 leading-snug">
                        <span className="mt-1 h-1.5 w-1.5 rounded-full bg-violet-400 shrink-0" />
                        {item}
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null;
            })()}

          </div>
        </div>
      )}
    </div>
  );
}
