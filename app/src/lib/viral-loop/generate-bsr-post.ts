/**
 * Template-based Facebook post generator for babysitting requests.
 * Generates a share-ready post from BSR data.
 */

import { formatClockTime as formatTime } from '@/lib/timezone';

interface BsrPostInput {
  firstName: string;
  suburb: string;
  timeSlots: Array<{
    slot_date: string;
    start_time: string;
    end_time: string;
  }>;
  children: Array<{ ageMonths: number; gender?: string }>;
  hourlyRate: number;
  specialRequirements?: string | null;
}

function formatDate(dateStr: string): string {
  const d = new Date(dateStr + 'T00:00:00');
  const days = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  return `${days[d.getDay()]} ${d.getDate()} ${months[d.getMonth()]}`;
}

function durationHours(start: string, end: string): number {
  const [sh, sm] = start.split(':').map(Number);
  const [eh, em] = end.split(':').map(Number);
  return Math.round(((eh * 60 + em) - (sh * 60 + sm)) / 60 * 10) / 10;
}

function ageDisplay(months: number): string {
  if (months < 12) return `${months}mths`;
  const years = Math.floor(months / 12);
  return `${years}yr`;
}

export function generateBsrPost(input: BsrPostInput): string {
  const { suburb, timeSlots, children, hourlyRate } = input;

  const numDays = timeSlots.length;
  const numChildren = children.length;
  const childWord = numChildren === 1 ? 'my child' : `my ${numChildren} children`;

  const slotLines = timeSlots.map(s => {
    const hrs = durationHours(s.start_time, s.end_time);
    const hrsLabel = hrs === 1 ? '1hr' : `${hrs}hrs`;
    return `📅 ${formatDate(s.slot_date)}, ${formatTime(s.start_time)} – ${formatTime(s.end_time)} (${hrsLabel})`;
  });

  const childLines = children.map(c => {
    const g = c.gender?.toLowerCase();
    const gender = g === 'male' || g === 'boy' ? 'boy' : g === 'female' || g === 'girl' ? 'girl' : 'child';
    return `👶 1 ${gender} (${ageDisplay(c.ageMonths)})`;
  });

  const totalHours = timeSlots.reduce((sum, s) => sum + durationHours(s.start_time, s.end_time), 0);
  const estTotal = Math.round(hourlyRate * totalHours);

  const lines = [
    `🍼 Experienced Babysitter Needed 🍼`,
    `📍 ${suburb}`,
    '',
    numDays > 1
      ? `I am looking for a trusted babysitter on ${numDays} days for ${childWord}`
      : `I am looking for a trusted babysitter for ${childWord}`,
    '',
    ...slotLines,
    ...childLines,
    `💰 £${hourlyRate}/hr (est~£${estTotal})`,
    '',
    `💜 If you have experience babysitting/nannying and your WWCC please apply below!`,
  ];

  return lines.join('<br>');
}
