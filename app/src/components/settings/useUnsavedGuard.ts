"use client";

/**
 * Leaving an editable Settings page with unsaved changes (06b-3 rework, ledger B06 §9.1 R1):
 * - a link inside the app asks first — the in-app confirm (`DiscardChangesDialog`: "Discard your changes?", Keep
 *   editing / Discard); Discard drops the changes and goes where she clicked, Keep editing stays and puts focus back
 *   on the link;
 * - reloading or closing the tab gets the browser's own prompt (`beforeunload`).
 * Only while something changed. A new tab, a modified click (⌘ / Ctrl / Shift / Alt), a download, another site or a
 * link to where she already is never asks. The browser's Back button is not caught (no cancellable event exists).
 *
 * BB-wave1-041126/06b3-rework, 2026-11-09.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";

export interface UnsavedGuard {
  readonly confirming: boolean;
  readonly keepEditing: () => void;
  readonly discard: () => void;
  /** Once the confirm has closed after Keep editing: focus back on the link she clicked. */
  readonly returnFocus: () => void;
}

/** The in-app destination of a plain left click on a link, or null when it shouldn't be caught. */
function caughtHref(event: MouseEvent): { readonly href: string; readonly link: HTMLAnchorElement } | null {
  if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return null;
  const link = event.target instanceof Element ? event.target.closest("a[href]") : null;
  if (!(link instanceof HTMLAnchorElement) || link.target === "_blank" || link.hasAttribute("download")) return null;
  const url = new URL(link.href, window.location.href);
  if (url.origin !== window.location.origin) return null;
  const href = `${url.pathname}${url.search}${url.hash}`;
  return url.pathname + url.search === window.location.pathname + window.location.search ? null : { href, link };
}

export function useUnsavedGuard(dirty: boolean, onDiscard: () => void): UnsavedGuard {
  const router = useRouter();
  const [pending, setPending] = useState<string | null>(null);
  const clicked = useRef<HTMLAnchorElement | null>(null);

  useEffect(() => {
    if (!dirty) return undefined;
    const onUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    const onClick = (event: MouseEvent) => {
      const caught = caughtHref(event);
      if (caught === null) return;
      event.preventDefault();
      event.stopPropagation();
      clicked.current = caught.link;
      setPending(caught.href);
    };
    window.addEventListener("beforeunload", onUnload);
    document.addEventListener("click", onClick, true);
    return () => {
      window.removeEventListener("beforeunload", onUnload);
      document.removeEventListener("click", onClick, true);
    };
  }, [dirty]);

  const keepEditing = useCallback(() => setPending(null), []);
  const returnFocus = useCallback(() => {
    clicked.current?.focus();
    clicked.current = null;
  }, []);
  const discard = useCallback(() => {
    const href = pending;
    setPending(null);
    clicked.current = null;
    onDiscard();
    if (href !== null) router.push(href);
  }, [pending, onDiscard, router]);

  return { confirming: pending !== null, keepEditing, discard, returnFocus };
}
