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

from pathlib import Path

from ..config import ASSETS, LLM_MODEL
from ..llm import claude_code
from ..pipeline import assets as lib
from ..pipeline import drawn
from ..store import read_json
from .cuts import norm

TEMPLATES = ["none", "visual", "photo", "annotate", "counter"]
MAX_PHOTOS = 2
ANNOTATIONS = ["arrow_to_me", "sparkles", "question", "exclaim", "check", "cross", "heart", "lightning"]
TASTE = Path(__file__).with_name("taste.md")
SCHEMA = {
    "type": "object", "additionalProperties": False, "required": ["topic_en", "items"],
    "properties": {
        "topic_en": {"type": "string"},
        "items": {"type": "array", "items": {
            "type": "object", "additionalProperties": False, "required": ["cue", "at_word", "template", "visual_en", "why"],
            "properties": {
                "cue": {"type": "string"}, "at_word": {"type": "string"},
                "template": {"type": "string", "enum": TEMPLATES},
                "visual_en": {"type": "array", "items": {"type": "string"}, "description": "visual: 1–3 كلمات إنجليزي للحاجة اللي تتشاف (أهمها الأول)"},
                "annotation": {"type": "string", "enum": ANNOTATIONS},
                "value": {"type": "number", "description": "counter: الرقم اللي اتقال"},
                "why": {"type": "string"},
            }}},
    },
}
SYSTEM = """إنت مونتير فيديوهات قصيرة محترف (تيك توك/ريلز). قدامك تفريغ فيديو متكلم (اتراجع واتوافق عليه) سطر سطر بالتوقيت، وفهم المحتوى (الموضوع والأقسام).
الكلام كله **مكتوب أصلًا في الترجمة**، فالموشن جرافيك **مش كلام**: صورة ملوّنة شيك بتوضّح الفكرة في نفس اللحظة:
- `visual`: أيقونة ملوّنة للحاجة اللي بيتكلم عنها بالظبط (people, heart, idea, clock, money, phone, brain, home…). visual_en = الحاجة نفسها، أهم كلمة الأول.
- `annotate`: علامة ملوّنة على قد المعنى: check (صح/موافق)، cross (غلط/لأ)، question (حيرة/سؤال)، exclaim (مفاجأة/تحذير)، sparkles (حاجة حلوة)،
  heart (حب/راحة)، lightning (طاقة/قوة)، arrow_to_me (بيتكلم عن نفسه).
- `photo`: صورة حقيقية لموقف بيوصفه الكلام (a person reading alone, friends laughing together…)، مرتين بالكتير في الفيديو، للحظات المهمة. visual_en = وصف الصورة.
- `counter`: بس لو اتقال رقم (value).
- `none`: السطر مش محتاج.
قواعد: جرافيك في كل قسم على الأقل، وحوالي واحد كل 3–6 ثواني، ونوّع، وكل واحد ليه معنى واضح في الكلام اللي بيتقال ساعتها.
`at_word` كلمة من السطر الجرافيك يبدأ معاها بالظبط.

ذوق صاحب الفيديو الثابت (التزم بيه):
{taste}"""


def _words(text: str) -> list[str]:
    return [norm(w) for w in text.split() if norm(w)]


def _in_line(words: list[str], line: str) -> bool:
    lw = _words(line)
    ws = [norm(w) for w in words if norm(w)]
    return bool(ws) and all(any(x == w or (x.endswith(w) and len(x) - len(w) <= 2) for x in lw) for w in ws)


NUM_HINT = ("واحد", "اتنين", "تلات", "اربع", "خمس", "ست", "سبع", "تمان", "تسع", "عشر", "مية", "ميه", "الف", "مليون")
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


OUTLINE_SCHEMA = {"type": "object", "additionalProperties": False, "required": ["topic", "topic_en", "summary", "sections"],
                  "properties": {"topic": {"type": "string"}, "topic_en": {"type": "string"}, "summary": {"type": "string"},
                                 "sections": {"type": "array", "items": {"type": "object", "additionalProperties": False,
                                              "required": ["from_cue", "to_cue", "title", "purpose"],
                                              "properties": {"from_cue": {"type": "string"}, "to_cue": {"type": "string"},
                                                             "title": {"type": "string"}, "purpose": {"type": "string"}}}}}}
