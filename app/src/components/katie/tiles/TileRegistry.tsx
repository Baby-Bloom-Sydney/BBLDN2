"use client";

/**
 * TileRegistry — the single point where Katie's chat-deck tiles are
 * dispatched by `kind`. Adding a new tile kind = one new branch here +
 * one new case in `isChatTile` in `src/lib/chat/tiles.ts`. No other
 * file touches the dispatch.
 *
 * Architectural commitment (from the Phase 4 plan): for INTERACTIVE
 * tiles (interview_request, connection_request, bsr_job, etc.), the
 * branch below imports the EXACT SAME component rendered on the main
 * page — not a chat-specific copy. The tile component handles its own
 * data fetch + Realtime subscription + action handlers, so Katie's
 * view and the rest of the site stay in lockstep.
 */

import type { ChatTile } from "@/lib/chat/tiles";
import type { FeedItem } from "@/types/bapp";
import { KatieNoteTile } from "./KatieNoteTile";
import { VerificationStatusTile } from "./VerificationStatusTile";
import { ConnectionRequestTile } from "./ConnectionRequestTile";
import { BsrJobTile } from "./BsrJobTile";
import { babysittingEnabled } from "@/lib/features/flags";
import { JobMatchTile } from "./JobMatchTile";
import { PositionTile } from "./PositionTile";
import { PlacementTile } from "./PlacementTile";
import { DraftTile } from "./DraftTile";
import { ActivityTile } from "@/components/bapp/tiles/ActivityTile";
import { ObservationTile } from "@/components/bapp/tiles/ObservationTile";
import { DiaryTile } from "@/components/bapp/tiles/DiaryTile";
import { ProgressTile } from "@/components/bapp/tiles/ProgressTile";

export function RenderTile({ tile }: { tile: ChatTile }) {
  switch (tile.kind) {
    case "katie_note":
      return <KatieNoteTile tile={tile} />;
    case "activity":
      // Same component the child feed uses. No `onViewActivity` handler
      // here — the "View Activity →" button only renders when a handler
      // is supplied, so Katie's inline version stays compact. Users who
      // want the full sheet can open the child's development page.
      return <ActivityTile item={tile.data.item as FeedItem} />;
    case "observation":
      return <ObservationTile item={tile.data.item as FeedItem} />;
    case "diary":
      return <DiaryTile item={tile.data.item as FeedItem} />;
    case "progress":
      // ProgressTile accepts an optional milestoneMap for looking up
      // milestone descriptions. Katie's inline version skips it — the
      // compact form just renders the domain + mastery score per update,
      // and the milestone id is still visible as a fallback. The full
      // annotated version renders on the child's main-feed page where
      // the milestoneMap is in scope.
      return <ProgressTile item={tile.data.item as FeedItem} />;
    case "verification_status":
      // Wraps VerificationProgress — the stepper component from the
      // design system. Step derivation is server-side so Katie never
      // speaks raw verification_level / verification_status codes.
      return <VerificationStatusTile tile={tile} />;
    case "connection_request":
      // First interactive/id-only tile. Fetches live from
      // /api/chat/connections/[id] so the chat view never drifts from
      // the main-page view of the same connection.
      return <ConnectionRequestTile tile={tile} />;
    case "bsr_job":
      // Babysitting request live view — role-aware (nanny invitation
      // vs parent's own request). Fetches /api/chat/bsr/[id].
      // 5c (P-23): not offered while BABYSITTING_ENABLED is off — a persisted tile renders nothing, no fetch.
      return babysittingEnabled() ? <BsrJobTile tile={tile} /> : null;
    case "job_match":
      // DFY match notification live view — nanny-only. Fetches
      // /api/chat/job-matches/[id].
      return <JobMatchTile tile={tile} />;
    case "parent_position":
      // Parent's active position — id-only. Reuses the SAME
      // PositionDetailView used on /parent/position, in compact +
      // read-only mode. Fetches /api/chat/position/[id].
      return <PositionTile tile={tile} />;
    case "parent_placement":
      // Parent's active placement (their hired nanny) — id-only.
      // Reuses the SAME PlacementCard used on /parent/position, in
      // compact + read-only mode. Fetches /api/chat/placement/[id].
      return <PlacementTile tile={tile} />;
    case "draft":
      // Sudo / draft tile (WU 8.22b). Wraps a draftable preview
      // with Add Image + Accept / Amend / Dismiss footer. Action
      // handlers come from the surrounding DraftActionsProvider in
      // KatieDeck — outside that surface the buttons render
      // disabled (see DraftTile's `actions.isWired`).
      return <DraftTile tile={tile} />;
    // Future kinds — add here, importing the SAME component used on the
    // main page. e.g.:
    //   case "interview_request":
    //     return <InterviewRequestTile id={tile.data.id} />;
    default: {
      const _exhaustive: never = tile;
      void _exhaustive;
      return null;
    }
  }
}
