"use client";

import {useEffect, type RefObject} from "react";

type Language = "zh" | "en";
type Typography = {font: number; line: number};
type Settings = {zh: Typography; en: Typography};
type Pair = {
  zh: HTMLElement; en: HTMLElement; initial: Settings;
  taller: Language; gap: number; score: number; best?: Settings;
};
type OriginalStyle = {font: string; line: string; fontPriority: string; linePriority: string};

const FONT = "--pair-font-size", LINE = "--pair-line-height";
// Taller-side font/leading changes, followed by shorter-side changes.
// Each profile is measured across all eligible groups in one write/read batch.
const PROFILES = [
  [0, -.05, 0, 0],
  [-.5, -.05, 0, 0],
  [-1, -.1, 0, 0],
  [-2, -.15, 0, 0],
  [0, 0, .5, .05],
  [-.5, -.05, .5, .05],
  [-1, -.1, .5, .05],
] as const;

function typography(element: HTMLElement, fontSize: number, language: Language): Typography {
  const style = getComputedStyle(element);
  const font = parseFloat(style.fontSize) || fontSize;
  return {font, line: parseFloat(style.lineHeight) / font || (language === "zh" ? 1.9 : 1.8)};
}

function bodyLength(element: HTMLElement): number {
  const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
  let length = 0, node: Node | null;
  while ((node = walker.nextNode())) {
    if (node.parentElement?.closest("h1,h2,h3,h4,h5,h6,[hidden],[aria-hidden='true'],script,style")) continue;
    length += (node.textContent || "").replace(/\s/g, "").length;
  }
  return length;
}

function headingHeight(element: HTMLElement): number {
  return [...element.querySelectorAll<HTMLElement>("h1,h2,h3,h4,h5,h6")]
    .reduce((total, heading) => total + heading.getBoundingClientRect().height, 0);
}

function bounded(base: Typography, language: Language, fontSize: number, fontDelta: number, lineDelta: number): Typography {
  const clamp = (value: number, low: number, high: number) => Math.round(Math.max(low, Math.min(high, value)) * 100) / 100;
  return {
    font: clamp(base.font + fontDelta, fontSize - (language === "zh" ? 1 : 2), fontSize + .5),
    line: clamp(base.line + lineDelta, language === "zh" ? 1.8 : 1.65, language === "zh" ? 1.95 : 1.85),
  };
}

function readabilityCost(initial: Typography, candidate: Typography): number {
  const fontChange = candidate.font - initial.font;
  const lineChange = candidate.line - initial.line;
  // Shrinking text has a much greater cost than gently enlarging the shorter side.
  return Math.abs(fontChange) * (fontChange < 0 ? 24 : 6) +
    Math.abs(lineChange) * (lineChange < 0 ? 60 : 20);
}

/**
 * Gently reduce a semantic pair's height difference without changing its content.
 * CSS must consume the two pair variables; fixed-size descendants remain fixed.
 * Pass a stable contentKey (for example the rows array), not a new object per render.
 */
