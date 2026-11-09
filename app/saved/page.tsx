import type {Metadata} from "next";
import GuideApp from "../../components/guide-app";
export const metadata:Metadata={title:"我的收藏 · Android AI 眼镜设计指南",description:"回看已收藏的 Android 应用设计内容，了解如何为无屏眼镜与带屏眼镜设计体验，并回到原文位置继续阅读。",robots:{index:false,follow:false}};
export default function Saved(){return <GuideApp view="saved"/>;}
