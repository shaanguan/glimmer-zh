"use client";

import {useEffect, type RefObject} from "react";

const layoutSelector = '.source-layout[data-layout-kind="tabs"]';
const panelSelector = `${layoutSelector} > .source-column`;
const headingSelector = "h1,h2,h3,h4,h5,h6";

type SourceTabs = {
  root: HTMLElement;
  panels: HTMLElement[];
  headings: HTMLElement[];
  labels: string[];
  selected: () => number;
  activate: (index: number, focus?: boolean) => void;
  dispose: () => void;
};

const controllers = new WeakMap<HTMLElement, SourceTabs>();
let identifier = 0;

function labelFor(heading: HTMLElement): string {
  return (heading.textContent || "").replace(/\s+/g, " ").trim();
}

function panelsFor(root: HTMLElement): HTMLElement[] {
  return [...root.children].filter((node): node is HTMLElement =>
    node instanceof HTMLElement && node.classList.contains("source-column"));
}

function uniqueId(document: Document, kind: "tab" | "panel"): string {
  let id: string;
  do {id = `source-${kind}-${++identifier}`;} while (document.getElementById(id));
  return id;
}

/** Enhance existing panels in place. No original text nodes are rewritten. */
function initialize(root: HTMLElement): SourceTabs | undefined {
  const panels = panelsFor(root);
  const headings = panels.map(panel => panel.querySelector<HTMLElement>(headingSelector));
  const previous = controllers.get(root);
  if (previous && previous.panels.length === panels.length &&
    panels.every((panel, index) => panel === previous.panels[index] &&
      headings[index] === previous.headings[index] &&
      labelFor(previous.headings[index]) === previous.labels[index])) return previous;

  const preferred = previous?.selected() || 0;
  previous?.dispose();
  if (panels.length < 2 || headings.some(heading => !heading || !labelFor(heading))) return;
  const titles = headings as HTMLElement[];
  const labels = titles.map(labelFor);
  const document = root.ownerDocument;
  const originals = new Map<HTMLElement, Map<string, string | null>>();
  const addedHeadingClasses = titles.filter(heading => !heading.classList.contains("source-tab-heading"));
  const remember = (element: HTMLElement, name: string) => {
    if (!originals.has(element)) originals.set(element, new Map());
    const attributes = originals.get(element)!;
    if (!attributes.has(name)) attributes.set(name, element.getAttribute(name));
  };
  const set = (element: HTMLElement, name: string, value: string) => {
    remember(element, name);
    element.setAttribute(name, value);
  };

  const list = document.createElement("div");
  list.className = "source-tablist";
  list.setAttribute("role", "tablist");
  list.setAttribute("aria-orientation", "horizontal");
  list.setAttribute("aria-label", root.closest(".article-en") ? "Content options" : "内容选项");
  const buttons = panels.map((panel, index) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "source-tab";
    button.id = uniqueId(document, "tab");
    button.dataset.label = labels[index];
    button.setAttribute("role", "tab");
    button.setAttribute("aria-label", labels[index]);
    if (!panel.id) set(panel, "id", uniqueId(document, "panel"));
    button.setAttribute("aria-controls", panel.id);
    set(panel, "role", "tabpanel");
    set(panel, "aria-labelledby", button.id);
    set(panel, "tabindex", "0");
    remember(panel, "hidden");
    titles[index].classList.add("source-tab-heading");
    // CSS renders data-label; adding button text would change passage offsets.
    list.appendChild(button);
    return button;
  });

  let active = Math.min(preferred, panels.length - 1);
  const activate = (index: number, focus = false) => {
    if (index < 0 || index >= panels.length) return;
    active = index;
    panels.forEach((panel, i) => {
      const selected = i === index;
      if (!selected && !panel.hidden) {
        panel.querySelectorAll<HTMLMediaElement>("audio,video").forEach(media => {
          if (!media.paused) media.pause();
        });
      }
      panel.hidden = !selected;
      buttons[i].setAttribute("aria-selected", String(selected));
      buttons[i].tabIndex = selected ? 0 : -1;
    });
    if (focus) buttons[index].focus({preventScroll: true});
  };
  const eventIndex = (event: Event) => {
    const button = event.target instanceof Element ? event.target.closest<HTMLButtonElement>(".source-tab") : null;
    return button ? buttons.indexOf(button) : -1;
  };
  const onClick = (event: MouseEvent) => {
    const index = eventIndex(event);
    if (index >= 0) activate(index);
  };
  const onKeyDown = (event: KeyboardEvent) => {
    const index = eventIndex(event);
    if (index < 0) return;
    const next = event.key === "ArrowRight" ? (index + 1) % panels.length :
      event.key === "ArrowLeft" ? (index + panels.length - 1) % panels.length :
      event.key === "Home" ? 0 : event.key === "End" ? panels.length - 1 : null;
    if (next === null) return;
    event.preventDefault();
    activate(next, true);
  };
  list.addEventListener("click", onClick);
  list.addEventListener("keydown", onKeyDown);

  const controller: SourceTabs = {
    root, panels, headings: titles, labels, selected: () => active, activate,
    dispose: () => {
      list.removeEventListener("click", onClick);
      list.removeEventListener("keydown", onKeyDown);
      list.remove();
      originals.forEach((attributes, element) => attributes.forEach((value, name) => {
        if (value === null) element.removeAttribute(name);
        else element.setAttribute(name, value);
      }));
      addedHeadingClasses.forEach(heading => heading.classList.remove("source-tab-heading"));
      if (controllers.get(root) === controller) controllers.delete(root);
    },
  };
  controllers.set(root, controller);
  root.insertBefore(list, root.firstChild);
  activate(active);
  return controller;
}

