import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFileSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { Worker } from "node:worker_threads";
import { handleTrafficRequest, trafficCleanupSql, trafficDay, trafficInsertSql } from "../lib/traffic-server.ts";

const migration = readFileSync(new URL("../drizzle/0000_traffic.sql", import.meta.url), "utf8");
const site = "https://guide.example";
const headers = { Origin: site, "Content-Type": "application/json", "Sec-Fetch-Site": "same-origin" };
const payload = (overrides = {}) => ({ eventId: randomUUID(), path: "/", referrer: "direct", device: "desktop", ...overrides });
const request = (event = payload(), options = {}) => new Request(`${site}/api/traffic`, {
  method: "POST", headers, body: JSON.stringify(event), ...options,
});

// Execute the exact production statements and generated migration against SQLite;
// expose only D1's prepare/bind and atomic batch contract to the handler.
function database() {
  const sql = new DatabaseSync(":memory:");
  sql.exec(migration);
  return {
    sql,
    prepare(statement) { return { bind: (...values) => ({ statement, values }) }; },
    async batch(statements) {
      sql.exec("BEGIN IMMEDIATE");
      try {
        for (const { statement, values } of statements) sql.prepare(statement).run(...values);
        sql.exec("COMMIT");
        return statements.map(() => ({ success: true }));
      } catch (cause) {
        sql.exec("ROLLBACK");
        throw cause;
      }
    },
  };
}

function total(db) {
  return db.sql.prepare("SELECT COALESCE(SUM(views), 0) AS total FROM traffic_daily").get().total;
}

async function quietErrors(run) {
  const original = console.error;
  const messages = [];
  console.error = (...args) => messages.push(args);
  try { await run(messages); } finally { console.error = original; }
}

test("collects page views once and stores only canonical public dimensions", async () => {
  const db = database();
  try {
    const event = payload({ path: "/guide/overview", referrer: "developer.android.com" });
    assert.equal((await handleTrafficRequest(request(event), db)).status, 204);
    assert.equal((await handleTrafficRequest(request({ ...event, eventId: event.eventId.toUpperCase() }), db)).status, 204);
    assert.equal(total(db), 1);
    const row = db.sql.prepare("SELECT * FROM traffic_receipts").get();
    assert.deepEqual(Object.keys(row).sort(), ["day", "device", "event_id", "path", "received_at", "referrer"]);
    assert.equal(row.event_id, event.eventId);
    assert.equal(row.path, "/");
    assert.equal(row.referrer, "developer.android.com");
    assert.equal(row.day, trafficDay(row.received_at));
    assert.ok(Math.abs(Date.now() - row.received_at) < 5000);
    const aggregate = db.sql.prepare("SELECT * FROM traffic_daily").get();
    assert.deepEqual(Object.keys(aggregate).sort(), ["day", "device", "first_seen_at", "last_seen_at", "path", "referrer", "views"]);
    assert.equal(aggregate.first_seen_at, row.received_at);
    assert.equal(aggregate.last_seen_at, row.received_at);
    for (const path of ["/glossary", "/saved", "/guide/components-overview"]) {
      assert.equal((await handleTrafficRequest(request(payload({ path, referrer: "internal" })), db)).status, 204);
    }
    assert.equal(total(db), 4);
  } finally { db.sql.close(); }
});

test("rejects unknown fields, private URL data, invalid UUIDs and arbitrary routes before database work", async () => {
  let writes = 0;
  const db = { prepare() { writes++; throw new Error("unexpected write"); } };
  const invalid = [
    null, [], "text", {},
    payload({ ip: "192.0.2.1" }), payload({ userId: "person" }), payload({ event: "click" }),
    payload({ timestamp: 1 }), payload({ eventId: "a13e2230-394b-11ed-81ce-0242ac120002" }),
    payload({ eventId: "' OR 1=1--" }), payload({ path: "/about" }),
    payload({ path: "/guide/not-a-real-guide" }), payload({ path: "/saved?passage=private" }),
    payload({ path: "/guide/components-overview#saved-text" }), payload({ path: `${site}/` }),
    payload({ path: "/guide/components-overview/" }), payload({ device: "iPhone secret" }),
    ...["https://search.example/secret?q=private", "Search.Example", "search.example.", "user@search.example", "search.example:443", "192.0.2.1", "127.1", "[2001:db8::1]", "localhost", "a..example", "a_unsafe.example", "a.example/path", "a.example?query", "a.example#hash", "-a.example", "a-.example", "a".repeat(64) + ".example"].map(referrer => payload({ referrer })),
  ];
  for (const event of invalid) {
    const response = await handleTrafficRequest(request(event), db);
    assert.equal(response.status, 400, JSON.stringify(event));
    assert.deepEqual(await response.json(), { error: "invalid_event" });
  }
  assert.equal(writes, 0);
});

