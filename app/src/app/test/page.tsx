export default function TestOGImagePage() {
  // A local placeholder, never a storage URL. This route is public and
  // unauthenticated, and it previously served a real person's photograph out
  // of the old project's bucket (stage-0 finding 7, HIGH). 12.09 / 12.NEW.
  const profilePicUrl = "/og-placeholder-avatar.svg";
  const firstName = "Sophie";

  const logo = (
    <div className="absolute bottom-[6px] right-[12px] z-10 flex items-center gap-2">
      <svg width="44" height="44" viewBox="0 0 24 24" fill="none" stroke="#8B5CF6" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M9 12h.01" /><path d="M15 12h.01" /><path d="M10 16c.5.3 1.2.5 2 .5s1.5-.2 2-.5" /><path d="M19 6.3a9 9 0 0 1 1.8 3.9 2 2 0 0 1 0 3.6 9 9 0 0 1-17.6 0 2 2 0 0 1 0-3.6A9 9 0 0 1 12 3c2 0 3.5 1.1 3.5 2.5s-.9 2.5-2 2.5c-.8 0-1.5-.4-1.5-1" />
      </svg>
      <span className="text-3xl font-bold">
        <span className="text-slate-900">Baby</span>
        <span className="text-violet-500">Bloom</span>
      </span>
    </div>
  );

  const frame = "relative overflow-hidden bg-white";

  return (
    <div className="min-h-screen bg-slate-100 p-8">
      <h1 className="text-2xl font-bold mb-6 text-slate-900">OG Image Variants</h1>

      <div className="flex flex-col items-center">

        {/* ── D3: Exponential Growth ── */}
        <div className="flex flex-col items-center">
          <h2 className="text-lg font-bold text-slate-900 mb-2">D3 — Exponential Growth</h2>
          <div style={{ width: 720, height: 378 }}>
            <div style={{ width: 1200, height: 630, transform: "scale(0.6)", transformOrigin: "top left" as const }} className={frame}>
              <svg className="absolute inset-0 w-full h-full" viewBox="0 0 1200 630" fill="none">
                {/* Layer 1 — outermost, darkest */}
                <path
                  d="M0 630 L0 625 C300 620, 600 610, 800 570 C950 535, 1050 460, 1120 340 C1160 265, 1185 150, 1200 0 L1200 630 Z"
                  fill="#DDD6FE"
                />
                {/* Layer 2 */}
                <path
                  d="M0 630 L0 628 C350 625, 650 618, 840 585 C980 555, 1070 490, 1135 380 C1170 310, 1190 200, 1200 70 L1200 630 Z"
                  fill="#E9D5FF"
                />
                {/* Layer 3 */}
                <path
                  d="M0 630 L0 630 C400 628, 700 624, 880 598 C1010 572, 1090 515, 1150 420 C1180 355, 1195 250, 1200 140 L1200 630 Z"
                  fill="#F3E8FF"
                />
                {/* Layer 4 — innermost, lightest */}
                <path
                  d="M0 630 C450 630, 750 628, 920 610 C1040 595, 1110 545, 1165 460 C1190 400, 1198 300, 1200 210 L1200 630 Z"
                  fill="#FAF5FF"
                />
              </svg>
              <div className="relative z-10 w-full h-full flex items-center justify-start pl-[5px]">
                <div className="w-[620px] h-[620px] rounded-full overflow-hidden shadow-2xl border-[16px] border-[#DDD6FE] flex-shrink-0">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={profilePicUrl} alt={firstName} className="w-full h-full object-cover" />
                </div>
                <div className="flex flex-col ml-[20px] mb-[160px]" style={{ gap: 0 }}>
                  <span className="flex items-center gap-4 text-[96px] font-bold leading-none text-green-600">
                    verified
                    <svg width="90" height="90" viewBox="0 0 24 24" fill="none" stroke="#16a34a" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z" />
                      <path d="m9 12 2 2 4-4" />
                    </svg>
                  </span>
                  <span className="text-[96px] font-bold leading-none text-slate-900">nanny  babysitter</span>
                </div>
              </div>
              <span className="absolute z-10 text-[32px] font-semibold leading-none text-slate-900 opacity-[0.33]" style={{ top: 410, left: 645 }}>Clapham, London</span>
              {logo}
            </div>
          </div>
        </div>

      </div>
    </div>
  );
}
