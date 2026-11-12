import type {Metadata} from "next";
import {notFound} from "next/navigation";
import GuideApp from "../../../components/guide-app";
import library from "../../../content/library.json";
import {pageMetadata, SITE_DESCRIPTION, SITE_TITLE} from "../../../lib/site";
export async function generateMetadata({params}:{params:Promise<{slug:string}>}):Promise<Metadata>{
  const {slug}=await params;
  const page=library.find(p=>p.slug===slug);
  if(!page)return pageMetadata({title:"未找到页面 · Android AI 眼镜设计指南",description:SITE_DESCRIPTION,path:`/guide/${slug}`,index:false});
  if(slug==="overview")return pageMetadata({title:SITE_TITLE,description:page.description,path:"/"});
  return pageMetadata({title:`${page.title} · Android AI 眼镜设计指南`,description:`${page.description} Android Developers 中文译本，面向无屏眼镜与带屏眼镜的 Android 应用体验设计。`,path:`/guide/${slug}`});
}
export default async function Guide({params}:{params:Promise<{slug:string}>}){const {slug}=await params;if(!library.some(p=>p.slug===slug))notFound();return <GuideApp view={slug==="overview"?"home":"guide"} slug={slug}/>;}
