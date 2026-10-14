"use client";

// T-032 — Worklist tab strip. Underline-style segmented control.

import type { WorklistTab } from "@/lib/leads/types";
import { WORKLIST_TABS } from "@/lib/leads/types";

interface LeadWorklistTabsProps {
  currentTab: WorklistTab;
  onChange: (tab: WorklistTab) => void;
  disabled?: boolean;
}

const TAB_LABEL: Record<WorklistTab, string> = {
  worklist: "Worklist",
  never_contacted: "Never contacted",
  snoozed_today: "Snoozed today",
  cold_7d: "Cold > 7d",
  verification_stuck: "ID verified, DBS not yet approved",
  responded: "Responded",
  activated: "Activated",
  dormant: "Dormant",
  all: "All",
};

export function LeadWorklistTabs({
  currentTab,
  onChange,
  disabled = false,
}: LeadWorklistTabsProps) {
  return (
    <div className="overflow-x-auto -mx-4 px-4 sm:mx-0 sm:px-0">
      <div className="flex w-max items-center gap-1 border-b border-slate-200 sm:w-auto">
        {WORKLIST_TABS.map((tab) => {
          const active = tab === currentTab;
          return (
            <button
              key={tab}
              type="button"
              disabled={disabled}
              onClick={() => onChange(tab)}
              aria-pressed={active}
              className={`relative whitespace-nowrap px-3 py-2 text-sm font-medium transition-colors ${
                active
                  ? "text-violet-700"
                  : "text-slate-500 hover:text-slate-900"
              } ${disabled ? "opacity-50" : ""}`}
            >
              {TAB_LABEL[tab]}
              {active && (
                <span className="absolute inset-x-2 -bottom-px h-0.5 rounded-full bg-violet-500" />
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}
