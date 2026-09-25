"use client";

import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { StepProps } from "../NannyRegistrationFunnel";

// Most common at top, then alphabetical
const COUNTRIES = [
  "Australian",
  "British",
  "New Zealander",
  "American",
  "Canadian",
  "Afghan",
  "Albanian",
  "Algerian",
  "Andorran",
  "Angolan",
  "Argentine",
  "Armenian",
  "Austrian",
  "Azerbaijani",
  "Bahraini",
  "Bangladeshi",
  "Belarusian",
  "Belgian",
  "Belizean",
  "Beninese",
  "Bhutanese",
  "Bolivian",
  "Bosnian",
  "Botswanan",
  "Brazilian",
  "Bruneian",
  "Bulgarian",
  "Burkinabe",
  "Burundian",
  "Cambodian",
  "Cameroonian",
  "Cape Verdean",
  "Central African",
  "Chadian",
  "Chilean",
  "Chinese",
  "Colombian",
  "Comorian",
  "Congolese",
  "Costa Rican",
  "Croatian",
  "Cuban",
  "Cypriot",
  "Czech",
  "Danish",
  "Djiboutian",
  "Dominican",
  "Ecuadorean",
  "Egyptian",
  "Emirati",
  "Equatorial Guinean",
  "Eritrean",
  "Estonian",
  "Ethiopian",
  "Fijian",
  "Finnish",
  "French",
  "Gabonese",
  "Gambian",
  "Georgian",
  "German",
  "Ghanaian",
  "Greek",
  "Guatemalan",
  "Guinean",
  "Guyanese",
  "Haitian",
  "Honduran",
  "Hungarian",
  "Icelandic",
  "Indian",
  "Indonesian",
  "Iranian",
  "Iraqi",
  "Irish",
  "Israeli",
  "Italian",
  "Ivorian",
  "Jamaican",
  "Japanese",
  "Jordanian",
  "Kazakhstani",
  "Kenyan",
  "Korean",
  "Kuwaiti",
  "Kyrgyz",
  "Laotian",
  "Latvian",
  "Lebanese",
  "Liberian",
  "Libyan",
  "Liechtensteiner",
  "Lithuanian",
  "Luxembourgish",
  "Macedonian",
  "Malagasy",
  "Malawian",
  "Malaysian",
  "Maldivian",
  "Malian",
  "Maltese",
  "Mauritanian",
  "Mauritian",
  "Mexican",
  "Moldovan",
  "Mongolian",
  "Montenegrin",
  "Moroccan",
  "Mozambican",
  "Namibian",
  "Nepalese",
  "Nicaraguan",
  "Nigerian",
  "Norwegian",
  "Omani",
  "Pakistani",
  "Palauan",
  "Palestinian",
  "Panamanian",
  "Paraguayan",
  "Peruvian",
  "Filipino",
  "Polish",
  "Portuguese",
  "Qatari",
  "Romanian",
  "Russian",
  "Rwandan",
  "Saudi",
  "Senegalese",
  "Serbian",
  "Sierra Leonean",
  "Singaporean",
  "Slovak",
  "Slovenian",
  "Somali",
  "South African",
  "South Sudanese",
  "Spanish",
  "Sri Lankan",
  "Sudanese",
  "Surinamese",
  "Swazi",
  "Swedish",
  "Swiss",
  "Syrian",
  "Taiwanese",
  "Tajik",
  "Tanzanian",
  "Thai",
  "Timorese",
  "Togolese",
  "Trinidadian",
  "Tunisian",
  "Turkish",
  "Turkmen",
  "Ugandan",
  "Ukrainian",
  "Uruguayan",
  "Uzbek",
  "Venezuelan",
  "Vietnamese",
  "Yemeni",
  "Zambian",
  "Zimbabwean",
];

const RESIDENCY_STATUS_OPTIONS = [
  "Australian Citizen",
  "Permanent Resident",
  "Working Holiday",
  "Other",
];

function SingleSelectTags({
  options,
  selected,
  onChange,
}: {
  options: string[];
  selected: string | null;
  onChange: (val: string) => void;
}) {
  return (
    <div className="flex flex-wrap gap-2">
      {options.map((opt) => (
        <button
          key={opt}
          type="button"
          onClick={() => onChange(opt)}
          className={`px-4 py-2 rounded-full border text-sm font-medium cursor-pointer transition-colors ${
            selected === opt
              ? "bg-violet-600 text-white border-violet-600"
              : "bg-white text-slate-700 border-slate-300 hover:border-violet-400"
          }`}
        >
          {opt}
        </button>
      ))}
    </div>
  );
}

function YesNoTags({
  value,
  onChange,
}: {
  value: boolean | null;
  onChange: (val: boolean) => void;
}) {
  return (
    <div className="flex flex-wrap gap-2">
      {["Yes", "No"].map((opt) => (
        <button
          key={opt}
          type="button"
          onClick={() => onChange(opt === "Yes")}
          className={`px-4 py-2 rounded-full border text-sm font-medium cursor-pointer transition-colors ${
            value === (opt === "Yes")
              ? "bg-violet-600 text-white border-violet-600"
              : "bg-white text-slate-700 border-slate-300 hover:border-violet-400"
          }`}
        >
          {opt}
        </button>
      ))}
    </div>
  );
}

function Reveal({
  show,
  children,
}: {
  show: boolean;
  children: React.ReactNode;
}) {
  return (
    <div
      className={`transition-all duration-300 ease-in-out overflow-hidden ${
        show ? "max-h-[600px] opacity-100 mt-6" : "max-h-0 opacity-0"
      }`}
    >
      {children}
    </div>
  );
}

