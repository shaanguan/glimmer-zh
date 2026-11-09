"""Build lossless bilingual alignment data without changing library.json.

Run with html5lib 1.1 installed:
  python scripts/generate-parallel.py

HTML5 fragment parsing matches the article.innerHTML context used by the reader.
Rows are bounded by shared headings, ordered media occurrences, and tables. Text
between these anchors stays together: paragraph counts are not translation maps.
"""

from __future__ import annotations

from collections import Counter
from dataclasses import dataclass
import hashlib
import json
from pathlib import Path
import re
from xml.dom import Node, minidom

import html5lib


ROOT = Path(__file__).resolve().parents[1]
LIBRARY = ROOT / "content/library.json"
OUTPUT = ROOT / "content/parallel.json"
MEDIA_TAGS = {"img", "video", "audio"}
HEADING_RE = re.compile(r"h[1-6]\Z")


def parse(markup: str):
    return html5lib.parseFragment(markup, treebuilder="dom", container="article")


def text_content(node) -> str:
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


def serialize(nodes) -> str:
    fragment = minidom.Document().createDocumentFragment()
    for node in nodes:
        fragment.appendChild(node.cloneNode(True))
    return html5lib.serialize(
        fragment, tree="dom", quote_attr_values="always",
        omit_optional_tags=False, strip_whitespace=False,
    )


def normalized_id(node) -> str:
    return re.sub(r"^en-", "", node.getAttribute("id"))


def ancestors(node):
    parent = node.parentNode
    while parent is not None:
        yield parent
        parent = parent.parentNode


def in_element(node, names) -> bool:
    return any(p.nodeType == Node.ELEMENT_NODE and p.tagName in names for p in ancestors(node))


def media_signature(node):
    return (
        node.tagName,
        node.getAttribute("src"),
        node.getAttribute("poster"),
        tuple((s.getAttribute("src"), s.getAttribute("type"))
              for s in elements(node) if s.tagName == "source"),
    )


def media_inventory(root):
    return [media_signature(n) for n in elements(root) if n.tagName in MEDIA_TAGS]


def attributes(root, name):
    return [n.getAttribute(name) for n in elements(root) if n.hasAttribute(name)]


def table_shape(table):
    return [[(c.tagName, c.getAttribute("rowspan") or "1", c.getAttribute("colspan") or "1")
             for c in row.childNodes
             if c.nodeType == Node.ELEMENT_NODE and c.tagName in {"td", "th"}]
            for row in elements(table) if row.tagName == "tr"]


@dataclass
class Event:
    kind: str
    key: str | None
    nodes: list
    detail: dict | None = None


def mark_anchors(root, shared_heading_ids):
    marked = {}
    occurrence = Counter()
    table_index = 0
    for node in elements(root):
        if in_element(node, {"table", "video", "audio"}):
            continue
        if HEADING_RE.fullmatch(node.tagName) and normalized_id(node) in shared_heading_ids:
            key = "heading:" + normalized_id(node)
            marked[id(node)] = ("heading", key, {
                "id": normalized_id(node),
                "level": int(node.tagName[1]),
                "title": text_content(node).strip(),
            })
        elif node.tagName == "table":
            table_index += 1
            marked[id(node)] = ("table", f"table:{table_index}", {
                "tableIndex": table_index,
                "shape": table_shape(node),
                "media": [list(m[:3]) for m in media_inventory(node)],
            })
        elif node.tagName in MEDIA_TAGS:
            signature = media_signature(node)
            occurrence[signature] += 1
            source = signature[1] or "|".join(s[0] for s in signature[3])
            key = f"media:{node.tagName}:{source}:{occurrence[signature]}"
            atom = node
            # Retain clickable-image wrappers and picture/source attributes once.
            while (atom.parentNode is not None
                   and atom.parentNode.nodeType == Node.ELEMENT_NODE
                   and atom.parentNode.tagName in {"a", "picture"}
                   and not text_content(atom.parentNode).strip()
                   and sum(n.tagName in MEDIA_TAGS for n in elements(atom.parentNode)) == 1):
                atom = atom.parentNode
            marked[id(atom)] = ("media", key, {
                "mediaType": node.tagName,
                "src": source,
                "occurrence": occurrence[signature],
            })
    return marked


