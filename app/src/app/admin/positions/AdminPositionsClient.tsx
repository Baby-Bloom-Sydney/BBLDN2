'use client';

import { useState, useMemo, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Briefcase, Users, CheckCircle, XCircle, Search, ChevronDown, ChevronRight, ExternalLink, Ban, User } from 'lucide-react';
import { closePositionAction, fetchUserData } from './actions';
import { UserDetailDrawer } from '@/app/admin/users/UserDetailDrawer';
import type { UserData } from '@/app/admin/users/page';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { StatsCard } from '@/components/dashboard/StatsCard';
import { StatusBadge } from '@/components/dashboard/StatusBadge';
import { EmptyState } from '@/components/dashboard/EmptyState';
import { POSITION_STAGE, POSITION_STATUS, CONNECTION_STAGE, POSITION_STAGE_LABELS, POSITION_STATUS_LABELS, CONNECTION_STAGE_LABELS } from '@/lib/position/constants';
import type { PositionStage, PositionStatus, ConnectionStage } from '@/lib/position/constants';
import type { AdminPosition } from './page';

interface Props {
  positions: AdminPosition[];
}

type StageFilter = 'all' | 'active' | 'connecting' | 'filled' | 'closed';
type SourceFilter = 'all' | 'parent' | 'admin' | 'ai_agent';

function getPositionStageLabel(stage: number | null): string {
  if (stage == null) return 'Unknown';
  return POSITION_STAGE_LABELS[stage as PositionStage] ?? 'Unknown';
}

function getPositionStageBadgeVariant(stage: number | null): 'active' | 'pending' | 'verified' | 'inactive' | 'failed' | 'info' {
  switch (stage) {
    case POSITION_STAGE.OPEN: return 'active';
    case POSITION_STAGE.CONNECTING: return 'info';
    case POSITION_STAGE.ACTIVE: return 'verified';
    case POSITION_STAGE.DRAFT: return 'pending';
    case POSITION_STAGE.ENDED: return 'inactive';
    case POSITION_STAGE.CLOSED: return 'inactive';
    default: return 'inactive';
  }
}

function getConnectionStageBadgeVariant(stage: number | null): 'active' | 'pending' | 'verified' | 'inactive' | 'failed' | 'info' {
  if (stage == null) return 'inactive';
  if (stage === CONNECTION_STAGE.REQUEST_SENT) return 'pending';
  if (stage === CONNECTION_STAGE.ACCEPTED) return 'info';
  if (([CONNECTION_STAGE.INTRO_SCHEDULED, CONNECTION_STAGE.INTRO_COMPLETE, CONNECTION_STAGE.TRIAL_ARRANGED, CONNECTION_STAGE.TRIAL_COMPLETE, CONNECTION_STAGE.OFFERED, CONNECTION_STAGE.AWAITING_RESPONSE] as ConnectionStage[]).includes(stage as ConnectionStage)) return 'verified';
  if (([CONNECTION_STAGE.CONFIRMED, CONNECTION_STAGE.ACTIVE] as ConnectionStage[]).includes(stage as ConnectionStage)) return 'active';
  if (([CONNECTION_STAGE.DECLINED, CONNECTION_STAGE.CANCELLED_BY_PARENT, CONNECTION_STAGE.CANCELLED_BY_NANNY, CONNECTION_STAGE.NOT_HIRED, CONNECTION_STAGE.NOT_SELECTED, CONNECTION_STAGE.REQUEST_CANCELLED] as ConnectionStage[]).includes(stage as ConnectionStage)) return 'failed';
  if (([CONNECTION_STAGE.REQUEST_EXPIRED, CONNECTION_STAGE.SCHEDULE_EXPIRED, CONNECTION_STAGE.FINISHED, CONNECTION_STAGE.INTRO_INCOMPLETE] as ConnectionStage[]).includes(stage as ConnectionStage)) return 'inactive';
  return 'inactive';
}

