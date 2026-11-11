// ─── Position Stage ───

export const POSITION_STAGE = {
  DRAFT: 0,
  OPEN: 1,
  CONNECTING: 10,
  ACTIVE: 30,
  ENDED: 50,
  CLOSED: 60,
} as const;

export type PositionStage = typeof POSITION_STAGE[keyof typeof POSITION_STAGE];

// ─── Position Status (detailed, grouped by tens) ───

export const POSITION_STATUS = {
  DRAFT: 0,
  OPEN: 1,
  CONNECTING: 10,
  ACTIVE: 30,
  ENDED_NATURAL: 50,
  ENDED_NANNY_LEFT: 51,
  ENDED_NO_LONGER_NEEDED: 52,
  ENDED_MUTUAL: 53,
  ENDED_CHILD_AGED_OUT: 54,
  ENDED_RELOCATION: 55,
  ENDED_OTHER: 56,
  CLOSED: 60,
  CLOSED_NO_CANDIDATES: 61,
} as const;

export type PositionStatus = typeof POSITION_STATUS[keyof typeof POSITION_STATUS];

// ─── Connection Stage (per-nanny pipeline) ───

export const CONNECTION_STAGE = {
  // 0-9: Request
  REQUEST_SENT: 0,
  REQUEST_EXPIRED: 1,
  DECLINED: 2,
  REQUEST_CANCELLED: 3,
  NANNY_APPLIED_PENDING: 4,  // Held application — nanny applied at level 3
  NANNY_APPLIED: 5,
  // 10-19: Scheduling
  ACCEPTED_PENDING: 9,       // Held acceptance — nanny accepted/interested at level 3
  ACCEPTED: 10,
  SCHEDULE_EXPIRED: 11,
  // 20-29: Meet (user-facing: "Meet and Greet"; internal code still uses "intro")
  INTRO_SCHEDULED: 20,
  INTRO_COMPLETE: 21,
  INTRO_INCOMPLETE: 22,
  // 30-39: Outcome
  AWAITING_RESPONSE: 30,
  TRIAL_ARRANGED: 31,
  TRIAL_COMPLETE: 32,
  OFFERED: 33,
  CONFIRMED: 34,
  NOT_HIRED: 35,
  NOT_SELECTED: 36,
  // 40-49: Active
  ACTIVE: 40,
  FINISHED: 41,
  // 50-59: Removed
  CANCELLED_BY_PARENT: 50,
  CANCELLED_BY_NANNY: 51,
} as const;

export type ConnectionStage = typeof CONNECTION_STAGE[keyof typeof CONNECTION_STAGE];

/**
 * 7 days: the family's window on a nanny's application, and on her answer while it waits for the admin's approval
 * (below level 4). An answer at level 4 gives the family 72 hours to book a meet.
 */
export const CONNECTION_WAIT_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;

// ─── Labels ───

export const POSITION_STAGE_LABELS: Record<PositionStage, string> = {
  [POSITION_STAGE.DRAFT]: 'Draft',
  [POSITION_STAGE.OPEN]: 'Open',
  [POSITION_STAGE.CONNECTING]: 'Connecting',
  [POSITION_STAGE.ACTIVE]: 'Active',
  [POSITION_STAGE.ENDED]: 'Ended',
  [POSITION_STAGE.CLOSED]: 'Closed',
};

export const POSITION_STATUS_LABELS: Record<PositionStatus, string> = {
  [POSITION_STATUS.DRAFT]: 'Draft',
  [POSITION_STATUS.OPEN]: 'Open',
  [POSITION_STATUS.CONNECTING]: 'Connecting',
  [POSITION_STATUS.ACTIVE]: 'Active',
  [POSITION_STATUS.ENDED_NATURAL]: 'Ended — Natural',
  [POSITION_STATUS.ENDED_NANNY_LEFT]: 'Ended — Nanny Left',
  [POSITION_STATUS.ENDED_NO_LONGER_NEEDED]: 'Ended — No Longer Needed',
  [POSITION_STATUS.ENDED_MUTUAL]: 'Ended — Mutual Agreement',
  [POSITION_STATUS.ENDED_CHILD_AGED_OUT]: 'Ended — Child Aged Out',
  [POSITION_STATUS.ENDED_RELOCATION]: 'Ended — Relocation',
  [POSITION_STATUS.ENDED_OTHER]: 'Ended — Other',
  [POSITION_STATUS.CLOSED]: 'Closed',
  [POSITION_STATUS.CLOSED_NO_CANDIDATES]: 'Closed — No Candidates',
};

