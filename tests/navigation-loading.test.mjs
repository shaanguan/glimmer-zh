import test from "node:test";
import assert from "node:assert/strict";
import {navigationTarget} from "../components/use-navigation-loading.ts";

const current = "https://guide.example/guide/foundations-design-principles?passage=saved#focus";

test("tracks native document navigation and preserves passage query/hash", () => {
  assert.deepEqual(navigationTarget("/guide/components-buttons?passage=a#size", current), {
    href: "/guide/components-buttons?passage=a#size",
    sameDocumentFragment: false,
    isCurrentUrl: false,
  });
  for (const path of ["/", "/glossary", "/saved", "/about", "/guide/overview", "/saved/"]) {
    assert.equal(navigationTarget(path, current)?.sameDocumentFragment, false, path);
  }
});

test("same path/query without a fragment is a reload, not an in-page jump", () => {
  const target = navigationTarget("/guide/foundations-design-principles?passage=saved", current);
  assert.equal(target.sameDocumentFragment, false);
  assert.equal(target.isCurrentUrl, false);
  const withoutFragment = "https://guide.example/glossary";
  assert.deepEqual(navigationTarget("/glossary", withoutFragment), {
    href: "/glossary", sameDocumentFragment: false, isCurrentUrl: true,
  });
});

test("explicit fragments, including bare #, stay in the current document", () => {
  assert.equal(navigationTarget("#new-section", current).sameDocumentFragment, true);
  assert.equal(navigationTarget("#focus", current).isCurrentUrl, true);
  assert.deepEqual(navigationTarget("#", current), {
    href: "/guide/foundations-design-principles?passage=saved#",
    sameDocumentFragment: true,
    isCurrentUrl: false,
  });
  assert.equal(navigationTarget("/glossary#", current).sameDocumentFragment, false);
  assert.equal(navigationTarget("?passage=different#focus", current).sameDocumentFragment, false);
});

test("normalizes relative app links and same-origin absolute links", () => {
  assert.equal(navigationTarget("components-buttons", current).href, "/guide/components-buttons");
  assert.equal(navigationTarget("https://GUIDE.example:443/saved", current).href, "/saved");
  assert.equal(navigationTarget("//guide.example/about", current).href, "/about");
});

test("ignores external origins, non-web schemes, credentials and malformed URLs", () => {
  for (const href of ["https://external.example/about", "http://guide.example/about", "https://guide.example:444/about", "mailto:help@example.com", "javascript:void(0)", "data:text/html,test", "https://user:password@guide.example/about", "http://["]) {
    assert.equal(navigationTarget(href, current), null, href);
  }
});

test("does not leave document loading feedback for media, downloads or non-app paths", () => {
  for (const href of ["/assets/original/hero.png", "/manual.pdf", "/api/export", "/guide", "/guide/components/buttons", "/saved/archive"]) {
    assert.equal(navigationTarget(href, current), null, href);
  }
});
