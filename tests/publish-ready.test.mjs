import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync, statSync} from "node:fs";
import {SITE_ORIGIN} from "../lib/site.ts";

const index = JSON.parse(readFileSync("content/source/index.json", "utf8"));
const sitemap = readFileSync("public/sitemap.xml", "utf8");
const robots = readFileSync("public/robots.txt", "utf8");
const headers = readFileSync("public/_headers", "utf8");
const wrangler = readFileSync("wrangler.jsonc", "utf8");

test("sitemap lists the public Chinese guide and skips private pages", () => {
  assert.match(sitemap, new RegExp(`<loc>${SITE_ORIGIN}/</loc>`));
  assert.match(sitemap, new RegExp(`<loc>${SITE_ORIGIN}/glossary</loc>`));
  for (const page of index) {
    if (page.slug === "overview") continue;
    assert.match(sitemap, new RegExp(`<loc>${SITE_ORIGIN}/guide/${page.slug}</loc>`));
  }
  assert.doesNotMatch(sitemap, /\/saved</);
  assert.equal(SITE_ORIGIN, "https://glimmer.zhoub.xyz");
});

test("robots advertises the sitemap and static assets stay cacheable", () => {
  assert.match(robots, /Sitemap: https:\/\/glimmer\.zhoub\.xyz\/sitemap\.xml/);
  assert.match(headers, /\/assets\/\*\s+Cache-Control: public, max-age=31536000, immutable/);
  assert.match(headers, /\/fonts\/\*/);
  assert.match(wrangler, /"pattern": "glimmer\.zhoub\.xyz"/);
  assert.match(wrangler, /"custom_domain": true/);
});

test("the moved Glimmer skill link is used and the hero image is the small WebP", () => {
  const color = readFileSync("content/zh/styles-color.json", "utf8");
  assert.match(color, /display-glasses-with-jetpack-compose-glimmer\/SKILL\.md/);
  assert.doesNotMatch(color, /display-ai-glasses-with-jetpack-compose-glimmer/);
  assert.match(color, /Jetpack Compose Glimmer 技能（Skill）/);
  const webp = statSync("public/assets/overview/hero-bridge.webp").size;
  const png = statSync("public/assets/original/fa92ea53-hero-full-v2.png").size;
  assert.ok(webp < png / 5, `hero webp ${webp} should be much smaller than png ${png}`);
  assert.match(readFileSync("lib/overview-assets.ts", "utf8"), /hero-bridge\.webp/);
});
