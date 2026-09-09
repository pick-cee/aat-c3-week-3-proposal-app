"use client";

import { useEffect } from "react";

/**
 * Stops unsaved typing from vanishing to a stray click.
 *
 * The notes textarea holds an entire discovery call — ten minutes of typing
 * that exists nowhere else until extraction runs. Closing the tab, hitting
 * back, or clicking "Queue" threw all of it away silently. Nothing about that
 * is recoverable, and it is the kind of loss that makes someone stop trusting
 * a tool entirely.
 *
 * Two layers, because they cover different exits:
 *
 *   `beforeunload` catches the browser leaving — closing the tab, a reload, a
 *   typed URL. The browser shows its own generic dialogue; the text cannot be
 *   customised, which is a deliberate anti-abuse rule and not worth fighting.
 *
 *   A capture-phase click handler catches in-app navigation, which
 *   `beforeunload` never sees because the page is not unloading. That is the
 *   more likely exit here: the "Queue" link sits at the top of the very screen
 *   someone is typing into.
 */
export function useDraftGuard(hasUnsavedWork: boolean, message: string): void {
  useEffect(() => {
    if (!hasUnsavedWork) return;

    const onBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      // Assigning returnValue is what actually triggers the prompt in older
      // browsers; preventDefault alone is the modern spec.
      event.returnValue = "";
    };

    const onClick = (event: MouseEvent) => {
      // Only plain left-clicks. A middle-click or ctrl-click opens a new tab,
      // which does not lose anything.
      if (event.defaultPrevented || event.button !== 0) return;
      if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;

      const link = (event.target as HTMLElement | null)?.closest("a");
      if (!link) return;

      const href = link.getAttribute("href");
      if (!href || href.startsWith("#") || link.target === "_blank") return;

      if (!window.confirm(message)) {
        event.preventDefault();
        event.stopPropagation();
      }
    };

    window.addEventListener("beforeunload", onBeforeUnload);
    // Capture phase: intercept before Next's router handles the click.
    document.addEventListener("click", onClick, true);

    return () => {
      window.removeEventListener("beforeunload", onBeforeUnload);
      document.removeEventListener("click", onClick, true);
    };
  }, [hasUnsavedWork, message]);
}
