import { QuickMatchResultsClient } from "./QuickMatchResultsClient";
import { SITE_NAME } from "@/lib/constants";

export const metadata = {
  title: `Your Nanny Matches | ${SITE_NAME}`,
};

export default function ResultsPage() {
  return <QuickMatchResultsClient />;
}
