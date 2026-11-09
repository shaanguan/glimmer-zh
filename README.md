# Android AI 眼镜设计指南 · 中文译本

A non-official, meaning-focused Chinese edition of Google Android AI Glasses design guidelines.
The 2026-11-09 source snapshot includes 33 guide pages and the original landing overview,
with original illustrations and audio/video examples. This is an independently edited,
AI-assisted translation, not an official Google translation.

## Content

- `content/source/`: live English snapshots with source URLs and original update dates.
- `content/zh/`: full Chinese translations. Extra interpretation is labeled `译者注`.
- `content/glossary.json`: 64 contextual English/Chinese terms, each linked to its relevant guide chapter.
- `content/library.json`: compiled reader/search content.
- `content/parallel.json`: source-ordered bilingual groups and alignment checks.
- `content/image-dimensions.json`: local image dimensions for stable loading placeholders.
- `public/assets/original/`: source media, preserved without semantic changes.
- `NOTICE` and `licenses/`: attribution, modification record, and applicable license information.

## Development

This project uses the Sites Vinext starter (React, Vite, and a Cloudflare Worker).
Use the package manager selected by the included execution profile. Run `pnpm dev`
for development and `pnpm build` for a production build in a compatible environment.
The hosting identity and bindings are preserved in the existing hosting manifest.

## Visual theme

`DESIGN.md` is the project theme contract, organized using the Awesome DESIGN.md
approach. Its LottieFiles visual reference is the public, independently measured
Sitepeel document, attributed to [Sitepeel (sitepeel.dev)](https://sitepeel.dev),
under CC BY 4.0. The original reference, license, and notice are preserved in
`design/reference/`. It is not the paid Catalog Pass file or an official
LottieFiles brand guideline. Chinese typography, reading density, contrast,
responsive layouts, and dark mode are documented project adaptations.

Open DM Sans and Inter Latin fonts are self-hosted in `public/fonts/`, alongside
their original SIL OFL licenses and source provenance. Chinese uses system fonts.

## Content maintenance

Install BeautifulSoup 4 and html5lib 1.1 in a Python environment. `scripts/fetch-sources.py` retrieves
the current official English pages and first-party source assets. Inspect the fetch
report and compare changes to the previous source snapshot. Update each affected
Chinese translation manually, preserving exact values, conditions, and normative
strength. Do not replace the translations with raw machine-translated Chinese.

After reviewed edits, run `python scripts/restore-source-layouts.py` to restore the
official column, example and tab groups recorded in `design/source-layouts.json`.
The script preserves all text and media positions and refuses stale content ranges;
if the upstream text changes, review and update the affected layout mapping first.
`python scripts/restore-source-layouts.py --check` verifies existing groups without writing.

Then run `python scripts/compile-content.py`, `python scripts/validate-content.py`,
`python scripts/generate-parallel.py`, and `python scripts/check-reading-content.py`,
in that order, before building. The content checks verify page coverage, local media,
internal links, heading IDs, and specification numbers. Numeric review notes require
human judgment; the check is not a substitute for semantic review. These checks preserve both languages’
complete text streams and the position of every illustration, caption, and table,
including the offsets used by existing passage bookmarks. Source updates are not
scheduled automatically.

## Source limitations recorded in this edition

- The Color page mixes HCT tone differences and contrast-ratio expressions. Preserve
  the source figures and consult its translator notes instead of equating the values.
- The Lists padding table contains `2d dp`; retained as an apparent source typo.
- Voice indicator alignment rules overlap for two lines; both source rules remain visible.
- Pager wording occasionally refers to Stack; terminology is clarified without
  silently changing the source's intended component.
- The original 18 px typography example assumes 30 pixels per degree.

Source URLs and dates are recorded in `content/source/`; attribution and license
records are in `NOTICE` and `licenses/`. Existing official media remains in its
original language; translated body text and captions provide context.

## Responsive reading

Comparison uses complete semantic groups, with headings and related explanation
or lists kept together. The compact language control cycles between Chinese, side-by-side comparison,
and English, including on portrait phones. Comparison typography adjusts within
readable limits to reduce height differences between corresponding text groups.
Chinese and English translations are never stacked vertically.
Shared illustrations remain in their original position, with one visible copy.
Chinese, English and comparison use the same overall reading width and margins.
Official image/text columns, paired examples and component variant tabs retain their
original spatial groups. These complete groups use a local language selector in
comparison mode; the original variant tabs remain keyboard accessible. Bookmark
restoration and contents navigation reveal the relevant language and tab without
replacing text nodes. The overview switches as a whole to preserve its hero and card
layout; tables use a local language selector and their own horizontal viewport.
Image placeholders reserve intrinsic dimensions, respect reduced-motion settings,
and offer a retry control after a failed request without adding bookmark text.

## Traffic analytics

The site records first-party page-view aggregates in its private Sites D1 database.
Collection starts with the deployment that enables the `DB` binding and traffic
migration; it cannot reconstruct visits before that deployment. The reader remains
public and the statistics do not add controls or explanatory copy to guide pages.

- **Metric:** one page view for each visible document load, reload, or actual
  back/forward-cache restoration. In-page headings, language changes, font settings,
  and browser visibility changes do not create extra views. A page view is not a
  unique visitor or session; there is no persistent visitor identifier.
- **Dimensions:** server-received day in `Asia/Shanghai`, canonical reader path,
  referring hostname, and approximate device category. Queries, fragments, full
  referrer URLs, raw user agents, IP addresses, accounts, search terms, and saved
  passage contents are not stored by the application analytics.
- **Source meaning:** `direct` means direct or unknown, including BFCache returns;
  `internal` means another page on this origin. Other values are hostname-only
  document referrers. These are page sources, not first-touch marketing attribution.
- **Privacy and delivery:** the client uses no analytics cookies or browser storage,
  respects DNT/GPC, and waits until a document is visible and no longer prerendered.
  It sends the same random event ID for at most two attempts within ten minutes.
  Privacy tools, offline visits, unsupported browsers, and JavaScript-disabled
  visits can be missing; known crawler signatures are excluded, not every bot.

`traffic_daily` contains the reportable aggregates. Sum `views` over the chosen days
for total PV, or group by `day`, `path`, `referrer`, or `device` for trends and rankings.
The table's primary key includes all four dimensions, so each row is one mutually
exclusive slice and must be summed rather than counted as a visit. `first_seen_at`
and `last_seen_at` are server timestamps in milliseconds. The short-lived
`traffic_receipts` table deduplicates delivery; records older than 24 hours become
eligible for deletion in batches of up to 100 on subsequent accepted requests.
Daily totals remain after receipt cleanup.

The owner can ask ChatGPT to read the site's database and analyze a chosen period,
or inspect the database in Sites settings. Read `traffic_daily`, not raw receipts,
and distinguish initial publication checks from organic traffic. There is no public
report endpoint: `/api/traffic` only accepts validated same-origin page-view POSTs.
Do not publish the database contents through a client-readable route.

For maintenance, use the standard Sites migration and publication workflow. Never
replay or rewrite an applied migration. Analytics validation is available through
`node --experimental-strip-types --test tests/traffic-*.test.mjs`.