function getPositionStatusLabel(pos: AdminPosition): { label: string; detail: string | null } {
  const status = pos.position_status;
  if (status == null) return { label: pos.status ?? 'Unknown', detail: null };

  const label = POSITION_STATUS_LABELS[status as PositionStatus] ?? pos.status ?? 'Unknown';

  // For active/filled positions, find who filled it
  if (status === POSITION_STATUS.ACTIVE) {
    const hiredConn = pos.connections.find(c =>
      c.connection_stage === CONNECTION_STAGE.ACTIVE || c.connection_stage === CONNECTION_STAGE.CONFIRMED
    );
    return { label, detail: hiredConn ? hiredConn.nanny_name : null };
  }

  return { label, detail: null };
}

function getPositionStatusBadgeVariant(status: number | null): 'active' | 'pending' | 'verified' | 'inactive' | 'failed' | 'info' {
  if (status == null) return 'inactive';
  if (status === POSITION_STATUS.DRAFT) return 'pending';
  if (status === POSITION_STATUS.OPEN) return 'active';
  if (status === POSITION_STATUS.CONNECTING) return 'info';
  if (status === POSITION_STATUS.ACTIVE) return 'verified';
  if (status >= 50 && status < 60) return 'failed'; // ended variants
  if (status >= 60) return 'inactive'; // closed variants
  return 'inactive';
}

function getSourceLabel(source: string): string {
  switch (source) {
    case 'parent': return 'Parent';
    case 'admin': return 'Admin';
    case 'ai_agent': return 'AI';
    default: return source;
  }
}

function getSourceBadgeVariant(source: string): 'verified' | 'info' | 'active' {
  switch (source) {
    case 'admin': return 'info';
    case 'ai_agent': return 'active';
    default: return 'verified';
  }
}

function formatAge(months: number): string {
  if (months < 12) return `${months}mo`;
  const years = Math.floor(months / 12);
  const rem = months % 12;
  return rem > 0 ? `${years}yr ${rem}mo` : `${years}yr`;
}

function formatGender(g: string | null): string {
  if (!g || g === 'Rather Not Say') return '';
  return g === 'Female' ? 'F' : 'M';
}

function timeAgo(dateStr: string): string {
  const days = Math.floor((Date.now() - new Date(dateStr).getTime()) / 86400000);
  if (days === 0) return 'Today';
  if (days === 1) return '1d ago';
  if (days < 30) return `${days}d ago`;
  const months = Math.floor(days / 30);
  return `${months}mo ago`;
}

function formatDate(dateStr: string | null): string {
  if (!dateStr) return '—';
  return new Date(dateStr).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
}

function matchesStageFilter(pos: AdminPosition, filter: StageFilter): boolean {
  if (filter === 'all') return true;
  const stage = pos.stage;
  switch (filter) {
    case 'active': return stage === POSITION_STAGE.OPEN;
    case 'connecting': return stage === POSITION_STAGE.CONNECTING;
    case 'filled': return stage === POSITION_STAGE.ACTIVE;
    case 'closed': return stage === POSITION_STAGE.ENDED || stage === POSITION_STAGE.CLOSED;
    default: return true;
  }
}

