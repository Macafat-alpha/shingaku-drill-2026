"""予想問題を紙で解くためのPDFを作る（問題冊子＋解答用紙／採点用解答＋根拠）。

    python3 tools/build_mock_pdf.py            # すべての予想問題
    python3 tools/build_mock_pdf.py D E F      # 指定したものだけ

入力は data/mocks.json と data/cards.json（先に build_data.py を実行しておく）。
出力は vault の 02_waseda/shingaku-chishiki-2026/pdf/（公開リポジトリには置かない）。
"""
import html
import json
import subprocess
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
VAULT = Path.home() / "Library/Mobile Documents/iCloud~md~obsidian/Documents/vault/02_waseda/shingaku-chishiki-2026"
OUT = VAULT / "pdf"
CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
KANA = "アイウエオカキクケコサシスセソ"

CSS = """
@page { size: A4; margin: 16mm 15mm 16mm 15mm; }
* { box-sizing: border-box; }
body { font-family: "Hiragino Mincho ProN", "ヒラギノ明朝 ProN", serif; font-size: 10.5pt; line-height: 1.6; color: #000; margin: 0; }
.cover { height: 250mm; display: flex; flex-direction: column; justify-content: center; align-items: center; text-align: center; page-break-after: always; }
.cover .t1 { font-size: 20pt; letter-spacing: .1em; }
.cover .t2 { font-size: 15pt; margin-top: 6mm; }
.cover .t3 { font-size: 15pt; margin-top: 4mm; }
.cover .note { font-size: 10pt; margin-top: 14mm; line-height: 1.9; }
.cover .name { margin-top: 30mm; font-size: 12pt; border-bottom: 1px solid #000; width: 90mm; text-align: left; padding-bottom: 1mm; }
h2 { font-size: 12.5pt; font-weight: normal; margin: 0 0 4mm; }
h2 .box { display: inline-block; border: 1px solid #000; width: 6.5mm; text-align: center; margin-right: 3mm; }
.sec + .sec { page-break-before: always; }
.q { margin: 0 0 4.2mm; page-break-inside: avoid; }
.q .stem { display: flex; gap: 2.5mm; }
.q .no { flex: 0 0 auto; white-space: nowrap; }
.ch { margin: 1.2mm 0 0 9mm; display: grid; gap: .6mm 4mm; }
.ch.c4 { grid-template-columns: repeat(4, 1fr); }
.ch.c3 { grid-template-columns: repeat(3, 1fr); }
.ch.c2 { grid-template-columns: repeat(2, 1fr); }
.ch.c1 { grid-template-columns: 1fr; }
.sheet { page-break-before: always; }
.sheet h1, .key h1 { font-size: 13pt; font-weight: normal; text-align: center; margin: 0 0 2mm; }
.sheet .meta, .key .meta { text-align: right; font-size: 9.5pt; margin-bottom: 2mm; }
table.grid { width: 100%; border-collapse: collapse; margin-bottom: 6mm; table-layout: fixed; }
table.grid td { border: 1px solid #000; height: 10.5mm; padding: 0 2mm; font-size: 10.5pt; }
table.grid td.n { width: 8mm; text-align: center; }
table.grid td.sec { width: 8mm; text-align: center; border-right: 1px solid #000; }
table.grid td.a { text-align: center; }
.key .exp { font-size: 9.5pt; line-height: 1.55; }
.key .exp h3 { font-size: 10.5pt; font-weight: normal; margin: 4mm 0 1.5mm; }
.key .exp p { margin: 0 0 1.4mm; padding-left: 10mm; text-indent: -10mm; }
.score { margin-top: 2mm; text-align: right; font-size: 11pt; }
"""


def esc(s):
    return html.escape(str(s))


def answer_text(q):
    t, a = q["t"], q["a"]
    if t == "mc":
        return KANA[a]
    if t == "multi":
        return "・".join(KANA[i] for i in a)
    if t == "num":
        return f"{a:g}" if isinstance(a, float) else str(a)
    return a[0]


def choices_html(q):
    c = q.get("c") or []
    if not c:
        return ""
    longest = max(len(x) for x in c)
    cols = 4 if longest <= 9 and len(c) <= 4 else 3 if longest <= 13 else 2 if longest <= 22 else 1
    if len(c) > 4 and cols == 4:
        cols = 3
    items = "".join(f"<div>{KANA[i]}　{esc(x)}</div>" for i, x in enumerate(c))
    return f'<div class="ch c{cols}">{items}</div>'


