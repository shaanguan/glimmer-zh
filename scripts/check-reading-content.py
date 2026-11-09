"""Regression checks for readingGroups and wrapTables against the full corpus.

Uses Node's built-in TypeScript support and the HTML5 parser already used by
generate-parallel.py; it does not build the app or add a runtime dependency.

  python scripts/check-reading-content.py
"""

from __future__ import annotations

from collections import Counter
import hashlib
import json
from pathlib import Path
import subprocess
from xml.dom import Node

import html5lib


ROOT = Path(__file__).resolve().parents[1]
INPUTS = [ROOT / name for name in (
    "lib/parallel-content.ts", "content/library.json", "content/parallel.json",
)]
MEDIA = {"img", "video", "audio"}
HEADINGS = {f"h{i}" for i in range(1, 7)}

NODE_CHECK = r"""
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {readingGroups, wrapTables} from './lib/parallel-content.ts';

const make = (id, kind, html) => ({id, kind, zh:html, en:html});
const rows = [
  make('heading-a', 'heading', '<h2 id="a">A</h2>'),
  make('intro-a', 'text', '<p>Explanation.</p><ul><li>Related rule.</li></ul>'),
  make('image-a', 'media', '<figure><img src="same.png"></figure>'),
  make('caption-a', 'text', '<figcaption>After the first image.</figcaption>'),
  make('heading-b', 'heading', '<h2 id="b">B</h2>'),
  make('intro-b', 'text', '<p>Before the second image.</p>'),
  make('image-b', 'media', '<figure><img src="same.png"></figure>'),
  make('table', 'table', '<table><tr><td rowspan="2">Cell</td></tr><tr></tr></table>'),
  make('after', 'text', '<p>After the table.</p>'),
];
const groups = readingGroups(rows, html => html);
assert.deepEqual(groups.map(g => g.id),
  ['heading-a', 'image-a', 'caption-a', 'heading-b', 'image-b', 'table', 'after']);
assert.equal(groups[0].zh.__html, rows[0].zh + rows[1].zh);
assert.equal(groups[2].caption, true);
assert.equal(groups[3].zh.__html, rows[4].zh + rows[5].zh);
assert.equal(groups.filter(g => g.kind === 'media').length, 2);

const pages = JSON.parse(readFileSync('./content/library.json', 'utf8'));
const parallel = JSON.parse(readFileSync('./content/parallel.json', 'utf8'));
const output = Object.fromEntries(pages.map(page => [page.slug, {
  groups: readingGroups(parallel[page.slug].rows, html => html),
  wrapped: {zh: wrapTables(page.body, 'zh'), en: wrapTables(page.bodyEn, 'en')},
}]));
process.stdout.write(JSON.stringify(output));
"""


def parse(html):
    return html5lib.parseFragment(html, treebuilder="dom", container="article")


def text_content(node):
    if node.nodeType in (Node.TEXT_NODE, Node.CDATA_SECTION_NODE):
        return node.data
    if node.nodeType in (Node.ELEMENT_NODE, Node.DOCUMENT_FRAGMENT_NODE, Node.DOCUMENT_NODE):
        return "".join(text_content(child) for child in node.childNodes)
    return ""


def elements(node):
    for child in node.childNodes:
        if child.nodeType == Node.ELEMENT_NODE:
            yield child
            yield from elements(child)


def attributes(node, attr):
    return [n.getAttribute(attr) for n in elements(node) if n.hasAttribute(attr)]


def utf16_length(text):
    return len(text.encode("utf-16-le")) // 2


def table_shape(table):
    return [[(cell.tagName, cell.getAttribute("rowspan") or "1",
              cell.getAttribute("colspan") or "1")
             for cell in row.childNodes if cell.nodeType == Node.ELEMENT_NODE
             and cell.tagName in {"td", "th"}]
            for row in elements(table) if row.tagName == "tr"]


def ordered_content_events(root):
    """Text offsets tie images/tables/headings to the same surrounding prose.

    A hidden EN media placeholder represents its original media occurrence;
    this checks placement as well as order without requiring duplicate players.
    """
    offset = 0
    events = []

    def visit(node):
        nonlocal offset
        if node.nodeType in (Node.TEXT_NODE, Node.CDATA_SECTION_NODE):
            offset += utf16_length(node.data)
            return
        if node.nodeType == Node.ELEMENT_NODE:
            tag = node.tagName
            proxy = node.getAttribute("data-parallel-media")
            if tag in MEDIA or proxy in MEDIA:
                original = proxy in MEDIA
                attr_prefix = "data-original-" if original else ""
                source_tag = "span" if original else "source"
                sources = [s for s in elements(node) if s.tagName == source_tag
                           and (not original or s.getAttribute("data-parallel-media") == "source")]
                event = ("media", proxy if original else tag,
                         node.getAttribute(attr_prefix + "src"),
                         node.getAttribute(attr_prefix + "poster"),
                         tuple((s.getAttribute(attr_prefix + "src"),
                                s.getAttribute(attr_prefix + "type")) for s in sources))
                events.append((offset, event))
            elif tag == "table":
                events.append((offset, ("table", table_shape(node))))
            elif tag in HEADINGS:
                events.append((offset, ("heading", tag, node.getAttribute("id"), text_content(node))))
            elif tag == "figcaption":
                events.append((offset, ("caption", text_content(node))))
        for child in node.childNodes:
            visit(child)

    visit(root)
    return events


