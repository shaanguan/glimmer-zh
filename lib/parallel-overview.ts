/** The fields needed here are a structural subset of the parallel-content rows. */
export type ParallelRow = {
  readonly kind: string;
  readonly zh: string;
  readonly en: string;
  readonly heading?: {readonly level: number} | null;
};

/**
 * Source overview fragments carry empty section/header/figure wrappers around
 * headings and prose. Remove only bare layout tags, never their text nodes.
 * Media fragments take a separate path so their original hidden markup survives.
 */
function unwrapEnglishLayout(html: string): string {
  return html.replace(/<\/?(?:section|header|figure)\s*>/gi, "");
}

/** Add readable paragraphs to the source's loose prose and standalone CTAs. */
function wrapEnglishText(html: string): string {
  const content = unwrapEnglishLayout(html);
  // Existing semantic blocks already provide layout; do not create nested <p>s.
  if (/<\/?(?:p|div|ul|ol|li|table|aside|h[1-6]|blockquote|pre)\b/i.test(content)) return content;

  const paragraph = (value: string) => value.trim() ? `<p>${value}</p>` : value;
  const links = /<a\b(?:[^"'<>]|"[^"]*"|'[^']*')*>[\s\S]*?<\/a\s*>/gi;
  let result = "", cursor = 0;
  for (const match of content.matchAll(links)) {
    result += paragraph(content.slice(cursor, match.index));
    result += paragraph(match[0]);
    cursor = match.index! + match[0].length;
  }
  return result + paragraph(content.slice(cursor));
}

/**
 * Reuse the Chinese media without contributing a single text character to the
 * English article. Keep media/link attributes, but do not duplicate source IDs.
 */
function sharedMedia(html: string): string {
  const tags = html.match(/<(?:[^"'<>]|"[^"]*"|'[^']*')*>/g) || [];
  return tags
    .filter(tag => /^<\/?(?:figure|picture|a|img|source|video)\b/i.test(tag))
    .map(tag => tag
      .replace(/\s+([^\s=/>]+)(?:\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+))?/g,
        (attribute, name: string) => name.toLowerCase() === "id" ? "" : attribute)
      .replace(/^<figure\b/i, '<figure data-overview-shared-media="true"'))
    .join("");
}

function renderRow(row: ParallelRow, language: "zh" | "en", promoteTitle = false): string {
  let html: string;
  if (language === "zh") {
    html = row.zh;
  } else if (row.kind === "media") {
    // Preserve the complete original fragment, including whitespace outside its
    // existing placeholder. Those characters are part of saved text offsets.
    html = sharedMedia(row.zh) +
      `<div hidden aria-hidden="true" data-overview-media-original="true">${row.en}</div>`;
  } else {
    html = row.kind === "text" ? wrapEnglishText(row.en) : unwrapEnglishLayout(row.en);
  }
  if (promoteTitle) {
    html = html.replace(/<h3(?=\s|>)/i, "<h1").replace(/<\/h3\s*>/i, "</h1>");
  }
  return html;
}

function renderIntro(rows: readonly ParallelRow[], language: "zh" | "en"): string {
  const heroIndex = rows.findIndex(row => row.kind === "media");
  const titleIndex = rows.findIndex(row => row.kind === "heading" && row.heading?.level === 3);
  const render = (row: ParallelRow, index: number) => renderRow(row, language, index === titleIndex);
  if (heroIndex < 0) {
    return `<section class="overview-intro"><div class="overview-intro-copy">${rows.map(render).join("")}</div></section>`;
  }

  const beforeHero = rows.slice(0, heroIndex).map(render).join("");
  const hero = renderRow(rows[heroIndex], language);
  const copy = rows.slice(heroIndex + 1)
    .map((row, index) => render(row, heroIndex + 1 + index)).join("");
  // The hero figure is a direct child: the existing image crop depends on it.
  return `<section class="overview-intro">${beforeHero}${hero}<div class="overview-intro-copy">${copy}</div></section>`;
}

function renderSection(rows: readonly ParallelRow[], language: "zh" | "en"): string {
  const firstMedia = rows.findIndex(row => row.kind === "media");
  if (firstMedia < 0) {
    return `<section class="overview-section">${rows.map(row => renderRow(row, language)).join("")}</section>`;
  }

  const introduction = rows.slice(0, firstMedia).map(row => renderRow(row, language)).join("");
  const cards: string[] = [];
  let card = "";
  for (const row of rows.slice(firstMedia)) {
    if (row.kind === "media" && card) {
      cards.push(`<div class="overview-card">${card}</div>`);
      card = "";
    }
    card += renderRow(row, language);
  }
  if (card) cards.push(`<div class="overview-card">${card}</div>`);
  return `<section class="overview-section">${introduction}<div class="overview-cards" data-count="${cards.length}">${cards.join("")}</div></section>`;
}

/**
 * Render one language at a time with the existing overview hero and card layout.
 * Every source text character remains in order, including hidden media text, so
 * existing language-specific text-position/text-quote bookmarks remain valid.
 */
export function formatParallelOverview(rows: readonly ParallelRow[], language: "zh" | "en"): string {
  if (!rows.length) return "";
  const intro: ParallelRow[] = [];
  const sections: ParallelRow[][] = [];
  let current = intro;
  for (const row of rows) {
    if (row.kind === "heading" && row.heading?.level === 2) {
      current = [];
      sections.push(current);
    }
    current.push(row);
  }
  return (intro.length ? renderIntro(intro, language) : "") +
    sections.map(section => renderSection(section, language)).join("");
}