def merge_text_events(events):
    merged = []
    for event in events:
        if event.kind == "text" and merged and merged[-1].kind == "text":
            merged[-1].nodes.extend(event.nodes)
        else:
            merged.append(event)
    return merged


def split_tree(node, marked):
    if id(node) in marked:
        kind, key, detail = marked[id(node)]
        return [Event(kind, key, [node.cloneNode(True)], detail)]
    if node.nodeType != Node.ELEMENT_NODE and node.nodeType != Node.DOCUMENT_FRAGMENT_NODE:
        return [Event("text", None, [node.cloneNode(True)])]

    events = merge_text_events([e for child in node.childNodes for e in split_tree(child, marked)])
    if node.nodeType == Node.DOCUMENT_FRAGMENT_NODE:
        return events
    if not events:
        return [Event("text", None, [node.cloneNode(True)])]

    # Splitting a container must not duplicate its ID. Its first fragment keeps it.
    # In this dataset these IDs belong to Chinese Do/Don't figures, not headings.
    for index, event in enumerate(events):
        wrapper = node.cloneNode(False)
        if index and wrapper.hasAttribute("id"):
            wrapper.removeAttribute("id")
        for child in event.nodes:
            wrapper.appendChild(child)
        event.nodes = [wrapper]
    return events


def intervals(events):
    gaps = [[]]
    anchors = []
    for event in events:
        if event.kind == "text":
            gaps[-1].extend(event.nodes)
        else:
            anchors.append(event)
            gaps.append([])
    return gaps, anchors


def hide_media(markup: str, whole_row=False) -> str:
    """Remove duplicate renderable media while retaining all fallback text/links."""
    root = parse(markup)
    candidates = [n for n in elements(root) if n.tagName in MEDIA_TAGS | {"source"}]
    # Innermost first so all media descendants become inert placeholders too.
    for node in reversed(candidates):
        replacement = node.ownerDocument.createElement("span")
        replacement.setAttribute("hidden", "")
        replacement.setAttribute("data-parallel-media", node.tagName)
        for attr in ("id", "lang", "dir"):
            if node.hasAttribute(attr):
                replacement.setAttribute(attr, node.getAttribute(attr))
        for attr in ("src", "poster", "alt", "type", "srcset"):
            if node.hasAttribute(attr):
                replacement.setAttribute("data-original-" + attr, node.getAttribute(attr))
        while node.firstChild is not None:
            replacement.appendChild(node.firstChild)
        node.parentNode.replaceChild(replacement, node)
    result = serialize(root.childNodes)
    if whole_row:
        result = '<div hidden="" aria-hidden="true" data-parallel-media-placeholder="true">' + result + '</div>'
    return result


def meaningful_units(nodes):
    """Diagnostic counts only; never use equal counts to guess a translation map."""
    root = parse(serialize(nodes))
    units = []
    transparent = {"section", "div", "header", "figure", "picture"}

    def visit(node):
        if node.nodeType == Node.TEXT_NODE:
            if node.data.strip():
                units.append("bare")
        elif node.nodeType == Node.ELEMENT_NODE:
            if not text_content(node).strip():
                return
            if node.tagName in transparent:
                for child in node.childNodes:
                    visit(child)
            else:
                units.append(node.tagName)
    for child in root.childNodes:
        visit(child)
    return units


def sha_text(text):
    return hashlib.sha256(text.encode("utf-8")).hexdigest()


def utf16_length(text):
    return len(text.encode("utf-16-le")) // 2


