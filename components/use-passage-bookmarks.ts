"use client";

import {useEffect, useRef, useState} from "react";
import type {GuidePage} from "../lib/types";
import {anchorFromRange, isSamePassage, rangeFromOffsets, resolveTextAnchor, sectionForRange, type SavedPassage} from "../lib/passage-anchors";
import {PASSAGES_KEY, readPassages, writePassages} from "../lib/passage-storage";

export type PassageDraft = Omit<SavedPassage,"id"|"createdAt"> & {range: Range; x: number; y: number};
type Notice = {message: string; error?: boolean; saved?: boolean} | null;
type RestoredPassage = {passage: SavedPassage; found: boolean} | null;

function articleFor(language: "zh"|"en") {
  return document.querySelector<HTMLElement>(language === "en" ? ".article-en" : ".article-zh");
}

function viewFor(article: HTMLElement) {
  // Language roots may use display: contents; layout operations need a real box.
  return article.closest<HTMLElement>("[data-passage-view]") || article;
}

function highlightRange(range: Range | null) {
  if (typeof CSS === "undefined" || !("highlights" in CSS) || typeof Highlight === "undefined") return;
  if (range) CSS.highlights.set("saved-passage", new Highlight(range));
  else CSS.highlights.delete("saved-passage");
}

function menuPosition(range: Range, touch: boolean) {
  const viewport = window.visualViewport;
  const left = viewport?.offsetLeft || 0;
  const top = viewport?.offsetTop || 0;
  const bottom = top + (viewport?.height || window.innerHeight);
  const width = viewport?.width || window.innerWidth;
  const headerBottom = document.querySelector(".site-header")?.getBoundingClientRect().bottom || 0;
  const minimumTop = Math.max(top, headerBottom) + 8;
  if (bottom - minimumTop < 52) return null;
  const rects = [...range.getClientRects()].filter(r => r.width > 0 && r.height > 0 && r.bottom > minimumTop && r.top < bottom - 8);
  if (!rects.length) return null;
  const rect = touch ? rects[rects.length - 1] : rects[0];
  const x = Math.max(left + 8, Math.min(left + width - 112, (rect.left + rect.right) / 2 - 52));
  let y = !touch && rect.top - 52 >= minimumTop ? rect.top - 52 : rect.bottom + 8;
  y = Math.max(minimumTop, Math.min(bottom - 52, y));
  return {x, y};
}