def grid_html(m, fill):
    rows = ""
    for si, sec in enumerate(m["sections"]):
        qs = sec["qs"]
        per = 3
        nrow = (len(qs) + per - 1) // per
        for r in range(nrow):
            cells = ""
            if r == 0:
                cells += f'<td class="sec" rowspan="{nrow}">{"①②③"[si]}</td>'
            for k in range(per):
                i = r * per + k
                if i < len(qs):
                    a = esc(answer_text(qs[i])) if fill else ""
                    cells += f'<td class="n">{i + 1}</td><td class="a">{a}</td>'
                else:
                    cells += '<td class="n"></td><td></td>'
            rows += f"<tr>{cells}</tr>"
        rows += '<tr><td colspan="7" style="border:none;height:4mm"></td></tr>'
    cols = '<col style="width:8mm">' + '<col style="width:9mm"><col>' * 3
    return f'<table class="grid"><colgroup>{cols}</colgroup>{rows}</table>'


def section_title(name, qs):
    pts = sum(q.get("pts", 2) for q in qs)
    no, _, rest = name.partition(" ")
    num = str("①②③".index(no) + 1) if no in "①②③" else no
    return f'<h2><span class="box">{esc(num)}</span>{esc(rest or name)}（配点：{pts}点）</h2>'


def booklet(m):
    total = sum(len(s["qs"]) for s in m["sections"])
    body = (
        '<div class="cover">'
        f'<div class="t1">進学知識テスト</div><div class="t2">{esc(m["title"])}</div><div class="t3">【２０分間】</div>'
        f'<div class="note">{"　".join(esc(s["name"]) + f"（{len(s["qs"])}問）" for s in m["sections"])}<br>'
        f'全{total}問・各2点　※学校名は略称可　※【完答】はすべて合っていて正解</div>'
        '<div class="name">氏名</div></div>'
    )
    for si, sec in enumerate(m["sections"]):
        body += f'<div class="sec">{section_title(sec["name"], sec["qs"])}'
        for qi, q in enumerate(sec["qs"]):
            body += (f'<div class="q"><div class="stem"><span class="no">問{qi + 1}</span>'
                     f'<span>{esc(q["q"])}</span></div>{choices_html(q)}</div>')
        body += "</div>"
    body += (f'<div class="sheet"><h1>進学知識テスト　{esc(m["title"])}　解答用紙</h1>'
             '<div class="meta">※各2点　※学校名は略称可</div>'
             f'{grid_html(m, False)}<div class="score">氏名＿＿＿＿＿＿＿＿＿＿　得点＿＿＿＿／100</div></div>')
    return body


def answer_key(m, cards):
    body = (f'<div class="key"><h1>進学知識テスト　{esc(m["title"])}　採点用解答</h1>'
            f'<div class="meta">※各2点　※学校名は略称可</div>{grid_html(m, True)}<div class="exp">')
    for si, sec in enumerate(m["sections"]):
        body += f'<h3>{esc(sec["name"])}　根拠</h3>'
        for qi, q in enumerate(sec["qs"]):
            c = cards.get(q.get("card"), {})
            fact = c.get("fact", "")
            ref = "（資料外・参考）" if c.get("ref") else ""
            body += f'<p>問{qi + 1}　{esc(answer_text(q))}　…　{esc(fact)}{ref}</p>'
    body += "</div></div>"
    return body


def to_pdf(title, body, out):
    doc = f'<!doctype html><html lang="ja"><head><meta charset="utf-8"><title>{esc(title)}</title><style>{CSS}</style></head><body>{body}</body></html>'
    with tempfile.NamedTemporaryFile("w", suffix=".html", delete=False, encoding="utf-8") as f:
        f.write(doc)
        src = f.name
    subprocess.run([CHROME, "--headless", "--disable-gpu", "--no-pdf-header-footer",
                    f"--print-to-pdf={out}", f"file://{src}"], check=True, capture_output=True)
    Path(src).unlink()
    print("wrote", out)


def main():
    mocks = json.loads((ROOT / "data/mocks.json").read_text(encoding="utf-8"))["mocks"]
    cards = {c["id"]: c for c in json.loads((ROOT / "data/cards.json").read_text(encoding="utf-8"))["cards"]}
    want = set(sys.argv[1:])
    OUT.mkdir(exist_ok=True)
    for m in mocks:
        if want and m["id"] not in want:
            continue
        to_pdf(m["title"], booklet(m), OUT / f'{m["title"]}_問題.pdf')
        to_pdf(m["title"], answer_key(m, cards), OUT / f'{m["title"]}_解答.pdf')


if __name__ == "__main__":
    main()
