#!/usr/bin/env node
/**
 * Crawl a Glimmer origin and compare status, internal links, and screenshots
 * with the saved baseline.
 *
 *   pnpm regress -- --base https://glimmer.zhoub.xyz
 *   pnpm regress -- --base https://glimmer.zhoub.xyz --update --screenshots <dir>
 *
 * The status/link baseline lives in tests/regress-baseline.json.
 * Screenshots are compared only when --screenshot-baseline points at a directory
 * produced by an earlier run (they are large and stay out of git).
 */
import {accessSync, constants, existsSync, mkdirSync, readFileSync, writeFileSync} from "node:fs";
import {dirname, join} from "node:path";
import {fileURLToPath} from "node:url";
import {deflateSync, inflateSync} from "node:zlib";
import {chromium} from "playwright-core";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const DEFAULT_BASELINE = join(ROOT, "tests", "regress-baseline.json");
const PUBLIC_ORIGINS = new Set(["https://glimmer.zhoub.xyz", "http://glimmer.zhoub.xyz"]);
const NON_HTML = new Set(["/robots.txt", "/sitemap.xml", "/og.png"]);
const VIEWPORTS = [
  {name: "1280", width: 1280, height: 800},
  {name: "390", width: 390, height: 844},
];
const PIXEL_TOLERANCE = 24;
const MISMATCH_LIMIT = 0.002;

function parseArgs(argv) {
  const args = {
    base: "",
    baseline: DEFAULT_BASELINE,
    update: false,
    screenshots: "",
    screenshotBaseline: "",
    only: "",
    help: false,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const value = () => {
      const next = argv[++index];
      if (!next || next.startsWith("--")) throw new Error(`Missing value for ${arg}`);
      return next;
    };
    if (arg === "--base") args.base = value().replace(/\/$/, "");
    else if (arg === "--baseline") args.baseline = value();
    else if (arg === "--update") args.update = true;
    else if (arg === "--screenshots") args.screenshots = value();
    else if (arg === "--screenshot-baseline") args.screenshotBaseline = value();
    else if (arg === "--only") args.only = value();
    else if (arg === "--help" || arg === "-h") args.help = true;
    else throw new Error(`Unknown argument ${arg}`);
  }
  return args;
}

function help() {
  console.log(`Usage: pnpm regress -- --base <url> [--update] [--baseline <file>] [--screenshots <dir>] [--screenshot-baseline <dir>]`);
}

function chromePath() {
  const candidates = [process.env.CHROME_PATH, "/usr/bin/google-chrome", "/usr/bin/google-chrome-stable", "/usr/bin/chromium"];
  for (const candidate of candidates) {
    if (!candidate) continue;
    try {
      accessSync(candidate, constants.X_OK);
      return candidate;
    } catch {}
  }
  return undefined;
}

function internalPath(raw, pageOrigin) {
  if (!raw) return null;
  const trimmed = raw.trim();
  if (!trimmed || trimmed.startsWith("#") || /^(?:mailto:|tel:|javascript:|data:)/i.test(trimmed)) return null;
  let url;
  try {
    url = new URL(trimmed, pageOrigin);
  } catch {
    return null;
  }
  if (url.origin !== pageOrigin && !PUBLIC_ORIGINS.has(url.origin)) return null;
  if (/^\/(?:_next|cdn-cgi|api)(?:\/|$)/.test(url.pathname)) return null;
  const path = url.pathname.length > 1 ? url.pathname.replace(/\/$/, "") : url.pathname;
  return path + url.search;
}

async function mapPool(items, limit, worker) {
  const results = new Array(items.length);
  let cursor = 0;
  async function run() {
    while (cursor < items.length) {
      const index = cursor;
      cursor += 1;
      results[index] = await worker(items[index]);
    }
  }
  await Promise.all(Array.from({length: Math.min(limit, items.length)}, () => run()));
  return results;
}

async function fetchStatus(url) {
  const response = await fetch(url, {redirect: "follow", signal: AbortSignal.timeout(45000)});
  const status = response.status;
  const redirected = response.url !== url && new URL(response.url).pathname !== new URL(url).pathname;
  await response.body?.cancel();
  return {status, redirected};
}

