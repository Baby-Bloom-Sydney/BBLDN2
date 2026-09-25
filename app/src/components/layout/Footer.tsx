import Link from "next/link";
import { Logo } from "./Logo";
import { BRAND, SITE_NAME } from "@/lib/constants";

const footerLinks = {
  company: {
    title: "About Us",
    links: [
      { href: "/about", label: "Our Story" },
      { href: "/how-it-works", label: "How It Works" },
      { href: "/contact", label: "Contact" },
    ],
  },
  nannies: {
    title: "For Nannies",
    links: [
      { href: "/childcare-professionals", label: "Why Baby Bloom" },
      { href: "/apply", label: "Apply Now" },
      { href: "/pricing", label: "Services" },
    ],
  },
  parents: {
    title: "For Parents",
    links: [
      { href: "/nannies", label: "Browse Nannies" },
      { href: "/signup?role=parent", label: "Create Account" },
      { href: "/how-it-works", label: "How It Works" },
    ],
  },
};

export function Footer() {
  const currentYear = new Date().getFullYear();

  return (
    <footer className="bg-slate-50 border-t border-slate-200">
      <div className="container mx-auto px-4 md:px-6 py-12 md:py-16">
        {/* Main Footer Content */}
        <div className="grid grid-cols-1 gap-8 md:grid-cols-2 lg:grid-cols-4">
          {/* Brand Column */}
          <div className="lg:col-span-1">
            <Logo />
            <p className="mt-4 text-sm text-slate-600 max-w-xs">
              Connecting {BRAND.city} families with trusted, verified nannies
              since 2020.
            </p>
          </div>

          {/* Links Columns */}
          {Object.entries(footerLinks).map(([key, section]) => (
            <div key={key}>
              <h3 className="font-semibold text-slate-900 text-sm uppercase tracking-wider">
                {section.title}
              </h3>
              <ul className="mt-4 space-y-3">
                {section.links.map((link) => (
                  <li key={link.href}>
                    <Link
                      href={link.href}
                      className="text-sm text-slate-600 hover:text-violet-500 transition-colors"
                    >
                      {link.label}
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>

        {/* Bottom Section */}
        <div className="mt-12 pt-8 border-t border-slate-200">
          <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
            <p className="text-sm text-slate-500">
              {currentYear} {SITE_NAME}. All rights reserved.
            </p>
            <div className="flex gap-6">
              <Link
                href="/legal/privacy-policy"
                className="text-sm text-slate-500 hover:text-violet-500 transition-colors"
              >
                Privacy Policy
              </Link>
              <Link
                href="/legal/client-terms"
                className="text-sm text-slate-500 hover:text-violet-500 transition-colors"
              >
                Terms and Conditions
              </Link>
              <Link
                href="/legal/cookies"
                className="text-sm text-slate-500 hover:text-violet-500 transition-colors"
              >
                Cookie Policy
              </Link>
            </div>
          </div>
        </div>
      </div>
    </footer>
  );
}
