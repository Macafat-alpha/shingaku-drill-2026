#!/usr/bin/env python3
"""vault の原稿（cards/*.yaml・mocks.yaml・hayami.yaml・reading/*.md）から data/*.json を作る。

照合:
- カードの check に書いた文字列が、出典の書き起こし（source/*.md）に実在するか
- 選択肢の正答番号が範囲内か、予想問題が参照するカードが存在するか、各大問の問題数
使い方: python3 tools/build_data.py [--strict]
"""
import json
import re
import sys
import unicodedata
from datetime import datetime, timezone, timedelta
from pathlib import Path

import markdown
import yaml

VAULT = Path.home() / "Library/Mobile Documents/iCloud~md~obsidian/Documents/vault/02_waseda/shingaku-chishiki-2026"
APP = Path(__file__).resolve().parent.parent
OUT = APP / "data"
KANA = "アイウエオカキクケコサシスセソ"
TYPES = {"num", "text", "mc", "multi"}

errors: list[str] = []
warnings: list[str] = []


def norm(s: str) -> str:
    s = unicodedata.normalize("NFKC", str(s))
    return re.sub(r"[\s,，、]", "", s)


def load_sources() -> dict[str, str]:
    return {p.name: norm(p.read_text(encoding="utf-8")) for p in (VAULT / "source").glob("*.md")}


def to_index(v, n, where):
    if isinstance(v, int):
        idx = v
    elif isinstance(v, str) and len(v) == 1 and v in KANA:
        idx = KANA.index(v)
    else:
        errors.append(f"{where}: 正答の指定が不正 {v!r}")
        return 0
    if not 0 <= idx < n:
        errors.append(f"{where}: 正答 {v!r} が選択肢の範囲外（{n}個）")
    return idx


def norm_q(q: dict, where: str) -> dict:
    q = dict(q)
    t = q.get("t")
    if t not in TYPES:
        errors.append(f"{where}: 形式 t が不正 {t!r}")
        return q
    if not q.get("q"):
        errors.append(f"{where}: 問題文 q がない")
    if t == "num":
        try:
            q["a"] = float(q["a"]) if "." in str(q["a"]) else int(q["a"])
        except (KeyError, ValueError):
            errors.append(f"{where}: 数値の正答 a が不正")
    elif t == "text":
        a = q.get("a")
        q["a"] = [a] if isinstance(a, str) else list(a or [])
        if not q["a"]:
            errors.append(f"{where}: 記述の正答 a がない")
    elif t == "mc":
        q["a"] = to_index(q.get("a"), len(q.get("c", [])), where)
        if len(q.get("c", [])) < 2:
            errors.append(f"{where}: 選択肢 c が足りない")
    elif t == "multi":
        a = q.get("a")
        a = list(a) if isinstance(a, (list, str)) else [a]
        q["a"] = sorted(to_index(x, len(q.get("c", [])), where) for x in a)
    return q


def build_cards(sources):
    cards, seen = [], set()
    for f in sorted((VAULT / "cards").glob("*.yaml")):
        doc = yaml.safe_load(f.read_text(encoding="utf-8")) or {}
        for i, c in enumerate(doc.get("cards", [])):
            where = f"{f.name}#{c.get('id', i)}"
            c = {**{k: doc[k] for k in ("area", "ch", "file") if k in doc}, **c}
            cid = c.get("id")
            if not cid or cid in seen:
                errors.append(f"{where}: id がないか重複")
                continue
            seen.add(cid)
            for k in ("area", "ch", "imp", "src", "fact", "title"):
                if not c.get(k):
                    errors.append(f"{where}: {k} がない")
            if c.get("imp") not in ("A", "B", "C"):
                errors.append(f"{where}: imp は A/B/C")
            src_text = sources.get(c.get("file", ""), None)
            if src_text is None:
                errors.append(f"{where}: 出典ファイル {c.get('file')!r} が source/ にない")
            else:
                for s in c.get("check", []):
                    if norm(s) not in src_text:
                        errors.append(f"{where}: 照合失敗 {s!r} が {c['file']} に見つからない")
            if not c.get("check"):
                warnings.append(f"{where}: check が空（出典照合なし）")
            qs = [norm_q(q, f"{where}.qs[{j}]") for j, q in enumerate(c.get("qs", []))]
            if not qs:
                errors.append(f"{where}: 問い qs がない")
            cards.append({
                "id": cid, "area": c["area"], "ch": c.get("ch"), "imp": c.get("imp"), "title": c.get("title"),
                "src": c.get("src"), "fact": c.get("fact"), "prev": c.get("prev"), "confuse": c.get("confuse"), "ref": bool(c.get("ref")),
                "qs": qs,
            })
    return cards