async function settle(page) {
  await page.evaluate(async () => {
    const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));
    const step = Math.max(window.innerHeight * 0.85, 280);
    for (let y = 0; y < document.documentElement.scrollHeight; y += step) {
      window.scrollTo(0, y);
      await sleep(20);
    }
    window.scrollTo(0, document.documentElement.scrollHeight);
    await Promise.race([
      Promise.all([...document.images].map(image => image.complete ? null : new Promise(resolve => {
        image.addEventListener("load", resolve, {once: true});
        image.addEventListener("error", resolve, {once: true});
      }))),
      sleep(12000),
    ]);
    if (document.fonts?.ready) await document.fonts.ready;
    document.querySelectorAll("video").forEach(video => {
      video.pause();
      try { video.currentTime = 0; } catch {}
    });
    window.scrollTo(0, 0);
  });
  await page.waitForFunction(() => document.querySelectorAll(".image-frame.is-loading").length === 0, null, {timeout: 12000}).catch(() => {});
}

async function collectLinks(page, origin) {
  const raw = await page.evaluate(() => {
    const values = [];
    const take = (value) => { if (value) values.push(value); };
    for (const element of document.querySelectorAll("a[href], area[href], link[href], img[src], source[src], video[src], audio[src], video[poster], image[href]")) {
      take(element.getAttribute("href"));
      take(element.getAttribute("src"));
      take(element.getAttribute("poster"));
    }
    for (const element of document.querySelectorAll("[srcset]")) {
      for (const part of (element.getAttribute("srcset") || "").split(",")) take(part.trim().split(/\s+/)[0]);
    }
    for (const element of document.querySelectorAll('meta[property="og:image"], meta[name="twitter:image"]')) take(element.getAttribute("content"));
    return values;
  });
  return [...new Set(raw.map(value => internalPath(value, origin)).filter(Boolean))].sort();
}

function shotPath(directory, viewport, routePath) {
  const slug = routePath === "/" ? "index" : routePath.replace(/^\//, "").replace(/[^a-z0-9]+/gi, "-").replace(/^-|-$/g, "");
  return join(directory, viewport, `${slug}.png`);
}

function crc32(bytes) {
  let crc = ~0;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
  }
  return ~crc >>> 0;
}

function pngChunk(type, data) {
  const body = Buffer.concat([Buffer.from(type), data]);
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([length, body, crc]);
}

function decodePng(buffer) {
  const bytes = Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer);
  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  if (!bytes.subarray(0, 8).equals(signature)) throw new Error("Not a PNG");
  let width = 0;
  let height = 0;
  let colorType = 0;
  const idat = [];
  let offset = 8;
  while (offset + 8 <= bytes.length) {
    const length = bytes.readUInt32BE(offset);
    const type = bytes.toString("ascii", offset + 4, offset + 8);
    const data = bytes.subarray(offset + 8, offset + 8 + length);
    offset += 12 + length;
    if (type === "IHDR") {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      if (data[8] !== 8 || data[12] !== 0) throw new Error("Unsupported PNG bit depth or interlace");
      colorType = data[9];
    } else if (type === "IDAT") idat.push(data);
    else if (type === "IEND") break;
  }
  const channels = {2: 3, 6: 4}[colorType];
  if (!channels) throw new Error(`Unsupported PNG color type ${colorType}`);
  const inflated = inflateSync(Buffer.concat(idat));
  const stride = width * channels;
  const rgba = new Uint8Array(width * height * 4);
  let source = 0;
  let previous = new Uint8Array(stride);
  const paeth = (left, up, upLeft) => {
    const estimate = left + up - upLeft;
    const leftDistance = Math.abs(estimate - left);
    const upDistance = Math.abs(estimate - up);
    const diagonal = Math.abs(estimate - upLeft);
    if (leftDistance <= upDistance && leftDistance <= diagonal) return left;
    return upDistance <= diagonal ? up : upLeft;
  };
  for (let y = 0; y < height; y += 1) {
    const filter = inflated[source];
    source += 1;
    const row = inflated.subarray(source, source + stride);
    source += stride;
    const current = new Uint8Array(stride);
    for (let index = 0; index < stride; index += 1) {
      const left = index >= channels ? current[index - channels] : 0;
      const up = previous[index];
      const upLeft = index >= channels ? previous[index - channels] : 0;
      let value = row[index];
      if (filter === 1) value += left;
      else if (filter === 2) value += up;
      else if (filter === 3) value += (left + up) >> 1;
      else if (filter === 4) value += paeth(left, up, upLeft);
      else if (filter !== 0) throw new Error(`Bad PNG filter ${filter}`);
      current[index] = value & 255;
    }
    for (let x = 0; x < width; x += 1) {
      const from = x * channels;
      const to = (y * width + x) * 4;
      rgba[to] = current[from];
      rgba[to + 1] = current[from + 1];
      rgba[to + 2] = current[from + 2];
      rgba[to + 3] = channels === 4 ? current[from + 3] : 255;
    }
    previous = current;
  }
  return {width, height, rgba};
}