def require_equivalent(source, actual, label):
    original_text = text_content(source)
    actual_text = text_content(actual)
    assert actual_text == original_text, f"{label}: textContent changed"
    assert attributes(actual, "id") == attributes(source, "id"), f"{label}: IDs changed"
    assert attributes(actual, "href") == attributes(source, "href"), f"{label}: links changed"
    assert ordered_content_events(actual) == ordered_content_events(source), (
        f"{label}: media, table, heading or caption moved relative to surrounding text")


def require_table_viewports(root, language, label):
    tables = [n for n in elements(root) if n.tagName == "table"]
    for table in tables:
        parent = table.parentNode
        assert parent.nodeType == Node.ELEMENT_NODE and parent.tagName == "div", label
        assert "table-scroll" in parent.getAttribute("class").split(), label
        assert parent.getAttribute("role") == "region", label
        assert parent.getAttribute("tabindex") == "0", label
        assert parent.getAttribute("aria-label") == (
            "表格，可横向滚动" if language == "zh" else "Table, scroll horizontally"), label
    return len(tables)


def main():
    snapshots = {path: path.read_bytes() for path in INPUTS}
    pages = json.loads(snapshots[INPUTS[1]])
    parallel = json.loads(snapshots[INPUTS[2]])
    process = subprocess.run(["node", "--input-type=module", "--eval", NODE_CHECK],
                             cwd=ROOT, text=True, capture_output=True, check=True)
    output = json.loads(process.stdout)
    group_counts = Counter()
    language_checks = 0
    media_and_table_events = 0

    for page in pages:
        slug = page["slug"]
        groups = output[slug]["groups"]
        rows = parallel[slug]["rows"]
        positions = {row["id"]: index for index, row in enumerate(rows)}
        starts = [positions[group["id"]] for group in groups]
        assert starts[0] == 0 and starts == sorted(set(starts)), (slug, "group order")
        stops = starts[1:] + [len(rows)]
        for group, start, stop in zip(groups, starts, stops):
            originals = rows[start:stop]
            group_counts[group["kind"]] += 1
            if group["kind"] in {"media", "table"}:
                assert len(originals) == 1 and originals[0]["kind"] == group["kind"], (
                    slug, group["id"], "a media/table boundary moved")
            else:
                assert all(row["kind"] not in {"media", "table"} for row in originals), (
                    slug, group["id"], "text crossed a media/table boundary")
            for language in ("zh", "en"):
                original = parse("".join(row[language] for row in originals))
                result = parse(group[language]["__html"])
                require_equivalent(original, result, f"{slug}/{language}/{group['id']}")

        for language, body_key in (("zh", "body"), ("en", "bodyEn")):
            original = parse(page[body_key])
            # Each dangerouslySetInnerHTML group has its own div context.
            grouped = parse("".join('<div class="reading-block">' + group[language]["__html"]
                                    + "</div>" for group in groups))
            wrapped = parse(output[slug]["wrapped"][language])
            require_equivalent(original, grouped, f"{slug}/{language}/readingGroups")
            require_equivalent(original, wrapped, f"{slug}/{language}/wrapTables")
            expected_tables = sum(n.tagName == "table" for n in elements(original))
            assert require_table_viewports(grouped, language, slug) == expected_tables
            assert require_table_viewports(wrapped, language, slug) == expected_tables
            language_checks += 2
            if language == "zh":
                media_and_table_events += sum(event[1][0] in {"media", "table"}
                                              for event in ordered_content_events(original))

    for path, contents in snapshots.items():
        assert path.read_bytes() == contents, f"{path.name} changed during validation; rerun"
    print(json.dumps({
        "pages": len(pages),
        "groups": dict(group_counts),
        "exactLanguageFlowChecks": language_checks,
        "mediaAndTableOccurrencesWithUnchangedTextOffsets": media_and_table_events,
        "tableShapesAndAccessibleViewports": "passed, both languages",
        "headingWithExplanationAndList": "passed",
        "captionAfterImageAndRepeatedImageOrder": "passed",
        "overviewLayoutRenderer": "not covered; only generic helper output was checked",
        "helperSha256": hashlib.sha256(snapshots[INPUTS[0]]).hexdigest(),
    }, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
