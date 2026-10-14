"use client";

/**
 * KatieDeck — the conversation surface.
 *
 * Scrollable message list + input pinned to bottom + footer disclaimer.
 * Fetches message history on mount (Phase 1); Realtime subscription
 * comes in Phase 1D.
 * Unit 3w6fix (W6-D7): the empty-state greeting's topics come from
 * `katieGreetingTopics(role)` — parents are not offered "verification" (D-7).
 */

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { KatieFooter } from "./KatieFooter";
import { KatieInput } from "./KatieInput";
import { KatieQuickActions } from "./KatieQuickActions";
import { katieGreetingTopics } from "./greeting";
import { ImageAttachmentProvider } from "./image-attachment-context";
import { DraftActionsProvider } from "./tiles/draft-actions-context";
import { MessageRow } from "./messages/MessageRow";
import { AssistantMessage } from "./messages/AssistantMessage";
import { TypingIndicator } from "./messages/TypingIndicator";
import { SparkleIcon } from "./messages/SparkleIcon";
import type { KatieMessage } from "./messages/types";
import { useKatie } from "@/contexts/KatieContext";
import { usePreloadOptional } from "@/contexts/PreloadContext";
import { useAuth } from "@/contexts/AuthContext";
import { useChatStream } from "./use-chat-stream";
import { useTypewriter } from "./use-typewriter";
import { KATIE_TYPEWRITER_ENABLED } from "@/lib/chat/flags";
import { isChatTile, type ChatTile } from "@/lib/chat/tiles";

interface EmptyStateProps {
  role: string;
  onChipSelect: (prompt: string) => void;
}

function EmptyState({ role, onChipSelect }: EmptyStateProps) {
  return (
    <div className="mt-8 flex flex-col items-start gap-3 text-sm text-slate-700">
      <SparkleIcon className="h-6 w-6 text-violet-500" />
      <p className="text-base font-medium text-slate-900">
        Hi — I&apos;m Katie.
      </p>
      <p>
        I can help you across all of Baby Bloom — {katieGreetingTopics(role)}.
      </p>
      <KatieQuickActions role={role} onSelect={onChipSelect} />
    </div>
  );
}