function encodePng(width, height, rgba) {
  const stride = width * 4;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y += 1) {
    raw[y * (stride + 1)] = 0;
    Buffer.from(rgba.buffer, rgba.byteOffset + y * stride, stride).copy(raw, y * (stride + 1) + 1);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    pngChunk("IHDR", ihdr),
    pngChunk("IDAT", deflateSync(raw)),
    pngChunk("IEND", Buffer.alloc(0)),
  ]);
}

function compareShots(actualFile, expectedFile, diffFile) {
  const actual = readFileSync(actualFile);
  const expected = readFileSync(expectedFile);
  if (actual.equals(expected)) return {identical: true, ratio: 0, width: 0, height: 0};
  const left = decodePng(actual);
  const right = decodePng(expected);
  if (left.width !== right.width || left.height !== right.height) {
    return {identical: false, ratio: 1, width: left.width, height: left.height, expectedWidth: right.width, expectedHeight: right.height};
  }
  let mismatched = 0;
  const diff = new Uint8Array(left.rgba.length);
  for (let index = 0; index < left.rgba.length; index += 4) {
    const delta = Math.max(
      Math.abs(left.rgba[index] - right.rgba[index]),
      Math.abs(left.rgba[index + 1] - right.rgba[index + 1]),
      Math.abs(left.rgba[index + 2] - right.rgba[index + 2]),
      Math.abs(left.rgba[index + 3] - right.rgba[index + 3]),
    );
    const changed = delta > PIXEL_TOLERANCE;
    if (changed) mismatched += 1;
    const pixel = index;
    diff[pixel] = changed ? 220 : left.rgba[pixel];
    diff[pixel + 1] = changed ? 40 : left.rgba[pixel + 1];
    diff[pixel + 2] = changed ? 40 : left.rgba[pixel + 2];
    diff[pixel + 3] = 255;
  }
  const ratio = mismatched / (left.width * left.height);
  if (ratio > 0) {
    mkdirSync(dirname(diffFile), {recursive: true});
    writeFileSync(diffFile, encodePng(left.width, left.height, diff));
  }
  return {identical: false, ratio, mismatched, width: left.width, height: left.height};
}

function sameList(left, right) {
  if (left.length !== right.length) return false;
  return left.every((value, index) => value === right[index]);
}

