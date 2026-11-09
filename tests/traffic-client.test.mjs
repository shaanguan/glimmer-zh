import test from "node:test";
import assert from "node:assert/strict";
import {randomUUID} from "node:crypto";
import {setImmediate} from "node:timers/promises";
import {startTrafficCollection, trafficDevice, trafficPath, trafficReferrer} from "../lib/traffic-client.ts";

function surface(options = {}) {
  const requests = [];
  const browser = new EventTarget();
  const page = new EventTarget();
  Object.assign(browser, {
    location: new URL(options.url ?? "https://guide.example/guide/components-buttons?passage=private#details"),
    navigator: {userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X)", maxTouchPoints: 0, ...options.navigator},
    crypto: {randomUUID},
    fetch: (url, init) => {
      requests.push({url, init, data: JSON.parse(init.body)});
      return options.fetch ? options.fetch(requests.length) : Promise.resolve({ok: true, status: 204});
    },
  });
  Object.assign(page, {visibilityState: "visible", prerendering: false, referrer: "https://search.example/results?q=private", ...options.document});
  Object.defineProperty(browser, "localStorage", {get() {throw new Error("Analytics must not read browser storage");}});
  Object.defineProperty(browser, "sessionStorage", {get() {throw new Error("Analytics must not read browser storage");}});
  return {browser, page, requests};
}

function pageShow(browser, persisted) {
  const event = new Event("pageshow");
  Object.defineProperty(event, "persisted", {value: persisted});
  browser.dispatchEvent(event);
}

test("sends only a random view ID, canonical path, hostname and coarse device", async () => {
  const {browser, page, requests} = surface();
  const stop = startTrafficCollection(browser, page);
  await setImmediate();
  assert.equal(requests.length, 1);
  assert.deepEqual(Object.keys(requests[0].data).sort(), ["device", "eventId", "path", "referrer"]);
  assert.match(requests[0].data.eventId, /^[0-9a-f-]{36}$/);
  assert.equal(requests[0].data.path, "/guide/components-buttons");
  assert.equal(requests[0].data.referrer, "search.example");
  assert.equal(requests[0].data.device, "desktop");
  assert.equal(requests[0].url, "/api/traffic");
  assert.equal(requests[0].init.credentials, "omit");
  assert.equal(requests[0].init.referrerPolicy, "no-referrer");
  assert.equal(requests[0].init.mode, "cors");
  assert.equal(requests[0].init.keepalive, true);
  assert.equal(requests[0].init.body.includes("private"), false);
  stop();
});

test("effect replay and ordinary visibility, pageshow and hash events do not double count", async () => {
  const {browser, page, requests} = surface();
  startTrafficCollection(browser, page)();
  const stop = startTrafficCollection(browser, page);
  pageShow(browser, false);
  browser.dispatchEvent(new Event("hashchange"));
  page.dispatchEvent(new Event("visibilitychange"));
  await setImmediate();
  page.dispatchEvent(new Event("visibilitychange"));
  assert.equal(requests.length, 1);
  stop();
});

test("background and prerendered documents count only when actually displayed", async () => {
  const {browser, page, requests} = surface({document: {visibilityState: "hidden", prerendering: true}});
  const stop = startTrafficCollection(browser, page);
  assert.equal(requests.length, 0);
  page.prerendering = false;
  page.dispatchEvent(new Event("prerenderingchange"));
  assert.equal(requests.length, 0);
  page.visibilityState = "visible";
  page.dispatchEvent(new Event("visibilitychange"));
  await setImmediate();
  assert.equal(requests.length, 1);
  stop();
});

test("each actual BFCache return counts once with a fresh ID and unknown source", async () => {
  const {browser, page, requests} = surface();
  const stop = startTrafficCollection(browser, page);
  await setImmediate();
  pageShow(browser, true);
  page.dispatchEvent(new Event("visibilitychange"));
  await setImmediate();
  assert.equal(requests.length, 2);
  assert.notEqual(requests[0].data.eventId, requests[1].data.eventId);
  assert.equal(requests[1].data.referrer, "direct");
  stop();
});