export function AdminPositionsClient({ positions }: Props) {
  const [stageFilter, setStageFilter] = useState<StageFilter>('all');
  const [sourceFilter, setSourceFilter] = useState<SourceFilter>('all');
  const [search, setSearch] = useState('');
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [drawerUser, setDrawerUser] = useState<UserData | null>(null);
  const [drawerOpen, setDrawerOpen] = useState(false);

  const openUserDrawer = async (userId: string) => {
    const userData = await fetchUserData(userId);
    if (userData) {
      setDrawerUser(userData);
      setDrawerOpen(true);
    }
  };

  const filtered = useMemo(() => {
    return positions.filter(pos => {
      if (!matchesStageFilter(pos, stageFilter)) return false;
      if (sourceFilter !== 'all' && pos.source !== sourceFilter) return false;
      if (search) {
        const q = search.toLowerCase();
        const name = (pos.family_display_name ?? pos.parent_name ?? '').toLowerCase();
        const suburb = (pos.suburb ?? '').toLowerCase();
        if (!name.includes(q) && !suburb.includes(q)) return false;
      }
      return true;
    });
  }, [positions, stageFilter, sourceFilter, search]);

  // Stats
  const activeCount = positions.filter(p => p.stage === POSITION_STAGE.OPEN).length;
  const connectingCount = positions.filter(p => p.stage === POSITION_STAGE.CONNECTING).length;
  const filledCount = positions.filter(p => p.stage === POSITION_STAGE.ACTIVE).length;
  const closedCount = positions.filter(p => p.stage === POSITION_STAGE.ENDED || p.stage === POSITION_STAGE.CLOSED).length;

  const stageTabs: { key: StageFilter; label: string; count: number }[] = [
    { key: 'all', label: 'All', count: positions.length },
    { key: 'active', label: 'Open', count: activeCount },
    { key: 'connecting', label: 'Connecting', count: connectingCount },
    { key: 'filled', label: 'Active', count: filledCount },
    { key: 'closed', label: 'Closed', count: closedCount },
  ];

  return (
    <div className="space-y-6 p-6">
      <h1 className="text-2xl font-bold text-slate-900">Positions</h1>

      {/* Stats */}
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatsCard icon={Briefcase} value={activeCount} label="Open" iconColor="text-green-600" iconBgColor="bg-green-100" />
        <StatsCard icon={Users} value={connectingCount} label="Connecting" iconColor="text-blue-600" iconBgColor="bg-blue-100" />
        <StatsCard icon={CheckCircle} value={filledCount} label="Active" iconColor="text-violet-600" iconBgColor="bg-violet-100" />
        <StatsCard icon={XCircle} value={closedCount} label="Closed / Ended" iconColor="text-slate-500" iconBgColor="bg-slate-100" />
      </div>

      {/* Filters */}
      <Card>
        <CardHeader className="pb-3">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex gap-1">
              {stageTabs.map(tab => (
                <button
                  key={tab.key}
                  onClick={() => setStageFilter(tab.key)}
                  className={`rounded-lg px-3 py-1.5 text-sm font-medium transition-colors ${
                    stageFilter === tab.key
                      ? 'bg-violet-100 text-violet-700'
                      : 'text-slate-500 hover:bg-slate-100 hover:text-slate-700'
                  }`}
                >
                  {tab.label} <span className="ml-1 text-xs opacity-70">{tab.count}</span>
                </button>
              ))}
            </div>
            <div className="flex gap-2">
              <select
                value={sourceFilter}
                onChange={e => setSourceFilter(e.target.value as SourceFilter)}
                className="rounded-lg border border-slate-200 px-3 py-1.5 text-sm text-slate-700 focus:outline-none focus:ring-2 focus:ring-violet-500"
              >
                <option value="all">All Sources</option>
                <option value="parent">Parent</option>
                <option value="admin">Admin</option>
                <option value="ai_agent">AI Agent</option>
              </select>
              <div className="relative">
                <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                <input
                  type="text"
                  placeholder="Search family or suburb..."
                  value={search}
                  onChange={e => setSearch(e.target.value)}
                  className="rounded-lg border border-slate-200 py-1.5 pl-9 pr-3 text-sm text-slate-700 focus:outline-none focus:ring-2 focus:ring-violet-500"
                />
              </div>
            </div>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          {filtered.length === 0 ? (
            <div className="p-8">
              <EmptyState
                icon={Briefcase}
                title="No positions found"
                description="Try adjusting your filters"
              />
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-8" />
                  <TableHead>Family</TableHead>
                  <TableHead>Suburb</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Source</TableHead>
                  <TableHead>Applicants</TableHead>
                  <TableHead>Expires</TableHead>
                  <TableHead>Created</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filtered.map(pos => {
                  const isExpanded = expandedId === pos.id;
                  const displayName = pos.family_display_name ?? pos.parent_name ?? 'Unknown';
                  return (
                    <>
                      <TableRow
                        key={pos.id}
                        className="cursor-pointer hover:bg-slate-50"
                        onClick={() => setExpandedId(isExpanded ? null : pos.id)}
                      >
                        <TableCell className="w-8 pr-0">
                          {isExpanded
                            ? <ChevronDown className="h-4 w-4 text-slate-400" />
                            : <ChevronRight className="h-4 w-4 text-slate-400" />
                          }
                        </TableCell>
                        <TableCell className="font-medium text-slate-900">{displayName}</TableCell>
                        <TableCell className="text-slate-600">{pos.suburb ?? '—'}</TableCell>
                        <TableCell>
                          {(() => {
                            const { label, detail } = getPositionStatusLabel(pos);
                            return (
                              <div className="flex flex-col gap-0.5">
                                <StatusBadge variant={getPositionStatusBadgeVariant(pos.position_status)}>
                                  {label}
                                </StatusBadge>
                                {detail && (
                                  <span className="text-[11px] text-slate-500">by {detail}</span>
                                )}
                              </div>
                            );
                          })()}
                        </TableCell>
                        <TableCell>
                          <StatusBadge variant={getSourceBadgeVariant(pos.source)}>
                            {getSourceLabel(pos.source)}
                          </StatusBadge>
                        </TableCell>
                        <TableCell>
                          {pos.connections.length > 0 ? (
                            <span className="inline-flex h-6 w-6 items-center justify-center rounded-full bg-violet-100 text-xs font-medium text-violet-700">
                              {pos.connections.length}
                            </span>
                          ) : (
                            <span className="text-sm text-slate-400">0</span>
                          )}
                        </TableCell>
                        <TableCell className="text-sm text-slate-500">
                          {pos.expires_at ? formatDate(pos.expires_at) : '—'}
                        </TableCell>
                        <TableCell className="text-sm text-slate-500">{timeAgo(pos.created_at)}</TableCell>
                      </TableRow>

                      {/* Expanded detail */}
                      {isExpanded && (
                        <TableRow key={`${pos.id}-detail`}>
                          <TableCell colSpan={8} className="bg-slate-50 p-0">
                            <PositionDetail position={pos} onOpenUser={openUserDrawer} />
                          </TableCell>
                        </TableRow>
                      )}
                    </>
                  );
                })}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <UserDetailDrawer
        user={drawerUser}
        open={drawerOpen}
        onOpenChange={setDrawerOpen}
      />
    </div>
  );
}

function PositionDetail({ position, onOpenUser }: { position: AdminPosition; onOpenUser: (userId: string) => void }) {
  const activeConnections = position.connections.filter(c =>
    c.connection_stage != null && !([
      CONNECTION_STAGE.REQUEST_EXPIRED,
      CONNECTION_STAGE.DECLINED,
      CONNECTION_STAGE.REQUEST_CANCELLED,
      CONNECTION_STAGE.SCHEDULE_EXPIRED,
      CONNECTION_STAGE.NOT_HIRED,
      CONNECTION_STAGE.NOT_SELECTED,
      CONNECTION_STAGE.CANCELLED_BY_PARENT,
      CONNECTION_STAGE.CANCELLED_BY_NANNY,
    ] as ConnectionStage[]).includes(c.connection_stage as ConnectionStage)
  );
  const closedConnections = position.connections.filter(c =>
    !activeConnections.includes(c)
  );

  const [copied, setCopied] = useState(false);
  const [isPending, startTransition] = useTransition();
  const router = useRouter();

  const copyId = () => {
    navigator.clipboard.writeText(position.id);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  const handleClose = () => {
    if (!confirm('Close this position? This will cancel it.')) return;
    startTransition(async () => {
      const result = await closePositionAction(position.id);
      if (!result.success) alert(`Error: ${result.error}`);
      router.refresh();
    });
  };

  const isClosed = position.stage === POSITION_STAGE.ENDED || position.stage === POSITION_STAGE.CLOSED;

  return (
    <div className="space-y-4 px-6 py-4">
      {/* Source / Parent info + actions */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3 text-sm">
          <StatusBadge variant={getSourceBadgeVariant(position.source)}>
            {getSourceLabel(position.source)}
          </StatusBadge>
          {position.source === 'parent' && position.parent_name && (
            <button
              onClick={() => position.parent_user_id && onOpenUser(position.parent_user_id)}
              className="inline-flex items-center gap-1 text-violet-600 hover:text-violet-700 hover:underline"
            >
              <User className="h-3.5 w-3.5" />
              {position.parent_name}
            </button>
          )}
          {position.source !== 'parent' && (
            <span className="text-slate-500">System parent (AI/Admin)</span>
          )}
        </div>
        <div className="flex items-center gap-2">
          <a
            href={`/position/${position.id}`}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-50"
          >
            View public page <ExternalLink className="h-3 w-3" />
          </a>
          {!isClosed && (
            <button
              onClick={handleClose}
              disabled={isPending}
              className="inline-flex items-center gap-1 rounded-lg border border-red-200 bg-red-50 px-3 py-1.5 text-xs font-medium text-red-600 hover:bg-red-100 disabled:opacity-50"
            >
              <Ban className="h-3 w-3" />
              {isPending ? 'Closing...' : 'Close Position'}
            </button>
          )}
        </div>
      </div>

      {/* Position details row */}
      <div className="flex flex-wrap gap-x-4 gap-y-2 text-sm text-slate-600">
        {position.hourly_rate != null && <span><strong>Rate:</strong> £{position.hourly_rate}/hr</span>}
        {position.hours_per_week != null && <span><strong>Hours:</strong> {position.hours_per_week}h/wk</span>}
        {position.schedule_type && <span><strong>Schedule:</strong> {position.schedule_type}</span>}
        {position.days_required && <span><strong>Days:</strong> {position.days_required.join(', ')}</span>}
        {position.placement_length && <span><strong>Length:</strong> {position.placement_length}</span>}
        {position.dfy_activated_at && (
          <span><strong>DFY:</strong> {position.dfy_tier ?? 'standard'} — activated {formatDate(position.dfy_activated_at)}</span>
        )}
      </div>

      {/* Children + UUID */}
      <div className="flex flex-wrap items-center gap-4">
        {position.children.length > 0 && (
          <div className="flex items-center gap-2">
            <span className="text-sm font-medium text-slate-700">Children:</span>
            <div className="flex gap-1">
              {position.children.map((c, i) => (
                <span key={i} className="inline-flex items-center rounded-md bg-slate-100 px-1.5 py-0.5 text-xs text-slate-600">
                  {formatAge(c.age_months)}{formatGender(c.gender) ? ` ${formatGender(c.gender)}` : ''}
                </span>
              ))}
            </div>
          </div>
        )}
        <button
          onClick={copyId}
          className="inline-flex items-center gap-1 rounded bg-slate-100 px-2 py-0.5 font-mono text-[11px] text-slate-500 hover:bg-slate-200 hover:text-slate-700 transition-colors"
          title="Click to copy position ID"
        >
          {copied ? 'Copied!' : position.id}
        </button>
      </div>

      {position.description && (
        <p className="text-sm text-slate-500 italic">&ldquo;{position.description}&rdquo;</p>
      )}

      {/* Schedule grid */}
      {position.schedule && Object.keys(position.schedule).length > 0 && (
        <div>
          <h4 className="mb-2 text-sm font-semibold text-slate-700">Schedule</h4>
          <ScheduleGrid schedule={position.schedule} />
        </div>
      )}

      {/* Active connections */}
      {activeConnections.length > 0 && (
        <div>
          <h4 className="mb-2 text-sm font-semibold text-slate-700">Active Applicants ({activeConnections.length})</h4>
          <ConnectionTable connections={activeConnections} />
        </div>
      )}

      {/* Closed connections */}
      {closedConnections.length > 0 && (
        <div>
          <h4 className="mb-2 text-sm font-semibold text-slate-500">Closed / Terminal ({closedConnections.length})</h4>
          <ConnectionTable connections={closedConnections} />
        </div>
      )}

      {position.connections.length === 0 && (
        <p className="text-sm text-slate-400">No applicants yet</p>
      )}
    </div>
  );
}

function ConnectionTable({ connections }: { connections: AdminPosition['connections'] }) {
  return (
    <div className="overflow-x-auto rounded-lg border border-slate-200">
      <table className="w-full text-sm">
        <thead className="bg-slate-100">
          <tr>
            <th className="px-3 py-2 text-left font-medium text-slate-600">Nanny</th>
            <th className="px-3 py-2 text-left font-medium text-slate-600">Stage</th>
            <th className="px-3 py-2 text-left font-medium text-slate-600">Source</th>
            <th className="px-3 py-2 text-left font-medium text-slate-600">Requested</th>
            <th className="px-3 py-2 text-left font-medium text-slate-600">Responded</th>
            <th className="px-3 py-2 text-left font-medium text-slate-600">Meet Time</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {connections.map(conn => (
            <tr key={conn.id} className="hover:bg-white">
              <td className="px-3 py-2 font-medium text-slate-800">{conn.nanny_name}</td>
              <td className="px-3 py-2">
                <StatusBadge variant={getConnectionStageBadgeVariant(conn.connection_stage)}>
                  {conn.connection_stage != null
                    ? (CONNECTION_STAGE_LABELS[conn.connection_stage as ConnectionStage] ?? `Stage ${conn.connection_stage}`)
                    : 'Unknown'
                  }
                </StatusBadge>
              </td>
              <td className="px-3 py-2 text-slate-500 capitalize">{conn.source ?? '—'}</td>
              <td className="px-3 py-2 text-slate-500">{timeAgo(conn.created_at)}</td>
              <td className="px-3 py-2 text-slate-500">{conn.responded_at ? timeAgo(conn.responded_at) : '—'}</td>
              <td className="px-3 py-2 text-slate-500">{formatDate(conn.confirmed_time)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

const SCHEDULE_DAYS = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'] as const;
const SCHEDULE_BRACKETS = ['morning', 'midday', 'afternoon', 'evening'] as const;
const DAY_SHORT: Record<string, string> = {
  monday: 'Mon', tuesday: 'Tue', wednesday: 'Wed', thursday: 'Thu',
  friday: 'Fri', saturday: 'Sat', sunday: 'Sun',
};

function ScheduleGrid({ schedule }: { schedule: Record<string, string[]> }) {
  const activeDays = SCHEDULE_DAYS.filter(d => schedule[d]?.length > 0);
  if (activeDays.length === 0) return null;

  return (
    <div className="inline-block overflow-x-auto rounded-lg border border-slate-200">
      <table className="text-xs">
        <thead className="bg-slate-100">
          <tr>
            <th className="px-2 py-1.5 text-left font-medium text-slate-600" />
            {SCHEDULE_BRACKETS.map(b => (
              <th key={b} className="px-2 py-1.5 text-center font-medium text-slate-600 capitalize">{b}</th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {activeDays.map(day => (
            <tr key={day}>
              <td className="px-2 py-1.5 font-medium text-slate-700">{DAY_SHORT[day]}</td>
              {SCHEDULE_BRACKETS.map(b => (
                <td key={b} className="px-2 py-1.5 text-center">
                  {schedule[day]?.includes(b) ? (
                    <span className="inline-block h-3 w-3 rounded-full bg-violet-500" />
                  ) : (
                    <span className="inline-block h-3 w-3 rounded-full bg-slate-200" />
                  )}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
