/** Text-position + text-quote anchors. Offsets use DOM/JavaScript UTF-16 units. */
export type TextAnchor = {
  exact: string;
  prefix: string;
  suffix: string;
  start: number;
  end: number;
};

export type SavedPassage = {
  id: string;
  slug: string;
  language: "zh" | "en";
  quote: string;
  anchor: TextAnchor;
  sectionId: string;
  sectionTitle: string;
  createdAt: string;
};

export type TextPosition = {start: number; end: number};

export function createTextAnchor(text: string, start: number, end: number): TextAnchor {
  return {start, end, exact: text.slice(start, end), prefix: text.slice(Math.max(0, start - 64), start), suffix: text.slice(end, end + 64)};
}

function locateExact(text: string, anchor: TextAnchor): TextPosition | null {
  if (!anchor.exact) return null;
  const contextMatches = (start: number) =>
    text.slice(Math.max(0, start - anchor.prefix.length), start) === anchor.prefix &&
    text.slice(start + anchor.exact.length, start + anchor.exact.length + anchor.suffix.length) === anchor.suffix;
  if (anchor.start >= 0 && text.slice(anchor.start, anchor.end) === anchor.exact && contextMatches(anchor.start)) {
    return {start: anchor.start, end: anchor.end};
  }
  const matches: number[] = [];
  let at = text.indexOf(anchor.exact);
  while (at !== -1) {
    if (contextMatches(at)) matches.push(at);
    at = text.indexOf(anchor.exact, at + 1);
  }
  // A surviving copy elsewhere is not evidence that the original passage survived.
  // Recover only a unique match with the saved context; never rank partial matches.
  if (matches.length !== 1) return null;
  return {start: matches[0], end: matches[0] + anchor.exact.length};
}

function normalizeWithMap(text: string) {
  let normalized = "";
  const starts: number[] = [], ends: number[] = [];
  for (let i = 0; i < text.length; i++) {
    if (/\s/.test(text[i])) {
      if (normalized.endsWith(" ")) { ends[ends.length - 1] = i + 1; continue; }
      normalized += " ";
    } else normalized += text[i];
    starts.push(i); ends.push(i + 1);
  }
  return {text: normalized, starts, ends};
}

export function resolveTextAnchor(text: string, anchor: TextAnchor): TextPosition | null {
  const exact = locateExact(text, anchor);
  if (exact) return exact;
  // Whitespace-only markup changes are safe to recover; semantic/fuzzy replacements are not.
  const normalized = normalizeWithMap(text);
  const normalizedExact = normalizeWithMap(anchor.exact).text;
  if (!normalizedExact.trim()) return null;
  const result = locateExact(normalized.text, {
    ...anchor, start: -1, end: -1, exact: normalizedExact,
    prefix: normalizeWithMap(anchor.prefix).text, suffix: normalizeWithMap(anchor.suffix).text,
  });
  if (!result) return null;
  return {start: normalized.starts[result.start], end: normalized.ends[result.end - 1]};
}

export function rangeFromOffsets(article: HTMLElement, position: TextPosition): Range | null {
  const walker = document.createTreeWalker(article, NodeFilter.SHOW_TEXT);
  let offset = 0;
  let startNode: Text | null = null, endNode: Text | null = null;
  let startOffset = 0, endOffset = 0;
  let node: Node | null;
  while ((node = walker.nextNode())) {
    const text = node as Text;
    const next = offset + text.length;
    if (!startNode && position.start < next) { startNode = text; startOffset = Math.max(0, position.start - offset); }
    if (startNode && position.end <= next) { endNode = text; endOffset = Math.max(0, position.end - offset); break; }
    offset = next;
  }
  if (!startNode || !endNode || position.end <= position.start) return null;
  const range = document.createRange();
  range.setStart(startNode, startOffset); range.setEnd(endNode, endOffset);
  return range;
}

export function anchorFromRange(article: HTMLElement, range: Range): TextAnchor | null {
  if (!article.contains(range.startContainer) || !article.contains(range.endContainer)) return null;
  const raw = range.toString();
  const exact = raw.trim();
  if (!exact) return null;
  const before = document.createRange();
  before.selectNodeContents(article);
  before.setEnd(range.startContainer, range.startOffset);
  const start = before.toString().length + raw.length - raw.trimStart().length;
  return createTextAnchor(article.textContent || "", start, start + exact.length);
}

export function sectionForRange(article: HTMLElement, range: Range) {
  let sectionId = "", sectionTitle = "";
  for (const heading of article.querySelectorAll<HTMLElement>("h2[id],h3[id],h4[id]")) {
    if (heading.contains(range.startContainer) || (heading.compareDocumentPosition(range.startContainer) & Node.DOCUMENT_POSITION_FOLLOWING)) {
      sectionId = heading.id; sectionTitle = heading.textContent || "";
    } else break;
  }
  return {sectionId, sectionTitle};
}

export function passageHref(passage: SavedPassage) {
  const pathname=passage.slug==="overview"?"/":`/guide/${encodeURIComponent(passage.slug)}`;
  return `${pathname}?passage=${encodeURIComponent(passage.id)}${passage.sectionId ? `#${encodeURIComponent(passage.sectionId)}` : ""}`;
}

export function isSamePassage(a: Pick<SavedPassage,"slug"|"language"|"anchor">, b: Pick<SavedPassage,"slug"|"language"|"anchor">) {
  return a.slug === b.slug && a.language === b.language && a.anchor.exact === b.anchor.exact &&
    a.anchor.start === b.anchor.start && a.anchor.end === b.anchor.end &&
    a.anchor.prefix === b.anchor.prefix && a.anchor.suffix === b.anchor.suffix;
}