test("network retry reuses the event ID and is bounded", async () => {
  const {browser, page, requests} = surface({fetch: () => Promise.reject(new Error("offline"))});
  const stop = startTrafficCollection(browser, page);
  await setImmediate();
  browser.dispatchEvent(new Event("online"));
  await setImmediate();
  page.dispatchEvent(new Event("visibilitychange"));
  browser.dispatchEvent(new Event("online"));
  assert.equal(requests.length, 2);
  assert.equal(requests[0].data.eventId, requests[1].data.eventId);
  stop();
});

test("retries expire before server receipts, while a new BFCache view gets a new window", async (t) => {
  t.mock.timers.enable({apis: ["Date"], now: 1794200000000});
  const {browser, page, requests} = surface({fetch: () => Promise.reject(new Error("offline"))});
  const stop = startTrafficCollection(browser, page);
  await setImmediate();
  t.mock.timers.tick(10 * 60 * 1000 + 1);
  browser.dispatchEvent(new Event("online"));
  assert.equal(requests.length, 1);
  pageShow(browser, true);
  assert.equal(requests.length, 2);
  assert.notEqual(requests[0].data.eventId, requests[1].data.eventId);
  stop();
});

test("a late request from before BFCache restoration cannot mark the new view as sent", async () => {
  let finishOld;
  const {browser, page, requests} = surface({fetch: (attempt) => attempt === 1
    ? new Promise(resolve => {finishOld = resolve;})
    : Promise.reject(new Error("offline"))});
  const stop = startTrafficCollection(browser, page);
  pageShow(browser, true);
  await setImmediate();
  finishOld({ok: true, status: 204});
  await setImmediate();
  browser.dispatchEvent(new Event("online"));
  assert.equal(requests.length, 3);
  assert.equal(requests[1].data.eventId, requests[2].data.eventId);
  assert.notEqual(requests[0].data.eventId, requests[2].data.eventId);
  stop();
});

test("privacy signals are honored initially and before retries", async () => {
  for (const navigator of [{globalPrivacyControl: true}, {doNotTrack: "1"}, {doNotTrack: "yes"}]) {
    const {browser, page, requests} = surface({navigator});
    const stop = startTrafficCollection(browser, page);
    assert.equal(requests.length, 0);
    stop();
  }
  const {browser, page, requests} = surface({fetch: () => Promise.reject(new Error("offline"))});
  const stop = startTrafficCollection(browser, page);
  await setImmediate();
  browser.navigator.globalPrivacyControl = true;
  browser.dispatchEvent(new Event("online"));
  assert.equal(requests.length, 1);
  stop();
});

test("development and non-reader paths are excluded", () => {
  for (const url of ["http://localhost:4173/", "https://guide.example/api/traffic", "https://guide.example/assets/image.png"]) {
    const {browser, page, requests} = surface({url});
    startTrafficCollection(browser, page)();
    assert.equal(requests.length, 0);
  }
  assert.equal(trafficPath("/guide/overview/"), "/");
  assert.equal(trafficPath("/saved/"), "/saved");
});

test("referrer minimization removes credentials, search strings, IPs and malformed URLs", () => {
  assert.equal(trafficReferrer("https://user:secret@news.example/private?token=secret#fragment", "https://guide.example"), "news.example");
  assert.equal(trafficReferrer("https://guide.example/saved?passage=private", "https://guide.example"), "internal");
  for (const value of ["", "broken", "file:///private/path", "https://127.0.0.1/private", "https://[::1]/", "https://invalid_host.example/"]) {
    assert.equal(trafficReferrer(value, "https://guide.example"), "direct", value);
  }
});

test("device classification is coarse and handles common tablet user agents", () => {
  assert.equal(trafficDevice("Mozilla/5.0 (iPhone; CPU iPhone OS) Mobile"), "mobile");
  assert.equal(trafficDevice("Mozilla/5.0 (Linux; Android 13) Mobile"), "mobile");
  assert.equal(trafficDevice("Mozilla/5.0 (Linux; Android 13)"), "tablet");
  assert.equal(trafficDevice("Mozilla/5.0 (Macintosh; Intel Mac OS X)", 5), "tablet");
  assert.equal(trafficDevice("Mozilla/5.0 (Windows NT 10.0)"), "desktop");
  assert.equal(trafficDevice(""), "unknown");
});
