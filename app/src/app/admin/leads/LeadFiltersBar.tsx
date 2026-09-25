"use client";

// T-032 — Filter bar. Tri-state verification chips + contributions filter +
// status multi-select + suburb + responded filter + search + sort.

import { useState } from "react";
import { Search, X } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import type {
  ContributionsFilter,
  LeadQueryState,
  LeadSort,
  LeadStatus,
  RespondedFilter,
  TriState,
} from "@/lib/leads/types";
import { LEAD_STATUSES } from "@/lib/leads/types";
import { LEAD_SORTS } from "@/lib/leads/types";
import { LeadStatusPill } from "./LeadStatusPill";

interface LeadFiltersBarProps {
  state: LeadQueryState;
  onChange: (next: LeadQueryState) => void;
  disabled?: boolean;
}

function nextTriState(current: TriState): TriState {
  if (current === "any") return "has";
  if (current === "has") return "missing";
  return "any";
}

interface TriChipProps {
  label: string;
  value: TriState;
  onCycle: () => void;
  disabled?: boolean;
}

function TriChip({ label, value, onCycle, disabled }: TriChipProps) {
  const colour =
    value === "has"
      ? "bg-green-50 text-green-700 ring-green-200"
      : value === "missing"
        ? "bg-red-50 text-red-700 ring-red-200"
        : "bg-slate-50 text-slate-600 ring-slate-200";
  const suffix = value === "has" ? "✓" : value === "missing" ? "✗" : "·";
  return (
    <button
      type="button"
      onClick={onCycle}
      disabled={disabled}
      aria-pressed={value !== "any"}
      title={`${label}: ${value}`}
      className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-medium ring-1 ring-inset transition ${colour} ${
        disabled ? "opacity-50" : "hover:ring-2"
      }`}
    >
      <span>{label}</span>
      <span aria-hidden="true">{suffix}</span>
    </button>
  );
}

const CONTRIB_LABEL: Record<ContributionsFilter, string> = {
  any: "Any",
  complete: "Complete",
  incomplete: "Incomplete",
};

const RESPONDED_LABEL: Record<RespondedFilter, string> = {
  any: "Any",
  yes: "Responded",
  no: "Not responded",
};

const SORT_LABEL: Record<LeadSort, string> = {
  signup_newest: "Signup (newest)",
  signup_oldest: "Signup (oldest)",
  last_contact_recent: "Last contact (recent)",
  last_contact_never_first: "Last contact (never first)",
  total_contacts_desc: "Total contacts ↓",
  next_action_soonest: "Next action (soonest)",
  children_desc: "Children ↓",
  children_asc: "Children ↑",
  linked_children_desc: "Linked children ↓",
  linked_children_asc: "Linked children ↑",
};

export function LeadFiltersBar({
  state,
  onChange,
  disabled = false,
}: LeadFiltersBarProps) {
  const [searchDraft, setSearchDraft] = useState(state.filters.search ?? "");

  const update = (patch: Partial<LeadQueryState["filters"]>) => {
    onChange({ ...state, filters: { ...state.filters, ...patch } });
  };

  const clearAll = () => {
    onChange({
      ...state,
      filters: {
        tab: state.filters.tab,
        wwcc: "any",
        gov_id: "any",
        photo: "any",
        abn: "any",
        external_u3: "any",
        children: "any",
        linked_children: "any",
        level: [],
        contributions: "any",
        status: [],
        suburb: null,
        responded: "any",
        search: null,
      },
    });
    setSearchDraft("");
  };

  const toggleStatus = (s: LeadStatus) => {
    const has = state.filters.status.includes(s);
    update({
      status: has
        ? state.filters.status.filter((x) => x !== s)
        : [...state.filters.status, s],
    });
  };

  const hasAny =
    state.filters.wwcc !== "any" ||
    state.filters.gov_id !== "any" ||
    state.filters.photo !== "any" ||
    state.filters.abn !== "any" ||
    state.filters.external_u3 !== "any" ||
    state.filters.children !== "any" ||
    state.filters.linked_children !== "any" ||
    state.filters.level.length > 0 ||
    state.filters.contributions !== "any" ||
    state.filters.status.length > 0 ||
    state.filters.suburb !== null ||
    state.filters.responded !== "any" ||
    state.filters.search !== null;

  return (
    <div className="space-y-3 rounded-lg border border-slate-200 bg-white p-3">
      {/* Tri-state chips */}
      <div className="flex flex-wrap items-center gap-1.5">
        <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">
          Verification:
        </span>
        <TriChip
          label="WWCC"
          value={state.filters.wwcc}
          onCycle={() => update({ wwcc: nextTriState(state.filters.wwcc) })}
          disabled={disabled}
        />
        <TriChip
          label="ID"
          value={state.filters.gov_id}
          onCycle={() => update({ gov_id: nextTriState(state.filters.gov_id) })}
          disabled={disabled}
        />
        <TriChip
          label="Photo"
          value={state.filters.photo}
          onCycle={() => update({ photo: nextTriState(state.filters.photo) })}
          disabled={disabled}
        />
        <TriChip
          label="ABN"
          value={state.filters.abn}
          onCycle={() => update({ abn: nextTriState(state.filters.abn) })}
          disabled={disabled}
        />
        <span className="ml-3 text-xs font-semibold uppercase tracking-wide text-slate-500">
          U3 outside BB:
        </span>
        <TriChip
          label="External U3"
          value={state.filters.external_u3}
          onCycle={() =>
            update({ external_u3: nextTriState(state.filters.external_u3) })
          }
          disabled={disabled}
        />
        <span className="ml-3 text-xs font-semibold uppercase tracking-wide text-slate-500">
          Family:
        </span>
        <TriChip
          label="Children"
          value={state.filters.children}
          onCycle={() =>
            update({ children: nextTriState(state.filters.children) })
          }
          disabled={disabled}
        />
        <TriChip
          label="Linked"
          value={state.filters.linked_children}
          onCycle={() =>
            update({
              linked_children: nextTriState(state.filters.linked_children),
            })
          }
          disabled={disabled}
        />
        <span className="ml-3 text-xs font-semibold uppercase tracking-wide text-slate-500">
          Contributions:
        </span>
        {(["any", "complete", "incomplete"] as ContributionsFilter[]).map(
          (v) => (
            <button
              key={v}
              type="button"
              disabled={disabled}
              onClick={() => update({ contributions: v })}
              aria-pressed={state.filters.contributions === v}
              className={`rounded-full px-2.5 py-1 text-xs font-medium ring-1 ring-inset transition ${
                state.filters.contributions === v
                  ? "bg-violet-50 text-violet-700 ring-violet-200"
                  : "bg-slate-50 text-slate-600 ring-slate-200 hover:ring-slate-300"
              } ${disabled ? "opacity-50" : ""}`}
            >
              {CONTRIB_LABEL[v]}
            </button>
          ),
        )}
      </div>

      {/* Level + status + responded */}
      <div className="flex flex-wrap items-center gap-1.5">
        <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">
          Level:
        </span>
        {[0, 1, 2, 3, 4].map((lvl) => {
          const active = state.filters.level.includes(lvl);
          return (
            <button
              key={lvl}
              type="button"
              disabled={disabled}
              onClick={() =>
                update({
                  level: active
                    ? state.filters.level.filter((x) => x !== lvl)
                    : [...state.filters.level, lvl],
                })
              }
              aria-pressed={active}
              className={`rounded-full px-2 py-1 text-xs font-medium ring-1 ring-inset transition ${
                active
                  ? "bg-violet-50 text-violet-700 ring-violet-200"
                  : "bg-slate-50 text-slate-600 ring-slate-200 hover:ring-slate-300"
              } ${disabled ? "opacity-50" : ""}`}
            >
              Lv {lvl}
            </button>
          );
        })}

        <span className="ml-3 text-xs font-semibold uppercase tracking-wide text-slate-500">
          Status:
        </span>
        {LEAD_STATUSES.map((s) => {
          const active = state.filters.status.includes(s);
          return (
            <button
              key={s}
              type="button"
              disabled={disabled}
              onClick={() => toggleStatus(s)}
              aria-pressed={active}
              className={`rounded-full px-1 py-0.5 transition ${
                active
                  ? "ring-2 ring-violet-300"
                  : "ring-1 ring-transparent hover:ring-slate-200"
              } ${disabled ? "opacity-50" : ""}`}
            >
              <LeadStatusPill status={s} />
            </button>
          );
        })}

        <span className="ml-3 text-xs font-semibold uppercase tracking-wide text-slate-500">
          Responded:
        </span>
        {(["any", "yes", "no"] as RespondedFilter[]).map((v) => (
          <button
            key={v}
            type="button"
            disabled={disabled}
            onClick={() => update({ responded: v })}
            aria-pressed={state.filters.responded === v}
            className={`rounded-full px-2.5 py-1 text-xs font-medium ring-1 ring-inset transition ${
              state.filters.responded === v
                ? "bg-teal-50 text-teal-700 ring-teal-200"
                : "bg-slate-50 text-slate-600 ring-slate-200 hover:ring-slate-300"
            } ${disabled ? "opacity-50" : ""}`}
          >
            {RESPONDED_LABEL[v]}
          </button>
        ))}
      </div>

      {/* Search + suburb + sort + clear */}
      <div className="flex flex-wrap items-center gap-2">
        <form
          className="flex-1 min-w-[200px]"
          onSubmit={(e) => {
            e.preventDefault();
            update({ search: searchDraft.trim() ? searchDraft.trim() : null });
          }}
        >
          <div className="relative">
            <Search className="pointer-events-none absolute left-2 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
            <Input
              type="search"
              value={searchDraft}
              onChange={(e) => setSearchDraft(e.target.value)}
              placeholder="Search name, email, mobile…"
              disabled={disabled}
              className="pl-8"
            />
          </div>
        </form>

        <Input
          type="text"
          value={state.filters.suburb ?? ""}
          onChange={(e) =>
            update({
              suburb: e.target.value.trim() ? e.target.value.trim() : null,
            })
          }
          placeholder="Area"
          disabled={disabled}
          className="max-w-[180px]"
        />

        <select
          value={state.sort}
          onChange={(e) =>
            onChange({ ...state, sort: e.target.value as LeadSort })
          }
          disabled={disabled}
          className="h-9 rounded-md border border-slate-200 bg-white px-2 text-sm text-slate-700"
        >
          {LEAD_SORTS.map((s) => (
            <option key={s} value={s}>
              {SORT_LABEL[s]}
            </option>
          ))}
        </select>

        {hasAny && (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            disabled={disabled}
            onClick={clearAll}
            className="gap-1 text-slate-500"
          >
            <X className="h-3.5 w-3.5" />
            Clear
          </Button>
        )}
      </div>
    </div>
  );
}
