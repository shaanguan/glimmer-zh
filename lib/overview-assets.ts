type OverviewLanguage = "zh" | "en";
type OverviewAsset = {
  src: string;
  alt: Record<OverviewLanguage, string>;
  hero?: boolean;
};

/** Original artwork with canvas extensions; source snapshots and text stay intact. */
export const OVERVIEW_ASSETS: Readonly<Record<string, OverviewAsset>> = {
  "/assets/original/fa92ea53-hero-full-v2.png": {
    src: "/assets/overview/hero-bridge.webp",
    alt: {zh: "虚化的金门大桥暮色背景上，显示 Leyla 的消息卡和 Reply 回复按钮。", en: "A message from Leyla and a Reply button over a blurred Golden Gate Bridge at dusk."},
    hero: true,
  },
  "/assets/original/1a71ad99-surfaces.svg": {
    src: "/assets/overview/principles-expanded-3x2.svg",
    alt: {zh: "四个由两种颜色组成的圆形，按两行两列排列。", en: "Four two-tone circles arranged in two rows and two columns."},
  },
  "/assets/original/b3304161-get-started-layout-content.svg": {
    src: "/assets/overview/surfaces-expanded-3x2.svg",
    alt: {zh: "箭头连接多个圆角界面框，框内含胶囊、圆环和几何图形。", en: "Arrows connect rounded interface frames containing capsules, rings and geometric shapes."},
  },
  "/assets/original/4ccc6fd5-get-started-patterns.svg": {
    src: "/assets/overview/interactions-expanded-3x2.svg",
    alt: {zh: "方形、圆环和三角形通过箭头连接到另一侧的虚线轮廓。", en: "Arrows connect a square, a ring and a triangle to dotted outlines on the opposite side."},
  },
  "/assets/original/a3dedd5f-get-started-styles.svg": {
    src: "/assets/overview/styles-expanded-3x2.svg",
    alt: {zh: "绿色背景上排列相机图标、双色色块、Aa 字样与手绘曲线。", en: "A camera icon, a two-tone color swatch, Aa lettering and a drawn curve on a green background."},
  },
  "/assets/original/c42a683b-glasses_landing_sensing.png": {
    src: "/assets/overview/world-sensing-outpaint-3x2.webp",
    alt: {zh: "双手在台面上揉面，画面上方提示还需揉面 3 分钟。", en: "Hands knead dough on a counter beneath a prompt to keep kneading for three more minutes."},
  },
  "/assets/original/071507e6-glasses_landing_comprehension.png": {
    src: "/assets/overview/comprehension-outpaint-3x2.webp",
    alt: {zh: "视野中显示 Hang floating shelves 卡片，配有置物架参考图片。", en: "A card titled Hang floating shelves shows a reference image of shelves in the user's view."},
  },
  "/assets/original/07dd917b-glasses_landing_assistance.png": {
    src: "/assets/overview/visual-assistance-outpaint-3x2.webp",
    alt: {zh: "餐厅场景中叠加西班牙语翻译字幕和暂停按钮。", en: "Spanish translation captions and a pause button overlay a restaurant scene."},
  },
  "/assets/original/0390597a-glasses_landing_handsfree.png": {
    src: "/assets/overview/hands-free-outpaint-3x2.webp",
    alt: {zh: "第一人称视角记录夕阳下戴草帽的同伴，前景可见牵着的手。", en: "A first-person view of a companion wearing a straw hat at sunset, with joined hands in the foreground."},
  },
  "/assets/original/318b7b98-glasses_landing_audio.png": {
    src: "/assets/overview/audio-glasses-outpaint-16x9.webp",
    alt: {zh: "虚化的皮划艇场景上，显示拍照并发送到群组的语音请求。", en: "A voice request to take a photo and send it to a group overlays a blurred kayak scene."},
  },
  "/assets/original/536cd207-glasses_landing_displayglasses.png": {
    src: "/assets/overview/display-glasses-outpaint-16x9.webp",
    alt: {zh: "虚化的户外步道上叠加日程卡片，内容为 Coffee with Francis 和 30 minutes。", en: "A calendar card reading Coffee with Francis and 30 minutes overlays a blurred outdoor path."},
  },
  "/assets/original/064688a2-glasses_landing_figma.png": {
    src: "/assets/original/064688a2-glasses_landing_figma.png",
    alt: {zh: "渐变背景上的 Jetpack Compose Glimmer Design Kit 标题与眼镜图标。", en: "The Jetpack Compose Glimmer Design Kit title and glasses icon on a gradient background."},
  },
  "/assets/original/d933c706-card-cover-wide_onboard-ae.png": {
    src: "/assets/original/d933c706-card-cover-wide_onboard-ae.png",
    alt: {zh: "包含语音气泡、镜腿按钮、眼镜与方向箭头的教学动效封面。", en: "Onboarding artwork combining a speech bubble, a glasses temple button, glasses and directional arrows."},
  },
  "/assets/original/8c9c89d6-develop.svg": {
    src: "/assets/overview/development-expanded-4x3.svg",
    alt: {zh: "浅绿色网格上排列深绿色的几何图形和组件形状。", en: "Dark olive geometric shapes arranged on a pale green grid."},
  },
};

const imageTag = /<img\b(?:[^>"']|"[^"]*"|'[^']*')*>/gi;

function attributePattern(name: string): RegExp {
  return new RegExp(`\\s${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s"'=<>\x60]+))`, "i");
}

function setAttribute(tag: string, name: string, value: string): string {
  const escaped = value.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  const attribute = ` ${name}="${escaped}"`;
  const pattern = attributePattern(name);
  return pattern.test(tag) ? tag.replace(pattern, () => attribute) :
    tag.replace(/\/?>(?=$)/, ending => attribute + ending);
}

/** Apply before prepareImages, so loading frames use the replacement's dimensions.
 * Only actual img attributes change; English hidden media placeholders retain
 * their source attributes, whitespace, IDs, links and bookmark text offsets. */
export function applyOverviewAssets(html: string, language: OverviewLanguage): string {
  return html.replace(imageTag, tag => {
    const source = attributePattern("src").exec(tag);
    const path = source?.[1] ?? source?.[2] ?? source?.[3] ?? "";
    const asset = Object.hasOwn(OVERVIEW_ASSETS, path) ? OVERVIEW_ASSETS[path] : undefined;
    if (!asset) return tag;
    let result = setAttribute(setAttribute(tag, "src", asset.src), "alt", asset.alt[language]);
    // Stale source dimensions must not override the replacement's manifest entry.
    result = result.replace(attributePattern("width"), "").replace(attributePattern("height"), "");
    if (asset.hero) {
      result = setAttribute(setAttribute(result, "loading", "eager"), "fetchpriority", "high");
    }
    return result;
  });
}