test("requires same Origin, rejects cross-site metadata, and allows browsers without Fetch metadata", async () => {
  const db = database();
  try {
    for (const origin of [null, "null", "https://other.example", "https://sub.guide.example", "http://guide.example", `${site}:444`, `${site}/`]) {
      const selected = { ...headers };
      if (origin === null) delete selected.Origin; else selected.Origin = origin;
      assert.equal((await handleTrafficRequest(request(payload(), { headers: selected }), db)).status, 403);
    }
    for (const fetchSite of ["cross-site", "same-site", "none"]) {
      assert.equal((await handleTrafficRequest(request(payload(), { headers: { ...headers, "Sec-Fetch-Site": fetchSite } }), db)).status, 403);
    }
    const response = await handleTrafficRequest(request(payload(), { headers: { Origin: site, "Content-Type": "application/json" } }), db);
    assert.equal(response.status, 204);
    assert.equal(response.headers.get("Access-Control-Allow-Origin"), null);
    assert.equal(response.headers.get("Set-Cookie"), null);
    assert.equal(response.headers.get("Cache-Control"), "no-store");
    assert.equal(total(db), 1);
  } finally { db.sql.close(); }
});

test("read methods have no reporting surface, and privacy signals / known crawlers do not write", async () => {
  const db = database();
  try {
    for (const method of ["GET", "HEAD", "OPTIONS", "PUT", "DELETE"]) {
      const response = await handleTrafficRequest(new Request(`${site}/api/traffic`, { method }), db);
      assert.equal(response.status, 405);
      assert.equal(response.headers.get("Allow"), "POST");
    }
    for (const extra of [{ DNT: "1" }, { "Sec-GPC": "1" }, { "User-Agent": "Mozilla/5.0 (compatible; Googlebot/2.1)" }, { "User-Agent": "ChatGPT-User/1.0" }]) {
      assert.equal((await handleTrafficRequest(request(payload(), { headers: { ...headers, ...extra } }), db)).status, 204);
    }
    assert.equal(total(db), 0);
    assert.equal(db.sql.prepare("SELECT COUNT(*) AS n FROM traffic_receipts").get().n, 0);
  } finally { db.sql.close(); }
});

test("enforces content type, UTF-8 JSON and actual byte size including streamed requests", async () => {
  const cases = [
    [{ headers: { ...headers, "Content-Type": "text/plain" } }, 415, "unsupported_content_type"],
    [{ headers: { ...headers, "Content-Encoding": "gzip" } }, 415, "unsupported_content_type"],
    [{ headers: { ...headers, "Content-Length": "1025" } }, 413, "body_too_large"],
    [{ headers: { ...headers, "Content-Length": "garbage" } }, 400, "invalid_content_length"],
    [{ body: "not json" }, 400, "invalid_json"],
    [{ body: new Uint8Array([0x7b, 0xff, 0x7d]) }, 400, "invalid_json"],
    [{ body: "x".repeat(1025) }, 413, "body_too_large"],
    [{ body: "中".repeat(400) }, 413, "body_too_large"],
    [{ body: new ReadableStream({ start(controller) { controller.enqueue(new Uint8Array(600)); controller.enqueue(new Uint8Array(600)); controller.close(); } }), duplex: "half" }, 413, "body_too_large"],
  ];
  for (const [options, status, code] of cases) {
    const response = await handleTrafficRequest(request(payload(), options));
    assert.equal(response.status, status);
    assert.deepEqual(await response.json(), { error: code });
  }
});

test("database failures are retryable, retain no failed receipt, and log no request details", async () => {
  const db = database();
  try {
    await quietErrors(async messages => {
      const unavailable = await handleTrafficRequest(request());
      assert.equal(unavailable.status, 503);
      assert.deepEqual(await unavailable.json(), { error: "database_unavailable" });
      assert.equal((await handleTrafficRequest(request(), db)).status, 204);
      db.sql.exec("CREATE TRIGGER fail_aggregate BEFORE UPDATE ON traffic_daily BEGIN SELECT RAISE(ABORT, 'private database detail'); END");
      const retry = payload();
      const failed = await handleTrafficRequest(request(retry), db);
      assert.equal(failed.status, 503);
      assert.deepEqual(await failed.json(), { error: "write_failed" });
      assert.equal(db.sql.prepare("SELECT COUNT(*) AS n FROM traffic_receipts").get().n, 1);
      assert.equal(total(db), 1);
      db.sql.exec("DROP TRIGGER fail_aggregate");
      assert.equal((await handleTrafficRequest(request(retry), db)).status, 204);
      assert.equal(total(db), 2);
      assert.deepEqual(messages, [["[traffic] database_unavailable"], ["[traffic] write_failed"]]);
    });
  } finally { db.sql.close(); }
});