def build_page(page):
    zh_root, en_root = parse(page["body"]), parse(page["bodyEn"])
    zh_h = {normalized_id(n) for n in elements(zh_root) if HEADING_RE.fullmatch(n.tagName)}
    en_h = {normalized_id(n) for n in elements(en_root) if HEADING_RE.fullmatch(n.tagName)}
    shared = zh_h & en_h
    z_gaps, z_anchors = intervals(split_tree(zh_root, mark_anchors(zh_root, shared)))
    e_gaps, e_anchors = intervals(split_tree(en_root, mark_anchors(en_root, shared)))
    assert [(a.kind, a.key) for a in z_anchors] == [(a.kind, a.key) for a in e_anchors], (page["slug"], "anchor order")
    assert media_inventory(zh_root) == media_inventory(en_root), (page["slug"], "media sequence")

    rows = []
    grouped = []
    heading = None
    pending = ["", ""]

    def append(kind, zh, en, **metadata):
        nonlocal pending
        row = {
            "id": f'{page["slug"]}--parallel-{len(rows) + 1:03d}',
            "kind": kind,
            "zh": pending[0] + zh,
            "en": pending[1] + en,
            "sectionId": heading,
            **metadata,
        }
        pending = ["", ""]
        rows.append(row)
        return row

    for index in range(len(z_anchors) + 1):
        z_html, e_html = serialize(z_gaps[index]), serialize(e_gaps[index])
        z_text, e_text = text_content(parse(z_html)), text_content(parse(e_html))
        if z_text.strip() or e_text.strip():
            z_units, e_units = meaningful_units(z_gaps[index]), meaningful_units(e_gaps[index])
            is_group = len(z_units) > 1 or len(e_units) > 1
            row = append("text", z_html, e_html,
                         anchorKey=f"interval:{index}",
                         alignment="shared-anchor-interval",
                         grouped=is_group,
                         unitCounts={"zh": len(z_units), "en": len(e_units)})
            if is_group:
                grouped.append({"rowId": row["id"], "sectionId": heading,
                                "unitCounts": row["unitCounts"]})
        elif rows:
            # Preserve even whitespace-only source nodes without empty visual rows.
            rows[-1]["zh"] += z_html
            rows[-1]["en"] += e_html
        else:
            pending[0] += z_html
            pending[1] += e_html

        if index == len(z_anchors):
            break
        za, ea = z_anchors[index], e_anchors[index]
        z_html, e_html = serialize(za.nodes), serialize(ea.nodes)
        extra = {"anchorKey": za.key}
        if za.kind == "heading":
            heading = za.detail["id"]
            extra["heading"] = {
                "id": heading,
                "level": za.detail["level"],
                "zh": za.detail["title"],
                "en": ea.detail["title"],
            }
        elif za.kind == "media":
            e_html = hide_media(e_html, whole_row=True)
            extra["media"] = za.detail
        elif za.kind == "table":
            assert za.detail["shape"] == ea.detail["shape"], (page["slug"], za.key, "table shape")
            # Tables switch languages as a whole. Keep controls in both versions;
            # only the selected table is visible, so its audio stays playable.
            extra["table"] = za.detail
        append(za.kind, z_html, e_html, **extra)

    if pending != ["", ""]:
        append("text", "", "", anchorKey="empty-document")

    # Match actual React cells: each fragment is parsed in its own block container.
    validation = {}
    for lang, source_root, source_key in (("zh", zh_root, "body"), ("en", en_root, "bodyEn")):
        expected = text_content(source_root)
        cells = [parse(row[lang]) for row in rows]
        actual = "".join(text_content(cell) for cell in cells)
        assert actual == expected, (page["slug"], lang, "textContent", first_difference(expected, actual))
        rendered = parse("".join('<div data-parallel-cell="">' + row[lang] + '</div>' for row in rows))
        assert text_content(rendered) == expected, (page["slug"], lang, "wrapped textContent")
        assert attributes(rendered, "id") == attributes(source_root, "id"), (page["slug"], lang, "IDs")
        assert attributes(rendered, "href") == attributes(source_root, "href"), (page["slug"], lang, "links")
        if lang == "zh":
            assert media_inventory(rendered) == media_inventory(source_root), (page["slug"], "Chinese media")
        else:
            expected_table_media = [media_signature(n) for n in elements(source_root)
                                    if n.tagName in MEDIA_TAGS and in_element(n, {"table"})]
            assert media_inventory(rendered) == expected_table_media, (page["slug"], "English table media")
            assert all(in_element(n, {"table"}) for n in elements(rendered)
                       if n.tagName in MEDIA_TAGS), (page["slug"], "duplicate English shared media")
        validation[lang] = {
            "textSha256Utf8": sha_text(expected),
            "textLengthUtf16": utf16_length(expected),
            "sourceHtmlSha256": sha_text(page[source_key]),
            "ids": len(attributes(source_root, "id")),
            "links": len(attributes(source_root, "href")),
            "exactTextContentPreserved": True,
        }

    result = {
        "rows": rows,
        "validation": validation,
        "summary": {
            "sharedHeadingAnchors": len(shared),
            "anchorCount": len(z_anchors),
            "rowCounts": dict(Counter(row["kind"] for row in rows)),
            "groupedIntervals": len(grouped),
            "mediaOccurrences": len(media_inventory(zh_root)),
            "englishSharedMediaRows": 0,
            "englishMediaInSwitchableTables": sum(
                n.tagName in MEDIA_TAGS and in_element(n, {"table"}) for n in elements(en_root)),
        },
        "groupedIntervals": grouped,
    }
    if page["slug"] == "overview":
        result["overviewLayout"] = overview_layout(rows)
    return result


