import imageDimensions from "../content/image-dimensions.json" with {type: "json"};

type ImageDimensions = {width: number; height: number};
const dimensions = imageDimensions as Record<string, ImageDimensions>;
const imageTag = /<img\b(?:[^>"']|"[^"]*"|'[^']*')*>/i;
const imageFragment = /<picture\b(?:[^>"']|"[^"]*"|'[^']*')*>[\s\S]*?<\/picture\s*>|<img\b(?:[^>"']|"[^"]*"|'[^']*')*>/gi;

function attribute(tag: string, name: string): string | undefined {
  const match = new RegExp(`(?:^|\\s)${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s"'=<>\x60]+))`, "i").exec(tag);
  return match ? match[1] ?? match[2] ?? match[3] : undefined;
}

function sourceDimensions(source: string): ImageDimensions | undefined {
  // The content's images are local assets. A query string must not prevent a
  // match against the manifest's pathname.
  try {
    const pathname = new URL(source.replace(/&amp;/g, "&"), "https://local.invalid").pathname;
    return dimensions[decodeURIComponent(pathname)];
  } catch {
    return undefined;
  }
}

/** Add loading surfaces only at the final rendering boundary. The original
 * strings and all text nodes stay intact, so passage offsets do not change. */
export function prepareImages(html: string): string {
  return html.replace(imageFragment, fragment => {
    const tag = imageTag.exec(fragment)?.[0];
    if (!tag || /\sdata-image-prepared(?:\s|=|\/?>)/i.test(tag)) return fragment;

    const measured = sourceDimensions(attribute(tag, "src") || "");
    const width = measured?.width ?? 960;
    const height = measured?.height ?? 540;
    let additions = ' data-image-prepared=""';
    if (measured && attribute(tag, "width") === undefined) additions += ` width="${width}"`;
    if (measured && attribute(tag, "height") === undefined) additions += ` height="${height}"`;
    if (attribute(tag, "decoding") === undefined) additions += ' decoding="async"';
    const prepared = tag.replace(/\/?>(?=$)/, ending => `${additions}${ending}`);
    const content = fragment.replace(tag, prepared);
    // A span also remains valid when the image is inside a paragraph or link.
    // Wrapping the whole picture preserves its source-to-img relationship.
    // The initial server-rendered page already has a loading surface. Waiting
    // for the client effect would leave a blank space while JavaScript loads.
    return `<span class="image-frame is-loading"${measured ? ' data-image-measured=""' : ""} style="--image-natural-width:${width}px;--image-aspect-ratio:${width} / ${height}">${content}</span>`;
  });
}
