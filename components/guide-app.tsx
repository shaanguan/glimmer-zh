"use client";

import {useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type MouseEvent as ReactMouseEvent, type KeyboardEvent as ReactKeyboardEvent} from "react";
import {ArrowLeft, ArrowRight, ArrowUpRight, AudioLines, Bookmark, BookOpen, ChevronDown, ChevronRight, Compass, Languages, Layers, Menu, Moon, MousePointer2, Palette, PanelsTopLeft, Search, Type, X} from "lucide-react";
import library from "../content/library.json";
import parallel from "../content/parallel.json";
import glossary from "../content/glossary.json";
import {groups} from "../lib/groups";
import type {GuidePage, Term} from "../lib/types";
import {usePassageBookmarks} from "./use-passage-bookmarks";
import SavedLibrary from "./saved-library";
import {formatOverview} from "../lib/overview-layout";
import {formatParallelOverview} from "../lib/parallel-overview";
import {applyOverviewAssets} from "../lib/overview-assets";
import {wrapTables, type ParallelRow, type ReadingLanguage} from "../lib/parallel-content";
import ReadingArticle, {type ReadingArticleHandle} from "./reading-article";
import {prepareImages} from "../lib/image-loading";
import {useImageLoading} from "./use-image-loading";
import {useNavigationLoading} from "./use-navigation-loading";

const pages = library as GuidePage[];
const guidePages = pages.filter(page=>page.slug!=="overview");
const pageHref = (slug:string)=>slug==="overview"?"/":`/guide/${slug}`;
const terms = glossary as Term[];
const aligned = parallel as Record<string, {rows: ParallelRow[]}>;
const icons = {Compass, Layers, MousePointer2, AudioLines, Palette, PanelsTopLeft};
const groupIcon = (name:string) => icons[name as keyof typeof icons] || BookOpen;
const sourcePaths = new Map(pages.map(p => [new URL(p.sourceUrl).pathname.replace(/\/$/, ""), p.slug]));
const sizes = [17,19,21];
type View = "home" | "guide" | "glossary" | "saved";
type SearchResult = {title:string;sub:string;href:string;kind:string};

function localizeLinks(body:string) {
  const markup=body.replace(/<a\b([^>]*?)href="([^"]+)"([^>]*)>/g, (whole, before, href, after) => {
    try {const u = new URL(href, "https://developer.android.com");const slug = sourcePaths.get(u.pathname.replace(/\/$/, ""));
      if(slug && u.hostname === "developer.android.com") return `<a href="${pageHref(slug)}${u.hash}">`;
      if(href.startsWith("/guide/overview")) return `<a href="/${href.slice("/guide/overview".length)}">`;
    } catch {}
    return whole;
  });
  return prepareImages(markup);
}
function readStored<T,>(key:string,fallback:T):T {try {const value=localStorage.getItem(key);return value ? JSON.parse(value) as T : fallback;}catch{return fallback;}}
function store(key:string,value:unknown){try{localStorage.setItem(key,JSON.stringify(value));return true;}catch{return false;}}

