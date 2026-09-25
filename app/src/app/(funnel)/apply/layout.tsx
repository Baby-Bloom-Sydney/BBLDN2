import { Metadata } from 'next';
import { BRAND, SITE_NAME } from "@/lib/constants";

export const metadata: Metadata = {
  title: 'Apply to Nanny with Baby Bloom',
  description: `Join ${SITE_NAME} as a professional nanny in ${BRAND.city}. Complete your application and get matched with families.`,
};

export default function ApplyNannyLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="min-h-screen bg-white">
      <main className="max-w-2xl mx-auto px-4 lg:px-6">
        {children}
      </main>
    </div>
  );
}
