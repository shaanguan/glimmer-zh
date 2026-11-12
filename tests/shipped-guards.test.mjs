import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync, statSync} from "node:fs";
import {SITE_ORIGIN} from "../lib/site.ts";

const css = readFileSync("app/globals.css", "utf8");
const headers = readFileSync("public/_headers", "utf8");
const robots = readFileSync("public/robots.txt", "utf8");
const sitemap = readFileSync("public/sitemap.xml", "utf8");
const site = readFileSync("lib/site.ts", "utf8");
const layout = readFileSync("app/layout.tsx", "utf8");
const home = readFileSync("app/page.tsx", "utf8");
const guide = readFileSync("app/guide/[slug]/page.tsx", "utf8");
const glossary = readFileSync("app/glossary/page.tsx", "utf8");
const saved = readFileSync("app/saved/page.tsx", "utf8");
const color = readFileSync("content/zh/styles-color.json", "utf8");
const onboarding = readFileSync("content/zh/interaction-onboarding.json", "utf8");
const library = JSON.parse(readFileSync("content/library.json", "utf8"));
const cjk = '"PingFang SC", "Hiragino Sans GB", "Noto Sans SC", "Noto Sans CJK SC", "Source Han Sans SC", "Microsoft YaHei", "WenQuanYi Micro Hei", sans-serif';

test("the fixed Jetpack Compose Glimmer skill link is what readers see", () => {
  const fixed = "display-glasses-with-jetpack-compose-glimmer/SKILL.md";
  const removed = "display-ai-glasses-with-jetpack-compose-glimmer";
  assert.match(color, /Jetpack Compose Glimmer 技能（Skill）/);
  assert.ok(color.includes(fixed));
  assert.equal(color.includes(removed), false);
  const rendered = library.find(page => page.slug === "styles-color");
  assert.ok(rendered.body.includes(fixed));
  assert.equal(rendered.body.includes(removed), false);
});

test("Chinese keeps the Figma page names and the After Effects Master Color label", () => {
  for (const source of [onboarding, library.find(page => page.slug === "interaction-onboarding").body]) {
    assert.match(source, /<strong>Master Color<\/strong>（主颜色）/);
    assert.match(source, /<strong>Intelligent eyewear Welcome sequence<\/strong>（智能眼镜欢迎流程）/);
    assert.match(source, /<strong>Intelligent eyewear Instructional illustrations<\/strong>（智能眼镜教学插图）/);
  }
});

test("body text uses the CJK font stack and a 1.75 line height", () => {
  assert.match(css, new RegExp(`--font: "DM Sans", ${cjk.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`));
  assert.match(css, new RegExp(`--font-ui: "Inter", ${cjk.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`));
  assert.match(css, /html:lang\(zh-CN\)/);
  assert.match(css, /body \{[^}]*font-family: var\(--font\);[^}]*line-height: 1\.75/);
});

