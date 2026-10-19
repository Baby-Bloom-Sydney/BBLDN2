import { Baby } from "lucide-react";

/**
 * Unit 5c (P-23, Stage 5 ruling 1): what the babysitting tab and pages show while `BABYSITTING_ENABLED` is off.
 * One shared panel for both hubs and both pages. No call to action — babysitting will reopen later.
 */
export function BabysittingComingSoon({ withHeading = false }: { withHeading?: boolean }) {
  const panel = (
    <div className="flex flex-col items-center justify-center rounded-2xl border border-slate-200 bg-white px-6 py-12 text-center shadow-sm">
      <div className="flex h-12 w-12 items-center justify-center rounded-full bg-violet-100">
        <Baby className="h-6 w-6 text-violet-500" aria-hidden="true" />
      </div>
      <p className="mt-4 text-base font-semibold text-slate-900">Coming soon.</p>
    </div>
  );

  if (!withHeading) return panel;

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold text-slate-900">Babysitting</h1>
      {panel}
    </div>
  );
}
