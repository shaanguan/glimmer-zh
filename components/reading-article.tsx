"use client";

import {forwardRef, useEffect, useImperativeHandle, useMemo, useRef, useState, type CSSProperties} from "react";
import {readingGroups, type ParallelRow, type ReadingLanguage} from "../lib/parallel-content";
import {useBalancedComparison} from "./use-balanced-comparison";

export type ReadingArticleHandle = {
  revealRange: (range: Range, language: ReadingLanguage) => Promise<void>;
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
  const [tableLanguages, setTableLanguages] = useState<Record<string, ReadingLanguage>>({});
  // Stable innerHTML objects protect live native selections when controls update.
  const groups = useMemo(() => readingGroups(rows, localize), [rows, localize]);

  useBalancedComparison(view, isParallel, fontSize, rows);

  useImperativeHandle(ref, () => ({
    async revealRange(range, targetLanguage) {
      const cells = view.current?.querySelectorAll<HTMLElement>(`.article-${targetLanguage} > [data-kind="table"]`);
      const ids = [...(cells || [])].filter(cell => range.intersectsNode(cell)).map(cell => cell.dataset.group!);
      if (!ids.length) return;
      setTableLanguages(previous => ({...previous, ...Object.fromEntries(ids.map(id => [id, targetLanguage]))}));
      // Let React expose the requested table before the native range is focused.
      await new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
    },
  }), []);

  useEffect(() => {
    view.current?.querySelectorAll<HTMLMediaElement>("[hidden] audio, [hidden] video").forEach(media => media.pause());
  }, [tableLanguages, language, isParallel]);

  return <div ref={view} tabIndex={-1} data-passage-view className={compare ? `parallel-article ${isParallel ? "is-parallel" : "is-switched"}` : "single-article"}>
    {!compare ? <article className="article-content article-zh" dangerouslySetInnerHTML={bodyZh}/> : <>
      {isParallel && <div className="parallel-labels" aria-hidden="true"><span>中文</span><span>English</span></div>}
      {(["zh", "en"] as const).map(lang => <article key={lang} lang={lang === "en" ? "en" : "zh-CN"} className={`article-content article-${lang} parallel-language`}>
        {groups.map((group, index) => {
          const shared = group.kind === "media";
          const tableLanguage = isParallel ? tableLanguages[group.id] || "zh" : language;
          const hidden = shared ? lang === "en" : group.kind === "table" ? lang !== tableLanguage : !isParallel && lang !== language;
          return <div key={group.id} hidden={hidden} data-group={group.id} data-kind={group.kind} data-caption={group.caption || undefined}
            className={`parallel-cell parallel-${group.kind}`}
            style={{gridRow: index + (isParallel ? 2 : 1), gridColumn: shared || group.kind === "table" || !isParallel ? "1 / -1" : lang === "zh" ? 1 : 2} as CSSProperties}
            dangerouslySetInnerHTML={group[lang]}/>;
        })}
      </article>)}
      {isParallel && groups.map((group, index) => group.kind === "table" && <div key={group.id} className="table-language-control" style={{gridRow: index + 2, gridColumn: "1 / -1"}}>
        <div className="language-options" role="group" aria-label="表格语言">
          {(["zh", "en"] as const).map(lang => <button key={lang} type="button" aria-pressed={(tableLanguages[group.id] || language) === lang}
            onClick={() => setTableLanguages(previous => ({...previous, [group.id]: lang}))}>{lang === "zh" ? "中文" : "EN"}</button>)}
        </div>
      </div>)}
    </>}
  </div>;
});

export default ReadingArticle;