OUTLINE_SYSTEM = """إنت محرر محتوى. قدامك تفريغ فيديو متكلم سطر سطر (اتراجع واتوافق عليه).
افهم الفيديو كأنه سكريبت: الموضوع في جملة، وملخص في سطرين، وقسّمه لأقسام (هوك/فكرة/مثال/خلاصة…) كل قسم من سطر لسطر وعنوانه وهدفه.
اكتب بالعربي البسيط، ومن غير ما تألّف حاجة مش في الكلام."""


def outline(cues: list[dict], ask_fn=None) -> dict:
    """فهم المحتوى قبل الجرافيك: الموضوع والملخص والأقسام (من الترجمة اللي اتوافق عليها)."""
    lines = [f"c{k + 1} [{c['start']:.1f}–{c['end']:.1f}] {c['text']}" for k, c in enumerate(cues)]
    try:
        return (ask_fn or (lambda sy, us, sc: claude_code.ask(sy, us, sc, model=LLM_MODEL)["data"]))(OUTLINE_SYSTEM, "\n".join(lines), OUTLINE_SCHEMA)
    except Exception as e:
        return {"error": str(e)[:200], "topic": "", "topic_en": "", "summary": "", "sections": []}


def plan(cues: list[dict], brief_text: str = "", ask_fn=None, content: dict | None = None) -> dict:
    """سطور الترجمة + فهم المحتوى ← خطة جرافيك متراجعة بالكود: {"topic_en", "outline", "items": [...مقبولة], "rejected": [...+السبب]}."""
    content = content if content is not None else outline(cues, ask_fn)
    lines = [f"c{k + 1} [{c['start']:.1f}–{c['end']:.1f}] {c['text']}" for k, c in enumerate(cues)]
    user = (f"الموضوع: {content.get('topic')}\nالملخص: {content.get('summary')}\nالأقسام:\n"
            + "\n".join(f"- {x['from_cue']}→{x['to_cue']}: {x['title']} ({x['purpose']})" for x in content.get("sections") or [])
            + "\n\nالتفريغ:\n" + "\n".join(lines) + (f"\n\nطلب صاحب الفيديو: {brief_text}" if brief_text else ""))
    system = SYSTEM.replace("{taste}", TASTE.read_text(encoding="utf-8") if TASTE.exists() else "")
    try:
        res = (ask_fn or (lambda sy, us, sc: claude_code.ask(sy, us, sc, model=LLM_MODEL)["data"]))(system, user, SCHEMA)
    except Exception as e:  # الجرافيك بالقواعد بيكمّل
        return {"error": str(e)[:200], "items": [], "rejected": [], "outline": content}
    ok, bad = validate(res.get("items") or [], cues)
    ok.sort(key=lambda x: x["at"])
    photos = [x for x in ok if x["template"] == "photo"]
    for x in photos[MAX_PHOTOS:]:   # صورتين بالكتير
        ok.remove(x); bad.append({**x, "reject": f"أكتر من {MAX_PHOTOS} صور"})
    return {"topic_en": res.get("topic_en", "") or content.get("topic_en", ""), "items": ok, "rejected": bad, "outline": content}


def validate(items: list[dict], cues: list[dict]) -> tuple[list[dict], list[dict]]:
    """كل بند (من المخرج أو من اختيار صاحب الفيديو) بيتراجع بالكود: السطر موجود، والكلمة فيه، والنوع مكتمل."""
    ok, bad = [], []
    for it in items:
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
        if it["template"] in ("visual", "photo") and not it.get("visual_en"):
            bad.append({**it, "reject": "visual من غير حاجة تتشاف"}); continue
        if it["template"] == "annotate" and it.get("annotation") not in ANNOTATIONS:
            bad.append({**it, "reject": "شخبطة مش معروفة"}); continue
        if it["template"] == "counter" and (it.get("value") is None or not re.search(r"\d|" + "|".join(NUM_HINT), c["text"])):
            bad.append({**it, "reject": "مفيش رقم اتقال في السطر"}); continue
        ok.append({**it, "cue_i": k, "at": at["start"], "cue_end": c["end"]})
    return ok, bad