test("receipt expiry removes at most 100 indexed rows while retaining daily aggregates", () => {
  const db = database();
  try {
    const now = Date.now();
    const expiry = now - 24 * 60 * 60 * 1000;
    const insert = db.sql.prepare(trafficInsertSql);
    for (let index = 0; index < 250; index++) insert.run(randomUUID(), expiry - index - 1, trafficDay(expiry), "/", "direct", "desktop");
    insert.run(randomUUID(), expiry, trafficDay(expiry), "/", "direct", "desktop");
    insert.run(randomUUID(), now, trafficDay(now), "/", "direct", "desktop");
    assert.equal(total(db), 252);
    const plan = db.sql.prepare(`EXPLAIN QUERY PLAN ${trafficCleanupSql}`).all(expiry).map(row => row.detail).join(" ");
    assert.match(plan, /traffic_receipts_received_at_idx/);
    const cleanup = db.sql.prepare(trafficCleanupSql);
    for (const [removed, remaining] of [[100, 152], [100, 52], [50, 2]]) {
      assert.equal(cleanup.run(expiry).changes, removed);
      assert.equal(db.sql.prepare("SELECT COUNT(*) AS n FROM traffic_receipts").get().n, remaining);
      assert.equal(total(db), 252);
    }
  } finally { db.sql.close(); }
});

test("Shanghai date changes at 16:00 UTC, including year and leap-day boundaries", () => {
  for (const [instant, expected] of [
    ["2026-11-09T15:59:59.999Z", "2026-11-09"], ["2026-11-09T16:00:00.000Z", "2026-11-10"],
    ["2026-12-31T15:59:59.999Z", "2026-12-31"], ["2026-12-31T16:00:00.000Z", "2027-01-01"],
    ["2028-02-28T16:00:00.000Z", "2028-02-29"], ["2028-02-29T16:00:00.000Z", "2028-03-01"],
  ]) assert.equal(trafficDay(Date.parse(instant)), expected);
});

test("concurrent SQLite connections deduplicate the same event and atomically preserve distinct views", async () => {
  const directory = mkdtempSync(join(tmpdir(), "glimmer-traffic-"));
  const path = join(directory, "traffic.sqlite");
  const sql = new DatabaseSync(path);
  const workers = [];
  try {
    sql.exec("PRAGMA journal_mode=WAL");
    sql.exec(migration);
    const start = new Int32Array(new SharedArrayBuffer(4));
    const sharedId = randomUUID();
    const now = Date.now();
    const day = trafficDay(now);
    const done = [];
    const ready = [];
    for (let index = 0; index < 6; index++) {
      const worker = new Worker(`
        const {parentPort, workerData} = require("node:worker_threads");
        const {DatabaseSync} = require("node:sqlite");
        const {randomUUID} = require("node:crypto");
        const db = new DatabaseSync(workerData.path);
        db.exec("PRAGMA busy_timeout = 10000");
        const insert = db.prepare(workerData.insertSql);
        parentPort.postMessage("ready");
        Atomics.wait(workerData.start, 0, 0);
        for (let i = 0; i < 10; i++) {
          insert.run(workerData.sharedId, workerData.now, workerData.day, "/", "direct", "desktop");
          if (i < 5) insert.run(randomUUID(), workerData.now + workerData.index + 1, workerData.day, "/", "direct", "desktop");
        }
        db.close();
      `, { eval: true, workerData: { path, start, sharedId, now, day, index, insertSql: trafficInsertSql } });
      workers.push(worker);
      ready.push(new Promise((resolve, reject) => { worker.once("message", resolve); worker.once("error", reject); }));
      done.push(new Promise((resolve, reject) => { worker.once("exit", code => code === 0 ? resolve() : reject(new Error(`worker exit ${code}`))); worker.once("error", reject); }));
    }
    await Promise.all(ready);
    Atomics.store(start, 0, 1);
    Atomics.notify(start, 0, 6);
    await Promise.all(done);
    assert.equal(sql.prepare("SELECT COUNT(*) AS n FROM traffic_receipts").get().n, 31);
    assert.deepEqual({ ...sql.prepare("SELECT views, first_seen_at, last_seen_at FROM traffic_daily").get() }, {
      views: 31, first_seen_at: now, last_seen_at: now + 6,
    });
  } finally {
    await Promise.all(workers.map(worker => worker.terminate()));
    sql.close();
    rmSync(directory, { recursive: true, force: true });
  }
});
