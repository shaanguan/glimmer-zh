export type ReadingLanguage = "zh" | "en";

export type SourceLayout = {id: string; columns: 2 | 3 | 4 | 5; kind?: "tabs"};

export type ParallelRow = {
  id: string;
  kind: "heading" | "text" | "media" | "table" | "layout" | "note";
  zh: string;
  en: string;
  sectionId?: string | null;
  heading?: {id: string; level: number; zh: string; en: string};
  layout?: SourceLayout;
};

export type ReadingGroup = {
  id: string;
  kind: "text" | "media" | "table" | "layout";
  zh: {__html: string};
  en: {__html: string};
  caption: boolean;
  layout?: SourceLayout;
};

/** Keep the native table intact; only its viewport scrolls on a small screen. */
export function wrapTables(html: string, language: ReadingLanguage): string {
  return html.replace(/<table\b[^>]*>[\s\S]*?<\/table\s*>/gi, table =>
    `<div class="table-scroll" role="region" aria-label="${language === "zh" ? "表格，可横向滚动" : "Table, scroll horizontally"}" tabindex="0">${table}</div>`,
  );
}

/** A heading and its explanation/list form one comparison group. Media and
 * tables and source layouts are boundaries, never arbitrary paragraph-count matches. */
export function readingGroups(rows: readonly ParallelRow[], localize: (html: string) => string): ReadingGroup[] {
  const result: ReadingGroup[] = [];
  let pending: ParallelRow[] = [];
  let hasBody = false;
  const flush = () => {
    if (!pending.length) return;
    const zh = pending.map(row => row.zh).join("");
    const en = pending.map(row => row.en).join("");
    result.push({id: pending[0].id, kind: "text", zh: {__html: localize(zh)}, en: {__html: localize(en)},
      caption: /<figcaption\b/i.test(zh) && !pending.some(row => row.kind === "heading")});
    pending = [];
    hasBody = false;
  };
  for (const row of rows) {
    if (row.kind === "media" || row.kind === "table" || row.kind === "layout") {
      flush();
      result.push({id: row.id, kind: row.kind, caption: false, layout: row.layout,
        zh: {__html: wrapTables(localize(row.zh), "zh")},
        en: {__html: wrapTables(localize(row.en), "en")}});
    } else {
      if (row.kind === "heading" && hasBody) flush();
      pending.push(row);
      if (row.kind !== "heading" && /\S/.test((row.zh + row.en).replace(/<[^>]*>/g, ""))) hasBody = true;
    }
  }
  flush();
  return result;
}
