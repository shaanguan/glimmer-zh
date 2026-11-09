"""Restore reviewed official layout groups without rewriting content.

The compact manifest records the literal source containers and guarded token
ranges in the existing English/Chinese snapshots. Run this after fetching or
editing snapshots and before compile-content.py / generate-parallel.py.
It is idempotent. A content edit that invalidates a range stops for review.

Requires html5lib 1.1. Use --check to verify without writing snapshots.
"""

from __future__ import annotations

import argparse
from collections import Counter
import hashlib
import json
from pathlib import Path
import re
from xml.dom import Node

import html5lib


ROOT = Path(__file__).resolve().parents[1]
MANIFEST = ROOT / "design/source-layouts.json"
MEDIA = {"img", "video", "audio"}
HEADINGS = {f"h{i}" for i in range(1, 7)}
TOKEN = re.compile(r"\w+|[^\w\s]")


def parse(markup):
    return html5lib.parseFragment(markup, treebuilder="dom", container="article")


def elements(node):
    for child in node.childNodes:
        if child.nodeType == Node.ELEMENT_NODE:
            yield child
            yield from elements(child)


def text_content(node):
    if node.nodeType in (Node.TEXT_NODE, Node.CDATA_SECTION_NODE):
        return node.data
    return "".join(text_content(child) for child in node.childNodes)


def token_events(node):
    result = []
    if node.nodeType == Node.TEXT_NODE:
        result.extend((match.group(), node, match.start(), match.end())
                      for match in TOKEN.finditer(node.data))
    elif node.nodeType == Node.ELEMENT_NODE:
        if node.tagName in HEADINGS and node.hasAttribute("id"):
            result.append(("@heading:" + node.getAttribute("id").removeprefix("en-"), node, None, None))
        if node.tagName in MEDIA | {"source"}:
            result.append(("@" + node.tagName + ":" + node.getAttribute("src"), node, None, None))
    for child in node.childNodes:
        result.extend(token_events(child))
    return result


def tokens(node):
    return [event[0] for event in token_events(node)]


def token_digest(root):
    serialized = json.dumps(tokens(root), ensure_ascii=False, separators=(",", ":"))
    return hashlib.sha256(serialized.encode()).hexdigest()


def media_signature(node):
    return (node.tagName, node.getAttribute("src"), node.getAttribute("poster"),
            tuple((child.getAttribute("src"), child.getAttribute("type"))
                  for child in elements(node) if child.tagName == "source"))


def content_signature(root):
    """Include exact UTF-16 text offsets, so media cannot drift through prose."""
    events, ids, links = [], [], []
    offset = 0

    def visit(node):
        nonlocal offset
        if node.nodeType in (Node.TEXT_NODE, Node.CDATA_SECTION_NODE):
            offset += len(node.data.encode("utf-16-le")) // 2
            return
        if node.nodeType == Node.ELEMENT_NODE:
            if node.hasAttribute("id"):
                ids.append(node.getAttribute("id"))
            if node.hasAttribute("href"):
                links.append(node.getAttribute("href"))
            if node.tagName in MEDIA:
                events.append((offset, "media", media_signature(node)))
            elif node.tagName in HEADINGS:
                events.append((offset, "heading", node.tagName,
                               node.getAttribute("id"), text_content(node)))
            elif node.tagName == "figcaption":
                events.append((offset, "caption", text_content(node)))
            elif node.tagName == "table":
                rows = tuple(tuple((cell.tagName, cell.getAttribute("rowspan"),
                                    cell.getAttribute("colspan"))
                                   for cell in row.childNodes
                                   if cell.nodeType == Node.ELEMENT_NODE and cell.tagName in {"td", "th"})
                             for row in elements(node) if row.tagName == "tr")
                events.append((offset, "table", rows))
        for child in node.childNodes:
            visit(child)

    visit(root)
    return text_content(root), tuple(ids), tuple(links), tuple(events)


def remove_generated_wrappers(root):
    for node in reversed(list(elements(root))):
        if node.hasAttribute("data-source-layout") or "source-column" in node.getAttribute("class").split():
            parent = node.parentNode
            for child in list(node.childNodes):
                parent.insertBefore(child, node)
            parent.removeChild(node)
    root.normalize()


def top_child(node, root):
    while node.parentNode is not root:
        node = node.parentNode
        assert node is not None, "Layout boundary escaped the article"
    return node


