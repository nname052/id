"""مخرج الجرافيك في المونتاج: بيقرا الكلام ويختار لكل لحظة رسمة/أيقونة/إيموجي متحرك على قد الموضوع (من المكتبات، ولو مالقاش التطبيق بيرسمها).

ليه: الجرافيك كان بقواعد بس (13 أيقونة على كلمات ثابتة)، فأغلب الكلام مالوش جرافيك، واللي بيظهر شكله واحد، ومكتبات الرسومات
(unDraw 1740 رسمة، آلاف الأيقونات، 879 إيموجي متحرك Lottie) ما كانتش بتتستخدم في المونتاج خالص.
القاعدة: الذكاء الاصطناعي بيقترح، والكود هو الحَكَم:
- كل كلمة هتظهر على الشاشة لازم تكون من الكلام نفسه (في نفس السطر)، والجرافيك بيبدأ مع كلمة معيّنة في السطر.
- الشكل (أيقونة/رسمة/إيموجي) لازم على قد معنى الكلمة الأساسية (نفس قاعدة السبورة)، ولو مفيش في المكتبات بيترسم.
- جرافيك واحد في نفس الوقت، ومدته 1.6–3.5 ث (سريع ومش بطيء)، وبين كل اتنين 0.4 ث على الأقل.
لو الطلب فشل، الاختيار بالقواعد القديمة (motion.choose) بيكمّل.
"""

import json
import re

from ..config import ASSETS, LLM_MODEL
from ..llm import claude_code
from ..pipeline import assets as lib
from ..pipeline import drawn
from ..store import read_json
from .cuts import norm

TEMPLATES = ["none", "sticker", "icon_word", "illustration", "counter", "meter", "checklist", "vs", "clock", "title"]
SCHEMA = {
    "type": "object", "additionalProperties": False, "required": ["topic_en", "items"],
    "properties": {
        "topic_en": {"type": "string"},
        "items": {"type": "array", "items": {
            "type": "object", "additionalProperties": False, "required": ["cue", "at_word", "template", "words", "visual_en", "why"],
            "properties": {
                "cue": {"type": "string"}, "at_word": {"type": "string"},
                "template": {"type": "string", "enum": TEMPLATES},
                "words": {"type": "array", "items": {"type": "string"}, "description": "1–4 كلمات متتالية من السطر نفسه، زي ما اتقالت"},
                "visual_en": {"type": "array", "items": {"type": "string"}, "description": "1–3 كلمات إنجليزي للحاجة اللي تترسم (أهمها الأول)"},
                "emoji": {"type": "string", "description": "للـ sticker: اسم إيموجي إنجليزي (smile, thumbs-up, fire, mind-blown...)"},
                "items": {"type": "array", "items": {"type": "string"}, "description": "checklist/vs: 2–4 عناصر، كل واحد كلمات من الكلام"},
                "value": {"type": "number"}, "level": {"type": "number"},
                "why": {"type": "string"},
            }}},
    },
}
SYSTEM = """إنت مونتير فيديوهات قصيرة محترف (تيك توك/ريلز). قدامك تفريغ فيديو متكلم سطر سطر بالتوقيت.
اختار الموشن جرافيك اللي يخلّي الفيديو حي واحترافي ومفهوم، **على قد موضوع الكلام**:
- `sticker`: إيموجي متحرك صغير جنب الوش لمشاعر/رد فعل (مبسوط، مصدوم، بيضحك، زهقان) — سريع (حوالي 1.6 ث).
- `icon_word`: أيقونة للحاجة نفسها + 1–3 كلمات من الكلام (الفكرة المهمة في السطر).
- `illustration`: رسمة لموقف (ناس بتتكلم، حد قاعد لوحده، شغل…) + 1–3 كلمات، للحظات الشرح.
- `counter`: لو اتقال رقم (value). `meter`: كمية/درجة (كتير/قليل) و level من 0 لـ 1. `checklist`: 2–4 حاجات اتعدّت.
- `vs`: مقارنة بين حاجتين اتقالوا (items = الاتنين). `clock`: لو الكلام عن وقت/ساعات/مواعيد. `title`: أول سطر بس (الهوك).
- `none`: السطر مش محتاج جرافيك.
قواعد: حوالي جرافيك لكل 3–5 ثواني (مش كل سطر، ومش سطرين ورا بعض بنفس النوع)، ونوّع.
لو فيه لحظة شرح (3 ثواني أو أكتر عن موقف أو فكرة)، استخدم `illustration` واحدة على الأقل في الفيديو (رسمة للموقف نفسه، مش أيقونة صغيرة).
`words` و `items` كلمات **من السطر نفسه زي ما اتقالت** (من غير تأليف). `at_word` كلمة من السطر الجرافيك يبدأ معاها.
`visual_en`: الحاجة اللي تترسم بالإنجليزي (people talking, alone person, thumbs up, friends...)، أهم كلمة الأول."""


