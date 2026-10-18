"""أيقونات بيرسمها التطبيق بنفسه، لما المكتبات ما يبقاش فيها شكل على قد المعنى.

ليه: المكتبات محدودة، وقاعدة «ما تكررش» بتمنع الشكل اللي اتستخدم قريب. فكان البحث بيرجّع أقرب كلمة وخلاص
(«brain, counter, decreasing number» ← أيقونة الرقم 0 بدل مخ). دلوقتي لو مفيش حاجة مناسبة محلي ولا أونلاين،
الذكاء الاصطناعي بيرسم أيقونة خطوط جديدة للفكرة نفسها (عناصر SVG بس، بنتأكد منها بالكود)، وبتتحفظ في assets/drawn
وتتسجّل زي أي أيقونة (وكل مرة ممكن يترسم شكل جديد لنفس الفكرة، فمفيش تكرار).
"""

import hashlib
import json
import re
import threading

from ..config import ASSETS
from ..store import read_json, write_json
from ..llm import claude_code
from .common import ask

DRAWN = ASSETS / "drawn"
_lock = threading.Lock()
TAGS = ["path", "circle", "ellipse", "line", "polyline", "rect"]
NUM = re.compile(r"^-?\d+(\.\d+)?$")
PATH_D = re.compile(r"^[MmLlHhVvCcSsQqTtAaZz0-9eE.,\s-]+$")
SCHEMA = {
    "type": "object", "additionalProperties": False, "required": ["concept", "elements"],
    "properties": {
        "concept": {"type": "string", "description": "اللي الأيقونة بتوضّحه في 2–4 كلمات إنجليزي"},
        "elements": {"type": "array", "minItems": 3, "maxItems": 36, "items": {
            "type": "object", "additionalProperties": False, "required": ["tag"],
            "properties": {
                "tag": {"type": "string", "enum": TAGS},
                "d": {"type": "string"}, "points": {"type": "string"},
                "cx": {"type": "number"}, "cy": {"type": "number"}, "r": {"type": "number"}, "rx": {"type": "number"}, "ry": {"type": "number"},
                "x": {"type": "number"}, "y": {"type": "number"}, "width": {"type": "number"}, "height": {"type": "number"},
                "x1": {"type": "number"}, "y1": {"type": "number"}, "x2": {"type": "number"}, "y2": {"type": "number"},
                "solid": {"type": "boolean", "description": "true = حتة صغيرة متملية (عين، نقطة)"},
            }}},
    },
}
SYSTEM = """إنت رسّام أيقونات خطوط (line icons) محترف بأسلوب Lucide/Tabler، لفيديو سبورة بيضا بيترسم بالقلم خط بخط.
ارسم أيقونة واحدة واضحة للفكرة المطلوبة على مساحة 100×100 (من 0 لـ 100):
- خطوط بس (stroke)، من غير ألوان. ممكن حتت صغيرة متملية (solid) زي عين أو نقطة.
- الشكل يملا تقريبًا من 8 لـ 92، ومتوسّط، ونِسبه صح (مش مضغوط ولا ممطوط).
- بسيط ومقروء من بعيد: من 4 لـ 25 عنصر. أشكال حقيقية متعرّفة (مخ بتلافيف، إسعاف بعجل وصليب، قطة بودان وشنب...).
- ممنوع كتابة أو حروف أو أرقام جوه الأيقونة.
- للمنحنيات استخدم path بأوامر C/Q/A. كل الأرقام جوه 0–100.
- لو الفكرة فعل أو حالة (ذراع بيقع، رقم بيقل)، ارسم الحاجة الأساسية + علامة بسيطة للحالة (سهم صغير، خطوط حركة)."""


def _num_ok(v) -> bool:
    return isinstance(v, (int, float)) and -4 <= v <= 104