function elementFor(node: Node, offset?: number): HTMLElement | null {
  const child = offset === undefined ? undefined : node.childNodes[offset];
  const boundary = child || node;
  return boundary instanceof HTMLElement ? boundary : boundary.parentElement;
}

function ancestorPanels(element: HTMLElement | null): HTMLElement[] {
  const result: HTMLElement[] = [];
  for (let current = element; current; current = current.parentElement) {
    if (current.matches(panelSelector)) result.unshift(current);
  }
  return result;
}

function activatePanels(panels: HTMLElement[]): void {
  const selected = new Set<HTMLElement>();
  for (const panel of panels) {
    const root = panel.parentElement;
    if (!root || selected.has(root)) continue;
    const controller = initialize(root);
    if (!controller) continue;
    selected.add(root);
    controller.activate(controller.panels.indexOf(panel));
  }
}

/** Reveal a bookmark without editing its Range, quote, or native selection.
 * When it spans several panels of one selector, the start panel takes priority. */
export function revealSourceTabs(range: Range): void {
  const panels = ancestorPanels(elementFor(range.startContainer, range.startOffset));
  const common = range.commonAncestorContainer;
  const scope = common instanceof Element ? common : common.parentElement;
  scope?.querySelectorAll<HTMLElement>(panelSelector).forEach(panel => {
    try {if (range.intersectsNode(panel)) panels.push(panel);} catch {}
  });
  panels.push(...ancestorPanels(elementFor(range.endContainer, range.endOffset)));
  activatePanels(panels);
}

/** Also works before the hook's first effect, for an early anchor/bookmark jump. */
export function revealSourceHeading(element: HTMLElement): void {
  activatePanels(ancestorPanels(element));
}

/** Hidden tab panels are eligible; a hidden language/layout counterpart is not. */
function languageIsVisible(element: HTMLElement, view: HTMLElement): boolean {
  for (let current = element.parentElement; current; current = current.parentElement) {
    if (!current.matches(panelSelector) && (current.hidden || getComputedStyle(current).display === "none")) return false;
    if (current === view) return true;
  }
  return false;
}

/** Initialize once per content tree. Attribute-only reading controls never
 * rebuild tabs; inserted content is enhanced without replacing any paragraphs. */
export function useSourceTabs(viewRef: RefObject<HTMLElement | null>, contentKey: unknown): void {
  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    const managed = new Map<HTMLElement, SourceTabs>();
    let scrollFrame = 0;
    let disposed = false;
    const adopt = (root: HTMLElement) => {
      const controller = initialize(root);
      if (!controller || managed.get(root) === controller) return false;
      managed.set(root, controller);
      return true;
    };
    const scan = (node: Element) => {
      let changed = node instanceof HTMLElement && node.matches(layoutSelector) ? adopt(node) : false;
      node.querySelectorAll<HTMLElement>(layoutSelector).forEach(root => {changed = adopt(root) || changed;});
      return changed;
    };
    const revealHash = (scroll: boolean) => {
      if (!window.location.hash) return;
      let id: string;
      try {id = decodeURIComponent(window.location.hash.slice(1));} catch {return;}
      const base = id.replace(/^en-/, "");
      const candidates = [...view.querySelectorAll<HTMLElement>("[id]")]
        .filter(element => element.id === base || element.id === `en-${base}`)
        .sort((a, b) => Number(b.id === id) - Number(a.id === id));
      const target = candidates.find(element => languageIsVisible(element, view));
      if (!target || !ancestorPanels(target).length) return;
      revealSourceHeading(target);
      if (!scroll) return;
      const destination = target.classList.contains("source-tab-heading") ?
        target.closest<HTMLElement>('.source-column[role="tabpanel"]') || target : target;
      window.cancelAnimationFrame(scrollFrame);
      scrollFrame = window.requestAnimationFrame(() => {
        if (!disposed && view.contains(destination) && !destination.closest("[hidden]") && languageIsVisible(destination, view)) {
          destination.scrollIntoView({block: "start", behavior: "instant"});
        }
      });
    };
    const onHashChange = () => revealHash(true);
    scan(view);
    const observer = new MutationObserver(records => {
      let changed = false;
      for (const record of records) {
        if (record.target instanceof Element) {
          const root = record.target.closest<HTMLElement>(layoutSelector);
          if (root && view.contains(root)) changed = adopt(root) || changed;
        }
        for (const node of record.addedNodes) {
          if (node instanceof Element && view.contains(node)) changed = scan(node) || changed;
        }
      }
      for (const [root, controller] of managed) {
        if (!view.contains(root)) {controller.dispose(); managed.delete(root);}
      }
      // A language change may replace the rendered tree. Keep its hash panel
      // available without unexpectedly scrolling the reader back to that hash.
      if (changed) revealHash(false);
    });
    observer.observe(view, {childList: true, subtree: true});
    window.addEventListener("hashchange", onHashChange);
    revealHash(true);
    return () => {
      disposed = true;
      observer.disconnect();
      window.cancelAnimationFrame(scrollFrame);
      window.removeEventListener("hashchange", onHashChange);
      managed.forEach(controller => controller.dispose());
      managed.clear();
    };
  }, [viewRef, contentKey]);
}

export default useSourceTabs;
