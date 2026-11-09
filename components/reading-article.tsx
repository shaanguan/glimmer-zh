"use client";

import {forwardRef, useEffect, useImperativeHandle, useMemo, useRef, useState, type CSSProperties} from "react";
import {readingGroups, type ParallelRow, type ReadingLanguage} from "../lib/parallel-content";
import {useBalancedComparison} from "./use-balanced-comparison";
import {useSourceTabs, revealSourceTabs, revealSourceHeading} from "./use-source-tabs";

export type ReadingArticleHandle = {
  revealRange: (range: Range, language: ReadingLanguage) => Promise<void>;
  navigateToHeading: (id: string) => boolean;
};

type Props = {
  rows: readonly ParallelRow[];
  bodyZh: {__html: string};
  compare: boolean;
  language: ReadingLanguage;
  fontSize: number;
  localize: (html: string) => string;
};

const ReadingArticle = forwardRef<ReadingArticleHandle, Props>(function ReadingArticle({rows, bodyZh, compare, language, fontSize, localize}, ref) {
  const view = useRef<HTMLDivElement>(null);
  const isParallel = compare && language === "zh";
  const [groupLanguages, setGroupLanguages] = useState<Record<string, ReadingLanguage>>({});
  // Stable innerHTML objects protect live native selections when controls update.
  const groups = useMemo(() => readingGroups(rows, localize), [rows, localize]);

  useBalancedComparison(view, isParallel, fontSize, rows);
  useSourceTabs(view, rows);

  useImperativeHandle(ref, () => ({
    async revealRange(range, targetLanguage) {
      const cells = view.current?.querySelectorAll<HTMLElement>(
        `.article-${targetLanguage} > [data-kind="table"], .article-${targetLanguage} > [data-kind="layout"]`,
      );
      const ids = [...(cells || [])].filter(cell => range.intersectsNode(cell)).map(cell => cell.dataset.group!);
      if (ids.length) {
        setGroupLanguages(previous => ({...previous, ...Object.fromEntries(ids.map(id => [id, targetLanguage]))}));
        // Expose every intersected group without replacing its text nodes.
        await new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
      }
      revealSourceTabs(range);
    },
    navigateToHeading(id) {
      const canonical = id.replace(/^en-/, "");
      const headings = view.current?.querySelectorAll<HTMLElement>("h1[id], h2[id], h3[id], h4[id]");
      const candidates = [...(headings || [])].filter(heading =>
        heading.id === canonical || heading.id === `en-${canonical}`);
      const visible = (element: HTMLElement) =>
        !element.closest("[hidden]") &&
        [...element.getClientRects()].some(rect => rect.width > 0 && rect.height > 0);
      const target = candidates.find(visible) || candidates.find(heading =>
        !heading.closest<HTMLElement>(".parallel-cell")?.hidden);
      if (!target) return false;
      revealSourceHeading(target);
      // The original section heading can serve as its tab label and remain
      // visually hidden. In that case its revealed panel is the destination.
      const tabPanel = target.classList.contains("source-tab-heading")
        ? target.closest<HTMLElement>('.source-column[role="tabpanel"]') || target.closest<HTMLElement>("[data-source-layout]")
        : null;
      const destination = tabPanel || (visible(target) ? target : target.closest<HTMLElement>(".source-column"));
      if (!destination || !visible(destination)) return false;
      destination.scrollIntoView({block: "start"});
      return true;
    },
  }), []);

  useEffect(() => {
    view.current?.querySelectorAll<HTMLMediaElement>("[hidden] audio, [hidden] video").forEach(media => media.pause());
  }, [groupLanguages, language, isParallel]);

  return <div ref={view} tabIndex={-1} data-passage-view className={compare ? `parallel-article ${isParallel ? "is-parallel" : "is-switched"}` : "single-article"}>
    {!compare ? <article className="article-content article-zh" dangerouslySetInnerHTML={bodyZh}/> : <>
      {isParallel && <div className="parallel-labels" aria-hidden="true"><span>中文</span><span>English</span></div>}
      {(["zh", "en"] as const).map(lang => <article key={lang} lang={lang === "en" ? "en" : "zh-CN"} className={`article-content article-${lang} parallel-language`}>
        {groups.map((group, index) => {
          const shared = group.kind === "media";
          const switchable = group.kind === "table" || group.kind === "layout";
          const groupLanguage = isParallel ? groupLanguages[group.id] || "zh" : language;
          const hidden = shared ? lang === "en" : switchable ? lang !== groupLanguage : !isParallel && lang !== language;
          return <div key={group.id} hidden={hidden} data-group={group.id} data-kind={group.kind} data-caption={group.caption || undefined}
            className={`parallel-cell parallel-${group.kind}`}
            style={{gridRow: index + (isParallel ? 2 : 1), gridColumn: shared || switchable || !isParallel ? "1 / -1" : lang === "zh" ? 1 : 2} as CSSProperties}
            dangerouslySetInnerHTML={group[lang]}/>;
        })}
      </article>)}
      {isParallel && groups.map((group, index) => (group.kind === "table" || group.kind === "layout") && <div key={group.id} className="table-language-control" style={{gridRow: index + 2, gridColumn: "1 / -1"}}>
        <div className="language-options" role="group" aria-label={group.kind === "table" ? "表格语言" : "图文组语言"}>
          {(["zh", "en"] as const).map(lang => <button key={lang} type="button" aria-pressed={(groupLanguages[group.id] || language) === lang}
            onClick={() => setGroupLanguages(previous => ({...previous, [group.id]: lang}))}>{lang === "zh" ? "中文" : "EN"}</button>)}
        </div>
      </div>)}
    </>}
  </div>;
});

export default ReadingArticle;
