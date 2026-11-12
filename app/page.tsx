import type {Metadata} from "next";
import GuideApp from "../components/guide-app";
import {pageMetadata, SITE_DESCRIPTION, SITE_TITLE} from "../lib/site";
export const metadata:Metadata=pageMetadata({title:SITE_TITLE,description:SITE_DESCRIPTION,path:"/"});
export default function Home(){return <><link rel="preload" as="image" href="/assets/overview/hero-bridge.webp" fetchPriority="high"/><GuideApp view="home" slug="overview"/></>;}
