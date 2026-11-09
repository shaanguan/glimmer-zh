export type TrafficDevice = "mobile" | "tablet" | "desktop" | "unknown";

export function trafficPath(pathname: string): string | null {
  const path = pathname.replace(/\/+$/, "") || "/";
  if (path === "/guide/overview") return "/";
  if (["/", "/glossary", "/saved"].includes(path)) return path;
  return /^\/guide\/[a-z0-9-]+$/.test(path) ? path : null;
}

// Retain the referring hostname only, never its path, search parameters or hash.
export function trafficReferrer(referrer: string, currentOrigin: string): string {
  if (!referrer) return "direct";
  try {
    const url = new URL(referrer);
    if (!/^https?:$/.test(url.protocol)) return "direct";
    if (url.origin === currentOrigin) return "internal";
    const host = url.hostname.toLowerCase().replace(/\.$/, "");
    if (!host.includes(".") || host.length > 253 || /^[\d.]+$/.test(host) || host.includes(":") ||
        !host.split(".").every(label => /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(label))) return "direct";
    return host;
  } catch {
    return "direct";
  }
}

// Device categories are approximate; the raw user agent is never transmitted.
export function trafficDevice(userAgent: string, maxTouchPoints = 0): TrafficDevice {
  if (/iPad|Tablet|PlayBook|Silk/i.test(userAgent) ||
      (/Macintosh/i.test(userAgent) && maxTouchPoints > 1) ||
      (/Android/i.test(userAgent) && !/Mobile/i.test(userAgent))) return "tablet";
  if (/Mobi|iPhone|iPod|Android/i.test(userAgent)) return "mobile";
  if (/Windows NT|Macintosh|X11|CrOS/i.test(userAgent)) return "desktop";
  return "unknown";
}

type TrafficNavigator = Navigator & {globalPrivacyControl?: boolean; msDoNotTrack?: string};
type TrafficDocument = Document & {prerendering?: boolean};
type ViewState = {eventId: string | null; attempts: number; firstAttemptAt: number | null; inFlight: boolean; sent: boolean; stopped: boolean; restored: boolean};
const RETRY_WINDOW_MS = 10 * 60 * 1000;

// Survives React effect replay without writing an identifier into browser storage.
// A new document or an actual back/forward-cache restoration is a new page view.
const views = new WeakMap<Document, ViewState>();

export function startTrafficCollection(browser: Window, page: Document): () => void {
  if (browser.location.protocol !== "https:") return () => {};
  const path = trafficPath(browser.location.pathname);
  if (!path) return () => {};
  const navigator = browser.navigator as TrafficNavigator;
  const document = page as TrafficDocument;
  let state = views.get(page);
  if (!state) {
    state = {eventId: null, attempts: 0, firstAttemptAt: null, inFlight: false, sent: false, stopped: false, restored: false};
    views.set(page, state);
  }
  const current = state;

  const collect = () => {
    if (document.visibilityState !== "visible" || document.prerendering ||
        navigator.globalPrivacyControl === true ||
        [navigator.doNotTrack, navigator.msDoNotTrack].some(value => value === "1" || value === "yes") ||
        current.inFlight || current.sent || current.stopped || current.attempts >= 2) return;
    // Never replay a delivery after its server-side receipt could have expired.
    if (current.firstAttemptAt !== null && Date.now() - current.firstAttemptAt >= RETRY_WINDOW_MS) {
      current.stopped = true;
      return;
    }
    try {
      current.eventId ??= browser.crypto.randomUUID();
      const eventId = current.eventId;
      const payload = {
        eventId,
        path,
        // BFCache retains the old document.referrer, not the source of this return.
        referrer: current.restored ? "direct" : trafficReferrer(document.referrer, browser.location.origin),
        device: trafficDevice(navigator.userAgent, navigator.maxTouchPoints),
      };
      current.inFlight = true;
      current.firstAttemptAt ??= Date.now();
      current.attempts += 1;
      void browser.fetch("/api/traffic", {
        method: "POST",
        headers: {"Content-Type": "application/json"},
        body: JSON.stringify(payload),
        keepalive: true,
        credentials: "omit",
        // CORS mode preserves Origin for validation even with no-referrer.
        // The target stays same-origin and the endpoint grants no cross-site CORS.
        mode: "cors",
        referrerPolicy: "no-referrer",
        cache: "no-store",
      }).then(response => {
        if (current.eventId !== eventId) return;
        current.inFlight = false;
        current.sent = response.ok;
        // Invalid events cannot become valid through a network retry.
        current.stopped = response.status >= 400 && response.status < 500 && response.status !== 429;
      }).catch(() => {
        if (current.eventId === eventId) current.inFlight = false;
      });
    } catch {
      current.inFlight = false;
      current.stopped = true;
    }
  };

  const restore = (event: PageTransitionEvent) => {
    if (!event.persisted) return;
    current.eventId = null;
    current.attempts = 0;
    current.firstAttemptAt = null;
    current.inFlight = false;
    current.sent = false;
    current.stopped = false;
    current.restored = true;
    collect();
  };
  document.addEventListener("visibilitychange", collect);
  document.addEventListener("prerenderingchange", collect);
  browser.addEventListener("online", collect);
  browser.addEventListener("pageshow", restore);
  collect();
  return () => {
    document.removeEventListener("visibilitychange", collect);
    document.removeEventListener("prerenderingchange", collect);
    browser.removeEventListener("online", collect);
    browser.removeEventListener("pageshow", restore);
  };
}