export function KatieDeck() {
  const { currentSurface, visibleDeck } = useKatie();
  const { role } = useAuth();
  const [messages, setMessages] = useState<KatieMessage[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [isHydrating, setIsHydrating] = useState(true);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  // Guards against rapid double-clicks (e.g., chip + chip, or
  // chip + Enter) firing two sends before `isStreaming` flips. The
  // disabled state on KatieInput / KatieQuickActions only updates
  // after `send` awaits its first network tick.
  const sendingRef = useRef(false);

  const { send, isStreaming, streamingText, streamingTile } = useChatStream();
  // WU7 (F2 client) — read the publisher-provided preload from
  // context. Optional: returns null when the provider isn't mounted
  // (e.g. legacy code paths or test environments) so the deck still
  // works unchanged. Threading happens at send() time.
  const preloadCtx = usePreloadOptional();

  // V1.1 side fix 2b: smooth the streaming text into a steady
  // char-by-char trickle so the user never sees "3 dots → block of
  // text". The hook is a no-op (returns the target unchanged) when
  // prefers-reduced-motion is set OR when the flag is disabled.
  const typewriterText = useTypewriter(streamingText, {
    reducedMotion: !KATIE_TYPEWRITER_ENABLED || undefined,
  });
  const visibleStreamingText = KATIE_TYPEWRITER_ENABLED
    ? typewriterText
    : streamingText;

  // Fetch history on mount
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/chat/messages?limit=30", {
          cache: "no-store",
        });
        if (!res.ok) return;
        const data = (await res.json()) as { messages: KatieMessage[] };
        if (cancelled) return;
        setMessages(data.messages ?? []);
      } catch {
        // non-fatal; empty state will show
      } finally {
        if (!cancelled) setIsHydrating(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // Auto-scroll on new content. `useLayoutEffect` runs synchronously
  // after DOM mutations and before paint, so `scrollHeight` reflects
  // the final rendered layout — `useEffect` could fire while the
  // container was still height-zero (during the hydrating gate's
  // first paint), leaving the scroll short. `isHydrating` is in the
  // deps so the scroll re-fires the moment the gate clears and
  // messages become visible.
  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
    // We watch `visibleStreamingText` (not `streamingText`) so the
    // scroll keeps pace with what's actually rendered. With the
    // typewriter spoof on, those diverge mid-stream and watching
    // the raw stream would scroll past content not yet visible.
  }, [messages, visibleStreamingText, isHydrating]);

  // Re-scroll to bottom when the user switches the carousel back to
  // Katie. Without this, swapping main → Katie leaves the deck at
  // whatever scroll position it had before the swap (often the top
  // if the user had scrolled up to read older messages, OR the
  // initial position if the deck was just mounted). Per user spec
  // 2026-05-07: always open at the most recent message.
  //
  // The `isHydrating` guard avoids a silent no-op: if the user
  // switches to Katie before the initial fetch resolves, the
  // container is still height-zero and `scrollHeight` is 0. The
  // first effect above re-fires when hydration completes (because
  // `isHydrating` is in its deps) and lands the scroll correctly.
  useLayoutEffect(() => {
    if (visibleDeck !== "katie" || isHydrating) return;
    const el = scrollRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, [visibleDeck, isHydrating]);

  // Append helper
  const append = useCallback((msg: KatieMessage) => {
    setMessages((prev) => [...prev, msg]);
  }, []);

  const handleSend = useCallback(
    async (message: string) => {
      if (sendingRef.current) return;
      sendingRef.current = true;
      setLoadError(null);
      try {
        // WU7 — pass the publisher-stamped preload through. send()
        // checks the F2 client kill-switch flag internally; we
        // unconditionally pass whatever the context has (might be
        // an empty object if no publisher has fired yet).
        const result = await send(
          message,
          currentSurface,
          append,
          preloadCtx?.preload,
        );
        if (!result.ok && result.error) {
          setLoadError(result.error);
        }
      } finally {
        sendingRef.current = false;
      }
    },
    [send, currentSurface, append, preloadCtx?.preload],
  );

  // Draft action handlers. Accept POSTs to the apply endpoint and
  // replaces the draft tile on the host chat message with the
  // persisted one. Dismiss is fully client-side. Amend is stubbed
  // until 8.22e teaches Katie the conversational amendment pattern.
  const handleDraftAccept = useCallback(
    async (
      draftId: string,
      toolName: string,
      args: Record<string, unknown>,
      imageUrl: string | null,
    ) => {
      try {
        const res = await fetch("/api/chat/drafts/accept", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          // draftId travels server-side so the dedup layer (WU 11.3)
          // can reject double-accepts (button mash, network retry).
          body: JSON.stringify({ draftId, toolName, args, imageUrl }),
        });
        // WU 11.3 — 409 means this draft was already accepted on a
        // prior click. The first click already produced the persisted
        // tile; this retry has nothing to add. Treat as silent no-op
        // rather than surfacing an error — the user already saw
        // success and the second click is just noise.
        if (res.status === 409) {
          return;
        }
        const body = (await res.json()) as {
          tile?: ChatTile;
          error?: string;
          warning?: string;
        };
        if (!res.ok || !body.tile) {
          setLoadError(body.error ?? "Couldn't accept that draft.");
          return;
        }
        const persistedTile = body.tile;
        // Replace the draft tile on the host chat message in place.
        // Keeping the same message id preserves scroll position and
        // any surrounding text Katie wrote alongside the draft.
        setMessages((prev) =>
          prev.map((m) => {
            if (!isChatTile(m.tile) || m.tile.kind !== "draft") return m;
            if (m.tile.data.draftId !== draftId) return m;
            return { ...m, tile: persistedTile };
          }),
        );
        // Warning means the row persisted but a downstream cascade
        // failed (progress recalc, etc). Surface it as an info
        // banner — NOT setLoadError, which carries error semantics
        // and would suggest a retry.
        if (body.warning) {
          // Re-using setLoadError as the surface for now; the message
          // text makes it clear this is a notice not a failure. A
          // dedicated warning surface can land in a follow-up.
          setLoadError(body.warning);
        }
      } catch (err) {
        setLoadError(
          err instanceof Error ? err.message : "Couldn't accept that draft.",
        );
      }
    },
    // setMessages and setLoadError are stable React setters but
    // listing them explicitly keeps the lint rule happy + makes
    // the dependency contract obvious for future maintainers.
    [setLoadError, setMessages],
  );

  const handleDraftAmend = useCallback(
    async (draftId: string, toolName: string, changeText?: string) => {
      // Amend ships a synthetic user-side message describing what
      // the user wants changed. WU 9.6: the DraftTile now renders an
      // inline textbox for the user's change description, so the
      // synthetic message includes that text directly rather than
      // forcing a chat round-trip ("Amend." → Katie asks → user
      // types in main input → Katie re-proposes).
      //
      // Auto-dismiss prior SAME-tool drafts so the new draft replaces
      // the old in place rather than stacking. Unrelated drafts
      // (e.g., a parallel diary draft) stay.
      void draftId;
      setMessages((prev) =>
        prev.filter((m) => {
          if (!isChatTile(m.tile) || m.tile.kind !== "draft") return true;
          return m.tile.data.toolName !== toolName;
        }),
      );

      const friendlyName = toolName.replace(/_/g, " ");
      const trimmed = changeText?.trim() ?? "";
      // Two message shapes: with-text (richer signal, Katie can
      // act immediately) vs without-text (legacy "Amend." that
      // makes Katie ask "what to change?"). Both are taught in
      // the logging_rules system prompt.
      const message =
        trimmed.length > 0
          ? `Amend the ${friendlyName} draft: ${trimmed}`
          : `Amend that ${friendlyName} draft.`;
      await handleSend(message);
    },
    [handleSend, setMessages],
  );

  const handleDraftDismiss = useCallback((draftId: string) => {
    // Fully wired in 8.22b: the chat message hosting this draft is
    // identified by a tile.data.draftId match. Remove it from the
    // local message list. Nothing was persisted, so no server call.
    setMessages((prev) =>
      prev.filter((m) => {
        // Keep messages that aren't draft tiles, or whose draft id
        // doesn't match the dismissal target. `isChatTile` narrows
        // to the typed union so the kind check is type-safe.
        if (!isChatTile(m.tile)) return true;
        if (m.tile.kind !== "draft") return true;
        return m.tile.data.draftId !== draftId;
      }),
    );
  }, []);

  return (
    <ImageAttachmentProvider>
      <DraftActionsProvider
        value={{
          onAccept: handleDraftAccept,
          onAmend: handleDraftAmend,
          onDismiss: handleDraftDismiss,
        }}
      >
        <div className="flex h-full flex-col bg-[hsl(var(--color-katie-bg-lilac))]">
          {/* A-07 fix: deck-internal "BabyBloom · Katie" subheading
              removed. The global DashboardNav above the tabs already
              identifies the surface; the deck-internal header was
              redundant once the tab strip landed. */}

          <div ref={scrollRef} className="flex-1 overflow-y-auto px-3 py-3">
            <div className="space-y-4">
              {!isHydrating && messages.length === 0 && !isStreaming ? (
                <EmptyState role={role ?? ""} onChipSelect={handleSend} />
              ) : null}

              {(() => {
                // Sparkle icon only shows on the most-recent
                // assistant message OR the streaming bubble (per
                // user feedback 2026-05-07). When a stream is in
                // flight, the streaming bubble below carries the
                // icon and the previously-most-recent assistant
                // message in the list goes back to no-icon — so we
                // suppress the icon on every persisted message
                // while streaming.
                const lastAssistantIndex = isStreaming
                  ? -1
                  : messages.reduce(
                      (acc, m, i) => (m.role === "assistant" ? i : acc),
                      -1,
                    );
                return messages.map((m, i) => (
                  <MessageRow
                    key={m.id}
                    message={m}
                    isMostRecentAssistant={i === lastAssistantIndex}
                  />
                ));
              })()}

              {isStreaming && (streamingText.length > 0 || streamingTile) ? (
                <AssistantMessage
                  content={visibleStreamingText}
                  tile={streamingTile}
                  // Streaming bubble always shows the icon — it IS
                  // the live "Katie is responding" surface.
                  showIcon
                />
              ) : null}
              {isStreaming && streamingText.length === 0 && !streamingTile ? (
                <TypingIndicator />
              ) : null}

              {loadError ? (
                <div className="rounded-md border border-rose-200 bg-rose-50 p-2 text-xs text-rose-700">
                  {loadError}
                </div>
              ) : null}
            </div>
          </div>

          <KatieInput disabled={isStreaming} onSend={handleSend} />
          <KatieFooter />
        </div>
      </DraftActionsProvider>
    </ImageAttachmentProvider>
  );
}
