import { ShieldCheck, UserCheck, GraduationCap } from "lucide-react";

const TRUST_ITEMS = [
  {
    icon: ShieldCheck,
    // [LEGAL] marketing claim (3g, LEDGER/3g.md legal section) — true once 3i re-checks daily.
    title: "Enhanced DBS checked",
    description: "Enhanced DBS certificate checked with the DBS Update Service",
  },
  {
    icon: UserCheck,
    title: "Expertly Vetted",
    description: "Identity, credentials, and experience verified before joining",
  },
  {
    icon: GraduationCap,
    title: "Developmental Focus",
    description: "Child development, structured play, and early learning as standard",
  },
];

export function TrustStrip() {
  return (
    <section className="py-12 md:py-16 bg-slate-50">
      <div className="container mx-auto px-4 md:px-6">
        <div className="grid md:grid-cols-3 gap-6 md:gap-8">
          {TRUST_ITEMS.map((item) => (
            <div key={item.title} className="flex items-start gap-4">
              <div className="w-10 h-10 rounded-lg bg-violet-100 flex items-center justify-center shrink-0">
                <item.icon className="w-5 h-5 text-violet-600" />
              </div>
              <div>
                <h3 className="font-semibold text-slate-900 text-sm">
                  {item.title}
                </h3>
                <p className="text-sm text-slate-500 mt-0.5 leading-relaxed">
                  {item.description}
                </p>
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