# ---------- اقتراحات لكل مشهد (الاستوديو) ----------
SUGGEST_SCHEMA = {"type": "object", "additionalProperties": False, "required": ["scenes"], "properties": {"scenes": {"type": "array", "items": {
    "type": "object", "additionalProperties": False, "required": ["cue", "options"], "properties": {
        "cue": {"type": "string"}, "options": {"type": "array", "items": SCHEMA["properties"]["items"]["items"]}}}}}}
SUGGEST_SYSTEM = """إنت مونتير فيديوهات قصيرة محترف. قدامك تفريغ فيديو متكلم سطر سطر وفهم المحتوى.
لكل سطر اقترح **3 اختيارات مختلفة** لموشن جرافيك (صورة وحركة، مش كلام) يختار منهم صاحب الفيديو:
visual (أيقونة ملوّنة للحاجة: visual_en)، photo (صورة حقيقية للموقف: visual_en وصف قصير)، annotate (علامة: check/cross/question/exclaim/sparkles/heart/lightning/arrow_to_me)،
counter (لو اتقال رقم). نوّع بين الاختيارات (مثلًا أيقونة + صورة + علامة)، وكل اختيار ليه علاقة واضحة بالسطر. at_word كلمة من السطر.

ذوق صاحب الفيديو الثابت:
{taste}"""


def suggest(cues: list[dict], content: dict | None = None, ask_fn=None) -> dict:
    """لكل سطر 3 اختيارات جرافيك متراجعة بالكود (صاحب الفيديو بيختار في الاستوديو)."""
    content = content if content is not None else outline(cues, ask_fn)
    lines = [f"c{k + 1} [{c['start']:.1f}–{c['end']:.1f}] {c['text']}" for k, c in enumerate(cues)]
    user = f"الموضوع: {content.get('topic')}\nالملخص: {content.get('summary')}\n\nالتفريغ:\n" + "\n".join(lines)
    system = SUGGEST_SYSTEM.replace("{taste}", TASTE.read_text(encoding="utf-8") if TASTE.exists() else "")
    try:
        res = (ask_fn or (lambda sy, us, sc: claude_code.ask(sy, us, sc, model=LLM_MODEL)["data"]))(system, user, SUGGEST_SCHEMA)
    except Exception as e:
        return {"error": str(e)[:200], "scenes": [], "outline": content}
    out = []
    for sc in res.get("scenes") or []:
        ok, _ = validate([{**o, "cue": sc["cue"]} for o in sc.get("options") or [] if o.get("template") != "none"], cues)
        if ok:
            out.append({"cue": sc["cue"], "cue_i": ok[0]["cue_i"], "text": cues[ok[0]["cue_i"]]["text"], "options": ok[:3]})
    return {"scenes": out, "outline": content}


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


def find_visual(kind: str, terms: list[str], used: set, idea: list[str] | None = None, allow_draw: bool = True) -> dict | None:
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


COLOR_SETS = ["fluent-color", "flat-color-icons"]   # أيقونات ملوّنة (MIT): الشكل الأساسي للجرافيك (شيك وملوّن، مش خط أبيض)


# مرادفات للبحث في الأيقونات الملوّنة (أسماءها إنجليزي بسيط): «friends» مش موجودة فكانت بتنزل لأيقونة خط شبه يافطة الحمّام
SYN = {"friends": "people", "friend": "person", "community": "people community", "crowd": "people team", "society": "people community",
       "social": "people chat", "introvert": "person", "alone": "person", "happy": "emoji smile", "life": "home", "living": "home",
       "relationship": "people", "group": "people team", "talk": "chat", "conversation": "chat multiple"}