def valid(elements: list) -> list:
    """بيشيل أي عنصر فيه أرقام بره الرسمة أو path مش سليم، وبيرجّع اللي فاضل."""
    out = []
    for e in elements:
        tag = e.get("tag")
        if tag not in TAGS:
            continue
        if tag == "path":
            d = e.get("d") or ""
            nums = [float(x) for x in re.findall(r"-?\d+(?:\.\d+)?(?:e-?\d+)?", d)]
            if not d or not PATH_D.match(d) or not d.lstrip()[:1] in "Mm" or len(d) > 1500 or any(abs(n) > 104 for n in nums):
                continue
        elif tag == "polyline":
            pts = re.findall(r"-?\d+(?:\.\d+)?", e.get("points") or "")
            if len(pts) < 4 or any(not _num_ok(float(p)) for p in pts):
                continue
        else:
            need = {"circle": ["cx", "cy", "r"], "ellipse": ["cx", "cy", "rx", "ry"], "line": ["x1", "y1", "x2", "y2"], "rect": ["x", "y", "width", "height"]}[tag]
            if not all(_num_ok(e.get(k)) for k in need):
                continue
        # الملي للحتت الصغيرة بس (عين، نقطة): راس كاملة متملية بتبان بقعة سودا ومش بتترسم بالقلم
        if e.get("solid") and not ((tag == "circle" and e["r"] <= 6) or (tag == "ellipse" and max(e["rx"], e["ry"]) <= 7)
                                   or (tag == "rect" and max(e["width"], e["height"]) <= 12)):
            e = {k: v for k, v in e.items() if k != "solid"}
        out.append(e)
    return out


def to_svg(elements: list) -> str:
    keys = ["d", "points", "cx", "cy", "r", "rx", "ry", "x", "y", "width", "height", "x1", "y1", "x2", "y2"]
    body = []
    for e in elements:
        attrs = " ".join(f'{k}="{e[k]}"' for k in keys if k in e)
        fill = ' fill="currentColor"' if e.get("solid") else ""
        body.append(f"<{e['tag']} {attrs}{fill}/>")
    return ('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" fill="none" stroke="currentColor" stroke-width="4" '
            'stroke-linecap="round" stroke-linejoin="round">' + "".join(body) + "</svg>")


def draw(pid: str, terms: list[str], idea: list[str] | None, avoid: set) -> dict | None:
    """أيقونة مرسومة جديدة للفكرة ← visual جاهز (أو None لو الرسم فشل)."""
    want = " ".join(terms)
    user = f"الأيقونة: {want}"
    if idea:
        user += f"\nفكرة المشهد كله: {' '.join(idea)}"
    used = [f for f in avoid if f.startswith("drawn/")]
    if used:
        user += "\nارسمها بشكل مختلف عن أي رسمة قبل كده لنفس الفكرة (زاوية أو تكوين تاني)."
    try:
        data = ask(pid, "scenes", SYSTEM, user, SCHEMA) if pid else claude_code.ask(SYSTEM, user, SCHEMA)["data"]
    except Exception:
        return None
    els = valid(data.get("elements") or [])
    if len(els) < 3:
        return None
    svg = to_svg(els)
    slug = re.sub(r"[^a-z0-9]+", "-", want.lower()).strip("-")[:40] or "icon"
    file = f"drawn/{slug}-{hashlib.sha1(svg.encode()).hexdigest()[:8]}.svg"
    with _lock:
        DRAWN.mkdir(parents=True, exist_ok=True)
        (ASSETS / file).write_text(svg, encoding="utf-8")
        idx = read_json(DRAWN / "index.json", [])
        idx.append({"file": file, "terms": terms, "concept": data.get("concept"), "pid": pid, "elements": len(els)})
        write_json(DRAWN / "index.json", idx)
    return {"kind": "icon", "asset": file, "asset_name": f"مرسومة: {data.get('concept') or want}", "license": "رسمة التطبيق", "drawn": True}


def reuse(terms: list[str], avoid: set) -> dict | None:
    """رسمة اتعملت قبل كده لنفس الكلمات بالظبط ولسه ما اتستخدمتش في الفيديو ده ولا في الفيديوهات الأخيرة."""
    key = sorted(w.lower() for w in terms)
    for it in reversed(read_json(DRAWN / "index.json", [])):
        if sorted(w.lower() for w in it["terms"]) == key and it["file"] not in avoid and (ASSETS / it["file"]).exists():
            return {"kind": "icon", "asset": it["file"], "asset_name": f"مرسومة: {it.get('concept') or ' '.join(terms)}", "license": "رسمة التطبيق", "drawn": True}
    return None


if __name__ == "__main__":  # تجربة: python -m app.pipeline.drawn brain "cells lost"
    import sys
    print(json.dumps(draw("", sys.argv[1:], None, set()), ensure_ascii=False))
