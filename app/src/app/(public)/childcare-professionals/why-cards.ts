/**
 * The "What nanny work looks like here" cards on /childcare-professionals. The babysitting card shows only while
 * `BABYSITTING_ENABLED` is "true" (brief 12 B1; P-23 hide, not delete), read on the server at render.
 */
import type { LucideIcon } from "lucide-react";
import { Clock, GraduationCap, ShieldCheck, Sparkles } from "lucide-react";
import { babysittingEnabled } from "@/lib/features/flags";

export interface WhyCard {
  readonly icon: LucideIcon;
  readonly title: string;
  readonly description: string;
  readonly accent: string;
}

const BABYSITTING_CARD: WhyCard = {
  icon: Sparkles,
  title: "Babysitting requests",
  description:
    "Babysitting requests sent to verified nannies in the area. Extra income on your terms, with families who are already vetted.",
  accent: "from-amber-400 to-amber-500",
};

const BASE_CARDS: readonly WhyCard[] = [
  {
    icon: ShieldCheck,
    title: "Families who get it",
    description:
      "The families on Baby Bloom care about quality childcare and child development. Engaged, respectful, and ready to invest in the right person.",
    accent: "from-violet-500 to-violet-600",
  },
  {
    icon: Clock,
    title: "Your terms, always",
    description:
      "Set your own rates. Choose your own schedule. Baby Bloom never takes a cut of what you earn — what you agree with the family is yours.",
    accent: "from-rose-400 to-rose-500",
  },
  {
    icon: GraduationCap,
    title: "Professional development",
    description:
      "Resources and tools being built to support nannies on the platform — activity planning, developmental tracking, and more. Coming soon.",
    accent: "from-emerald-400 to-emerald-500",
  },];

/** Today's order: the babysitting card sits third when it shows. */
export function whyCards(): readonly WhyCard[] {
  if (!babysittingEnabled()) return BASE_CARDS;
  return [...BASE_CARDS.slice(0, 2), BABYSITTING_CARD, ...BASE_CARDS.slice(2)];
}

/** Literal classes so Tailwind keeps both: the large-screen column count follows the card count, with no empty slot. */
const LG_COLUMNS: Readonly<Record<number, string>> = { 3: "lg:grid-cols-3", 4: "lg:grid-cols-4" };

export function whyCardsGridClass(count: number): string {
  return `grid sm:grid-cols-2 ${LG_COLUMNS[count] ?? "lg:grid-cols-4"} gap-5`;
}
