'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { StageProps } from '../../FunnelOrchestrator';
import { SingleSelectTags } from '../../shared/SingleSelectTags';
import { YesNoTags } from '../../shared/YesNoTags';
import { ProgressiveReveal } from '../../shared/ProgressiveReveal';
import { CompoundPageShell } from '../../shared/CompoundPageShell';
import {
  RIGHT_TO_WORK_OPTIONS,
  RTW_AUTO_NATIONALITIES,
  rightToWorkFor,
  type RightToWorkKey,
} from '@/lib/nanny-options';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { MapPin } from 'lucide-react';

// Full nationality list — British and Irish first (E-1: they skip the right-to-work question), then alphabetical
const COUNTRIES = [
  ...RTW_AUTO_NATIONALITIES,
  'Afghan', 'Albanian', 'Algerian', 'American', 'Andorran', 'Angolan', 'Argentine', 'Armenian', 'Australian', 'Austrian', 'Azerbaijani',
  'Bahraini', 'Bangladeshi', 'Belarusian', 'Belgian', 'Belizean', 'Beninese', 'Bhutanese', 'Bolivian',
  'Bosnian', 'Botswanan', 'Brazilian', 'Bruneian', 'Bulgarian', 'Burkinabe', 'Burundian',
  'Cambodian', 'Cameroonian', 'Canadian', 'Cape Verdean', 'Central African', 'Chadian', 'Chilean', 'Chinese',
  'Colombian', 'Comorian', 'Congolese', 'Costa Rican', 'Croatian', 'Cuban', 'Cypriot', 'Czech',
  'Danish', 'Djiboutian', 'Dominican',
  'Ecuadorean', 'Egyptian', 'Emirati', 'Equatorial Guinean', 'Eritrean', 'Estonian', 'Ethiopian',
  'Fijian', 'Finnish', 'French',
  'Gabonese', 'Gambian', 'Georgian', 'German', 'Ghanaian', 'Greek', 'Guatemalan', 'Guinean', 'Guyanese',
  'Haitian', 'Honduran', 'Hungarian',
  'Icelandic', 'Indian', 'Indonesian', 'Iranian', 'Iraqi', 'Israeli', 'Italian', 'Ivorian',
  'Jamaican', 'Japanese', 'Jordanian',
  'Kazakhstani', 'Kenyan', 'Korean', 'Kuwaiti', 'Kyrgyz',
  'Laotian', 'Latvian', 'Lebanese', 'Liberian', 'Libyan', 'Liechtensteiner', 'Lithuanian', 'Luxembourgish',
  'Macedonian', 'Malagasy', 'Malawian', 'Malaysian', 'Maldivian', 'Malian', 'Maltese', 'Mauritanian',
  'Mauritian', 'Mexican', 'Moldovan', 'Mongolian', 'Montenegrin', 'Moroccan', 'Mozambican',
  'Namibian', 'Nepalese', 'New Zealander', 'Nicaraguan', 'Nigerian', 'Norwegian',
  'Omani',
  'Pakistani', 'Palauan', 'Palestinian', 'Panamanian', 'Paraguayan', 'Peruvian', 'Filipino', 'Polish', 'Portuguese',
  'Qatari',
  'Romanian', 'Russian', 'Rwandan',
  'Saudi', 'Senegalese', 'Serbian', 'Sierra Leonean', 'Singaporean', 'Slovak', 'Slovenian', 'Somali',
  'South African', 'South Sudanese', 'Spanish', 'Sri Lankan', 'Sudanese', 'Surinamese', 'Swazi', 'Swedish', 'Swiss', 'Syrian',
  'Taiwanese', 'Tajik', 'Tanzanian', 'Thai', 'Timorese', 'Togolese', 'Trinidadian', 'Tunisian', 'Turkish', 'Turkmen',
  'Ugandan', 'Ukrainian', 'Uruguayan', 'Uzbek',
  'Venezuelan', 'Vietnamese',
  'Yemeni',
  'Zambian', 'Zimbabwean',
];

// District autocomplete types — a row of `/api/london-districts` (ADR-188)
interface DistrictEntry {
  district: string;
  prefix: string;
  label: string;
}

// A prefix query like "E1" substring-matches SE1, E10, E11 … so an exact or
// leading prefix match has to outrank them, or the district the family typed
// never reaches the eight-row dropdown (ADR-188: prefixes are 2-4 characters,
// unlike the 4-digit postcode this replaced, where `includes` was harmless).
function rankDistrict(d: DistrictEntry, q: string): number {
  const prefix = d.prefix.toLowerCase();
  if (prefix === q) return 0;
  if (prefix.startsWith(q)) return 1;
  if (d.district.toLowerCase().startsWith(q)) return 2;
  return 3;
}