export function useBalancedComparison(
  viewRef: RefObject<HTMLDivElement | null>,
  enabled: boolean,
  fontSize: number,
  contentKey: unknown,
): void {
  useEffect(() => {
    const view = viewRef.current;
    if (!enabled || !view || !Number.isFinite(fontSize) || fontSize <= 0) return;
    const originals = new Map<HTMLElement, OriginalStyle>();
    let cancelled = false, timer = 0, frame = 0, lastWidth = -1;

    const remember = (element: HTMLElement) => {
      if (originals.has(element)) return;
      originals.set(element, {
        font: element.style.getPropertyValue(FONT), line: element.style.getPropertyValue(LINE),
        fontPriority: element.style.getPropertyPriority(FONT), linePriority: element.style.getPropertyPriority(LINE),
      });
    };
    const restore = (element: HTMLElement) => {
      const original = originals.get(element);
      if (!original) return;
      if (original.font) element.style.setProperty(FONT, original.font, original.fontPriority);
      else element.style.removeProperty(FONT);
      if (original.line) element.style.setProperty(LINE, original.line, original.linePriority);
      else element.style.removeProperty(LINE);
    };
    const apply = (element: HTMLElement, value: Typography) => {
      element.style.setProperty(FONT, `${value.font}px`);
      element.style.setProperty(LINE, String(value.line));
    };

    const balance = () => {
      if (cancelled || !view.isConnected || view.getBoundingClientRect().width <= 0) return;
      // Always restart at the actual CSS defaults; resizing never compounds adjustments.
      originals.forEach((_, element) => restore(element));
      const english = new Map([...view.querySelectorAll<HTMLElement>(".article-en > .parallel-text")]
        .map(element => [element.dataset.group, element]));
      const pairs: Pair[] = [];
      for (const zh of view.querySelectorAll<HTMLElement>(".article-zh > .parallel-text")) {
        const en = zh.dataset.group ? english.get(zh.dataset.group) : undefined;
        if (!en || zh.hidden || en.hidden || zh.dataset.caption === "true" || en.dataset.caption === "true" ||
          zh.querySelector(".translator-note") || en.querySelector(".translator-note")) continue;
        const zhRect = zh.getBoundingClientRect(), enRect = en.getBoundingClientRect();
        if (!zhRect.width || !enRect.width || !zhRect.height || !enRect.height) continue;
        if (bodyLength(zh) < 40 || bodyLength(en) < 100) continue;
        const initial = {zh: typography(zh, fontSize, "zh"), en: typography(en, fontSize, "en")};
        const difference = zhRect.height - enRect.height, gap = Math.abs(difference);
        if (gap < Math.max(24, Math.max(zhRect.height, enRect.height) * .12)) continue;
        const zhBody = zhRect.height - headingHeight(zh), enBody = enRect.height - headingHeight(en);
        const bodyDifference = zhBody - enBody;
        // A two-line heading must not cause the body beneath it to be shrunk.
        if (zhBody + 1 < initial.zh.font * initial.zh.line * 3 || enBody + 1 < initial.en.font * initial.en.line * 3 ||
          Math.sign(bodyDifference) !== Math.sign(difference) || Math.abs(bodyDifference) < Math.max(16, gap * .5)) continue;
        remember(zh); remember(en);
        pairs.push({zh, en, initial, taller: difference > 0 ? "zh" : "en", gap, score: gap});
      }

      for (const profile of PROFILES) {
        const settings = pairs.map(pair => {
          const forLanguage = (language: Language) => {
            const offset = pair.taller === language ? 0 : 2;
            return bounded(pair.initial[language], language, fontSize, profile[offset], profile[offset + 1]);
          };
          return {zh: forLanguage("zh"), en: forLanguage("en")};
        });
        // Finish all writes before reading any height, instead of forcing layout per pair.
        pairs.forEach((pair, index) => {apply(pair.zh, settings[index].zh); apply(pair.en, settings[index].en);});
        pairs.forEach((pair, index) => {
          const gap = Math.abs(pair.zh.getBoundingClientRect().height - pair.en.getBoundingClientRect().height);
          if (pair.gap - gap < Math.max(12, pair.gap * .2)) return;
          const candidate = settings[index];
          const score = gap + readabilityCost(pair.initial.zh, candidate.zh) + readabilityCost(pair.initial.en, candidate.en);
          if (score < pair.score - 2) {pair.score = score; pair.best = candidate;}
        });
      }
      pairs.forEach(pair => {
        if (pair.best) {apply(pair.zh, pair.best.zh); apply(pair.en, pair.best.en);}
        else {restore(pair.zh); restore(pair.en);}
      });
    };

    const schedule = (force = false) => {
      if (cancelled) return;
      const width = view.getBoundingClientRect().width;
      if (!force && Math.abs(width - lastWidth) < 1) return;
      lastWidth = width;
      window.clearTimeout(timer); window.cancelAnimationFrame(frame);
      timer = window.setTimeout(() => {frame = window.requestAnimationFrame(balance);}, 120);
    };
    // Height notifications caused by our own variables are intentionally ignored.
    const observer = new ResizeObserver(() => schedule());
    observer.observe(view);
    const onFonts = () => schedule(true);
    const fonts = document.fonts;
    if (fonts.status === "loading") void fonts.ready.then(onFonts);
    fonts.addEventListener("loadingdone", onFonts);
    schedule(true);
    return () => {
      cancelled = true;
      window.clearTimeout(timer); window.cancelAnimationFrame(frame);
      observer.disconnect(); fonts.removeEventListener("loadingdone", onFonts);
      originals.forEach((_, element) => restore(element));
    };
  }, [viewRef, enabled, fontSize, contentKey]);
}

export default useBalancedComparison;
