/**
 * Template-based Facebook post generator for nanny positions.
 * Generates a share-ready post from position data.
 */

interface PositionPostInput {
  firstName: string;
  suburb: string;
  children: Array<{ ageMonths: number; gender?: string }>;
  daysRequired: string[] | null;
  hoursPerWeek: number | null;
  hourlyRate: number | null;
  scheduleType: string | null;
  startTiming: string | null;
}

function ageDisplay(months: number): string {
  if (months < 12) return `${months}mths`;
  const years = Math.floor(months / 12);
  return `${years}yr`;
}

export function generatePositionPost(input: PositionPostInput): string {
  const { suburb, children, daysRequired, hoursPerWeek, hourlyRate } = input;

  const numChildren = children.length;
  const childWord = numChildren === 1 ? 'our child' : `our ${numChildren} children`;

  const childLines = children.map(c => {
    const g = c.gender?.toLowerCase();
    const gender = g === 'male' || g === 'boy' ? 'boy' : g === 'female' || g === 'girl' ? 'girl' : 'child';
    return `👶 1 ${gender} (${ageDisplay(c.ageMonths)})`;
  });

  const lines: string[] = [
    `👶 Nanny Needed 👶`,
    `📍 ${suburb}`,
    '',
    `We are looking for a wonderful nanny for ${childWord}`,
    '',
    ...childLines,
  ];

  if (daysRequired && daysRequired.length > 0) {
    lines.push(`📅 ${daysRequired.join(', ')}`);
  }

  if (hoursPerWeek) {
    lines.push(`⏰ ~${hoursPerWeek} hrs/week`);
  }

  if (hourlyRate) {
    lines.push(`💰 £${hourlyRate}/hr`);
  }

  lines.push('');
  lines.push(`💜 If you have nannying experience and your WWCC please apply below!`);

  return lines.join('<br>');
}
