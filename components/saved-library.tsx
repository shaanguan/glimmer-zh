"use client";

import {useState} from "react";
import {ArrowRight, Bookmark, BookOpen, Quote, X} from "lucide-react";
import type {GuidePage} from "../lib/types";
import {passageHref, type SavedPassage} from "../lib/passage-anchors";

export default function SavedLibrary({pages,bookmarks,passages,hydrated,onRemovePassage,onRemoveBookmark}: {
  pages: GuidePage[]; bookmarks: string[]; passages: SavedPassage[]; hydrated: boolean;
  onRemovePassage:(id:string)=>void; onRemoveBookmark:(slug:string)=>void;
}) {
  const [tab,setTab]=useState<"passages"|"pages">("passages");
  const savedPages=bookmarks.map(slug=>pages.find(page=>page.slug===slug)).filter((page):page is GuidePage=>!!page);
  const count=tab==="passages"?passages.length:savedPages.length;

  return <>
    <h1>我的收藏</h1>
    <div className="saved-tabs" role="tablist" aria-label="收藏类型">
      <button id="saved-passages-tab" role="tab" aria-selected={tab==="passages"} aria-controls="saved-passages-panel" tabIndex={tab==="passages"?0:-1} onClick={()=>setTab("passages")} onKeyDown={event=>{if(event.key==="ArrowRight"||event.key==="ArrowLeft"){event.preventDefault();setTab("pages");document.getElementById("saved-pages-tab")?.focus();}}}><Quote size={17}/>划词收藏<span>{passages.length}</span></button>
      <button id="saved-pages-tab" role="tab" aria-selected={tab==="pages"} aria-controls="saved-pages-panel" tabIndex={tab==="pages"?0:-1} onClick={()=>setTab("pages")} onKeyDown={event=>{if(event.key==="ArrowLeft"||event.key==="ArrowRight"){event.preventDefault();setTab("passages");document.getElementById("saved-passages-tab")?.focus();}}}><BookOpen size={17}/>整页收藏<span>{savedPages.length}</span></button>
    </div>
    <div className="saved-storage-note">收藏保存在当前浏览器中。</div>
    <section id={tab==="passages"?"saved-passages-panel":"saved-pages-panel"} role="tabpanel" aria-labelledby={tab==="passages"?"saved-passages-tab":"saved-pages-tab"} className="saved-panel">
      {!hydrated?<p className="saved-loading" role="status">正在读取收藏…</p>:count===0?<div className="empty-state saved-empty"><span className="saved-empty-icon"><Bookmark size={28}/></span><h2>{tab==="passages"?"还没有划词收藏":"还没有整页收藏"}</h2><p>{tab==="passages"?"在指南正文中选中文字，点击浮出的「收藏」，就能在这里回看。":"点击指南页顶部的收藏图标。"}</p><a href="/guide/foundations-design-principles" className="button-primary">去读一篇指南<ArrowRight size={16}/></a></div>:
        tab==="passages"?<div className="passage-list">{passages.map(item=>{
          const page=pages.find(p=>p.slug===item.slug);
          return <article className="passage-card" key={item.id}>
            <div className="passage-card-heading"><div><a href={passageHref(item)} className="passage-source">{page?.title||"来源文章"}</a><span className="passage-language">{item.language==="en"?"原文":"中文译文"}</span></div><button className="remove-saved" onClick={()=>onRemovePassage(item.id)} aria-label={`取消收藏：${item.quote.slice(0,24)}`}><X size={15}/><span>取消收藏</span></button></div>
            {item.sectionTitle&&<p className="passage-section">{item.sectionTitle}</p>}
            <a className="passage-quote-link" href={passageHref(item)}><blockquote lang={item.language==="en"?"en":"zh-CN"}>{item.quote}</blockquote></a>
            <div className="passage-card-footer"><time dateTime={item.createdAt}>{new Intl.DateTimeFormat("zh-CN",{year:"numeric",month:"2-digit",day:"2-digit"}).format(new Date(item.createdAt))}</time><a href={passageHref(item)}>回到原文位置<ArrowRight size={15}/></a></div>
          </article>;
        })}</div>:<div className="saved-page-list">{savedPages.map(page=><article className="saved-page-card" key={page.slug}><span className="saved-page-icon"><BookOpen size={22}/></span><div><a className="saved-page-title" href={page.slug==="overview"?"/":`/guide/${page.slug}`}>{page.title}</a><p>{page.description}</p></div><button className="remove-saved" onClick={()=>onRemoveBookmark(page.slug)} aria-label={`取消整页收藏：${page.title}`}><X size={15}/><span>取消收藏</span></button></article>)}</div>}
    </section>
  </>;
}