def _words(text: str) -> list[str]:
    return [norm(w) for w in text.split() if norm(w)]


def _in_line(words: list[str], line: str) -> bool:
    lw = _words(line)
    ws = [norm(w) for w in words if norm(w)]
    return bool(ws) and all(any(x == w or (x.endswith(w) and len(x) - len(w) <= 2) for x in lw) for w in ws)


NEG = {norm(w) for w in ("مش", "ما", "مفيش", "مافيش", "مو", "لا", "ولا", "مكنش", "مابقاش", "عمري", "بلاش", "not", "no", "never")}


def _is_neg(w: str) -> bool:
    n = norm(w)
    return n in NEG or (n.endswith("ش") and len(n) > 3 and n.startswith(("م", "ع")) and n not in ("مش",) and n[:-1] in {"عندي", "عنده", "عندها", "عندك", "معاي", "معاه"}
                        or n in {"عنديش", "عندهوش", "عندهاش", "عندكش", "معنديش", "مفيش"})


def with_negation(words: list[str], line: str) -> list[str]:
    """لو الكلمة اللي قبل أول كلمة هتظهر (أو اللي قبلها) نفي، أو أول كلمة نفسها فيها نفي («عنديش»)، النفي بيفضل في الكلام اللي هيظهر."""
    lw = line.split()
    if not words:
        return words
    first = norm(words[0])
    k = next((i for i, x in enumerate(lw) if norm(x) == first or norm(x).endswith(first)), None)
    if k is None:
        return words
    j = next((j for j in (k - 1, k - 2) if j >= 0 and _is_neg(lw[j])), None)
    if j is None:
        return words
    while j - 1 >= 0 and _is_neg(lw[j - 1]):   # «ما عنديش» كلها
        j -= 1
    return [x.strip("«»\"'.,،؛;:؟?!…") for x in lw[j:k]] + list(words)


def plan(cues: list[dict], brief_text: str = "", ask_fn=None) -> dict:
    """سطور الترجمة ← خطة جرافيك متراجعة بالكود: {"topic_en", "items": [...مقبولة], "rejected": [...+السبب]}."""
    lines = [f"c{k + 1} [{c['start']:.1f}–{c['end']:.1f}] {c['text']}" for k, c in enumerate(cues)]
    user = "التفريغ:\n" + "\n".join(lines) + (f"\n\nطلب صاحب الفيديو: {brief_text}" if brief_text else "")
    try:
        res = (ask_fn or (lambda sy, us, sc: claude_code.ask(sy, us, sc, model=LLM_MODEL)["data"]))(SYSTEM, user, SCHEMA)
    except Exception as e:  # الجرافيك بالقواعد بيكمّل
        return {"error": str(e)[:200], "items": [], "rejected": []}
    ok, bad = [], []
    for it in res.get("items") or []:
        m = re.fullmatch(r"c(\d+)", it.get("cue", ""))
        k = int(m.group(1)) - 1 if m else -1
        if it["template"] == "none":
            continue
        if not (0 <= k < len(cues)):
            bad.append({**it, "reject": "سطر مش موجود"}); continue
        c = cues[k]
        at = next((w for w in c["words"] if norm(w["word"]) == norm(it.get("at_word", ""))
                   or norm(w["word"]).endswith(norm(it.get("at_word", "")) or "#")), None)
        if not at:
            bad.append({**it, "reject": f"«{it.get('at_word')}» مش في السطر"}); continue
        shown = list(it.get("words") or []) + [x for x in it.get("items") or []]
        if it["template"] not in ("sticker", "clock", "counter") and not shown:
            bad.append({**it, "reject": "مفيش كلام يظهر"}); continue
        if any(not _in_line(x.split(), c["text"]) for x in shown):
            bad.append({**it, "reject": "كلام مش من السطر نفسه (متألّف)"}); continue
        # النفي ما يتشالش: «عنديش اصحاب كتير» ظهرت «اصحاب كتير» (المعنى اتقلب). لو قبل الكلام اللي هيظهر كلمة نفي في السطر، بتتضاف معاه
        it["words"] = with_negation(it.get("words") or [], c["text"])
        it["items"] = [" ".join(with_negation(x.split(), c["text"])) for x in it.get("items") or []]
        if it["template"] == "title" and k != 0:
            it["template"] = "icon_word"
        ok.append({**it, "cue_i": k, "at": at["start"], "cue_end": c["end"]})
    ok.sort(key=lambda x: x["at"])
    return {"topic_en": res.get("topic_en", ""), "items": ok, "rejected": bad}


