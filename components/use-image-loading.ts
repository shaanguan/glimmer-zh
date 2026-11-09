"use client";

import {useEffect} from "react";

type ImageEntry = {
  frame: HTMLElement;
  source: string;
  retries: number;
  generation: number;
};

const imageSelector = ".image-frame img[data-image-prepared]";
const svgNamespace = "http://www.w3.org/2000/svg";

function retryButton(image: HTMLImageElement): HTMLButtonElement {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "image-retry";
  button.setAttribute("aria-label", image.alt ? `重新加载图片：${image.alt}` : "重新加载图片");
  button.title = "重新加载图片";
  const svg = document.createElementNS(svgNamespace, "svg");
  for (const [name, value] of Object.entries({viewBox: "0 0 24 24", width: "22", height: "22", fill: "none", stroke: "currentColor", "stroke-width": "1.7", "stroke-linecap": "round", "stroke-linejoin": "round", "aria-hidden": "true", focusable: "false"})) {
    svg.setAttribute(name, value);
  }
  for (const d of ["M3 11a9 9 0 1 1 2.6 6.4", "M3 4v7h7"]) {
    const path = document.createElementNS(svgNamespace, "path");
    path.setAttribute("d", d);
    svg.appendChild(path);
  }
  button.appendChild(svg);
  return button;
}

/** Call once in the reading shell. Delegated events cover all current pages;
 * observing inserted nodes also handles language/table switches and navigation. */
export function useImageLoading(): void {
  useEffect(() => {
    const entries = new WeakMap<HTMLImageElement, ImageEntry>();
    let disposed = false;

    const entryFor = (image: HTMLImageElement): ImageEntry | undefined => {
      const previous = entries.get(image);
      if (previous) return previous;
      if (!image.matches(imageSelector)) return undefined;
      const frame = image.closest<HTMLElement>(".image-frame");
      if (!frame) return undefined;
      const entry = {frame, source: image.getAttribute("src") || "", retries: 0, generation: 0};
      entries.set(image, entry);
      return entry;
    };

    const update = (image: HTMLImageElement, state: "loading" | "loaded" | "error") => {
      const entry = entryFor(image);
      if (!entry) return;
      if (state !== "loaded") entry.generation += 1;
      const {frame} = entry;
      frame.classList.toggle("is-loading", state === "loading");
      frame.classList.toggle("is-loaded", state === "loaded");
      frame.classList.toggle("is-error", state === "error");
      if (state === "loading") frame.setAttribute("aria-busy", "true");
      else frame.removeAttribute("aria-busy");

      // Keep manifest dimensions stable: a viewBox-only SVG can report the
      // browser's default naturalWidth rather than the file's measured width.
      if (state === "loaded" && !frame.hasAttribute("data-image-measured") && image.naturalWidth > 0 && image.naturalHeight > 0) {
        frame.style.setProperty("--image-natural-width", `${image.naturalWidth}px`);
        frame.style.setProperty("--image-aspect-ratio", `${image.naturalWidth} / ${image.naturalHeight}`);
      }
      const retry = frame.querySelector<HTMLButtonElement>(".image-retry");
      if (state === "error") {
        if (!retry) frame.appendChild(retryButton(image));
      } else retry?.remove();
    };

    const reveal = async (image: HTMLImageElement) => {
      const entry = entryFor(image);
      if (!entry) return;
      const generation = ++entry.generation;
      // A load event can precede decoding with decoding="async". Keep the
      // placeholder until pixels are ready, without adding a cosmetic delay.
      try { if (typeof image.decode === "function") await image.decode(); } catch {}
      if (disposed || !image.isConnected || generation !== entry.generation) return;
      update(image, image.naturalWidth > 0 ? "loaded" : "error");
    };

    const inspect = (image: HTMLImageElement) => {
      if (!entryFor(image)) return;
      // complete also becomes true for failed images; naturalWidth distinguishes
      // a cached success from a failure that happened before this effect ran.
      if (image.complete && image.naturalWidth > 0) void reveal(image);
      else update(image, image.complete ? "error" : "loading");
    };

    const scan = (node: Document | Element) => {
      if (node instanceof HTMLImageElement && node.matches(imageSelector)) inspect(node);
      node.querySelectorAll<HTMLImageElement>(imageSelector).forEach(inspect);
    };

    const onLoad = (event: Event) => {
      if (event.target instanceof HTMLImageElement) void reveal(event.target);
    };
    const onError = (event: Event) => {
      if (event.target instanceof HTMLImageElement) update(event.target, "error");
    };
    const onRetry = (event: MouseEvent) => {
      const target = event.target instanceof Element ? event.target : null;
      const button = target?.closest<HTMLButtonElement>(".image-retry");
      if (!button) return;
      const frame = button.closest<HTMLElement>(".image-frame");
      const image = frame?.querySelector<HTMLImageElement>("img[data-image-prepared]");
      if (!image) return;
      const entry = entryFor(image);
      if (!entry) return;
      // The overview contains linked images. Capture the retry before the link
      // or the React navigation handler can receive it.
      event.preventDefault();
      event.stopPropagation();
      const source = image.currentSrc || entry.source;
      if (!source) return;
      let url: URL;
      try { url = new URL(source, document.baseURI); }
      catch { return; }
      entry.retries += 1;
      url.searchParams.set("_image_retry", `${Date.now()}-${entry.retries}`);
      update(image, "loading");
      // Current guide assets use src only. For a responsive image, retry the
      // selected candidate so srcset cannot silently override the new request.
      image.removeAttribute("srcset");
      image.closest("picture")?.querySelectorAll("source[srcset]").forEach(source => source.removeAttribute("srcset"));
      image.src = url.href;
    };

    document.addEventListener("load", onLoad, true);
    document.addEventListener("error", onError, true);
    document.addEventListener("click", onRetry, true);
    const observer = new MutationObserver(records => {
      for (const record of records) {
        for (const node of record.addedNodes) {
          if (node instanceof Element) scan(node);
        }
      }
    });
    observer.observe(document.body, {childList: true, subtree: true});
    scan(document);

    return () => {
      disposed = true;
      observer.disconnect();
      document.removeEventListener("load", onLoad, true);
      document.removeEventListener("error", onError, true);
      document.removeEventListener("click", onRetry, true);
    };
  }, []);
}
