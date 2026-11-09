"use client";

import {useCallback, useEffect, useRef, useState} from "react";
import {flushSync} from "react-dom";

export type PendingNavigation = {href: string; label: string};

const APP_DOCUMENT_PATH = /^\/(?:guide\/[^/]+\/?|(?:glossary|saved|about)\/?)?$/;
const WAITING_DELAY = 10_000;

/** Resolve only application documents, without treating a reload as a hash jump. */
export function navigationTarget(href: string, currentHref: string) {
  try {
    const current = new URL(currentHref);
    const target = new URL(href, current);
    if (!/^https?:$/.test(target.protocol) || target.origin !== current.origin ||
        target.username || target.password || !APP_DOCUMENT_PATH.test(target.pathname)) return null;

    const sameDocument = target.pathname === current.pathname && target.search === current.search;
    // URL.hash omits a bare '#', which still requests a same-document jump.
    const fragmentAt = target.href.indexOf("#");
    const fragment = fragmentAt < 0 ? "" : target.href.slice(fragmentAt);
    return {
      href: target.pathname + target.search + fragment,
      sameDocumentFragment: sameDocument && fragmentAt >= 0,
      isCurrentUrl: sameDocument && target.hash === current.hash,
    };
  } catch {
    return null;
  }
}

function navigationLabel(label?: string) {
  const characters = Array.from(label?.replace(/\s+/g, " ").trim() || "页面");
  return characters.length > 72 ? characters.slice(0, 71).join("") + "…" : characters.join("");
}

/** Feedback for native document navigation; this hook never fetches or replaces content. */
export function useNavigationLoading() {
  const [pending, setPending] = useState<PendingNavigation | null>(null);
  const [stillWaiting, setStillWaiting] = useState(false);
  const pendingRef = useRef<PendingNavigation | null>(null);
  const waitingTimer = useRef<number | null>(null);

  const clearWaitingTimer = useCallback(() => {
    if (waitingTimer.current !== null) window.clearTimeout(waitingTimer.current);
    waitingTimer.current = null;
  }, []);

  const reset = useCallback(() => {
    clearWaitingTimer();
    if (!pendingRef.current) return;
    pendingRef.current = null;
    // Clear before a pagehide/BFCache snapshot as well as on user cancellation.
    flushSync(() => {
      setPending(null);
      setStillWaiting(false);
    });
  }, [clearWaitingTimer]);

  const cancel = useCallback(() => {
    if (!pendingRef.current) return;
    try { window.stop(); } finally { reset(); }
  }, [reset]);

  const begin = useCallback((href: string, label?: string): boolean => {
    if (typeof window === "undefined") return false;
    const target = navigationTarget(href, window.location.href);
    if (!target) return false;
    if (target.sameDocumentFragment) {
      // Choosing an in-page destination supersedes any older document request.
      cancel();
      return false;
    }

    clearWaitingTimer();
    const next = {href: target.href, label: navigationLabel(label)};
    pendingRef.current = next;
    // Commit in the initiating click/key handler, before native navigation begins.
    flushSync(() => {
      setPending(next);
      setStillWaiting(false);
    });
    waitingTimer.current = window.setTimeout(() => {
      waitingTimer.current = null;
      if (pendingRef.current === next) setStillWaiting(true);
    }, WAITING_DELAY);
    return true;
  }, [cancel, clearWaitingTimer]);

  useEffect(() => {
    function onClick(event: MouseEvent) {
      if (event.defaultPrevented || event.button !== 0 ||
          event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      const element = event.target instanceof Element ? event.target : null;
      const anchor = element?.closest<HTMLAnchorElement>("a[href]");
      if (!anchor || anchor.hasAttribute("download")) return;
      const browsingTarget = anchor.getAttribute("target") ??
        document.querySelector("base[target]")?.getAttribute("target") ?? "";
      if (browsingTarget && browsingTarget.toLowerCase() !== "_self") return;

      const target = navigationTarget(anchor.href, window.location.href);
      if (!target) {
        // A different same-window HTTP destination replaces our request, but is
        // outside the application documents for which we provide feedback.
        if (/^https?:$/.test(anchor.protocol)) reset();
        return;
      }
      if (anchor.closest(".header-nav") && target.isCurrentUrl) {
        event.preventDefault();
        cancel();
        return;
      }
      begin(target.href, anchor.getAttribute("aria-label") || anchor.title || anchor.textContent || undefined);
      // Keep default navigation, including repeated clicks that retry a target.
    }
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") cancel();
    }

    document.addEventListener("click", onClick);
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("pageshow", reset);
    window.addEventListener("pagehide", reset);
    window.addEventListener("hashchange", reset);
    window.addEventListener("popstate", reset);
    return () => {
      document.removeEventListener("click", onClick);
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("pageshow", reset);
      window.removeEventListener("pagehide", reset);
      window.removeEventListener("hashchange", reset);
      window.removeEventListener("popstate", reset);
      clearWaitingTimer();
      pendingRef.current = null;
    };
  }, [begin, cancel, clearWaitingTimer, reset]);

  return {pending, stillWaiting, begin, cancel};
}