export function N1Location({ state, dispatch, goNext, goBack, progress, questionNumber }: StageProps) {
  const { residency } = state;

  const update = useCallback(
    (payload: Partial<typeof residency>) => {
      dispatch({ type: 'UPDATE_RESIDENCY', payload });
    },
    [dispatch]
  );

  // Suburb autocomplete state
  const [districts, setDistricts] = useState<DistrictEntry[]>([]);
  const [suburbQuery, setSuburbQuery] = useState(
    residency.suburb && residency.postcode
      ? `${residency.suburb}, ${residency.postcode}`
      : residency.suburb ?? ''
  );
  const [filtered, setFiltered] = useState<DistrictEntry[]>([]);
  const [showDropdown, setShowDropdown] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    fetch('/api/london-districts')
      .then((res) => res.json())
      .then((d: DistrictEntry[]) => setDistricts(d))
      .catch(() => {});
  }, []);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setShowDropdown(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const handleSuburbChange = (val: string) => {
    setSuburbQuery(val);
    update({ suburb: null, postcode: null });
    if (val.trim().length >= 2) {
      const q = val.toLowerCase().trim();
      const matches = districts
        .filter(
          (d) =>
            d.district.toLowerCase().includes(q) ||
            d.prefix.toLowerCase().includes(q)
        )
        .sort(
          (a, b) =>
            rankDistrict(a, q) - rankDistrict(b, q) ||
            a.district.localeCompare(b.district)
        )
        .slice(0, 20);
      setFiltered(matches);
      setShowDropdown(matches.length > 0);
    } else {
      setFiltered([]);
      setShowDropdown(false);
    }
  };

  const handleSuburbSelect = (entry: DistrictEntry) => {
    setSuburbQuery(entry.label);
    setShowDropdown(false);
    update({ suburb: entry.district, postcode: entry.prefix });
  };

  // E-1: British / Irish are stored as `citizen` with the right to work and skip the question
  const isAutoRightToWork = (RTW_AUTO_NATIONALITIES as readonly string[]).includes(residency.nationality ?? '');
  const notInLondon = residency.sydney_resident === false;

  // Fail closed on state restored from before the UK question: an answer outside the four keys is never carried
  // forward; British / Irish are re-stamped as `citizen` (E-1)
  const statusIsKey = RIGHT_TO_WORK_OPTIONS.some((o) => o.key === residency.residency_status);
  useEffect(() => {
    if (residency.residency_status === null || statusIsKey) return;
    if (isAutoRightToWork) {
      update({ residency_status: 'citizen', right_to_work: rightToWorkFor('citizen') });
      return;
    }
    update({ residency_status: null, right_to_work: null, sydney_resident: null, suburb: null, postcode: null });
    setSuburbQuery('');
  }, [residency.residency_status, statusIsKey, isAutoRightToWork, update]);

  // Show conditions — cascade
  const showRightToWork = residency.nationality !== null && !isAutoRightToWork;
  const showLondon = statusIsKey;
  const showSuburb = residency.sydney_resident === true;

  // Continue once the last question is answered — a `no_rtw` answer still continues (E-1); not living in London stops
  const canContinue =
    residency.nationality !== null &&
    statusIsKey &&
    residency.sydney_resident === true &&
    residency.suburb !== null &&
    residency.suburb.trim() !== '';

  const rtwLabels = RIGHT_TO_WORK_OPTIONS.map((o) => o.label);
  const rtwSelectedLabel =
    RIGHT_TO_WORK_OPTIONS.find((o) => o.key === residency.residency_status)?.label ?? null;

  const resetLondon = () => {
    setSuburbQuery('');
    setFiltered([]);
  };

  const pickRightToWork = (label: string | null) => {
    const key: RightToWorkKey | null = RIGHT_TO_WORK_OPTIONS.find((o) => o.label === label)?.key ?? null;
    update({
      residency_status: key,
      right_to_work: key ? rightToWorkFor(key) : null,
      sydney_resident: null,
      suburb: null,
      postcode: null,
    });
    resetLondon();
  };

  return (
    <CompoundPageShell
      title="Where You Are"
      subtitle="Just a few formalities"
      progress={progress}
      showBack={true}
      onBack={goBack}
      questionNumber={questionNumber}
    >
      <div className="flex flex-col gap-5">
        {/* Nationality — dropdown select */}
        <div className="flex flex-col gap-2">
          <Label className="text-sm font-medium text-slate-700">
            What is your nationality?
          </Label>
          <select
            value={residency.nationality || ''}
            onChange={(e) => {
              const val = e.target.value || null;
              const auto = (RTW_AUTO_NATIONALITIES as readonly string[]).includes(val ?? '');
              // Cascade reset all downstream
              update({
                nationality: val,
                residency_status: auto ? 'citizen' : null,
                right_to_work: auto ? rightToWorkFor('citizen') : null,
                sydney_resident: null,
                suburb: null,
                postcode: null,
              });
              resetLondon();
            }}
            className="w-full h-11 rounded-lg border border-slate-200 bg-white px-3 text-sm text-slate-800 focus:border-violet-500 focus:ring-1 focus:ring-violet-500 outline-none"
          >
            <option value="">Select nationality</option>
            {COUNTRIES.map((c) => (
              <option key={c} value={c}>{c}</option>
            ))}
          </select>
        </div>

        {/* Right to work in the UK — everyone but British / Irish (E-1); four options, no "Not sure" (E-3) */}
        <ProgressiveReveal show={showRightToWork}>
          <div className="flex flex-col gap-2 pt-2">
            <Label className="text-sm font-medium text-slate-700">
              Do you have the right to work in the UK?
            </Label>
            <SingleSelectTags
              options={rtwLabels}
              selected={rtwSelectedLabel}
              onChange={pickRightToWork}
            />
          </div>
        </ProgressiveReveal>

        {/* Living in London — `sydney_resident` key kept per D-4 */}
        <ProgressiveReveal show={showLondon}>
          <div className="flex flex-col gap-2 pt-2">
            <Label className="text-sm font-medium text-slate-700">
              Are you currently living in London?
            </Label>
            <YesNoTags
              selected={residency.sydney_resident}
              onChange={(val) => {
                update({
                  sydney_resident: val,
                  suburb: null,
                  postcode: null,
                });
                resetLondon();
              }}
            />
          </div>
        </ProgressiveReveal>

        {/* Not living in London — hard stop, no Continue (E-6) */}
        {notInLondon && (
          <div className="p-4 bg-blue-50 border border-blue-200 rounded-lg flex gap-3">
            <MapPin className="w-5 h-5 text-blue-500 flex-shrink-0 mt-0.5" />
            <div className="flex flex-col gap-1">
              <p className="text-sm font-medium text-blue-800">
                We&apos;re currently only available in London
              </p>
              <p className="text-sm text-blue-700">
                But we&apos;re growing! Complete your application and we&apos;ll let you know when we&apos;re in your area.
              </p>
            </div>
          </div>
        )}

        {/* Suburb autocomplete */}
        <ProgressiveReveal show={showSuburb}>
          <div className="flex flex-col gap-2 pt-2" ref={dropdownRef}>
            <Label className="text-sm font-medium text-slate-700">
              What area are you in?
            </Label>
            <div className="relative">
              {showDropdown && filtered.length > 0 && (
                <div className="absolute z-50 bottom-full mb-1 w-full rounded-lg border border-slate-200 bg-white shadow-lg max-h-60 overflow-y-auto">
                  {filtered.map((entry) => (
                    <button
                      key={`${entry.district}-${entry.prefix}`}
                      type="button"
                      onClick={() => handleSuburbSelect(entry)}
                      className="w-full px-3 py-2.5 text-left text-sm text-slate-700 hover:bg-violet-50 hover:text-violet-700 transition-colors"
                    >
                      {entry.label}
                    </button>
                  ))}
                </div>
              )}
              <input
                type="text"
                value={suburbQuery}
                onChange={(e) => handleSuburbChange(e.target.value)}
                onFocus={() => {
                  if (filtered.length > 0) setShowDropdown(true);
                }}
                placeholder="Start typing your area or postcode"
                className="w-full h-11 px-3 rounded-lg border border-slate-200 text-sm text-slate-800 focus:border-violet-500 focus:ring-1 focus:ring-violet-500 outline-none"
              />
            </div>
          </div>
        </ProgressiveReveal>

        {canContinue && (
          <div className="fixed bottom-0 left-0 right-0 z-20 pt-3 pb-[66px] bg-gradient-to-t from-white from-70% to-transparent">
            <div className="max-w-md mx-auto px-4">
              <Button
                onClick={goNext}
                className="w-full bg-violet-600 hover:bg-violet-700 text-white h-11 px-6 rounded-lg font-medium text-sm"
              >
                Continue
              </Button>
            </div>
          </div>
        )}
      </div>
    </CompoundPageShell>
  );
}
