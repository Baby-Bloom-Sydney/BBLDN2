import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { STATUS_META } from "@/lib/verification";

// Every code's meaning comes from `STATUS_META` (unit 3a); this page keeps no local code map.
// Levels, access, transitions and sync follow LDN2 03-status-mapping.md §2 and 03-admin-dbs-tab-spec.md §5 row 2.

const levelRows = [
  { value: 0, label: "Signed Up", description: "Account created, profile not yet completed; also a barred nanny (27, suspended)" },
  { value: 1, label: "Registered", description: "Profile completed, verification not yet attempted" },
  { value: 2, label: "ID Verified", description: "Passport and selfie confirmed (by AI or admin)" },
  { value: 3, label: "Provisionally Verified", description: "Update Service passed; she looks verified; her replies are held until an admin approves" },
  { value: 4, label: "Fully Verified", description: "Admin approved after an Update Service pass; full platform access" },
];

const statusRows = Object.entries(STATUS_META)
  .map(([code, meta]) => ({ value: Number(code), ...meta }))
  .sort((a, b) => a.value - b.value);

type Access = boolean | "held";

const accessMatrix: { check: string; query: string; levels: Access[] }[] = [
  { check: "Has completed profile", query: ">= 1", levels: [false, true, true, true, true] },
  { check: "ID is confirmed", query: ">= 2", levels: [false, false, true, true, true] },
  { check: "Visible in search / matching", query: ">= 3", levels: [false, false, false, true, true] },
  { check: "Can accept interview requests", query: ">= 3 (held) / >= 4 (sent)", levels: [false, false, false, "held", true] },
  { check: "Can accept babysitting", query: ">= 4 AND babysitter_eligible", levels: [false, false, false, false, true] },
];

const transitions = [
  { from: "0", event: "Nanny submits verification form", to: "10", levelChange: "1 → 1" },
  { from: "10", event: "AI passes ID check", to: "20", levelChange: "1 → 2" },
  { from: "10", event: "AI fails / flags ID check", to: "11", levelChange: "1 → 1" },
  { from: "11", event: "Admin verifies ID", to: "20", levelChange: "1 → 2" },
  { from: "11", event: "Admin rejects ID", to: "12", levelChange: "1 → 1" },
  { from: "12", event: "Nanny resubmits passport + selfie", to: "10", levelChange: "1 → 1" },
  { from: "20", event: "Nanny uploads page 1 of her DBS certificate", to: "29", levelChange: "2 → 2" },
  { from: "29", event: "AI picks up the certificate", to: "25", levelChange: "2 → 2" },
  { from: "25", event: "AI fail (unreadable, not Enhanced, children's list not checked, wrong page, altered)", to: "24", levelChange: "2 → 2" },
  { from: "25", event: "AI unsure", to: "21", levelChange: "2 → 2" },
  { from: "25", event: "AI pass; cross-check runs", to: "20", levelChange: "2 → 2" },
  { from: "20", event: "Cross-check mismatch (surname + DOB)", to: "21", levelChange: "2 → 2" },
  { from: "20", event: "Cross-check passes and Update Service passes (BLANK / NON_BLANK)", to: "30", levelChange: "2 → 3" },
  { from: "20", event: "Update Service: new information", to: "23", levelChange: "2 → 2" },
  { from: "20", event: "Update Service: no match", to: "26", levelChange: "2 → 2" },
  { from: "20", event: "Update Service unreachable (technical retry; no fake pass)", to: "20", levelChange: "2 → 2" },
  { from: "22, 23, 24, 26", event: "Nanny edits and resubmits", to: "29", levelChange: "2 → 2" },
  { from: "23, 24, 26", event: "Nanny requests manual review", to: "21", levelChange: "2 → 2" },
  { from: "21, 30", event: "Admin Approve (needs an Update Service pass)", to: "40", levelChange: "2/3 → 4" },
  { from: "21, 30", event: "Admin rejects the DBS", to: "22", levelChange: "2/3 → 2" },
  { from: "any", event: "Admin Bar", to: "27", levelChange: "→ 0 (suspended)" },
  { from: "27", event: "Admin Lift bar (active again; DBS section reset, she re-uploads)", to: "20", levelChange: "0 → 2" },
  { from: "40", event: "Daily re-check passes (nothing changes)", to: "40", levelChange: "4 → 4" },
  { from: "40", event: "Daily re-check: new information", to: "23", levelChange: "4 → 2" },
  { from: "40", event: "Daily re-check: no match", to: "26", levelChange: "4 → 2" },
];

const syncRows = [
  { level: 0, statuses: "— (no verification record) · 27 (barred, suspended)" },
  { level: 1, statuses: "0, 10, 11, 12" },
  { level: 2, statuses: "20, 21, 22, 23, 24, 25, 26, 29" },
  { level: 3, statuses: "30" },
  { level: 4, statuses: "40" },
];

