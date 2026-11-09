import test from "node:test";
import assert from "node:assert/strict";
import {createTextAnchor,resolveTextAnchor,passageHref,isSamePassage} from "../lib/passage-anchors.ts";
import {readPassages,writePassages,isSavedPassage,PASSAGES_KEY} from "../lib/passage-storage.ts";

test("round-trips Chinese, surrogate pairs and an inline-formatting boundary", () => {
  const text="说明：👓眼镜界面应当简洁。原文 should 不等于 must。";
  const start=text.indexOf("👓"),end=text.indexOf("原文");
  const anchor=createTextAnchor(text,start,end);
  assert.deepEqual(resolveTextAnchor(text,anchor),{start,end});
  assert.equal(anchor.exact,"👓眼镜界面应当简洁。");
});
test("uses context to recover the intended repeated quote after preceding edits", () => {
  const text="第一章：内容应当简洁。声音反馈。第二章：内容应当简洁。视觉反馈。";
  const start=text.lastIndexOf("内容应当简洁。");
  const anchor=createTextAnchor(text,start,start+8);
  const updated="新增加的导言。"+text;
  const result=resolveTextAnchor(updated,anchor);
  assert.equal(result.start,updated.lastIndexOf("内容应当简洁。"));
});
test("whitespace-only changes preserve exact visible text and offsets", () => {
  const text="Before. Keep text\n  concise and clear. After.";
  const start=text.indexOf("Keep"),end=text.indexOf(" After");
  const anchor=createTextAnchor(text,start,end);
  const updated="New intro. Before. Keep text concise\tand clear. After.";
  const result=resolveTextAnchor(updated,anchor);
  assert.equal(updated.slice(result.start,result.end),"Keep text concise\tand clear.");
});
test("does not substitute a changed translation or guess an ambiguous occurrence", () => {
  const old="原句：界面必须居中。";
  assert.equal(resolveTextAnchor("新句：界面不应居中。",createTextAnchor(old,3,old.length)),null);
  assert.equal(resolveTextAnchor("left repeat middle repeat right",{exact:"repeat",prefix:"",suffix:"",start:99,end:105}),null);
});
test("distinguishes identical words in different contexts and languages", () => {
  const base={slug:"surfaces-app",language:"zh",anchor:createTextAnchor("前文选中后文",2,4)};
  assert.equal(isSamePassage(base,{...base,language:"en"}),false);
  assert.equal(isSamePassage(base,{...base,anchor:{...base.anchor,prefix:"别处"}}),false);
});
test("saves identical passages at distinct positions and restores each original occurrence", () => {
  const quote="可分别收藏的同一段文字";
  const repeated="相同前文".repeat(20)+quote+"相同后文".repeat(20);
  const text=repeated+"\n另一处\n"+repeated;
  const first=text.indexOf(quote),second=text.lastIndexOf(quote);
  const a={slug:"interaction-onboarding",language:"zh",anchor:createTextAnchor(text,first,first+quote.length)};
  const b={...a,anchor:createTextAnchor(text,second,second+quote.length)};
  assert.equal(a.anchor.prefix,b.anchor.prefix);
  assert.equal(a.anchor.suffix,b.anchor.suffix);
  assert.equal(isSamePassage(a,b),false);
  assert.equal(isSamePassage(a,{...a,anchor:{...a.anchor}}),true);
  assert.deepEqual(resolveTextAnchor(text,a.anchor),{start:first,end:first+quote.length});
  assert.deepEqual(resolveTextAnchor(text,b.anchor),{start:second,end:second+quote.length});
});
test("does not restore a different surviving occurrence when the saved one was changed", () => {
  const original="第一处：焦点。第二处：焦点。";
  const start=original.indexOf("焦点");
  const anchor=createTextAnchor(original,start,start+2);
  assert.equal(resolveTextAnchor("第一处：高亮。第二处：焦点。",anchor),null);
});
test("saved data validates and round-trips; storage failures propagate", () => {
  const entry={id:"test-clip",slug:"surfaces-app",language:"zh",quote:"选中",anchor:createTextAnchor("前文选中后文",2,4),sectionId:"layout",sectionTitle:"布局",createdAt:"2026-11-09T00:00:00Z"};
  let data="";
  const storage={getItem:key=>key===PASSAGES_KEY?data:null,setItem:(key,value)=>{assert.equal(key,PASSAGES_KEY);data=value;}};
  assert.equal(isSavedPassage(entry),true);
  writePassages([entry],storage);
  assert.deepEqual(readPassages(storage),[entry]);
  assert.equal(passageHref(entry),"/guide/surfaces-app?passage=test-clip#layout");
  assert.equal(passageHref({...entry,slug:"overview"}),"/?passage=test-clip#layout");
  assert.throws(()=>writePassages([entry],{setItem(){throw new Error("QuotaExceeded");}}),/QuotaExceeded/);
  data='[{"id":"broken"}]';
  assert.throws(()=>readPassages(storage),/Invalid/);
});