def build_mocks(card_ids):
    doc = yaml.safe_load((VAULT / "mocks.yaml").read_text(encoding="utf-8")) or {}
    mocks = []
    for m in doc.get("mocks", []):
        secs = []
        for si, sec in enumerate(m.get("sections", [])):
            qs = []
            for qi, q in enumerate(sec.get("qs", [])):
                where = f"mocks.yaml#{m.get('id')}.{si + 1}.問{qi + 1}"
                if q.get("card") not in card_ids:
                    errors.append(f"{where}: card {q.get('card')!r} が存在しない")
                qs.append(norm_q(q, where))
            if len(qs) != 25:
                warnings.append(f"mocks.yaml#{m.get('id')} {sec.get('name')}: {len(qs)}問（本番は25問）")
            secs.append({"name": sec["name"], "qs": qs})
        mocks.append({"id": m["id"], "title": m["title"], "note": m.get("note", ""), "sections": secs})
    return mocks


def build_hayami(card_ids):
    doc = yaml.safe_load((VAULT / "hayami.yaml").read_text(encoding="utf-8")) or {}
    for g in doc.get("groups", []):
        for r in g.get("rows", []):
            if r.get("card") and r["card"] not in card_ids:
                errors.append(f"hayami.yaml: card {r['card']!r} が存在しない")
    return doc.get("groups", [])


def build_reading(cards):
    chapters = []
    md = markdown.Markdown(extensions=["tables", "sane_lists"])
    by_ch: dict[str, list[str]] = {}
    for c in cards:
        by_ch.setdefault(c["ch"], []).append(c["id"])
    ids = {c["id"] for c in cards}
    for f in sorted((VAULT / "reading").glob("*.md")):
        text = f.read_text(encoding="utf-8")
        m = re.match(r"^---\n(.*?)\n---\n(.*)$", text, re.S)
        if not m:
            errors.append(f"reading/{f.name}: frontmatter がない")
            continue
        fm, body = yaml.safe_load(m.group(1)), m.group(2)
        if "no" not in fm and False in fm:  # YAML 1.1 は no: を False と読む
            fm["no"] = fm.pop(False)
        body = re.sub(r"^> \[!\w+\][^\n]*\n", "> ", body, flags=re.M)  # Obsidian callout → 引用
        md.reset()
        html = md.convert(body)
        # 一文一行の原稿: 段落内の改行は日本語では詰める（空白にしない）
        html = re.sub(r"<(p|li)>(.*?)</\1>", lambda m: f"<{m.group(1)}>" + re.sub(r"\n", "", m.group(2)) + f"</{m.group(1)}>", html, flags=re.S)
        html = re.sub(r"(?<=[^\x00-\x7F]) (<strong>)", r"\1", html)
        html = re.sub(r"(</strong>) (?=[^\x00-\x7F])", r"\1", html)
        html = html.replace("<table>", '<div class="tbl"><table>').replace("</table>", "</table></div>")
        recall = fm.get("recall", [])
        for r in recall:
            if r not in ids:
                errors.append(f"reading/{f.name}: recall のカード {r!r} が存在しない")
        chapters.append({
            "id": fm["id"], "area": fm["area"], "no": fm["no"], "title": fm["title"], "lead": fm.get("lead", ""),
            "minutes": fm.get("minutes"), "recall": recall, "cards": by_ch.get(fm["id"], []), "html": html,
        })
    chapters.sort(key=lambda c: (0 if c["area"] == "中学" else 1, c["no"]))
    for ch in by_ch:
        if ch not in {c["id"] for c in chapters}:
            warnings.append(f"章 {ch!r} の読み物がない（カード {len(by_ch[ch])}枚）")
    return chapters


def main():
    sources = load_sources()
    cards = build_cards(sources)
    ids = {c["id"] for c in cards}
    mocks = build_mocks(ids) if (VAULT / "mocks.yaml").exists() else []
    hayami = build_hayami(ids) if (VAULT / "hayami.yaml").exists() else []
    reading = build_reading(cards)
    version = datetime.now(timezone(timedelta(hours=9))).strftime("%Y-%m-%d %H:%M")

    for w in warnings:
        print("WARN ", w)
    for e in errors:
        print("ERROR", e)
    if errors and "--strict" in sys.argv:
        sys.exit(1)

    OUT.mkdir(exist_ok=True)
    dump = lambda name, obj: (OUT / f"{name}.json").write_text(json.dumps(obj, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    dump("cards", {"version": version, "cards": cards})
    dump("mocks", {"version": version, "mocks": mocks})
    dump("reading", {"version": version, "chapters": reading})
    dump("hayami", {"version": version, "groups": hayami})
    imp = {k: sum(1 for c in cards if c["imp"] == k) for k in "ABC"}
    print(f"cards {len(cards)} (A{imp['A']} B{imp['B']} C{imp['C']}) / chapters {len(reading)} / mocks {len(mocks)} / errors {len(errors)} / warnings {len(warnings)}")


if __name__ == "__main__":
    main()
