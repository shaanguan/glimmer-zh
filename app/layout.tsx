import type {Metadata} from "next";
import TrafficCollector from "../components/traffic-collector";
import {pageMetadata, SITE_DESCRIPTION, SITE_ORIGIN, SITE_TITLE} from "../lib/site";
import "./globals.css";
export const metadata:Metadata={
  metadataBase:new URL(SITE_ORIGIN),
  ...pageMetadata({title:SITE_TITLE,description:SITE_DESCRIPTION,path:"/"}),
  title:{default:SITE_TITLE,template:"%s"},
  icons:{icon:"/favicon.svg",shortcut:"/favicon.svg"},
};
export default function RootLayout({children}:{children:React.ReactNode}){return <html lang="zh-CN" suppressHydrationWarning><body><noscript dangerouslySetInnerHTML={{__html:"<style>.article-content .image-frame.is-loading{background:transparent!important}.article-content .image-frame.is-loading::before{display:none!important}.article-content .image-frame.is-loading img{opacity:1!important}</style>"}}/>{children}<TrafficCollector/></body></html>;}