function compareReports(actual, expected) {
  const problems = [];
  const actualRoutes = new Map(actual.routes.map(route => [route.path, route]));
  const expectedRoutes = new Map(expected.routes.map(route => [route.path, route]));
  for (const [path, route] of expectedRoutes) {
    const found = actualRoutes.get(path);
    if (!found) {
      problems.push(`missing route ${path}`);
      continue;
    }
    if (found.status !== route.status || found.redirected !== route.redirected) {
      problems.push(`${path} status ${route.status}${route.redirected ? " redirect" : ""} -> ${found.status}${found.redirected ? " redirect" : ""}`);
    }
    if (!sameList(found.links, route.links)) {
      const removed = route.links.filter(link => !found.links.includes(link));
      const added = found.links.filter(link => !route.links.includes(link));
      problems.push(`${path} links changed${removed.length ? ` removed ${removed.join(", ")}` : ""}${added.length ? ` added ${added.join(", ")}` : ""}`);
    }
  }
  for (const path of actualRoutes.keys()) {
    if (!expectedRoutes.has(path)) problems.push(`unexpected route ${path}`);
  }
  const actualResources = new Map(actual.resources.map(resource => [resource.path, resource]));
  const expectedResources = new Map(expected.resources.map(resource => [resource.path, resource]));
  for (const [path, resource] of expectedResources) {
    const found = actualResources.get(path);
    if (!found) problems.push(`missing resource ${path}`);
    else if (found.status !== resource.status || found.redirected !== resource.redirected) {
      problems.push(`${path} ${resource.status} -> ${found.status}`);
    }
  }
  for (const path of actualResources.keys()) {
    if (!expectedResources.has(path)) problems.push(`unexpected resource ${path}`);
  }
  for (const route of actual.routes) if (route.status >= 400) problems.push(`${route.path} returned ${route.status}`);
  for (const resource of actual.resources) if (resource.status >= 400) problems.push(`${resource.path} returned ${resource.status}`);
  return [...new Set(problems)];
}

async function crawl(base, {only, screenshots}) {
  const origin = new URL(base).origin;
  const sitemapResponse = await fetch(new URL("/sitemap.xml", origin), {signal: AbortSignal.timeout(45000)});
  if (!sitemapResponse.ok) throw new Error(`sitemap.xml returned ${sitemapResponse.status}`);
  const sitemap = await sitemapResponse.text();
  const discovered = [...sitemap.matchAll(/<loc>\s*([^<\s]+)\s*<\/loc>/g)].map(match => new URL(match[1], origin).pathname.replace(/\/$/, "") || "/");
  const routePaths = [...new Set([...discovered, ...NON_HTML])];
  const selected = only ? routePaths.filter(path => path === only) : routePaths;
  if (only && selected.length === 0) throw new Error(`--only ${only} is not in the sitemap or static routes`);

  const executablePath = chromePath();
  if (!executablePath) throw new Error("Google Chrome was not found. Set CHROME_PATH.");
  const browser = await chromium.launch({
    executablePath,
    headless: true,
    args: ["--no-sandbox", "--disable-dev-shm-usage", "--disable-gpu"],
  });
  const routes = [];
  try {
    const context = await browser.newContext({
      viewport: {width: VIEWPORTS[0].width, height: VIEWPORTS[0].height},
      deviceScaleFactor: 1,
      locale: "zh-CN",
      timezoneId: "Asia/Shanghai",
      reducedMotion: "reduce",
    });
    const page = await context.newPage();
    page.setDefaultTimeout(60000);
    await page.addInitScript(() => {
      const style = document.createElement("style");
      style.textContent = "*,*::before,*::after{animation:none!important;transition:none!important;caret-color:transparent!important}html{scroll-behavior:auto!important}";
      document.documentElement.appendChild(style);
    });
    for (const path of selected) {
      if (NON_HTML.has(path)) {
        const result = await fetchStatus(new URL(path, origin));
        routes.push({path, status: result.status, redirected: result.redirected, links: []});
        console.log(`${result.status} ${path}`);
        continue;
      }
      await page.setViewportSize({width: VIEWPORTS[0].width, height: VIEWPORTS[0].height});
      const response = await page.goto(new URL(path, origin).href, {waitUntil: "load", timeout: 60000});
      await settle(page);
      const status = response?.status() ?? 0;
      const redirected = Boolean(response?.request().redirectedFrom());
      const links = await collectLinks(page, origin);
      if (screenshots) {
        for (const viewport of VIEWPORTS) {
          await page.setViewportSize({width: viewport.width, height: viewport.height});
          if (viewport.name !== VIEWPORTS[0].name) await settle(page);
          const file = shotPath(screenshots, viewport.name, path);
          mkdirSync(dirname(file), {recursive: true});
          try {
            await page.screenshot({path: file, fullPage: true, animations: "disabled", type: "png"});
          } catch (error) {
            throw new Error(`screenshot ${viewport.name} ${path} failed: ${error instanceof Error ? error.message : error}`);
          }
        }
      }
      routes.push({path, status, redirected, links});
      console.log(`${status} ${path}  links ${links.length}${screenshots ? "  shot" : ""}`);
    }
    await context.close();
  } finally {
    await browser.close();
  }

  const routeSet = new Set(routePaths);
  const resourcePaths = [...new Set(routes.flatMap(route => route.links))].filter(path => !routeSet.has(path)).sort();
  const resources = await mapPool(resourcePaths, 8, async path => {
    try {
      const result = await fetchStatus(new URL(path, origin));
      return {path, status: result.status, redirected: result.redirected};
    } catch (error) {
      return {path, status: 0, redirected: false, error: error instanceof Error ? error.message : String(error)};
    }
  });
  for (const resource of resources) {
    if (resource.status >= 400 || resource.status === 0) console.log(`${resource.status || "ERR"} ${resource.path}`);
  }
  return {
    version: 1,
    source: origin,
    generatedAt: new Date().toISOString(),
    routes,
    resources: resources.map(({path, status, redirected}) => ({path, status, redirected})),
  };
}

