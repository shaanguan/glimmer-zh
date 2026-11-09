import type {SavedPassage} from "./passage-anchors";

export const PASSAGES_KEY = "jingshang-passages-v1";
type ReadStorage = Pick<Storage,"getItem">;
type WriteStorage = Pick<Storage,"setItem">;

export function isSavedPassage(value: unknown): value is SavedPassage {
  if (!value || typeof value !== "object") return false;
  const p = value as SavedPassage;
  return typeof p.id === "string" && /^[a-zA-Z0-9_-]+$/.test(p.id) &&
    typeof p.slug === "string" && /^[a-z0-9-]+$/.test(p.slug) &&
    (p.language === "zh" || p.language === "en") &&
    typeof p.quote === "string" && !!p.quote.trim() &&
    typeof p.sectionId === "string" && typeof p.sectionTitle === "string" &&
    typeof p.createdAt === "string" && Number.isFinite(Date.parse(p.createdAt)) &&
    !!p.anchor && typeof p.anchor === "object" &&
    typeof p.anchor.exact === "string" && !!p.anchor.exact.trim() &&
    typeof p.anchor.prefix === "string" && typeof p.anchor.suffix === "string" &&
    Number.isInteger(p.anchor.start) && Number.isInteger(p.anchor.end) &&
    p.anchor.start >= 0 && p.anchor.end > p.anchor.start;
}

export function readPassages(storage: ReadStorage = localStorage): SavedPassage[] {
  const raw = storage.getItem(PASSAGES_KEY);
  if (!raw) return [];
  const data: unknown = JSON.parse(raw);
  if (!Array.isArray(data)) throw new Error("Invalid saved-passage data");
  if (!data.every(isSavedPassage)) throw new Error("Invalid saved-passage record");
  const ids = new Set<string>();
  return data.filter(p => {if (ids.has(p.id)) return false; ids.add(p.id); return true;})
    .sort((a,b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));
}

export function writePassages(passages: SavedPassage[], storage: WriteStorage = localStorage) {
  // Write before updating React state: a quota/privacy failure must never look like success.
  storage.setItem(PASSAGES_KEY, JSON.stringify(passages));
}
