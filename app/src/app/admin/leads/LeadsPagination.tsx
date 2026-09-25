"use client";

// T-032 — Pagination control for the leads list.

import { Button } from "@/components/ui/button";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { PAGE_SIZE_CHOICES } from "@/lib/leads/query-builder";

interface LeadsPaginationProps {
  page: number;
  pageSize: number;
  total: number;
  renderedCount: number;
  onPageChange: (page: number) => void;
  onPageSizeChange: (size: number) => void;
  disabled?: boolean;
}

export function LeadsPagination({
  page,
  pageSize,
  total,
  renderedCount,
  onPageChange,
  onPageSizeChange,
  disabled = false,
}: LeadsPaginationProps) {
  const start = total === 0 ? 0 : (page - 1) * pageSize + 1;
  const end = (page - 1) * pageSize + renderedCount;
  const maxPage = Math.max(1, Math.ceil(total / pageSize));

  return (
    <div className="flex flex-wrap items-center justify-between gap-3 px-1 py-2 text-sm text-slate-600">
      <div>
        Showing{" "}
        <span className="font-medium text-slate-900">
          {start.toLocaleString("en-GB")}
        </span>
        –
        <span className="font-medium text-slate-900">
          {end.toLocaleString("en-GB")}
        </span>{" "}
        of{" "}
        <span className="font-medium text-slate-900">
          {total.toLocaleString("en-GB")}
        </span>
      </div>
      <div className="flex items-center gap-2">
        <label className="flex items-center gap-1">
          <span className="text-xs text-slate-500">Page size</span>
          <select
            value={pageSize}
            onChange={(e) =>
              onPageSizeChange(Number.parseInt(e.target.value, 10))
            }
            disabled={disabled}
            className="h-8 rounded-md border border-slate-200 bg-white px-2 text-sm"
          >
            {PAGE_SIZE_CHOICES.map((n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
          </select>
        </label>
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={disabled || page <= 1}
          onClick={() => onPageChange(page - 1)}
          aria-label="Previous page"
        >
          <ChevronLeft className="h-4 w-4" />
        </Button>
        <span className="min-w-[70px] text-center text-xs">
          Page <span className="font-medium text-slate-900">{page}</span> of{" "}
          <span className="font-medium text-slate-900">
            {maxPage.toLocaleString("en-GB")}
          </span>
        </span>
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={disabled || page >= maxPage}
          onClick={() => onPageChange(page + 1)}
          aria-label="Next page"
        >
          <ChevronRight className="h-4 w-4" />
        </Button>
      </div>
    </div>
  );
}
