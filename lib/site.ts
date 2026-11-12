import type { Metadata } from "next";

export const SITE_ORIGIN = "https://glimmer.zhoub.xyz";
export const SITE_NAME = "Android AI 眼镜设计指南";
export const SITE_TITLE = "Android AI 眼镜设计指南 · 中文译本";
export const SITE_DESCRIPTION = "Android Developers AI 眼镜设计指南的中文译本，帮助设计师将 Android 应用体验扩展到无屏眼镜与带屏眼镜。";
export const SHARE_IMAGE = "/og.png";

export function pageMetadata({
  title,
  description,
  path,
  index = true,
}: {
  title: string;
  description: string;
  path: string;
  index?: boolean;
}): Metadata {
  return {
    title,
    description,
    alternates: { canonical: path },
    robots: index ? { index: true, follow: true } : { index: false, follow: false },
    openGraph: {
      type: "website",
      locale: "zh_CN",
      siteName: SITE_NAME,
      url: path,
      title,
      description,
      images: [{ url: SHARE_IMAGE, width: 1200, height: 630, alt: "Android AI 眼镜设计指南中文译本" }],
    },
    twitter: {
      card: "summary_large_image",
      title,
      description,
      images: [SHARE_IMAGE],
    },
  };
}
