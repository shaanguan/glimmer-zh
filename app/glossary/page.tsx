import type {Metadata} from "next";
import GuideApp from "../../components/guide-app";
export const metadata:Metadata={title:"中英术语表 · Android AI 眼镜设计指南",description:"查阅面向无屏眼镜与带屏眼镜的 Android 应用设计术语，结合原文理解中文译法及其具体含义。"};
export default function Glossary(){return <GuideApp view="glossary"/>;}
