import { redirect } from 'next/navigation';
import { runPreAuthMatching } from '@/lib/matching/pre-auth';
import { MatchResultsClient } from './MatchResultsClient';
import { publicMatch } from '@/lib/matching/public-match';

interface Props {
  searchParams: Promise<{ lead?: string }>;
}

export default async function MatchmakingResultsPage({ searchParams }: Props) {
  const { lead } = await searchParams;

  if (!lead) {
    redirect('/matchmaking/onboarding');
  }

  const { matches, totalEligible } = await runPreAuthMatching(lead);
  const top4 = matches.slice(0, 4).map(publicMatch);

  return (
    <MatchResultsClient
      matches={top4}
      totalEligible={totalEligible}
      leadId={lead}
    />
  );
}