export default function GuideApp({view,slug}:{view:View;slug?:string}) {
  useImageLoading();
  const navigation=useNavigationLoading();
  const pendingPath=navigation.pending?new URL(navigation.pending.href,"https://reader.local").pathname:null;
  const pendingView=pendingPath==="/"?"home":pendingPath?.startsWith("/guide/")?"guide":pendingPath==="/glossary"?"glossary":pendingPath==="/saved"?"saved":null;
  const page=pages.find(p=>p.slug===(slug||(view==="home"?"overview":undefined)));
  const hasGuideSidebar=view==="guide";
  const [theme,setTheme]=useState("light");
  const [fontIndex,setFontIndex]=useState(0);
  const [compare,setCompare]=useState(false);
  const [readingLanguage,setReadingLanguage]=useState<ReadingLanguage>("zh");
  const readingArticle=useRef<ReadingArticleHandle>(null);
  const [searchOpen,setSearchOpen]=useState(false);
  const [menuOpen,setMenuOpen]=useState(false);
  const [query,setQuery]=useState("");
  const [activeResult,setActiveResult]=useState(0);
  const [collapsed,setCollapsed]=useState<string[]>([]);
  const [bookmarks,setBookmarks]=useState<string[]>([]);
  const [section,setSection]=useState("");
  const [termQuery,setTermQuery]=useState("");
  const searchInput=useRef<HTMLInputElement>(null);
  const dialog=useRef<HTMLElement>(null);
  const searchOverlay=useRef<HTMLDivElement>(null);
  const directory=useRef<HTMLElement>(null);
  const group=groups.find(g=>g.id===page?.group);
  const currentIndex=page?guidePages.indexOf(page):-1;
  const headings=page?.headings.filter(h=>h.level<=3 && !/^(Do|Don't|建议|避免|注意|Warning)(?:$|[：:])/i.test(h.title)) || [];
  // React compares this prop by object identity. Keep it stable so selection
  // menus and preference updates never recreate the article's text nodes.
  const bodyZh=useMemo(()=>({__html:page?(page.slug==="overview"?formatOverview(localizeLinks(applyOverviewAssets(page.body,"zh"))):wrapTables(localizeLinks(page.body),"zh")):""}),[page]);
  const bodyEn=useMemo(()=>({__html:page?.slug==="overview"?localizeLinks(applyOverviewAssets(formatParallelOverview(aligned.overview.rows,"en"),"en")):""}),[page]);
  const revealLanguage=useCallback((language:ReadingLanguage)=>{setReadingLanguage(language);if(view==="home")setCompare(language==="en");},[view]);
  const revealRange=useCallback((range:Range,language:ReadingLanguage)=>readingArticle.current?.revealRange(range,language),[]);
  const languageMode=compare?(readingLanguage==="en"?"en":"parallel"):"zh";
  const languageName={zh:"中文",parallel:"左右对照",en:"英文"}[languageMode];
  const languageAction=languageMode==="zh"?(view==="home"?"切换为英文":"切换为中英对照"):languageMode==="parallel"?"切换为英文":"切换为中文";
  const isSaved=!!page && bookmarks.includes(page.slug);
  const passages=usePassageBookmarks({page,compare,onCompare:setCompare,onLanguage:revealLanguage,onReveal:revealRange,enabled:!searchOpen&&!menuOpen});

  useEffect(()=>{
    const t=readStored<string>("jingshang-theme","light");setTheme(t==="dark"?"dark":"light");
    document.documentElement.dataset.theme=t==="dark"?"dark":"light";
    setFontIndex(Math.max(0,Math.min(2,readStored("jingshang-text-size",0))));
    const loadBookmarks=()=>{const saved=readStored<string[]>("jingshang-bookmarks",[]);setBookmarks(Array.isArray(saved)?saved.filter(s=>typeof s==="string"&&pages.some(p=>p.slug===s)):[]);};
    loadBookmarks();
    const onStorage=(e:StorageEvent)=>{if(e.key==="jingshang-bookmarks"||e.key===null)loadBookmarks();};
    window.addEventListener("storage",onStorage);return()=>window.removeEventListener("storage",onStorage);
  },[]);
  useEffect(()=>{
    const onKey=(e:globalThis.KeyboardEvent)=>{
      if((e.metaKey||e.ctrlKey)&&e.key.toLowerCase()==="k"){e.preventDefault();setSearchOpen(v=>!v);setMenuOpen(false);}
      if(e.key==="Escape"){setSearchOpen(false);setMenuOpen(false);}
    };window.addEventListener("keydown",onKey);return()=>window.removeEventListener("keydown",onKey);
  },[]);
  useEffect(()=>{
    document.body.style.overflow=(searchOpen||menuOpen)?"hidden":"";
    if(searchOpen){const old=document.activeElement as HTMLElement|null;searchInput.current?.focus();return()=>{document.body.style.overflow="";old?.focus();};}
    return()=>{document.body.style.overflow="";};
  },[searchOpen,menuOpen]);
  useEffect(()=>{
    if(!navigation.pending)return;
    // Let the clicked link start its native navigation before unmounting a
    // dialog; recovery controls must remain reachable during a slow response.
    const closeDialogs=window.setTimeout(()=>{setSearchOpen(false);setMenuOpen(false);},0);
    return()=>window.clearTimeout(closeDialogs);
  },[navigation.pending]);
  useEffect(()=>{
    if(!searchOpen||!window.visualViewport)return;
    const viewport=window.visualViewport;
    const update=()=>{
      const overlay=searchOverlay.current;
      if(!overlay)return;
      overlay.style.height=`${viewport.height}px`;
      overlay.style.top=`${viewport.offsetTop}px`;
      overlay.style.setProperty("--search-viewport-height",`${viewport.height}px`);
      overlay.dataset.compact=String(viewport.height<=600);
    };
    update();
    viewport.addEventListener("resize",update);
    viewport.addEventListener("scroll",update);
    return()=>{viewport.removeEventListener("resize",update);viewport.removeEventListener("scroll",update);};
  },[searchOpen]);
  useEffect(()=>{
    if(!menuOpen)return;
    const previous=document.activeElement as HTMLElement|null;
    directory.current?.querySelector<HTMLButtonElement>(".sidebar-close")?.focus();
    const desktop=window.matchMedia("(min-width: 1025px)");
    const closeOnDesktop=()=>{if(desktop.matches)setMenuOpen(false);};
    desktop.addEventListener("change",closeOnDesktop);
    return()=>{desktop.removeEventListener("change",closeOnDesktop);previous?.focus();};
  },[menuOpen]);
  useEffect(()=>{
    if(!page)return;
    const observer=new IntersectionObserver(entries=>{const visible=entries.filter(e=>e.isIntersecting&&!e.target.closest("[hidden]")).sort((a,b)=>a.boundingClientRect.top-b.boundingClientRect.top);if(visible[0])setSection(visible[0].target.id.replace(/^en-/,""));},{rootMargin:"-100px 0px -65% 0px",threshold:0});
    document.querySelectorAll(".article-content h2[id], .article-content h3[id]").forEach(el=>observer.observe(el));
    return()=>observer.disconnect();
  },[page,compare,readingLanguage]);
  useEffect(()=>setActiveResult(0),[query]);

  const results=useMemo<SearchResult[]>(()=>{
    const q=query.trim().toLocaleLowerCase();
    if(!q)return ["foundations-design-principles","foundations-made-for-glasses","interaction-inputs","styles-color","components-title-chip"].map(sl=>pages.find(p=>p.slug===sl)).filter((p):p is GuidePage=>!!p).map(p=>({title:p.title,sub:p.description,href:pageHref(p.slug),kind:groups.find(g=>g.id===p.group)?.title||"指南"}));
    const words=q.split(/\s+/);const matched=pages.map(p=>{
      const hay=(p.title+" "+p.englishTitle+" "+p.description+" "+p.text).toLocaleLowerCase();
      const score=words.every(w=>hay.includes(w))?10+(p.title.toLocaleLowerCase().includes(q)?100:0)+(p.englishTitle.toLocaleLowerCase().includes(q)?70:0)+(p.description.toLocaleLowerCase().includes(q)?30:0):0;
      const at=p.text.toLocaleLowerCase().indexOf(q);const snippet=at>=0?p.text.slice(Math.max(0,at-22),at+95).replace(/\s+/g," "):p.description;
      return {score,title:p.title,sub:snippet,href:pageHref(p.slug),kind:groups.find(g=>g.id===p.group)?.title||"指南"};
    }).filter(r=>r.score>0);
    const matchedTerms=terms.map((t,i)=>({t,i})).filter(({t})=>words.every(w=>(t.en+" "+t.zh+" "+t.meaning).toLocaleLowerCase().includes(w))).map(({t,i})=>({score:95,title:`${t.zh} · ${t.en}`,sub:t.meaning,href:`/glossary#term-${i}`,kind:"术语"}));
    return [...matched,...matchedTerms].sort((a,b)=>b.score-a.score).slice(0,20);
  },[query]);
  const filteredTerms=terms.map((t,i)=>({t,i})).filter(({t})=>(t.en+" "+t.zh+" "+t.meaning).toLocaleLowerCase().includes(termQuery.trim().toLocaleLowerCase()));
  useEffect(()=>{if(searchOpen)document.getElementById(`search-result-${activeResult}`)?.scrollIntoView({block:"nearest"});},[activeResult,searchOpen,query]);
  function toggleLanguages(){
    if(!compare){setReadingLanguage(view==="home"?"en":"zh");setCompare(true);}
    else if(view!=="home"&&readingLanguage==="zh")setReadingLanguage("en");
    else {setCompare(false);setReadingLanguage("zh");}
  }
  function openOverviewCard(event:ReactMouseEvent<HTMLDivElement>){
    const target=event.target as Element;
    if(event.defaultPrevented||event.button!==0||target.closest("a,button,input,video,audio"))return;
    // Preserve selecting and saving the card copy instead of navigating on release.
    if(window.getSelection()?.toString().trim())return;
    const card=target.closest(".overview-card");
    const link=card?.querySelector<HTMLAnchorElement>("h3 a[href]");
    if(!link)return;
    if(event.metaKey||event.ctrlKey||event.shiftKey)window.open(link.href,"_blank","noopener,noreferrer");
    else link.click();
  }
  function toggleTheme(){const next=theme==="dark"?"light":"dark";setTheme(next);document.documentElement.dataset.theme=next;store("jingshang-theme",next);}
  function changeSize(){const next=(fontIndex+1)%sizes.length;setFontIndex(next);store("jingshang-text-size",next);}
  function savePageBookmarks(next:string[]){if(store("jingshang-bookmarks",next)){setBookmarks(next);return true;}passages.setNotice({message:"收藏未能保存，请检查浏览器存储设置。",error:true});return false;}
  function toggleBookmark(){if(!page)return;const next=isSaved?bookmarks.filter(s=>s!==page.slug):[...bookmarks,page.slug];savePageBookmarks(next);}
  function removePageBookmark(slug:string){if(savePageBookmarks(bookmarks.filter(s=>s!==slug)))passages.setNotice({message:"已取消整页收藏。"});}
  function handleSearchKey(e:ReactKeyboardEvent<HTMLInputElement>){
    if(e.key==="ArrowDown"){e.preventDefault();setActiveResult(i=>Math.max(0,Math.min(i+1,results.length-1)));}
    if(e.key==="ArrowUp"){e.preventDefault();setActiveResult(i=>Math.max(0,i-1));}
    if(e.key==="Enter"&&results[activeResult]){e.preventDefault();navigation.begin(results[activeResult].href,results[activeResult].title);window.location.assign(results[activeResult].href);}
  }
  function trapFocus(e:ReactKeyboardEvent<HTMLElement>){if(e.key!=="Tab")return;const nodes=[...e.currentTarget.querySelectorAll<HTMLElement>('button,a[href],input')].filter(node=>node.getClientRects().length>0);if(!nodes?.length)return;const first=nodes[0],last=nodes[nodes.length-1];if(e.shiftKey&&document.activeElement===first){e.preventDefault();last.focus();}else if(!e.shiftKey&&document.activeElement===last){e.preventDefault();first.focus();}}

  return <div className={`site-shell shell-${view}`}>
    <a className="skip-link" href="#main-content">跳转至正文</a>
    <header className="site-header" inert={menuOpen||searchOpen||undefined}>
      <div className="brand-zone">
        {hasGuideSidebar&&<button className="icon-button mobile-menu directory-toggle" aria-label="打开章节目录" aria-expanded={menuOpen} onClick={()=>setMenuOpen(v=>!v)}><Menu size={21}/></button>}
        <a className="brand" href="/" aria-label="Android AI 眼镜设计指南首页"><span className="brand-mark" aria-hidden="true"><BookOpen size={27} strokeWidth={1.7}/></span><span className="brand-name"><span className="brand-full">Android AI 眼镜设计指南</span><span className="brand-compact" aria-hidden="true"><span>Android AI</span><span>眼镜指南</span></span><span className="brand-sub">Android Developers · 中文译本</span></span></a>
      </div>
      <nav className="header-nav" aria-label="主导航">
        {[{view:"home",href:"/",label:"概览"},{view:"guide",href:"/guide/foundations-design-principles",label:"指南"},{view:"glossary",href:"/glossary",label:"术语表"},{view:"saved",href:"/saved",label:"收藏"}].map(item=><a key={item.view} href={item.href} className={`${view===item.view?"active":""}${pendingView===item.view?" is-loading":""}`} aria-current={view===item.view?"page":undefined} aria-busy={pendingView===item.view||undefined}>{item.label}{pendingView===item.view&&<span className="navigation-tab-spinner navigation-spinner" aria-hidden="true"/>}</a>)}
      </nav>
      <div className="header-actions">
        <button className="search-trigger" onClick={()=>setSearchOpen(true)} aria-label="搜索指南与术语"><Search size={18}/><span>搜索</span><kbd>⌘ K</kbd></button>
        <div className="reader-toggles" role="group" aria-label="阅读设置">
          {page&&<>
            <button className="icon-toggle" onClick={toggleLanguages} aria-label={`当前${languageName}，${languageAction}`} data-active={compare} data-language-mode={languageMode} data-tooltip={languageAction}>{languageMode==="parallel"?<Languages size={19}/>:<span className="language-glyph" aria-hidden="true">{languageMode==="zh"?"中":"EN"}</span>}</button>
            <button className="icon-toggle" onClick={changeSize} aria-label={`调整字号，当前${["标准","较大","最大"][fontIndex]} ${sizes[fontIndex]} 像素`} data-active={fontIndex>0} data-tooltip={`字号：${["标准","较大","最大"][fontIndex]}`}><Type size={17+fontIndex*2}/></button>
            <button className="icon-toggle" onClick={toggleBookmark} aria-label={isSaved?"取消整页收藏":"收藏整页"} aria-pressed={isSaved} data-tooltip={isSaved?"取消整页收藏":"收藏整页"}><Bookmark size={18} fill={isSaved?"currentColor":"none"}/></button>
          </>}
          <button className="icon-toggle" onClick={toggleTheme} aria-label="深色模式" aria-pressed={theme==="dark"} data-tooltip={theme==="dark"?"关闭深色模式":"深色模式"}><Moon size={18} fill={theme==="dark"?"currentColor":"none"}/></button>
        </div>
      </div>
    </header>
    {hasGuideSidebar&&menuOpen&&<button className="sidebar-backdrop" onClick={()=>setMenuOpen(false)} aria-label="关闭章节目录"/>}
    {hasGuideSidebar&&<aside ref={directory} className={`sidebar ${menuOpen?"is-open":""}`} aria-label="章节目录" role={menuOpen?"dialog":undefined} aria-modal={menuOpen||undefined} inert={searchOpen||undefined} onKeyDown={menuOpen?trapFocus:undefined}>
      <div className="sidebar-head"><span>目录</span><button className="icon-button sidebar-close" onClick={()=>setMenuOpen(false)} aria-label="关闭目录"><X size={18}/></button></div>
      <div className="sidebar-scroll">
        <div className="sidebar-groups">{groups.map(g=>{const Icon=groupIcon(g.icon);const closed=collapsed.includes(g.id);return <section className="sidebar-group" key={g.id}><button className="group-toggle" aria-expanded={!closed} onClick={()=>setCollapsed(prev=>closed?prev.filter(s=>s!==g.id):[...prev,g.id])}><Icon size={15}/><span>{g.title}</span><ChevronDown size={13} className={closed?"rotated":""}/></button>{!closed&&<div className="group-links">{pages.filter(p=>p.group===g.id).map(p=><a key={p.slug} href={`/guide/${p.slug}`} aria-current={p.slug===slug?"page":undefined} className={p.slug===slug?"selected":""}><span>{p.title}</span>{bookmarks.includes(p.slug)&&<Bookmark size={11}/>}</a>)}</div>}</section>;})}</div>
      </div>
    </aside>}
    <main id="main-content" className={`site-main view-${view}`} aria-busy={!!navigation.pending||undefined} inert={menuOpen||searchOpen||undefined}>
      {view==="home"&&page&&<div className="overview-page" onClick={openOverviewCard} style={{"--reading-size":`${sizes[fontIndex]}px`} as CSSProperties}>
        {passages.restored&&!passages.restored.found&&<div className="restored-passage is-missing" role="status"><p>未能确认原文位置。</p><a href="/saved">查看收藏</a><button className="icon-button" onClick={passages.dismissRestored} aria-label="关闭收藏定位提示"><X size={16}/></button></div>}
        <div className="single-article" data-passage-view tabIndex={-1}><article key={compare?"en":"zh"} lang={compare?"en":"zh-CN"} className={`article-content overview-content article-${compare?"en":"zh"}`} dangerouslySetInnerHTML={compare?bodyEn:bodyZh}/></div>
        <SiteFooter/>
      </div>}
      {view==="guide"&&page&&<div className={`reader-layout ${compare?"is-comparing":""} ${compare&&readingLanguage==="en"?"is-english":""}`} style={{"--reading-size":`${sizes[fontIndex]}px`} as CSSProperties}>
        <div className="reader-main"><div className="breadcrumb"><a href="/guide/foundations-design-principles">指南</a><ChevronRight size={13}/><a href={`/guide/${pages.find(p=>p.group===group?.id)?.slug||"overview"}`}>{group?.title||"总览"}</a></div><header className="article-header"><h1>{page.title}</h1><div className="article-meta">{page.sourceUpdated&&<span>原文更新 {page.sourceUpdated}</span>}<a href={page.sourceUrl+"?hl=en"} target="_blank" rel="noopener noreferrer">原文<ArrowUpRight size={13}/></a></div></header>
          {passages.restored&&!passages.restored.found&&<div className="restored-passage is-missing" role="status"><p>未能确认原文位置。</p><a href="/saved">查看收藏</a><button className="icon-button" onClick={passages.dismissRestored} aria-label="关闭收藏定位提示"><X size={16}/></button></div>}
          <ReadingArticle ref={readingArticle} key={page.slug} rows={aligned[page.slug].rows} bodyZh={bodyZh} compare={compare} language={readingLanguage} fontSize={sizes[fontIndex]} localize={localizeLinks}/>
          <nav className="article-pagination" aria-label="前后章节">{currentIndex>0?<a href={`/guide/${guidePages[currentIndex-1].slug}`}><span><ArrowLeft size={14}/>上一篇</span><strong>{guidePages[currentIndex-1].title}</strong></a>:<div/>}{currentIndex<guidePages.length-1?<a className="next-page" href={`/guide/${guidePages[currentIndex+1].slug}`}><span>下一篇<ArrowRight size={14}/></span><strong>{guidePages[currentIndex+1].title}</strong></a>:<a className="next-page" href="/glossary"><span>继续阅读<ArrowRight size={14}/></span><strong>中英术语表</strong></a>}</nav>
          <SiteFooter/>
        </div>
        <aside className="page-toc" aria-label="本页目录"><span className="toc-heading">本页内容</span><nav>{headings.map((h,i)=><a key={`${h.id}-${i}`} href={`#${h.id}`} className={`${section===h.id?"active":""} ${h.level>2?"nested":""}`} onClick={event=>{if(readingArticle.current?.navigateToHeading(h.id)){event.preventDefault();window.history.pushState(window.history.state,"",`#${h.id}`);}setSection(h.id);}}>{h.title}</a>)}</nav></aside>
      </div>}
      {view==="saved"&&<div className="utility-page saved-page"><SavedLibrary pages={pages} bookmarks={bookmarks} passages={passages.passages} hydrated={passages.hydrated} onRemovePassage={passages.removePassage} onRemoveBookmark={removePageBookmark}/><SiteFooter/></div>}
      {view==="glossary"&&<div className="utility-page"><h1>中英术语表</h1><div className="glossary-search"><Search size={20}/><input value={termQuery} onChange={e=>setTermQuery(e.target.value)} placeholder="查找中文、英文或含义…" aria-label="筛选术语"/>{termQuery&&<button className="icon-button" onClick={()=>setTermQuery("")} aria-label="清除术语筛选"><X size={16}/></button>}<span>{filteredTerms.length} 个术语</span></div><div className="term-grid">{filteredTerms.map(({t,i})=><article className="term-card" id={`term-${i}`} key={t.en}><div className="term-title"><h2>{t.zh}</h2></div><p className="term-english">{t.en}</p><p className="term-meaning">{t.meaning}</p><a href={`/guide/${t.page}`}>在指南中阅读<ArrowUpRight size={14}/></a></article>)}</div>{filteredTerms.length===0&&<div className="empty-state"><Search size={28}/><h2>没有找到这个术语</h2><p>试试更短的关键词，或用英文查找。</p><button className="button-secondary" onClick={()=>setTermQuery("")}>显示全部术语</button></div>}<SiteFooter/></div>}
    </main>
    <div className={`navigation-status${navigation.pending?" is-visible":""}${navigation.stillWaiting?" is-slow":""}`} role="status" aria-live="polite" aria-atomic="true">
      {navigation.pending&&<><span className="navigation-spinner" aria-hidden="true"/><span>{navigation.stillWaiting?"仍在加载":"正在打开"}{navigation.pending.label||"页面"}…</span>{navigation.stillWaiting&&<div className="navigation-recovery"><button onClick={()=>{const target=navigation.pending;if(!target)return;navigation.cancel();navigation.begin(target.href,target.label);window.location.assign(target.href);}}>重试</button><button onClick={navigation.cancel}>取消</button></div>}</>}
    </div>
    {passages.draft&&!passages.selectionSaved&&<div ref={passages.menuRef} className="selection-bookmark-menu" role="toolbar" aria-label="划词操作" style={{left:passages.draft.x,top:passages.draft.y}} onPointerDown={e=>e.preventDefault()}><button onClick={passages.saveSelection} aria-keyshortcuts="Alt+S" aria-label="收藏选中文字"><Bookmark size={16}/><span>收藏</span></button></div>}
    {passages.notice&&<div className={`reader-toast ${passages.notice.error?"is-error":""}`} role={passages.notice.error?"alert":"status"}><span>{passages.notice.message}</span>{passages.notice.saved&&<a href="/saved">查看收藏<ArrowRight size={14}/></a>}<button onClick={()=>passages.setNotice(null)} aria-label="关闭提示"><X size={15}/></button></div>}
    {searchOpen&&<div ref={searchOverlay} className="search-overlay" onMouseDown={e=>{if(e.target===e.currentTarget)setSearchOpen(false);}}><section ref={dialog} className="search-dialog" role="dialog" aria-modal="true" aria-label="搜索指南与术语" onKeyDown={trapFocus}><div className="search-field"><Search size={21}/><input ref={searchInput} type="search" value={query} onChange={e=>setQuery(e.target.value)} onKeyDown={handleSearchKey} placeholder="搜索指南、术语或设计问题…" aria-label="搜索指南与术语" role="combobox" aria-expanded="true" aria-autocomplete="list" aria-controls="search-results" aria-activedescendant={results[activeResult]?`search-result-${activeResult}`:undefined} autoComplete="off"/><button className="search-close" onClick={()=>setSearchOpen(false)} aria-label="关闭搜索">Esc</button></div><div className="search-results-title" aria-live="polite">{query?`${results.length} 个相关结果`:"推荐阅读"}</div><div className="search-results" id="search-results" role="listbox" aria-label="搜索结果">{results.map((r,i)=><a key={r.href} id={`search-result-${i}`} role="option" aria-selected={i===activeResult} className={`search-result ${i===activeResult?"active":""}`} href={r.href} onMouseEnter={()=>setActiveResult(i)}><span className="result-icon">{r.kind==="术语"?<Languages size={18}/>:<BookOpen size={18}/>}</span><span className="result-content"><span className="result-title">{r.title}<small>{r.kind}</small></span><span className="result-description">{r.sub}</span></span><ArrowUpRight size={16}/></a>)}{results.length===0&&<div className="search-empty"><Search size={28}/><strong>没有找到相关内容</strong><p>可以试试“焦点”“标题胶囊”或英文关键词。</p></div>}</div><div className="search-footer"><span><kbd>↑</kbd><kbd>↓</kbd>选择 <kbd>↵</kbd>打开</span><span>搜索全部 {pages.length} 页与 {terms.length} 个术语</span></div></section></div>}
  </div>;
}

function SiteFooter(){return <footer className="site-footer"><p>原文：<a href="https://developer.android.com/design/ui/ai-glasses?hl=en" target="_blank" rel="noopener noreferrer">Android Developers / AOSP<ArrowUpRight size={12}/></a></p><a href="https://developer.android.com/license" target="_blank" rel="noopener noreferrer">内容许可<ArrowUpRight size={12}/></a></footer>;}