# ---------- الأشكال ----------
def _emoji_index() -> list[dict]:
    return (read_json(ASSETS / "catalog.json", {}).get("emoji") or {}).get("items") or []


def find_emoji(name: str, used: set) -> dict | None:
    """إيموجي متحرك (Noto Lottie) بالاسم: الأقرب لكلمات الاسم في الـ tags، ومش متكرر في نفس المونتاج."""
    q = set(re.split(r"[^a-z]+", (name or "").lower())) - {""}
    best = None
    for it in _emoji_index():
        if it["file"] in used:
            continue
        tags = set(re.split(r"[^a-z]+", " ".join(it.get("tags") or []).lower())) - {""}
        hit = {w for w in q if any(t == w or (len(w) > 3 and t.startswith(w)) for t in tags)}   # shrug ← shrugging
        sc = len(hit) - 0.1 * len(tags - q)
        if hit and (best is None or sc > best[0]):
            best = (sc, it)
    return best[1] if best else None


def find_visual(kind: str, terms: list[str], used: set, idea: list[str] | None = None) -> dict | None:
    """أيقونة أو رسمة على قد المعنى (نفس قواعد السبورة): المكتبة ← Iconify ← رسمة جديدة بيرسمها التطبيق."""
    from ..pipeline.scenes import relevant
    if not terms:
        return None
    kinds = ["illustration", "icon"] if kind == "illustration" else ["icon"]
    for k in kinds:
        for c in lib.candidates(k, terms, used, k=6):
            if relevant(c, terms, k):
                c = lib.ensure_local(c)
                used.add(c["file"])
                return {"kind": k, "file": c["file"], "name": c["name"], "license": c.get("license")}
    hit = lib.fetch_icon([terms[0]], used)
    if hit and relevant(hit, terms, "icon"):
        used.add(hit["file"])
        return {"kind": "icon", "file": hit["file"], "name": hit["name"], "license": hit.get("license")}
    got = drawn.draw("", terms, idea, used)
    if got:
        used.add(got["asset"])
        return {"kind": "icon", "file": got["asset"], "name": got["asset_name"], "license": got["license"], "drawn": True}
    return None


def svg_text(file: str) -> str:
    t = (ASSETS / file).read_text(encoding="utf-8")
    return re.sub(r"<\?xml[^>]*\?>", "", t)


def lottie_json(file: str) -> dict:
    return json.loads((ASSETS / file).read_text(encoding="utf-8"))


# ---------- من الخطة لمواصفات جرافيك ----------
IDLE = [(("heart", "love"), "beat"), (("bell", "notification", "alarm"), "swing"), (("phone", "call", "smartphone", "mobile"), "buzz"),
        (("bulb", "idea", "light", "lightbulb", "star", "sparkle"), "glow"), (("gear", "settings", "loading", "refresh"), "spin")]
