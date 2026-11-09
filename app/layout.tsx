import type {Metadata} from "next";
import "./globals.css";
export const metadata:Metadata={title:"Android AI 眼镜设计指南 · 中文译本",description:"Android Developers AI 眼镜设计指南的中文译本，帮助设计师将 Android 应用体验扩展到无屏眼镜与带屏眼镜。",icons:{icon:"/favicon.svg",shortcut:"/favicon.svg"}};
export default function RootLayout({children}:{children:React.ReactNode}){return <html lang="zh-CN" suppressHydrationWarning><body><noscript dangerouslySetInnerHTML={{__html:"<style>.article-content .image-frame.is-loading{background:transparent!important}.article-content .image-frame.is-loading::before{display:none!important}.article-content .image-frame.is-loading img{opacity:1!important}</style>"}}/>{children}</body></html>;}