export function usePassageBookmarks({page,compare,onCompare,onLanguage,onReveal,enabled}: {
  page?: GuidePage; compare: boolean; onCompare: (value:boolean)=>void; enabled: boolean;
  onLanguage: (language:"zh"|"en")=>void;
  onReveal: (range:Range, language:"zh"|"en")=>Promise<void> | void;
}) {
  const [passages,setPassages] = useState<SavedPassage[]>([]);
  const [hydrated,setHydrated] = useState(false);
  const [draft,setDraft] = useState<PassageDraft|null>(null);
  const [notice,setNotice] = useState<Notice>(null);
  const [restoreRequest,setRestoreRequest] = useState<SavedPassage|null>(null);
  const [restored,setRestored] = useState<RestoredPassage>(null);
  const draftRef = useRef<PassageDraft|null>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const handledUrl = useRef("");
  const completedRestore = useRef<SavedPassage|null>(null);
  const activeRange = useRef<Range|null>(null);
  const lastTouch = useRef(false);

  function updateDraft(value:PassageDraft|null) { draftRef.current=value; setDraft(value); }

  function clearRestoredState() {
    setRestored(null);setRestoreRequest(null);highlightRange(null);
    const selection=window.getSelection();
    const active=activeRange.current;
    if(selection?.rangeCount&&active){
      const selected=selection.getRangeAt(0);
      if(selected.startContainer===active.startContainer&&selected.startOffset===active.startOffset&&
        selected.endContainer===active.endContainer&&selected.endOffset===active.endOffset)selection.removeAllRanges();
    }
    activeRange.current=null;completedRestore.current=null;updateDraft(null);
  }

  useEffect(()=>{
    const refresh=()=>{
      try {setPassages(readPassages());}
      catch {setNotice({message:"无法读取当前浏览器的划词收藏，原有数据未被覆盖。",error:true});}
      setHydrated(true);
    };
    refresh();
    const onStorage=(event:StorageEvent)=>{if(event.key===PASSAGES_KEY||event.key===null)refresh();};
    window.addEventListener("storage",onStorage);
    return()=>window.removeEventListener("storage",onStorage);
  },[]);

  useEffect(()=>{
    if(!notice)return;
    const timer=window.setTimeout(()=>setNotice(null),notice.error?8000:4200);
    return()=>window.clearTimeout(timer);
  },[notice]);

  useEffect(()=>{
    if(!hydrated||!page)return;
    const inspectUrl=(force=false)=>{
      const id=new URLSearchParams(window.location.search).get("passage");
      if(!id){
        if(handledUrl.current)clearRestoredState();
        handledUrl.current="";
        return;
      }
      const saved=passages.find(item=>item.id===id&&item.slug===page.slug);
      if(!saved){
        if(handledUrl.current===`${page.slug}:${id}`){clearRestoredState();handledUrl.current="";}
        setNotice({message:"这条划词收藏不在当前浏览器中，或已取消收藏。",error:true});
        return;
      }
      if(!force&&handledUrl.current===`${page.slug}:${id}`)return;
      handledUrl.current=`${page.slug}:${id}`;
      onLanguage(saved.language);
      if(saved.language==="en")onCompare(true);
      setRestored(null);
      // A fresh request also re-runs restoration after a BFCache history return.
      setRestoreRequest({...saved});
    };
    const onHistory=()=>inspectUrl();
    const onPageShow=(event:PageTransitionEvent)=>{if(event.persisted)inspectUrl(true);};
    inspectUrl();
    window.addEventListener("popstate",onHistory);
    window.addEventListener("pageshow",onPageShow);
    return()=>{window.removeEventListener("popstate",onHistory);window.removeEventListener("pageshow",onPageShow);};
  },[hydrated,page,passages,onCompare,onLanguage]);

  useEffect(()=>{
    if(!restoreRequest||!page||restoreRequest.slug!==page.slug||!enabled||completedRestore.current===restoreRequest)return;
    if(restoreRequest.language==="en"&&!compare)return;
    const article=articleFor(restoreRequest.language);
    if(!article)return;
    const view=viewFor(article);
    const position=resolveTextAnchor(article.textContent||"",restoreRequest.anchor);
    const range=position?rangeFromOffsets(article,position):null;
    if(!range){
      completedRestore.current=restoreRequest;
      setRestored({passage:restoreRequest,found:false});
      activeRange.current=null;
      highlightRange(null);
      const section=restoreRequest.sectionId
        ? [...article.querySelectorAll<HTMLElement>("h1[id],h2[id],h3[id],h4[id]")].find(heading=>heading.id===restoreRequest.sectionId)
        : undefined;
      (section||view).scrollIntoView({block:"start",behavior:"instant"});
      return;
    }
    let cancelled=false, userInteracted=false, observer:ResizeObserver|undefined;
    let frame=0, settleTimer=0;
    const onInteraction=()=>{userInteracted=true;completedRestore.current=restoreRequest;};
    const keepInView=()=>{
      if(cancelled||userInteracted||!range.startContainer.isConnected)return;
      const rect=[...range.getClientRects()].find(r=>r.width>0&&r.height>0);
      if(!rect)return;
      const header=document.querySelector(".site-header");
      const viewport=window.visualViewport;
      const viewportTop=viewport?.offsetTop||0;
      const top=Math.max(viewportTop,header?.getBoundingClientRect().bottom||80)+32;
      const target=Math.max(top,viewportTop+Math.min((viewport?.height||window.innerHeight)*.32,240));
      window.scrollBy({top:rect.top-target,behavior:"instant"});
    };
    const restore=()=>{
      if(cancelled||userInteracted)return;
      frame=window.requestAnimationFrame(()=>{
        if(cancelled||userInteracted)return;
        view.focus({preventScroll:true});
        const selection=window.getSelection();
        selection?.removeAllRanges(); selection?.addRange(range);
        activeRange.current=range;
        completedRestore.current=restoreRequest;
        highlightRange(range);
        setRestored({passage:restoreRequest,found:true});
        keepInView();
        // Lazy media and font loading may move the destination. Settle briefly,
        // stopping immediately when the reader starts interacting.
        observer=new ResizeObserver(()=>{if(!userInteracted)keepInView();});
        observer.observe(view);
        settleTimer=window.setTimeout(()=>observer?.disconnect(),2000);
      });
    };
    // Respect interaction while waiting for fonts, not just after the first scroll.
    window.addEventListener("wheel",onInteraction,{passive:true});
    window.addEventListener("pointerdown",onInteraction,{passive:true});
    window.addEventListener("keydown",onInteraction);
    // A saved quote may belong to an inactive language inside a table. Reveal
    // that content before restoring its real selection and measuring geometry.
    Promise.resolve(onReveal(range,restoreRequest.language)).then(()=>{
      if(cancelled||userInteracted)return;
      if(document.fonts.status==="loaded")restore();else document.fonts.ready.then(restore);
    });
    return()=>{
      cancelled=true;window.cancelAnimationFrame(frame);window.clearTimeout(settleTimer);observer?.disconnect();
      window.removeEventListener("wheel",onInteraction);window.removeEventListener("pointerdown",onInteraction);window.removeEventListener("keydown",onInteraction);
    };
  },[restoreRequest,compare,page,enabled,onReveal]);

  useEffect(()=>{
    if(!page||!enabled){updateDraft(null);return;}
    let dragging=false,timer=0,frame=0,dismissedSelection="";
    const inspectSelection=()=>{
      if(dragging)return;
      const selection=window.getSelection();
      if(!selection||selection.isCollapsed||!selection.rangeCount){
        if(!menuRef.current?.contains(document.activeElement))updateDraft(null);
        return;
      }
      const selected=selection.getRangeAt(0);
      const parent=selected.startContainer.nodeType===Node.ELEMENT_NODE?selected.startContainer as Element:selected.startContainer.parentElement;
      const article=parent?.closest<HTMLElement>(".article-zh,.article-en");
      if(!article||!article.contains(selected.endContainer)){updateDraft(null);return;}
      const anchor=anchorFromRange(article,selected);
      if(!anchor){updateDraft(null);return;}
      const selectionKey=`${article.classList.contains("article-en")?"en":"zh"}:${anchor.start}:${anchor.end}:${anchor.exact}`;
      if(selectionKey===dismissedSelection){updateDraft(null);return;}
      dismissedSelection="";
      const range=rangeFromOffsets(article,anchor);
      if(!range){updateDraft(null);return;}
      const position=menuPosition(range,lastTouch.current);
      if(!position){updateDraft(null);return;}
      updateDraft({slug:page.slug,language:article.classList.contains("article-en")?"en":"zh",quote:selection.toString().trim(),anchor,...sectionForRange(article,range),range,...position});
    };
    const schedule=()=>{window.clearTimeout(timer);timer=window.setTimeout(inspectSelection,120);};
    const pointerDown=(event:PointerEvent)=>{
      if(menuRef.current?.contains(event.target as Node))return;
      dismissedSelection="";
      lastTouch.current=event.pointerType==="touch";
      dragging=event.pointerType==="mouse";
      updateDraft(null);
    };
    const pointerUp=()=>{dragging=false;schedule();};
    const moveMenu=()=>{
      window.cancelAnimationFrame(frame);
      frame=window.requestAnimationFrame(()=>{
        const current=draftRef.current;
        if(!current)return;
        const position=menuPosition(current.range,lastTouch.current);
        updateDraft(position?{...current,...position}:null);
      });
    };
    const onKey=(event:KeyboardEvent)=>{
      if(event.key==="Escape"){
        const current=draftRef.current;
        if(current)dismissedSelection=`${current.language}:${current.anchor.start}:${current.anchor.end}:${current.anchor.exact}`;
        window.clearTimeout(timer);updateDraft(null);
      }
      if(event.altKey&&event.key.toLowerCase()==="s"&&draftRef.current){event.preventDefault();menuRef.current?.querySelector("button")?.focus();}
    };
    document.addEventListener("selectionchange",schedule);
    document.addEventListener("pointerdown",pointerDown);
    document.addEventListener("pointerup",pointerUp);
    document.addEventListener("pointercancel",pointerUp);
    document.addEventListener("keyup",schedule);
    document.addEventListener("keydown",onKey);
    window.addEventListener("scroll",moveMenu,{passive:true});
    window.addEventListener("resize",moveMenu);
    window.visualViewport?.addEventListener("resize",moveMenu);
    window.visualViewport?.addEventListener("scroll",moveMenu);
    return()=>{
      window.clearTimeout(timer);window.cancelAnimationFrame(frame);
      document.removeEventListener("selectionchange",schedule);document.removeEventListener("pointerdown",pointerDown);
      document.removeEventListener("pointerup",pointerUp);document.removeEventListener("pointercancel",pointerUp);
      document.removeEventListener("keyup",schedule);document.removeEventListener("keydown",onKey);
      window.removeEventListener("scroll",moveMenu);window.removeEventListener("resize",moveMenu);
      window.visualViewport?.removeEventListener("resize",moveMenu);
      window.visualViewport?.removeEventListener("scroll",moveMenu);
    };
  },[page,compare,enabled]);

  useEffect(()=>()=>{highlightRange(null);},[]);

  function saveSelection() {
    const current=draftRef.current;
    if(!current)return;
    try {
      const saved=readPassages();
      if(saved.some(item=>isSamePassage(item,current))){setNotice({message:"这段文字已经收藏。",saved:true});return;}
      const {range,x,y,...data}=current;
      const entry:SavedPassage={...data,id:crypto.randomUUID(),createdAt:new Date().toISOString()};
      const next=[entry,...saved];
      writePassages(next); setPassages(next);
      const selection=window.getSelection();selection?.removeAllRanges();selection?.addRange(range);
      activeRange.current=range;highlightRange(range);
      setNotice({message:"已收藏这段文字。",saved:true});
    }catch{setNotice({message:"收藏未能保存。请检查浏览器是否允许本地存储，或存储空间是否已满。",error:true});}
  }

  function dismissRestored() {
    clearRestoredState();handledUrl.current="";
    const url=new URL(window.location.href);url.searchParams.delete("passage");
    window.history.replaceState(window.history.state,"",url.pathname+url.search+url.hash);
  }

  function removePassage(id:string) {
    try {
      const next=readPassages().filter(item=>item.id!==id);
      writePassages(next);setPassages(next);
      if(restored?.passage.id===id)dismissRestored();
      else {highlightRange(null);activeRange.current=null;}
      setNotice({message:"已取消收藏。"});
    }catch{setNotice({message:"取消收藏未能保存，请检查浏览器存储设置。",error:true});}
  }

  return {passages,hydrated,draft,menuRef,notice,setNotice,restored,dismissRestored,saveSelection,removePassage,
    selectionSaved:!!draft&&passages.some(item=>isSamePassage(item,draft))};
}