def overview_layout(rows):
    """Source-order row references only: no text copies or invented headings."""
    layout = {"intro": {"rows": [], "mediaRow": None, "titleRow": None}, "sections": []}
    section = None
    card = None
    for row in rows:
        row_id = row["id"]
        if row["kind"] == "heading" and row["heading"]["level"] == 2:
            section = {"id": row["heading"]["id"], "headingRow": row_id,
                       "introRows": [row_id], "cards": []}
            layout["sections"].append(section)
            card = None
        elif section is None:
            layout["intro"]["rows"].append(row_id)
            if row["kind"] == "media":
                layout["intro"]["mediaRow"] = row_id
            elif row["kind"] == "heading":
                layout["intro"]["titleRow"] = row_id
        elif row["kind"] == "media":
            card = {"mediaRow": row_id, "titleRow": None, "rows": [row_id]}
            section["cards"].append(card)
        elif card is None:
            section["introRows"].append(row_id)
        else:
            card["rows"].append(row_id)
            if row["kind"] == "heading" and card["titleRow"] is None:
                card["titleRow"] = row_id
    assert [len(s["cards"]) for s in layout["sections"]] == [4, 4, 2, 2, 1]
    assigned = list(layout["intro"]["rows"])
    for group in layout["sections"]:
        assigned.extend(group["introRows"])
        for item in group["cards"]:
            assigned.extend(item["rows"])
    assert assigned == [row["id"] for row in rows], "overview layout row coverage/order"
    assert len(assigned) == len(set(assigned)), "overview layout repeats a row"
    return layout


def first_difference(a, b):
    at = next((i for i, (x, y) in enumerate(zip(a, b)) if x != y), min(len(a), len(b)))
    return {"at": at, "expected": repr(a[max(0, at - 40):at + 80]),
            "actual": repr(b[max(0, at - 40):at + 80]), "lengths": [len(a), len(b)]}


def main():
    library_bytes = LIBRARY.read_bytes()
    pages = json.loads(library_bytes)
    result = {page["slug"]: build_page(page) for page in pages}
    assert len(result) == len(pages) == 34
    assert LIBRARY.read_bytes() == library_bytes, "library.json changed during generation"
    payload = json.dumps(result, ensure_ascii=False, separators=(",", ":")) + "\n"
    temporary = OUTPUT.with_suffix(".json.tmp")
    temporary.write_text(payload)
    temporary.replace(OUTPUT)
    counts = Counter()
    for page in result.values():
        counts.update(page["summary"]["rowCounts"])
    print(json.dumps({
        "output": str(OUTPUT), "pages": len(result), "rows": dict(counts),
        "groupedIntervals": sum(p["summary"]["groupedIntervals"] for p in result.values()),
        "mediaOccurrences": sum(p["summary"]["mediaOccurrences"] for p in result.values()),
        "englishMediaInSwitchableTables": sum(p["summary"]["englishMediaInSwitchableTables"]
                                               for p in result.values()),
        "exactTextContentChecks": len(result) * 2,
        "parser": "html5lib 1.1, article fragment context",
        "bytes": len(payload.encode("utf-8")),
    }, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