export default function VerificationReferencePage() {
  const cellClass = "px-3 py-2 text-sm border-b border-slate-100";
  const headerClass = "px-3 py-2 text-xs font-semibold text-slate-500 uppercase border-b border-slate-200 bg-slate-50";

  return (
    <div className="space-y-8 max-w-6xl">
      <div>
        <h1 className="text-2xl font-bold text-slate-900">Verification Reference</h1>
        <p className="mt-1 text-slate-500">
          Quick reference for the two verification data systems (passport + enhanced DBS). See{" "}
          <code className="text-xs bg-slate-100 px-1 py-0.5 rounded">NANNY-DBS-Research/03-status-mapping.md</code>{" "}
          for the full mapping.
        </p>
      </div>

      {/* System 1: Verification Level */}
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">
            System 1: Verification Level
            <span className="ml-2 text-sm font-normal text-slate-400">nannies.verification_level</span>
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <table className="w-full">
            <thead>
              <tr>
                <th className={headerClass}>Value</th>
                <th className={headerClass}>Label</th>
                <th className={headerClass}>Description</th>
              </tr>
            </thead>
            <tbody>
              {levelRows.map((row) => (
                <tr key={row.value}>
                  <td className={`${cellClass} font-mono font-bold text-violet-600`}>{row.value}</td>
                  <td className={`${cellClass} font-medium`}>{row.label}</td>
                  <td className={`${cellClass} text-slate-600`}>{row.description}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </CardContent>
      </Card>

      {/* Access Control Matrix */}
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Access Control Matrix</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <table className="w-full">
            <thead>
              <tr>
                <th className={headerClass}>Check</th>
                <th className={headerClass}>Query</th>
                <th className={`${headerClass} text-center`}>0</th>
                <th className={`${headerClass} text-center`}>1</th>
                <th className={`${headerClass} text-center`}>2</th>
                <th className={`${headerClass} text-center`}>3</th>
                <th className={`${headerClass} text-center`}>4</th>
              </tr>
            </thead>
            <tbody>
              {accessMatrix.map((row) => (
                <tr key={row.check}>
                  <td className={`${cellClass} font-medium`}>{row.check}</td>
                  <td className={`${cellClass} font-mono text-xs text-slate-500`}>{row.query}</td>
                  {row.levels.map((ok, i) => (
                    <td key={i} className={`${cellClass} text-center`}>
                      {ok === "held" ? (
                        <span className="text-amber-600 font-bold">held</span>
                      ) : ok ? (
                        <span className="text-green-600 font-bold">Y</span>
                      ) : (
                        <span className="text-slate-300">-</span>
                      )}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </CardContent>
      </Card>

      {/* System 2: Verification Status */}
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">
            System 2: Verification Status
            <span className="ml-2 text-sm font-normal text-slate-400">verifications.verification_status</span>
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <table className="w-full">
            <thead>
              <tr>
                <th className={headerClass}>Value</th>
                <th className={headerClass}>Label</th>
                <th className={headerClass}>Group</th>
                <th className={headerClass}>Description</th>
              </tr>
            </thead>
            <tbody>
              {statusRows.map((row) => (
                <tr key={row.value}>
                  <td className={`${cellClass} font-mono font-bold text-violet-600`}>{row.value}</td>
                  <td className={`${cellClass} font-medium`}>{row.label}</td>
                  <td className={`${cellClass} text-slate-500`}>{row.group}</td>
                  <td className={`${cellClass} text-slate-600`}>{row.description}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </CardContent>
      </Card>

      {/* State Transitions */}
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">State Transitions</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <table className="w-full">
            <thead>
              <tr>
                <th className={headerClass}>From</th>
                <th className={headerClass}>Event</th>
                <th className={headerClass}>To</th>
                <th className={headerClass}>Level Change</th>
              </tr>
            </thead>
            <tbody>
              {transitions.map((row, i) => (
                <tr key={i}>
                  <td className={`${cellClass} font-mono font-bold text-violet-600`}>{row.from}</td>
                  <td className={`${cellClass} text-slate-600`}>{row.event}</td>
                  <td className={`${cellClass} font-mono font-bold text-violet-600`}>{row.to}</td>
                  <td className={`${cellClass} font-mono text-slate-500`}>{row.levelChange}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </CardContent>
      </Card>

      {/* Synchronisation */}
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Level ↔ Status Synchronisation</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <table className="w-full">
            <thead>
              <tr>
                <th className={headerClass}>Verification Level</th>
                <th className={headerClass}>Valid Verification Statuses</th>
              </tr>
            </thead>
            <tbody>
              {syncRows.map((row) => (
                <tr key={row.level}>
                  <td className={`${cellClass} font-mono font-bold text-violet-600`}>{row.level}</td>
                  <td className={`${cellClass} font-mono text-slate-600`}>{row.statuses}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </CardContent>
      </Card>
    </div>
  );
}