test("primary tap targets are 44px and 40px at a 390px viewport", () => {
  assert.match(css, /\.icon-toggle \{[^}]*width: 44px; height: 44px/);
  assert.match(css, /\.group-toggle \{[^}]*min-height: 44px/);
  assert.match(css, /\.group-links a \{[^}]*min-height: 44px/);
  assert.match(css, /\.brand \{ min-height: 44px; \}/);
  assert.match(css, /\.source-tab \{[^}]*min-height: 44px/);
  assert.match(css, /@media \(max-width: 820px\) \{\s*\.search-trigger \{ width: 44px; height: 44px/);
  assert.match(css, /@media \(max-width: 640px\) \{[\s\S]*?\.directory-toggle \{ width: 44px; height: 44px; \}/);
  assert.match(css, /@media \(max-width: 390px\) \{\s*\.directory-toggle, \.icon-toggle, \.search-trigger \{ width: 40px; height: 40px; min-width: 40px/);
});

test("mobile pages contain wide content instead of stretching the document", () => {
  assert.match(css, /img \{ max-width: 100%; \}/);
  assert.match(css, /\.site-main \{[^}]*min-width: 0/);
  assert.match(css, /\.reader-main \{ min-width: 0; \}/);
  assert.match(css, /\.reader-layout \{[^}]*minmax\(0, 800px\)/);
  assert.match(css, /\.article-content \{[^}]*overflow-wrap: break-word;[^}]*min-width: 0/);
  assert.match(css, /\.article-content \.table-scroll \{[^}]*max-width: 100%;[^}]*overflow-x: auto/);
  assert.match(css, /\.overview-cards \{[^}]*minmax\(0, 1fr\)/);
  assert.match(css, /\.overview-card \{[^}]*min-width: 0/);
});

test("the hero is the small WebP and the home page preloads it", () => {
  const webp = statSync("public/assets/overview/hero-bridge.webp").size;
  assert.ok(webp > 8 * 1024 && webp < 16 * 1024, `hero webp is ${webp} bytes, expected about 13KB`);
  assert.match(home, /rel="preload" as="image" href="\/assets\/overview\/hero-bridge\.webp" fetchPriority="high"/);
  assert.match(readFileSync("lib/overview-assets.ts", "utf8"), /src: "\/assets\/overview\/hero-bridge\.webp"/);
});

test("static assets are cached for one year", () => {
  for (const path of ["/assets/*", "/fonts/*", "/_next/static/*"]) {
    assert.match(headers, new RegExp(`${path.replaceAll("*", "\\*").replaceAll("/", "\\/")}\\s+Cache-Control: public, max-age=31536000, immutable`));
  }
});

test("every public page has a Chinese title, description, canonical, and share tags", () => {
  assert.equal(SITE_ORIGIN, "https://glimmer.zhoub.xyz");
  assert.match(layout, /metadataBase:new URL\(SITE_ORIGIN\)/);
  assert.match(site, /alternates: \{ canonical: path \}/);
  assert.match(site, /openGraph: \{[\s\S]*locale: "zh_CN"[\s\S]*images: \[\{ url: SHARE_IMAGE/);
  assert.match(site, /twitter: \{[\s\S]*card: "summary_large_image"/);
  assert.match(home, /pageMetadata\(\{title:SITE_TITLE,description:SITE_DESCRIPTION,path:"\/"\}\)/);
  assert.match(glossary, /title:"中英术语表 · Android AI 眼镜设计指南"/);
  assert.match(glossary, /description:"查阅面向无屏眼镜与带屏眼镜的 Android 应用设计术语，结合原文理解中文译法及其具体含义。"/);
  assert.match(saved, /title:"我的收藏 · Android AI 眼镜设计指南"/);
  assert.match(saved, /index:false/);
  assert.match(guide, /title:`\$\{page\.title\} · Android AI 眼镜设计指南`/);
  assert.match(guide, /description:`\$\{page\.description\} Android Developers 中文译本，面向无屏眼镜与带屏眼镜的 Android 应用体验设计。`/);
  assert.ok(library.length >= 34);
  for (const page of library) {
    assert.match(page.title, /\p{Script=Han}/u, page.slug);
    assert.match(page.description, /\p{Script=Han}/u, page.slug);
    assert.equal(page.title.includes(page.englishTitle), false);
  }
});

test("robots.txt and sitemap.xml advertise the public Chinese origin", () => {
  assert.match(robots, /Sitemap: https:\/\/glimmer\.zhoub\.xyz\/sitemap\.xml/);
  assert.match(sitemap, /<loc>https:\/\/glimmer\.zhoub\.xyz\/<\/loc>/);
  assert.match(sitemap, /<loc>https:\/\/glimmer\.zhoub\.xyz\/glossary<\/loc>/);
  for (const page of library) {
    if (page.slug === "overview") continue;
    assert.match(sitemap, new RegExp(`<loc>https://glimmer\\.zhoub\\.xyz/guide/${page.slug}</loc>`));
  }
  assert.doesNotMatch(sitemap, /\/saved</);
});