export function StepResidency({ data, updateData, goNext, goBack }: StepProps) {
  const [customResidencyStatus, setCustomResidencyStatus] = useState("");

  const nationality = data.nationality ?? null;
  const isAustralian = nationality === "Australian";

  // Residency status tag selection
  const residencyStatusTag = (() => {
    if (!data.residency_status) return null;
    if (RESIDENCY_STATUS_OPTIONS.includes(data.residency_status)) {
      return data.residency_status;
    }
    return "Other";
  })();

  const showResidencyStatus = !!nationality && !isAustralian;
  const residencyStatusAnswered =
    isAustralian ||
    (residencyStatusTag !== null &&
      (residencyStatusTag !== "Other" ||
        (customResidencyStatus.trim() !== "")));

  const showRightToWork = !!nationality;
  const rightToWorkAnswered = data.right_to_work !== null && data.right_to_work !== undefined;

  const showSydneyResident =
    showRightToWork && (isAustralian || rightToWorkAnswered);

  const sydneyResident = data.sydney_resident ?? null;
  const sydneyResidentAnswered = sydneyResident !== null;

  const showSuburbPostcode = sydneyResident === true;
  // ADR-188: a London postcode district prefix is 2-4 alphanumerics
  // ("E1", "SW4", "SW20"), never a four-digit number, so there is no
  // numeric range to bound it by.
  const suburbPostcodeValid =
    !!data.suburb?.trim() && !!data.postcode?.trim();

  // Nav button: hidden unless sydney residency satisfied
  const canContinue =
    !!nationality &&
    residencyStatusAnswered &&
    rightToWorkAnswered &&
    sydneyResidentAnswered &&
    (sydneyResident === false || suburbPostcodeValid);

  function handleResidencyTagChange(val: string) {
    if (val !== "Other") {
      updateData({ residency_status: val });
      setCustomResidencyStatus("");
    } else {
      // Set to "Other" tag, actual value from text input
      updateData({ residency_status: customResidencyStatus || null });
    }
  }

  function handleCustomResidencyChange(val: string) {
    setCustomResidencyStatus(val);
    updateData({ residency_status: val || null });
  }

  return (
    <Card className="w-full max-w-2xl mx-auto">
      <CardHeader>
        <CardTitle className="text-2xl font-bold text-center text-slate-800">
          Residency Details
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-6">

        {/* Nationality Dropdown */}
        <div className="space-y-3">
          <p className="text-sm font-medium text-slate-700">
            What is your nationality?
          </p>
          <select
            value={nationality ?? ""}
            onChange={(e) =>
              updateData({ nationality: e.target.value || null })
            }
            className="w-full rounded-lg border border-slate-300 bg-white px-4 py-2.5 text-sm text-slate-800 focus:border-violet-500 focus:ring-1 focus:ring-violet-500 outline-none"
          >
            <option value="" disabled>
              Select your nationality
            </option>
            {COUNTRIES.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
        </div>

        {/* Residency Status — only if NOT Australian */}
        <Reveal show={showResidencyStatus}>
          <div className="space-y-3">
            <p className="text-sm font-medium text-slate-700">
              What is your current residency status in Australia?
            </p>
            <SingleSelectTags
              options={RESIDENCY_STATUS_OPTIONS}
              selected={residencyStatusTag}
              onChange={handleResidencyTagChange}
            />
            {/* Custom status input if Other selected */}
            <Reveal show={residencyStatusTag === "Other"}>
              <Input
                type="text"
                placeholder="Please specify your residency status"
                value={customResidencyStatus}
                onChange={(e) => handleCustomResidencyChange(e.target.value)}
                className="mt-3"
              />
            </Reveal>
          </div>
        </Reveal>

        {/* Right to Work */}
        <Reveal show={showRightToWork}>
          <div className="space-y-3">
            <p className="text-sm font-medium text-slate-700">
              Do you have the right to work in Australia?
            </p>
            <YesNoTags
              value={data.right_to_work ?? null}
              onChange={(val) => updateData({ right_to_work: val })}
            />
          </div>
        </Reveal>

        {/* Sydney Resident */}
        <Reveal show={showSydneyResident}>
          <div className="space-y-3">
            <p className="text-sm font-medium text-slate-700">
              Are you currently living in Sydney?
            </p>
            <YesNoTags
              value={sydneyResident}
              onChange={(val) => updateData({ sydney_resident: val })}
            />
          </div>

          {/* Suburb + Postcode if Yes */}
          <Reveal show={showSuburbPostcode}>
            <div className="space-y-4">
              <div className="space-y-2">
                <p className="text-sm font-medium text-slate-700">
                  Which area do you currently live in?
                </p>
                <Input
                  type="text"
                  placeholder="Eg: Clapham"
                  value={data.suburb ?? ""}
                  onChange={(e) =>
                    updateData({ suburb: e.target.value || null })
                  }
                />
              </div>
              <div className="space-y-2">
                <Input
                  type="text"
                  placeholder="Eg: SW4"
                  value={data.postcode ?? ""}
                  onChange={(e) =>
                    updateData({ postcode: e.target.value || null })
                  }
                />
              </div>
            </div>
          </Reveal>

          {/* Not-Sydney note */}
          <Reveal show={sydneyResident === false}>
            <ul className="list-disc list-inside space-y-1 pl-1">
              <li className="text-sm text-slate-600 italic">
                This service is currently only available for nannies living (or
                soon to be living) in Sydney
              </li>
            </ul>
          </Reveal>
        </Reveal>

        {/* Navigation */}
        <div className="flex gap-3 pt-2">
          <Button type="button" variant="outline" onClick={goBack} className="flex-1">
            Back
          </Button>
          {canContinue && (
            <Button
              type="button"
              onClick={goNext}
              className="flex-1 bg-violet-600 hover:bg-violet-700 text-white"
            >
              Continue to add bio
            </Button>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