DUR = {"sticker": 1.6, "icon_word": 2.2, "illustration": 3.0, "counter": 2.6, "meter": 2.8, "vs": 3.0, "clock": 2.4, "title": 2.6}
KIND = {"icon_word": "keyword", "illustration": "illus", "sticker": "sticker", "counter": "counter", "meter": "meter", "checklist": "checklist",
        "vs": "vs", "clock": "clock", "title": "title"}


def idle_for(name: str) -> str:
    n = (name or "").lower()
    return next((a for ks, a in IDLE if any(k in n for k in ks)), "float")


def duration(it: dict) -> float:
    if it["template"] == "checklist":
        return 1.2 + 0.55 * len(it.get("items") or [])
    return DUR.get(it["template"], 2.4) + 0.08 * len(" ".join(it.get("words") or []).split())


def to_spec(it: dict, used: set, idea_en: list[str] | None = None) -> dict | None:
    """بند من الخطة ← مواصفات للرسم (motion.render)، أو None لو الشكل المطلوب مش موجود ولا اترسم."""
    tpl, words = it["template"], " ".join(it.get("words") or [])
    sp = {"kind": KIND[tpl], "title": words, "at": it["at"], "first_word": it.get("at_word"), "why": f"مخرج الجرافيك: {it.get('why', '')}",
          "visual_en": it.get("visual_en") or [], "template": tpl}
    if tpl == "sticker":
        e = find_emoji(it.get("emoji") or " ".join(it.get("visual_en") or []), used)
        if not e:   # مفيش إيموجي متحرك بالاسم ده (مكتبة Noto مفيهاش shrug مثلًا): أيقونة على قد المعنى بدله
            v = find_visual("icon", (it.get("visual_en") or []) + ([it["emoji"]] if it.get("emoji") else []), used, idea_en)
            if not v or not words:
                return None
            sp.update(kind="keyword", svg=svg_text(v["file"]), visual=v["file"], visual_name=v["name"], license=v.get("license"),
                      drawn=bool(v.get("drawn")), idle=idle_for(v["name"]), why=sp["why"] + " · مفيش إيموجي متحرك بالاسم ده: أيقونة بدله")
            return sp
        used.add(e["file"])
        sp.update(lottie=lottie_json(e["file"]), emoji_file=e["file"], title="", license="CC BY 4.0 (Animated emoji by Google)")
    elif tpl in ("icon_word", "illustration", "title"):
        v = find_visual("illustration" if tpl == "illustration" else "icon", it.get("visual_en") or [], used, idea_en)
        if v and tpl != "title":
            sp.update(svg=svg_text(v["file"]), visual=v["file"], visual_name=v["name"], license=v.get("license"), drawn=bool(v.get("drawn")),
                      idle=idle_for(v["name"] + " " + " ".join(it.get("visual_en") or [])))
            if v["kind"] == "icon" and tpl == "illustration":
                sp["kind"] = "keyword"     # مفيش رسمة على قد المعنى: أيقونة كبيرة بدلها
        elif tpl != "title":
            return None
        if tpl == "title":
            sp["highlight"] = (it.get("words") or [""])[min(1, len(it.get("words") or [""]) - 1)] if len(it.get("words") or []) > 1 else (it.get("words") or [""])[0]
    elif tpl == "counter":
        if it.get("value") is None:
            return None
        sp.update(value=int(it["value"]), label=words)
    elif tpl == "meter":
        sp.update(level=max(0.1, min(1.0, float(it.get("level") or 0.5))), icon="gauge",
                  level_name="قليل" if (it.get("level") or 0.5) < 0.4 else "متوسط" if (it.get("level") or 0.5) < 0.7 else "كتير")
        v = find_visual("icon", it.get("visual_en") or [], used, idea_en)
        if v:
            sp.update(svg=svg_text(v["file"]), visual=v["file"])
    elif tpl in ("checklist", "vs"):
        items = [x for x in it.get("items") or [] if x.strip()][:4]
        if len(items) < 2:
            return None
        sp["items"] = items[:2] if tpl == "vs" else items
        sp["title"] = ""
    elif tpl == "clock":
        sp["idle"] = "spin"
    return sp