export const CONNECTION_STAGE_LABELS: Record<ConnectionStage, string> = {
  [CONNECTION_STAGE.REQUEST_SENT]: 'Request Sent',
  [CONNECTION_STAGE.REQUEST_EXPIRED]: 'Request Expired',
  [CONNECTION_STAGE.DECLINED]: 'Declined',
  [CONNECTION_STAGE.REQUEST_CANCELLED]: 'Request Cancelled',
  [CONNECTION_STAGE.NANNY_APPLIED_PENDING]: 'Applied',
  [CONNECTION_STAGE.NANNY_APPLIED]: 'Applied',
  [CONNECTION_STAGE.ACCEPTED_PENDING]: 'Accepted',
  [CONNECTION_STAGE.ACCEPTED]: 'Accepted',
  [CONNECTION_STAGE.SCHEDULE_EXPIRED]: 'Schedule Expired',
  [CONNECTION_STAGE.INTRO_SCHEDULED]: 'Meet Scheduled',
  [CONNECTION_STAGE.INTRO_COMPLETE]: 'Meet Complete',
  [CONNECTION_STAGE.INTRO_INCOMPLETE]: 'Meet Incomplete',
  [CONNECTION_STAGE.AWAITING_RESPONSE]: 'Awaiting Response',
  [CONNECTION_STAGE.TRIAL_ARRANGED]: 'Trial Arranged',
  [CONNECTION_STAGE.TRIAL_COMPLETE]: 'Trial Complete',
  [CONNECTION_STAGE.OFFERED]: 'Offered',
  [CONNECTION_STAGE.CONFIRMED]: 'Confirmed',
  [CONNECTION_STAGE.NOT_HIRED]: 'Not Hired',
  [CONNECTION_STAGE.NOT_SELECTED]: 'Not Selected',
  [CONNECTION_STAGE.ACTIVE]: 'Active',
  [CONNECTION_STAGE.FINISHED]: 'Finished',
  [CONNECTION_STAGE.CANCELLED_BY_PARENT]: 'Cancelled by Parent',
  [CONNECTION_STAGE.CANCELLED_BY_NANNY]: 'Cancelled by Nanny',
};

// ─── Stage Groups ───

/** Connection stages visible in nanny's My Positions */
export const VISIBLE_CONNECTION_STAGES: ConnectionStage[] = [
  CONNECTION_STAGE.REQUEST_SENT,
  CONNECTION_STAGE.NANNY_APPLIED_PENDING,
  CONNECTION_STAGE.NANNY_APPLIED,
  CONNECTION_STAGE.ACCEPTED_PENDING,
  CONNECTION_STAGE.ACCEPTED,
  CONNECTION_STAGE.INTRO_SCHEDULED,
  CONNECTION_STAGE.INTRO_COMPLETE,
  CONNECTION_STAGE.INTRO_INCOMPLETE,
  CONNECTION_STAGE.AWAITING_RESPONSE,
  CONNECTION_STAGE.TRIAL_ARRANGED,
  CONNECTION_STAGE.TRIAL_COMPLETE,
  CONNECTION_STAGE.OFFERED,
  CONNECTION_STAGE.CONFIRMED,
  CONNECTION_STAGE.ACTIVE,
  CONNECTION_STAGE.FINISHED,
];

/** Connection stages that are terminal/hidden from UI */
export const HIDDEN_CONNECTION_STAGES: ConnectionStage[] = [
  CONNECTION_STAGE.REQUEST_EXPIRED,
  CONNECTION_STAGE.DECLINED,
  CONNECTION_STAGE.REQUEST_CANCELLED,
  CONNECTION_STAGE.SCHEDULE_EXPIRED,
  CONNECTION_STAGE.INTRO_INCOMPLETE,
  CONNECTION_STAGE.NOT_HIRED,
  CONNECTION_STAGE.NOT_SELECTED,
  CONNECTION_STAGE.FINISHED,
  CONNECTION_STAGE.CANCELLED_BY_PARENT,
  CONNECTION_STAGE.CANCELLED_BY_NANNY,
];

/** Connection stages where nanny must take action */
export const NANNY_ACTION_REQUIRED: ConnectionStage[] = [
  CONNECTION_STAGE.REQUEST_SENT,
  CONNECTION_STAGE.INTRO_COMPLETE,
  CONNECTION_STAGE.TRIAL_COMPLETE,
  CONNECTION_STAGE.OFFERED, // only when parent-initiated (Path B)
];

/** Connection stages where parent must take action */
export const PARENT_ACTION_REQUIRED: ConnectionStage[] = [
  CONNECTION_STAGE.ACCEPTED,
  CONNECTION_STAGE.OFFERED, // only when nanny-initiated (Path A)
];