def column_nodes(root, start, stop):
    assert 0 <= start < stop <= len(token_events(root))
    # One original bare text node contains a caption followed by outside prose.
    # Split that node at the exact token boundary; retain every whitespace byte.
    event = token_events(root)[stop - 1]
    node, end = event[1], event[3]
    if node.nodeType == Node.TEXT_NODE and re.search(r"\S", node.data[end:]):
        assert node.parentNode is root, "Review a boundary inside an element"
        node.splitText(end)
    event = token_events(root)[start]
    node, begin = event[1], event[2]
    if node.nodeType == Node.TEXT_NODE and re.search(r"\S", node.data[:begin]):
        assert node.parentNode is root, "Review a boundary inside an element"
        node.splitText(begin)
    current = token_events(root)
    first = top_child(current[start][1], root)
    last = top_child(current[stop - 1][1], root)
    children = list(root.childNodes)
    selected = children[children.index(first):children.index(last) + 1]
    actual = [token for child in selected for token in tokens(child)]
    assert actual == [event[0] for event in current[start:stop]], "Partial semantic block: review the manifest"
    return selected


def apply_group(root, group, language):
    columns = []
    for item in group["items"]:
        selected = column_nodes(root, *item[language])
        column = root.ownerDocument.createElement("div")
        column.setAttribute("class", "source-column")
        if item.get("tone"):
            column.setAttribute("data-tone", item["tone"])
        root.insertBefore(column, selected[0])
        for node in selected:
            column.appendChild(node)
        actual_media = [{"tag": node.tagName, "src": node.getAttribute("src")}
                        for node in elements(column) if node.tagName in MEDIA]
        assert actual_media == item["media"], (group["id"], language, "media changed columns")
        columns.append(column)
    children = list(root.childNodes)
    selected = children[children.index(columns[0]):children.index(columns[-1]) + 1]
    wrapper = root.ownerDocument.createElement("div")
    wrapper.setAttribute("class", "source-layout")
    wrapper.setAttribute("data-source-layout", group["id"])
    wrapper.setAttribute("data-columns", str(group["columns"]))
    wrapper.setAttribute("data-layout-kind", group["kind"])
    root.insertBefore(wrapper, columns[0])
    previous_column = None
    for node in selected:
        if node in columns:
            wrapper.appendChild(node)
            previous_column = node
        elif node.nodeType == Node.ELEMENT_NODE:
            assert not tokens(node), "Unexpected content between source columns"
            # Empty p nodes left by the source's invalid HTML must not become
            # extra CSS grid items; keep them in source order inside the column.
            assert previous_column is not None
            previous_column.appendChild(node)
        else:
            wrapper.appendChild(node)


def restore(markup, page, language):
    root = parse(markup)
    original = content_signature(root)
    remove_generated_wrappers(root)
    assert token_digest(root) == page["baselineTokensSha256"][language], (
        page["slug"], language, "Content changed: review layout ranges before applying")
    for group in page["groups"]:
        apply_group(root, group, language)
    result = html5lib.serialize(root, tree="dom", quote_attr_values="always",
                               omit_optional_tags=False, strip_whitespace=False)
    rendered = parse(result)
    assert content_signature(rendered) == original, (page["slug"], language, "Content/offsets changed")
    wrappers = [node for node in elements(rendered) if node.hasAttribute("data-source-layout")]
    assert [node.getAttribute("data-source-layout") for node in wrappers] == [group["id"] for group in page["groups"]]
    for wrapper, group in zip(wrappers, page["groups"]):
        columns = [node for node in wrapper.childNodes if node.nodeType == Node.ELEMENT_NODE
                   and "source-column" in node.getAttribute("class").split()]
        assert len(columns) == group["columns"], (group["id"], "Column count")
    return result


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--check", action="store_true", help="validate existing wrappers without writing")
    options = parser.parse_args()
    manifest = json.loads(MANIFEST.read_text())
    writes = []
    counts = Counter()
    for page in manifest["pages"]:
        for language, directory, field in (("zh", "zh", "body"), ("en", "source", "bodyEn")):
            path = ROOT / "content" / directory / (page["slug"] + ".json")
            document = json.loads(path.read_text())
            restored = restore(document[field], page, language)
            if options.check:
                current = parse(document[field])
                ids = [node.getAttribute("data-source-layout") for node in elements(current)
                       if node.hasAttribute("data-source-layout")]
                assert ids == [group["id"] for group in page["groups"]], (page["slug"], language, "Run restoration first")
            document[field] = restored
            writes.append((path, json.dumps(document, ensure_ascii=False, indent=2) + "\n"))
        counts.update(group["kind"] for group in page["groups"])
    if not options.check:
        for path, contents in writes:
            path.write_text(contents)
    print(json.dumps({"pages": len(manifest["pages"]), "languageSnapshots": len(writes),
                      "groups": dict(counts), "columns": sum(group["columns"] for page in manifest["pages"] for group in page["groups"]),
                      "exactTextContentAndOffsets": "unchanged, both languages",
                      "headingsLinksMediaAndTables": "unchanged, both languages",
                      "mode": "verified" if options.check else "restored"}, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
