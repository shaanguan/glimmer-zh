import sourceIndex from "../content/source/index.json" with { type: "json" };

type TrafficDevice = "mobile" | "tablet" | "desktop" | "unknown";
type TrafficEvent = { eventId: string; path: string; referrer: string; device: TrafficDevice };

const MAX_BODY_BYTES = 1024;
const RECEIPT_LIFETIME_MS = 24 * 60 * 60 * 1000;
const publicPaths = new Set(["/", "/glossary", "/saved", ...sourceIndex.map(page => `/guide/${page.slug}`)]);
const devices = new Set<TrafficDevice>(["mobile", "tablet", "desktop", "unknown"]);
const fields = ["eventId", "path", "referrer", "device"];
const randomUUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const shanghaiDate = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Asia/Shanghai", year: "numeric", month: "2-digit", day: "2-digit",
});
// This only excludes recognisable crawler signatures, not all automated visits.
const knownCrawler = /(?:Googlebot|bingbot|Baiduspider|YandexBot|DuckDuckBot|Applebot|PetalBot|Bytespider|GPTBot|ChatGPT-User|OAI-SearchBot|ClaudeBot|Claude-User|Claude-SearchBot|PerplexityBot|Perplexity-User|facebookexternalhit|Twitterbot|LinkedInBot|Slackbot|Discordbot|WhatsApp|TelegramBot)/i;

export const trafficInsertSql = `INSERT INTO traffic_receipts (event_id, received_at, day, path, referrer, device)
VALUES (?, ?, ?, ?, ?, ?)
ON CONFLICT(event_id) DO NOTHING`;

export const trafficCleanupSql = `DELETE FROM traffic_receipts WHERE event_id IN (
  SELECT event_id FROM traffic_receipts
  WHERE received_at < ? ORDER BY received_at LIMIT 100
)`;

export function trafficDay(timestamp: number): string {
  return shanghaiDate.format(new Date(timestamp));
}

function error(status: number, code: string): Response {
  return new Response(JSON.stringify({ error: code }), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" },
  });
}

function accepted(): Response {
  return new Response(null, { status: 204, headers: { "Cache-Control": "no-store" } });
}

function validReferrer(value: unknown): value is string {
  if (value === "direct" || value === "internal") return true;
  if (typeof value !== "string" || value.length > 253 || !value.includes(".") || /^[\d.]+$/.test(value)) return false;
  // Lowercase ASCII DNS labels (including URL-normalised punycode) only. Do not
  // admit URLs, ports, credentials, IP addresses, or free-form referral text.
  if (!value.split(".").every(label => /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(label))) return false;
  try {
    return new URL(`https://${value}`).hostname === value;
  } catch {
    return false;
  }
}

function validateEvent(value: unknown): TrafficEvent | null {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return null;
  const event = value as Record<string, unknown>;
  if (Object.keys(event).length !== fields.length || fields.some(field => !Object.hasOwn(event, field))) return null;
  if (typeof event.eventId !== "string" || !randomUUID.test(event.eventId)) return null;
  if (typeof event.path !== "string" || !publicPaths.has(event.path)) return null;
  if (!validReferrer(event.referrer) || !devices.has(event.device as TrafficDevice)) return null;
  return {
    eventId: event.eventId.toLowerCase(),
    path: event.path === "/guide/overview" ? "/" : event.path,
    referrer: event.referrer,
    device: event.device as TrafficDevice,
  };
}

class BodyError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(status: number, code: string) {
    super(code);
    this.status = status;
    this.code = code;
  }
}

async function readEventBody(request: Request): Promise<unknown> {
  const length = request.headers.get("Content-Length");
  if (length !== null && (!/^\d+$/.test(length) || !Number.isSafeInteger(Number(length)))) {
    throw new BodyError(400, "invalid_content_length");
  }
  if (length !== null && Number(length) > MAX_BODY_BYTES) throw new BodyError(413, "body_too_large");
  if (!request.body) throw new BodyError(400, "invalid_json");

  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_BODY_BYTES) {
        void reader.cancel().catch(() => {});
        throw new BodyError(413, "body_too_large");
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  try {
    return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
  } catch {
    throw new BodyError(400, "invalid_json");
  }
}

/** Collect page views only; no public reporting surface or identity cookies. */
export async function handleTrafficRequest(request: Request, db?: D1Database): Promise<Response> {
  if (request.method !== "POST") {
    const response = error(405, "method_not_allowed");
    response.headers.set("Allow", "POST");
    return response;
  }
  const origin = request.headers.get("Origin");
  const fetchSite = request.headers.get("Sec-Fetch-Site");
  // No CORS headers: only the site's own origin can send browser events.
  // Fetch metadata is optional for browsers that do not implement it.
  if (origin !== new URL(request.url).origin || (fetchSite !== null && fetchSite !== "same-origin")) {
    return error(403, "invalid_origin");
  }
  if (request.headers.get("DNT") === "1" || request.headers.get("Sec-GPC") === "1") return accepted();
  if (knownCrawler.test(request.headers.get("User-Agent") ?? "")) return accepted();
  if (request.headers.get("Content-Type")?.split(";", 1)[0].trim().toLowerCase() !== "application/json" ||
      ![null, "identity"].includes(request.headers.get("Content-Encoding"))) {
    return error(415, "unsupported_content_type");
  }

  let event: TrafficEvent | null;
  try {
    event = validateEvent(await readEventBody(request));
  } catch (cause) {
    return cause instanceof BodyError ? error(cause.status, cause.code) : error(400, "unreadable_body");
  }
  if (!event) return error(400, "invalid_event");
  if (!db) {
    console.error("[traffic] database_unavailable");
    return error(503, "database_unavailable");
  }

  const receivedAt = Date.now();
  try {
    // The INSERT trigger updates daily totals in the same statement; conflicts
    // never fire it. D1's batch also makes insert + bounded expiry transactional.
    const result = await db.batch([
      db.prepare(trafficInsertSql).bind(event.eventId, receivedAt, trafficDay(receivedAt), event.path, event.referrer, event.device),
      db.prepare(trafficCleanupSql).bind(receivedAt - RECEIPT_LIFETIME_MS),
    ]);
    if (result.some(statement => !statement.success)) throw new Error("write_failed");
  } catch {
    // Do not log request bodies, headers, IPs, or database exception messages.
    console.error("[traffic] write_failed");
    return error(503, "write_failed");
  }
  return accepted();
}
