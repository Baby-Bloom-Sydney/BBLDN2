/**
 * A row value over several lines (an address in full, one part per line; ledger B06 §9.1 R2), each line whole: a
 * Settings row's value cell truncates one-line values. Nothing to show reads "Not added".
 *
 * BB-wave1-041126/06b3-rework, 2026-11-09.
 */

export const NOT_ADDED = "Not added";

export function ValueLines({ lines }: { readonly lines: readonly string[] }) {
  if (lines.length === 0) return <span className="text-sm italic text-slate-500">{NOT_ADDED}</span>;
  return (
    <span className="block">
      {lines.map((line, i) => (
        <span key={`${i}-${line}`} className="block whitespace-normal break-words text-sm text-slate-900">{line}</span>
      ))}
    </span>
  );
}
