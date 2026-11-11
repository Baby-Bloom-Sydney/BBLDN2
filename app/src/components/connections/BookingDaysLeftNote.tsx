import { bookingDaysLeftLine, type BookingWindowRow } from "@/lib/connections/booking-days-left";

/** The family's quiet line under a nanny who has accepted: "3 days left to book your meet and greet with Sarah". */
export function BookingDaysLeftNote({ row, name, className }: { row: BookingWindowRow; name: string; className?: string }) {
  const line = bookingDaysLeftLine(row, name);
  if (line === null) return null;
  return <p className={className ?? "text-xs text-slate-500"}>{line}</p>;
}