async function compareScreenshots(report, screenshots, baselineDir) {
  const problems = [];
  if (!baselineDir) return problems;
  for (const route of report.routes) {
    if (NON_HTML.has(route.path)) continue;
    for (const viewport of VIEWPORTS) {
      const actual = shotPath(screenshots, viewport.name, route.path);
      const expected = shotPath(baselineDir, viewport.name, route.path);
      if (!existsSync(expected)) {
        problems.push(`missing baseline screenshot ${viewport.name} ${route.path}`);
        continue;
      }
      if (!existsSync(actual)) {
        problems.push(`missing screenshot ${viewport.name} ${route.path}`);
        continue;
      }
      const diff = shotPath(screenshots, `diff-${viewport.name}`, route.path);
      const result = compareShots(actual, expected, diff);
      if (result.expectedWidth) {
        problems.push(`${viewport.name} ${route.path} size ${result.width}x${result.height} != ${result.expectedWidth}x${result.expectedHeight}`);
      } else if (result.ratio > MISMATCH_LIMIT) {
        problems.push(`${viewport.name} ${route.path} visual mismatch ${(result.ratio * 100).toFixed(2)}% (${diff})`);
      } else if (result.ratio > 0) {
        console.log(`visual ok ${viewport.name} ${route.path} ${(result.ratio * 100).toFixed(3)}% within tolerance`);
      }
    }
  }
  return problems;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    help();
    return;
  }
  if (!args.base) throw new Error("--base is required");
  const report = await crawl(args.base, args);
  const bad = [...report.routes, ...report.resources].filter(item => item.status >= 400 || item.status === 0);
  if (args.update) {
    if (args.only) throw new Error("--update cannot be combined with --only");
    mkdirSync(dirname(args.baseline), {recursive: true});
    writeFileSync(args.baseline, `${JSON.stringify(report, null, 2)}\n`);
    console.log(`wrote ${args.baseline} (${report.routes.length} routes, ${report.resources.length} resources)`);
  } else if (!existsSync(args.baseline)) {
    throw new Error(`Baseline not found at ${args.baseline}. Generate it with --update.`);
  } else {
    const baseline = JSON.parse(readFileSync(args.baseline, "utf8"));
    const compared = args.only ? {...report, routes: report.routes} : report;
    const expected = args.only ? {...baseline, routes: baseline.routes.filter(route => route.path === args.only), resources: baseline.resources} : baseline;
    const problems = compareReports(compared, expected);
    problems.push(...await compareScreenshots(report, args.screenshots, args.screenshotBaseline));
    if (problems.length) {
      console.error(`\n${problems.length} regression${problems.length === 1 ? "" : "s"}:`);
      for (const problem of problems) console.error(`- ${problem}`);
      process.exitCode = 1;
      return;
    }
    console.log(`no status or link regressions against ${args.baseline}`);
  }
  if (bad.length && !args.update) {
    console.error(`${bad.length} responses were 4xx/5xx`);
    process.exitCode = 1;
  } else if (bad.length) {
    console.error(`${bad.length} baseline responses were 4xx/5xx; the snapshot was still written`);
    process.exitCode = 1;
  }
}

main().catch(error => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