/** Position statuses that mean the position is over */
export const POSITION_TERMINAL_STATUSES: PositionStatus[] = [
  POSITION_STATUS.ENDED_NATURAL,
  POSITION_STATUS.ENDED_NANNY_LEFT,
  POSITION_STATUS.ENDED_NO_LONGER_NEEDED,
  POSITION_STATUS.ENDED_MUTUAL,
  POSITION_STATUS.ENDED_CHILD_AGED_OUT,
  POSITION_STATUS.ENDED_RELOCATION,
  POSITION_STATUS.ENDED_OTHER,
  POSITION_STATUS.CLOSED,
  POSITION_STATUS.CLOSED_NO_CANDIDATES,
];

// ─── End Reason → Status Mapping ───

export const END_REASON_TO_STATUS: Record<string, PositionStatus> = {
  natural: POSITION_STATUS.ENDED_NATURAL,
  nanny_left: POSITION_STATUS.ENDED_NANNY_LEFT,
  no_longer_needed: POSITION_STATUS.ENDED_NO_LONGER_NEEDED,
  mutual: POSITION_STATUS.ENDED_MUTUAL,
  child_aged_out: POSITION_STATUS.ENDED_CHILD_AGED_OUT,
  relocation: POSITION_STATUS.ENDED_RELOCATION,
  other: POSITION_STATUS.ENDED_OTHER,
};

export type EndReason = keyof typeof END_REASON_TO_STATUS;

// ─── Legacy Status ↔ Stage Sync ───

/** Map legacy text status to new integer stage + position_status */
export const LEGACY_POSITION_STATUS_MAP: Record<string, { stage: PositionStage; position_status: PositionStatus }> = {
  draft: { stage: POSITION_STAGE.DRAFT, position_status: POSITION_STATUS.DRAFT },
  active: { stage: POSITION_STAGE.OPEN, position_status: POSITION_STATUS.OPEN },
  paused: { stage: POSITION_STAGE.DRAFT, position_status: POSITION_STATUS.DRAFT },
  filled: { stage: POSITION_STAGE.ACTIVE, position_status: POSITION_STATUS.ACTIVE },
  cancelled: { stage: POSITION_STAGE.CLOSED, position_status: POSITION_STATUS.CLOSED },
};

/** Map legacy connection text status to new integer connection_stage */
export const LEGACY_CONNECTION_STATUS_MAP: Record<string, ConnectionStage> = {
  pending: CONNECTION_STAGE.REQUEST_SENT,
  accepted: CONNECTION_STAGE.ACCEPTED,
  confirmed: CONNECTION_STAGE.INTRO_SCHEDULED, // or INTRO_COMPLETE depending on time
  declined: CONNECTION_STAGE.DECLINED,
  cancelled: CONNECTION_STAGE.CANCELLED_BY_PARENT,
  expired: CONNECTION_STAGE.REQUEST_EXPIRED,
  completed: CONNECTION_STAGE.INTRO_COMPLETE,
};

// ─── Helpers ───

/** Derive position stage from position status code */
export function getStageFromStatus(status: PositionStatus): PositionStage {
  if (status === 0) return POSITION_STAGE.DRAFT;
  if (status === 1) return POSITION_STAGE.OPEN;
  if (status >= 10 && status < 30) return POSITION_STAGE.CONNECTING;
  if (status >= 30 && status < 50) return POSITION_STAGE.ACTIVE;
  if (status >= 50 && status < 60) return POSITION_STAGE.ENDED;
  if (status >= 60) return POSITION_STAGE.CLOSED;
  return POSITION_STAGE.DRAFT;
}

/** Check if a connection stage is visible in UI */
export function isVisibleConnectionStage(stage: ConnectionStage): boolean {
  return (VISIBLE_CONNECTION_STAGES as number[]).includes(stage);
}

/** Check if a position has reached a terminal state */
export function isPositionTerminal(status: PositionStatus): boolean {
  return (POSITION_TERMINAL_STATUSES as number[]).includes(status);
}

/** Get the legacy text status equivalent for a position stage (for dual-write) */
export function getLegacyPositionStatus(stage: PositionStage): string {
  switch (stage) {
    case POSITION_STAGE.DRAFT: return 'draft';
    case POSITION_STAGE.OPEN: return 'active';
    case POSITION_STAGE.CONNECTING: return 'active';
    case POSITION_STAGE.ACTIVE: return 'filled';
    case POSITION_STAGE.ENDED: return 'filled';
    case POSITION_STAGE.CLOSED: return 'cancelled';
    default: return 'active';
  }
}