def find_color_icon(terms: list[str], used: set) -> dict | None:
    """أيقونة ملوّنة من Iconify على قد المعنى: كل كلمة من كلمات المخرج (بالترتيب) ومرادفها، والاسم لازم فيه كلمة منها. بتتحفظ محلي برخصتها."""
    import requests
    from ..pipeline.scenes import _stem
    qs = []
    for t in terms:
        for w in [t, SYN.get(t.lower().strip())] + [SYN.get(x) for x in t.lower().split()]:
            if w and w not in qs:
                qs.append(w)
    for q in qs[:6]:
        head = {_stem(w) for w in lib._words(q)}
        try:
            r = requests.get("https://api.iconify.design/search", params={"query": q, "prefixes": ",".join(COLOR_SETS), "limit": 64}, headers=lib.UA, timeout=20)
            icons = r.json().get("icons", []) if r.ok else []
        except requests.RequestException:
            return None
        best = None
        for full in icons:
            prefix, name = full.split(":", 1)
            words = {_stem(w) for w in lib._words(name)}
            if not head & words:
                continue
            size = int(m.group(1)) if (m := re.search(r"-(\d+)$", name)) else 99
            base = re.sub(r"-\d+$", "", name)
            sc = (len(head & words) * 10 - len(words - head) * 2 + min(size, 48) / 48)
            file = f"fetched/icons-color/{prefix}-{base}.svg"
            if file in used:
                continue
            if best is None or sc > best[0]:
                best = (sc, prefix, name, base, file)
        if best:
            _, prefix, name, base, file = best
            path = ASSETS / file
            if not path.exists():
                try:
                    svg = requests.get(f"https://api.iconify.design/{prefix}/{name}.svg", headers=lib.UA, timeout=20)
                except requests.RequestException:
                    return None
                if not svg.ok or "<svg" not in svg.text:
                    continue
                path.parent.mkdir(parents=True, exist_ok=True)
                path.write_text(svg.text, encoding="utf-8")
            used.add(file)
            return {"kind": "icon", "file": file, "name": base.replace("-", " "), "license": f"MIT ({prefix})", "color": True}
    return None


def svg_text(file: str) -> str:
    t = (ASSETS / file).read_text(encoding="utf-8")
    return re.sub(r"<\?xml[^>]*\?>", "", t)


def lottie_json(file: str) -> dict:
    return json.loads((ASSETS / file).read_text(encoding="utf-8"))


# ---------- من الخطة لمواصفات جرافيك ----------
IDLE = [(("heart", "love"), "beat"), (("bell", "notification", "alarm"), "swing"), (("phone", "call", "smartphone", "mobile"), "buzz"),
        (("bulb", "idea", "light", "lightbulb", "star", "sparkle"), "glow"), (("gear", "settings", "loading", "refresh", "clock", "time"), "spin")]
DUR = {"visual": 2.3, "photo": 2.8, "annotate": 1.8, "counter": 2.4}


def idle_for(name: str) -> str:
    n = (name or "").lower()
    return next((a for ks, a in IDLE if any(k in n for k in ks)), "float")


def duration(it: dict) -> float:
    return DUR.get(it["template"], 2.0)


def to_spec(it: dict, used: set, idea_en: list[str] | None = None, allow_draw: bool = True) -> dict | None:
    """بند من الخطة ← مواصفات للرسم. مفيش كلام بيظهر (الكلام في الترجمة)، ومفيش إيموجي أصفر (ذوق صاحب الفيديو)."""
    tpl = it["template"]
    sp = {"kind": tpl, "title": "", "at": it["at"], "first_word": it.get("at_word"), "why": f"مخرج الجرافيك: {it.get('why', '')}",
          "visual_en": it.get("visual_en") or [], "template": tpl}
    if tpl == "visual":
        # ملوّنة الأول، ولو مفيش: التطبيق بيرسمها (مش أيقونة خط من المكتبة: «friends» طلعت شبه يافطة الحمّام)
        v = find_color_icon(it.get("visual_en") or [], used) or (None if allow_draw else find_visual("icon", it.get("visual_en") or [], used, idea_en, allow_draw=False))
        if not v and allow_draw:
            got = drawn.draw("", it.get("visual_en") or [], idea_en, used)
            v = {"kind": "icon", "file": got["asset"], "name": got["asset_name"], "license": got["license"], "drawn": True} if got else None
        if not v:
            return None
        sp.update(svg=svg_text(v["file"]), visual=v["file"], visual_name=v["name"], license=v.get("license"), drawn=bool(v.get("drawn")),
                  color=bool(v.get("color")), idle=idle_for(v["name"] + " " + " ".join(it.get("visual_en") or [])))
    elif tpl == "photo":
        from . import library
        ph = library.find_photo(it.get("visual_en") or [], used)
        if not ph:
            return None
        sp.update(photo=ph["file"], photo_credit=ph.get("credit"), license=ph.get("license"), visual_name=ph.get("title"))
    elif tpl == "annotate":
        sp["annotation"] = it["annotation"]
    elif tpl == "counter":
        sp.update(value=int(it["value"]), label="")
    return sp
