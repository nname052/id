"""المرحلة 2: خطة المشاهد. Claude بيعمل هوية بصرية جديدة لكل فيديو (ألوان، خطوط، خلفية، انتقالات) ويختار شكل كل مشهد
من 12 شكل، والبحث في كل المكتبات بيحصل هنا من غير AI، مع ذاكرة بتمنع تكرار الرسومات من الفيديوهات اللي فاتت.
المشاهد اللي نوعها custom بيصممها Claude بالكود في custom.py."""

import hashlib
import math
import re
import time

from .. import history, prefs, store
from ..config import ASSETS, MIN_SCENE_SECONDS
from . import assets, brief as brief_stage, custom, drawn, three_d
from .common import ask, prompt

LAYOUTS = ["hero", "kinetic", "split", "stat", "list", "versus", "quote", "question", "icon_row", "card", "character", "custom", "scene3d"]
HEADING_FONTS = ["Reem Kufi", "Lalezar", "Rakkas", "Blaka", "Kufam", "Changa", "Marhey", "Lemonada", "Alexandria", "Cairo",
                 "Readex Pro", "El Messiri", "Aref Ruqaa", "Amiri", "Noto Kufi Arabic", "Baloo Bhaijaan 2", "Zain"]
BODY_FONTS = ["IBM Plex Sans Arabic", "Cairo", "Tajawal", "Almarai", "Alexandria", "Readex Pro", "Zain", "Noto Kufi Arabic", "Baloo Bhaijaan 2"]
POSES = ["idle", "think", "talk", "cheer", "show", "wide", "hurt", "jump", "fall", "back", "hold", "interact", "run", "walk", "duck", "kick", "climb"]
HEX = {"type": "string", "pattern": "^#[0-9a-fA-F]{6}$"}
VISUAL = {"type": "object", "properties": {
    "kind": {"type": "string", "enum": ["illustration", "icon", "emoji", "character"]},
    "search": {"type": "array", "items": {"type": "string"}},
    "emoji_name": {"type": "string"},
    "pose": {"type": "string", "enum": POSES}},
    "required": ["kind", "search"], "additionalProperties": False}
SCENE = {"type": "object", "properties": {
    "sentence_ids": {"type": "array", "items": {"type": "integer"}, "minItems": 1},
    "idea": {"type": "string"},
    "idea_en": {"type": "array", "items": {"type": "string"}, "minItems": 1, "maxItems": 5},
    "layout": {"type": "string", "enum": LAYOUTS},
    "headline": {"type": "string"},
    "cue_word": {"type": "string"},
    "visual": VISUAL,
    "items": {"type": "array", "maxItems": 4, "items": {"type": "object", "properties": {"label": {"type": "string"}, "visual": VISUAL},
                                                         "required": ["label"], "additionalProperties": False}},
    "number_value": {"type": "string"},
    "number_label": {"type": "string"},
    "chart": {"type": "string", "enum": ["ring", "bar", "none"]},
    "custom_brief": {"type": "string"},
    "camera": {"type": "string", "enum": ["none", "push", "pull", "drift", "tilt", "shake"]},
    # مشهد 3D بإخراج حر: Claude بيكتب الأداء (وضعيات مربوطة بالكلام) واللقطات، والمشغّل بيحسب الحركة (rig.js)
    "scene3d": {"type": "object", "properties": {
        "set": {"type": "string", "enum": list(three_d.SETS)},
        "character": {"type": "string", "enum": list(three_d.CHARACTERS)},
        "time": {"type": "string", "enum": ["day", "sunset", "night"]},
        "speaking": {"type": "boolean"},
        "start": {"type": "string", "enum": ["center", "at_fridge_open", "at_window", "at_desk"]},
        "blocking": {"type": "object", "properties": {"x": {"type": "number"}, "z": {"type": "number"}, "face": {"type": "number"}},
                     "required": ["x", "z", "face"], "additionalProperties": False},
        "performance": {"type": "array", "minItems": 2, "maxItems": 7, "items": {"type": "object", "properties": {
            "at_word": {"type": "string"},
            "body": {"type": "string", "enum": three_d.BODY_POSES}, "head": {"type": "string", "enum": three_d.HEAD_POSES},
            "l_arm": {"type": "string", "enum": three_d.ARM_POSES}, "r_arm": {"type": "string", "enum": three_d.ARM_POSES},
            "motion": {"type": "string", "enum": ["none", "nod", "shake", "bounce", "laugh", "cry", "tremble", "breathe_heavy", "look_around"]},
            "ease": {"type": "string", "enum": three_d.EASES},
            "move_to": {"type": "array", "items": {"type": "number"}, "minItems": 2, "maxItems": 2},
            "face": {"type": "number"},
            "emote": {"type": "string", "enum": three_d.EMOTES}, "fx": {"type": "string", "enum": three_d.FX},
            "face": {"type": "string", "enum": three_d.EXPRESSIONS}, "action": {"type": "string", "enum": three_d.ACTIONS}},
            "required": ["at_word", "body", "head", "l_arm", "r_arm", "motion", "ease", "face"], "additionalProperties": False}},
        "shots": {"type": "array", "minItems": 1, "maxItems": 2, "items": {"type": "object", "properties": {
            "at_word": {"type": "string"}, "type": {"type": "string", "enum": three_d.SHOT_TYPES},
            "angle": {"type": "number"}, "height": {"type": "string", "enum": three_d.SHOT_HEIGHTS},
            "move": {"type": "string", "enum": three_d.CAMERA_MOVES}, "dutch": {"type": "boolean"}},
            "required": ["at_word", "type", "angle", "height", "move", "dutch"], "additionalProperties": False}}},
        "required": ["set", "character", "time", "speaking", "start", "blocking", "performance", "shots"], "additionalProperties": False},
    "enter": {"type": "string", "enum": ["rise", "pop", "draw", "fade", "slide"]},
    "idle": {"type": "string", "enum": ["float", "pulse", "wobble", "none"]}},
    "required": ["sentence_ids", "idea", "idea_en", "layout", "headline", "cue_word", "enter", "idle"], "additionalProperties": False}
SCHEMA = {"type": "object", "properties": {
    "identity": {"type": "object", "properties": {
        "palette": {"type": "object", "properties": {k: HEX for k in ("bg", "ink", "accent", "accent2", "surface")},
                    "required": ["bg", "ink", "accent", "accent2", "surface"], "additionalProperties": False},
        "font_heading": {"type": "string", "enum": HEADING_FONTS},
        "font_body": {"type": "string", "enum": BODY_FONTS},
        "background": {"type": "string", "enum": ["solid", "gradient", "blobs", "grid", "split", "stripes", "spotlight", "paper"]},
        "transition": {"type": "string", "enum": ["rise", "slide", "zoom", "wipe", "flash"]},
        "look3d": {"type": "string", "enum": list(three_d.LOOKS)}},
        "required": ["palette", "font_heading", "font_body", "background", "transition", "look3d"], "additionalProperties": False},
    "pace": {"type": "string", "enum": ["calm", "normal", "energetic"]},
    "text_size": {"type": "string", "enum": ["normal", "large"]},
    "scenes": {"type": "array", "minItems": 1, "maxItems": 40, "items": SCENE}},
    "required": ["identity", "pace", "text_size", "scenes"], "additionalProperties": False}

# ---------- السبورة البيضاء ----------
WB_FONTS = ["Marhey", "Lemonada", "Reem Kufi", "Changa", "El Messiri", "Aref Ruqaa"]
WB_ITEM = {"type": "object", "properties": {
    "kind": {"type": "string", "enum": ["illustration", "icon", "text", "number", "arrow", "underline", "circle"]},
    "search": {"type": "array", "items": {"type": "string"}},
    "text": {"type": "string"}, "value": {"type": "string"},
    "from": {"type": "integer"}, "to": {"type": "integer"}, "target": {"type": "integer"},
    "color": {"type": "string", "enum": ["ink", "accent", "accent2"]},
    "cue_word": {"type": "string"}},
    "required": ["kind", "color", "cue_word"], "additionalProperties": False}
WB_SCHEMA = {"type": "object", "properties": {
    "identity": {"type": "object", "properties": {
        "palette": SCHEMA["properties"]["identity"]["properties"]["palette"],
        "font_heading": {"type": "string", "enum": WB_FONTS}, "font_body": {"type": "string", "enum": WB_FONTS},
        "transition": {"type": "string", "enum": ["slide", "wipe"]}},
        "required": ["palette", "font_heading", "font_body", "transition"], "additionalProperties": False},
    "pace": SCHEMA["properties"]["pace"], "text_size": SCHEMA["properties"]["text_size"],
    "scenes": {"type": "array", "minItems": 1, "maxItems": 20, "items": {"type": "object", "properties": {
        "sentence_ids": {"type": "array", "items": {"type": "integer"}, "minItems": 1},
        "idea": {"type": "string"},
        "idea_en": {"type": "array", "items": {"type": "string"}, "minItems": 1, "maxItems": 5},
        "board": {"type": "array", "minItems": 1, "maxItems": 4, "items": WB_ITEM}},
        "required": ["sentence_ids", "idea", "idea_en", "board"], "additionalProperties": False}}},
    "required": ["identity", "pace", "text_size", "scenes"], "additionalProperties": False}


def schema_for(vtype: str) -> dict:
    """الشكل المسموح لخطة المشاهد حسب نوع الفيديو: العادي من غير 3D، والـ 3D حركتين على الأقل في كل مشهد."""
    import copy
    sch = copy.deepcopy(SCHEMA)
    sc = sch["properties"]["scenes"]["items"]["properties"]
    if vtype == "regular":
        sc["layout"]["enum"] = [x for x in LAYOUTS if x != "scene3d"]
        del sc["scene3d"]
    return sch


POSE_FILE = {"cheer": "cheer0", "walk": "walk0", "run": "run0", "climb": "climb0"}
TOON = ["Male person", "Female person", "Male adventurer", "Female adventurer"]


def _seed(*parts) -> int:
    return int(hashlib.md5("|".join(map(str, parts)).encode()).hexdigest()[:8], 16)


def _character(pid: str, recent: set) -> str:
    """شخصية كرتون واحدة للفيديو كله (نفس الشخص في كل مشاهده)، ومختلفة عن آخر الفيديوهات.
    الشخصيات 4 بس (أقل من نافذة التكرار)، فلو كلهم اتستخدموا بناخد اللي اتستخدم من أطول وقت."""
    options = [c for c in TOON if not any(c in a for a in recent)]
    if options:
        return options[_seed(pid, "char") % len(options)]
    last = {}
    for k, h in enumerate(history.recent(history.KEEP)):
        for c in TOON:
            if any(c in a for a in h.get("assets", [])):
                last[c] = k
    return min(TOON, key=lambda c: last.get(c, -1))


def _fresh(choice: str, pool: list, recent_vals: list, pid: str, salt: str) -> str:
    """القيمة اللي اختارها Claude لو ما اتستخدمتش في آخر الفيديوهات، وإلا بديل ما اتستخدمش (أو الأقدم استخدامًا)."""
    if choice not in recent_vals:
        return choice
    free = [x for x in pool if x not in recent_vals]
    if free:
        return free[_seed(pid, salt) % len(free)]
    last = {x: i for i, x in enumerate(recent_vals)}  # آخر مرة اتستخدم فيها (الأكبر = الأحدث)
    return min(pool, key=lambda x: last.get(x, -1))


def fresh_identity(ident: dict, pid: str, vtype: str) -> dict:
    """الخلفية وخط العناوين ما يتكرروش من آخر SHAPE_WINDOW فيديوهات (بالكود، مش بس طلب من Claude)."""
    ident = dict(ident)
    fonts = WB_FONTS if vtype == "whiteboard" else HEADING_FONTS
    ident["font_heading"] = _fresh(ident.get("font_heading"), fonts, history.recent_values("font_heading", skip_pid=pid), pid, "font")
    if vtype != "whiteboard":
        bgs = SCHEMA["properties"]["identity"]["properties"]["background"]["enum"]
        ident["background"] = _fresh(ident.get("background"), bgs, history.recent_values("background", skip_pid=pid), pid, "bg")
    return ident


# كلمات عامة: لو دي بس اللي اتطابقت، الشكل مش على قد المعنى («decreasing number» ← أيقونة الرقم 0 بدل مخ)
GENERIC = {"number", "numbers", "counter", "decreasing", "increasing", "big", "small", "simple", "icon", "illustration", "sign", "symbol",
           "shape", "line", "lines", "text", "word", "words", "thing", "object", "concept", "idea", "abstract", "one", "two", "three", "side",
           "every", "minute", "lost", "test", "cells", "person", "people", "man", "woman"}


def _stem(w: str) -> str:
    return w[:-1] if len(w) > 3 and w.endswith("s") and not w.endswith("ss") else w


def relevant(hit: dict, terms: list[str], kind: str = "icon") -> bool:
    """الشكل على قد المعنى.
    - أيقونة/إيموجي: اسمها لازم فيه كلمة من **أول** كلمة بحث (الحاجة نفسها). ليه: «honeycomb cell, wax cap» جابت قبعة تخرّج
      (cap)، و«bees, flapping wings» جابت إيموجي فلوس بجناحات: الكلمة الجانبية كانت كفاية.
    - رسمة (مشهد كامل): كلمة مش عامة من أي كلمة بحث في اسمها، أو كلمتين في كلماتها."""
    stem = lambda ws: {_stem(w) for w in ws if w not in GENERIC and len(w) > 2}
    name = {_stem(w) for w in assets._words(hit.get("name", ""))}
    if kind in ("icon", "emoji"):
        head = stem(assets._words(terms[0])) if terms else set()
        if not head:
            head = stem(assets._words(" ".join(terms)))
        return not head or bool(head & name)
    q = stem(assets._words(" ".join(terms)))
    if not q:
        return True
    if q & name:
        return True
    words = set(assets._words(" ".join([hit.get("name", ""), *map(str, hit.get("tags") or [])])))
    for it in assets._load()["items"]:   # كلمات المكتبة للعنصر ده (الـ keywords)
        if it["file"] == hit.get("file"):
            words |= set(it["words"])
            break
    return len(q & {_stem(w) for w in words}) >= 2


def resolve_visual(v: dict | None, pid: str, used: set, recent: set, toon: str, salt: str, idea: list | None = None,
                   icon_only: bool = False, allow_draw: bool = True) -> dict | None:
    """بيلاقي الملف للصورة: من النوع المطلوب، ولو مفيش بينزل للنوع اللي بعده.
    الترتيب: المكتبات المحلية (لازم على قد المعنى) ← أيقونة أونلاين للكلمة الأساسية ← رسمة جديدة بيرسمها التطبيق للفكرة."""
    if not v:
        return None
    if v["kind"] == "character":
        pose = POSE_FILE.get(v.get("pose") or "idle", v.get("pose") or "idle")
        a, b = toon.split(" ")
        key = a.lower() + b.capitalize()  # "Male adventurer" ← maleAdventurer
        sheet = f"2d/toon-characters/{toon}/Vector/character_{key}.svg"
        if (ASSETS / sheet).exists():
            return {"kind": "character", "asset": sheet, "xml": f"2d/toon-characters/{toon}/Tilesheet/character_{key}_sheet.xml",
                    "pose": pose, "asset_name": f"{toon} · {pose}", "license": "CC0 (Kenney)"}
        v = {**v, "kind": "illustration"}
    order = {"illustration": ["illustration", "icon", "emoji"], "icon": ["icon", "illustration"], "emoji": ["emoji", "icon"]}[v["kind"]]
    if icon_only:
        order = ["icon"]
    terms = v.get("search") or []
    take = lambda kind, hit: (used.add(hit["file"]) or {"kind": kind, "asset": hit["file"], "asset_name": hit["name"], "license": hit.get("license"),
                                                        "fetched": hit.get("fetched", False)})
    for kind in order:
        q = assets.emoji_terms(v.get("emoji_name") or " ".join(terms)) if kind == "emoji" else terms
        if not q:
            continue
        hit = assets.pick(kind, q, used, recent, _seed(pid, salt, kind))
        if hit and relevant(hit, terms if kind != "emoji" else (terms or [v.get("emoji_name") or ""]), kind):
            return take(kind, hit)
    if v["kind"] == "emoji" or not terms:
        return None
    blocked = set(used) | set(recent)
    # أيقونة أونلاين (مجموعات رخصتها مفتوحة) للكلمة الأساسية، وبعدين للجملة كلها
    for q in ([terms[0]], terms):
        hit = assets.fetch_icon(q, blocked)
        if hit and relevant(hit, terms, "icon"):
            return take("icon", hit)
    # مفيش حاجة على قد المعنى: التطبيق بيرسمها
    got = drawn.reuse(terms, blocked) or (drawn.draw(pid, terms, idea, blocked) if allow_draw else None)
    if got:
        used.add(got["asset"])
    return got


def fix_3d(scenes: list, pid: str, voice_gender: str) -> None:
    """قواعد الـ 3D اللي ما ينفعش نسيبها للـ AI: الشخصية مختلفة عن آخر الفيديوهات، ومن غير خلط واقعي بكرتون،
    واللي بيتكلم لازم يكون عنده بق يتحرك ومن نفس نوع الصوت."""
    banned = set(history.recent_characters(skip_pid=pid))
    chars = [s["scene3d"]["character"] for s in scenes if s.get("scene3d")]
    if not chars:
        return
    main = max(set(chars), key=chars.count)
    mapping = {}

    def alternative(c: str, need_speaker: bool) -> str:
        g = three_d.GENDER[c]
        pool = [x for x in (three_d.SPEAKERS if need_speaker else three_d.CHARACTERS) if three_d.GENDER[x] == g and x not in banned
                and (x in three_d.REALISTIC) == (main in three_d.REALISTIC and c == main)]
        pool = pool or [x for x in three_d.SPEAKERS if x not in banned] or list(three_d.SPEAKERS)
        return pool[_seed(pid, c) % len(pool)]
    speaking_chars = {s["scene3d"]["character"] for s in scenes if s.get("scene3d", {}).get("speaking")}
    for c in set(chars):
        if c in banned or (c != main and (c in three_d.REALISTIC) != (main in three_d.REALISTIC)):
            mapping[c] = alternative(c, c in speaking_chars)
    for s in scenes:
        s3 = s.get("scene3d")
        if not s3:
            continue
        s3["character"] = mapping.get(s3["character"], s3["character"])
        if s3.get("speaking"):
            if s3["character"] not in three_d.SPEAKERS:
                s3["character"] = alternative(s3["character"], True)
            # صوت الراوي ست والشخصية راجل (أو العكس): الشخصية ما تتكلمش، الراوي بيحكي
            if voice_gender in ("male", "female") and three_d.GENDER[s3["character"]] != voice_gender:
                s3["speaking"] = False
    if mapping:
        store.log(pid, f"3D: غيّرنا الشخصيات علشان ما تتكررش/تتخلطش: {mapping}")


def _kw(words) -> set:
    out = set()
    for w in words or []:
        for t in re.findall(r"[a-z]+", str(w).lower()):
            if len(t) > 2:
                out.add(t[:-1] if t.endswith("s") and len(t) > 4 else t)
    return out


def matches_idea(search, idea_en) -> bool:
    """صورة بتوضّح الفكرة: كلمات البحث عنها فيها كلمة على الأقل من كلمات الفكرة. لو المشهد مالوش idea_en (خطط قديمة) بنعدّيه."""
    return not idea_en or bool(_kw(search) & _kw(idea_en))


def merge_short(raw_scenes: list, timing: dict, min_s: float = MIN_SCENE_SECONDS) -> tuple[list, int]:
    """مشهد وقته على الشاشة أقل من الحد بيندمج في اللي قبله (أول مشهد بياخد اللي بعده). بيرجّع المشاهد وعدد الدمج.
    الوقت بيتحسب بالظبط زي المشغّل: المشهد بيبدأ قبل أول كلمة فيه بـ 0.2 ثانية (الأول من 0) ويخلص لما اللي بعده يبدأ."""
    scs, merged = [dict(s) for s in raw_scenes], 0
    first, total = timing["first"], timing["total"]
    start = lambda k: 0.0 if k == 0 else max(0.0, min(first.get(i, 1e9) for i in scs[k]["sentence_ids"]) - 0.2)  # noqa: E731
    dur = lambda k: (start(k + 1) if k + 1 < len(scs) else total) - start(k)  # noqa: E731
    changed = True
    while changed and len(scs) > 1:
        changed = False
        for k in range(len(scs) - 1):  # آخر مشهد بيكمّل لآخر الفيديو
            if dur(k) >= min_s:
                continue
            a, b = (k, k + 1) if k == 0 else (k - 1, k)
            A, B = scs[a], scs[b]
            A["sentence_ids"] = A["sentence_ids"] + B["sentence_ids"]
            if "board" in A and "board" in B:  # السبورة: عناصر التانية بتتضاف، وأرقام الأسهم/الدواير بتتزحزح
                off = len(A["board"])
                A["board"] = A["board"] + [{**it, **{f: it[f] + off for f in ("from", "to", "target") if isinstance(it.get(f), int)}} for it in B["board"]]
            if B.get("idea_en"):
                A["idea_en"] = list(dict.fromkeys((A.get("idea_en") or []) + B["idea_en"]))[:8]
            del scs[b]
            merged += 1
            changed = True
            break
    return scs, merged


def _words_for(pid: str) -> dict:
    from . import audio
    W = store.read_json(store.project_dir(pid) / "words.json")
    return W if (W and W.get("source") in ("elevenlabs", "user")) else audio.estimated_words(pid)


def sentence_seconds(pid: str) -> dict:
    """مدة كل جملة: من الصوت الحقيقي لو موجود، وإلا تقدير."""
    secs = {}
    for w in _words_for(pid)["words"]:
        a, b = secs.get(w["sid"], (w["start"], w["end"]))
        secs[w["sid"]] = (min(a, w["start"]), max(b, w["end"]))
    return {k: round(b - a + 0.35, 3) for k, (a, b) in secs.items()}  # + السكتة بعد الجملة


def scene_timing(pid: str) -> dict:
    """أول كلمة في كل جملة + طول الفيديو (نفس حساب المشغّل)."""
    W = _words_for(pid)
    first = {}
    for w in W["words"]:
        first[w["sid"]] = min(first.get(w["sid"], w["start"]), w["start"])
    return {"first": first, "total": W["duration"] + 2.2}


def finalize(sc: dict, i: int, vtype: str, pid: str, used: set, recent: set, toon: str) -> dict:
    """مشهد من Claude ← مشهد جاهز للمشغّل: بيدوّر على ملفات الصور، وبيحوّل الشكل لو الصورة مش موجودة."""
    out = {**sc, "id": sc.get("id") or f"s{i + 1:02d}"}
    out["visuals"], out["items"] = [], []
    if vtype == "whiteboard":
        # كل عنصر رسمة/أيقونة بيدوّر على ملفه، واللي ما لقيناش ليه رسمة بيتكتب كلام بدلها
        out.update(layout="board", headline="", cue_word="", enter="fade", idle="none")
        for j, it in enumerate(out["board"]):
            if it["kind"] in ("illustration", "icon") and not matches_idea(it.get("search"), sc.get("idea_en")):
                out.setdefault("rejected", []).append({"search": it.get("search"), "idea_en": sc.get("idea_en")})
                it["kind"], it["text"] = "text", it.get("text") or " ".join(it.get("search") or [])[:24]
                continue
            if it["kind"] in ("illustration", "icon"):
                v = resolve_visual({"kind": it["kind"], "search": it.get("search") or []}, pid, used, recent, toon, f"{i}b{j}", sc.get("idea_en"))
                if v and v["kind"] in ("illustration", "icon", "emoji"):
                    it["visual"] = v; it["kind"] = v["kind"]; out["visuals"].append(v)
                else:
                    it["kind"], it["text"] = "text", it.get("text") or " ".join(it.get("search") or [])[:24]
        return out
    if sc.get("visual") and sc["visual"].get("kind") != "character" and not matches_idea(sc["visual"].get("search"), sc.get("idea_en")):
        out.setdefault("rejected", []).append({"search": sc["visual"].get("search"), "idea_en": sc.get("idea_en")})
    elif sc.get("visual"):
        v = resolve_visual(sc["visual"], pid, used, recent, toon, f"{i}v", sc.get("idea_en"))
        if v:
            out["visuals"].append(v)
    for j, it in enumerate(sc.get("items") or []):
        out["items"].append({"label": it["label"], "visual": resolve_visual(it.get("visual"), pid, used, recent, toon, f"{i}i{j}")})
    # شكل محتاج صورة ومالقيناش: بيتحوّل لشكل كلام بس بدل ما يبقى فاضي
    if out["layout"] in ("hero", "split", "card", "character") and not out["visuals"]:
        out["layout"] = "kinetic"
    if out["layout"] in ("list", "versus", "icon_row") and len(out["items"]) < 2:
        out["layout"] = "kinetic"
    if out["layout"] == "stat" and not re.search(r"\d", out.get("number_value") or ""):
        out["layout"] = "kinetic"
    if out["layout"] == "scene3d" and not out.get("scene3d"):
        out["layout"] = "kinetic"
    return out


# ---------- مراجعة معنى الرسومات (طلب واحد للفيديو كله) ----------
# ليه: أسماء رسومات unDraw عناوين مشاهد قصيرة، والكلمات لوحدها ما تعرفش المعنى: «man, bed, holding head, tired» جابت «holding flowers»،
# و«hand reaching donut box» جابت «dialog box»، و«dropper nectar drop» جابت «mic drop». فبعد الاختيار بالكلمات، طلب واحد بيقارن فكرة كل
# مشهد باسم الرسمة اللي اتختارت، واللي مش على قد المعنى بيتبدّل بأيقونة على قد الكلمة الأساسية أو برسمة جديدة بيرسمها التطبيق.
JUDGE_SCHEMA = {"type": "object", "additionalProperties": False, "required": ["verdicts"], "properties": {"verdicts": {"type": "array", "items": {
    "type": "object", "additionalProperties": False, "required": ["n", "fits", "why", "draw_instead"],
    "properties": {"n": {"type": "integer"}, "fits": {"type": "boolean"}, "why": {"type": "string"},
                   "draw_instead": {"type": "array", "items": {"type": "string"}, "description": "لو fits=false: 1–3 كلمات إنجليزي للحاجة الأساسية اللي تترسم بدلها"}}}}}}
JUDGE_SYSTEM = """إنت مراجع صور لفيديو شرح. لكل عنصر عندك: فكرة المشهد، والحاجة المطلوب تترسم، واسم الرسمة اللي اتختارت من مكتبة (الاسم بيوصف الرسمة).
قرّر: الرسمة دي **بتوضّح الحاجة المطلوبة نفسها** للي بيتفرج؟ (fits=true) ولا مجرد كلمة مشتركة ومعناها حاجة تانية؟ (fits=false)
أمثلة: «holding flowers» لراجل تعبان ماسك راسه = false. «dialog box» لعلبة دونات = false. «alarm clock» لواحد نايم والمنبه جنبه = true.
«mint tea» لمعلقة عسل في كوباية شاي = true. اكتب السبب في كلمات قليلة.
لو false: `draw_instead` = الحاجة الأساسية اللي **تتشاف** وتوضّح الفكرة كأيقونة واحدة (1–3 كلمات إنجليزي، أهم كلمة الأول)،
زي ["ambulance phone call"] أو ["donut box"] أو ["tired man in bed"]. مش كلمة عامة زي hand أو man لوحدها."""


def visual_sheets(files: list[str], per: int = 20) -> list[tuple[str, str]]:
    """الرسومات نفسها مرقّمة في شبكة (PNG) علشان المراجعة تحكم بالنظر مش بالاسم: «Taken» من unDraw طلعت طبق طاير بيخطف واحد
    واتحطت لـ «سيُسلب منهم» لأن الاسم بيعدّي. بيرجّع [(media_type, base64)]، صورة لكل per رسمة."""
    import base64
    from playwright.sync_api import sync_playwright
    out = []
    with sync_playwright() as p:
        b = p.chromium.launch()
        for k in range(0, len(files), per):
            cells = []
            for n, f in enumerate(files[k:k + per], start=k):
                try:
                    svg = (ASSETS / f).read_text(encoding="utf-8") if f.endswith(".svg") else f'<img src="data:image/png;base64,{base64.b64encode((ASSETS / f).read_bytes()).decode()}">'
                except OSError:
                    svg = ""
                cells.append(f'<div class="c"><b>{n}</b><div class="v">{svg}</div></div>')
            pg = b.new_page(viewport={"width": 1200, "height": 300})
            pg.set_content('<html><body style="margin:0;background:#fff;font:700 22px sans-serif"><style>.g{display:grid;grid-template-columns:repeat(5,236px);gap:4px;padding:4px}'
                           '.c{position:relative;height:236px;border:2px solid #ddd;color:#333}.c b{position:absolute;left:6px;top:4px;color:#c00}'
                           '.v{position:absolute;inset:26px 10px 10px;display:flex;align-items:center;justify-content:center}.v svg,.v img{max-width:100%;max-height:100%;width:100%;height:100%}'
                           '</style><div class="g">' + "".join(cells) + "</div></body></html>")
            out.append(("image/png", base64.b64encode(pg.screenshot(full_page=True)).decode()))
            pg.close()
        b.close()
    return out


VISION_NOTE = ("\n\nقدامك كمان صورة (أو كذا صورة) فيها كل رسمة برقمها الأحمر. **احكم من الرسمة نفسها اللي شايفها، مش من اسمها** "
               "(اسم unDraw ممكن يضلّل: «Taken» طلعت طبق طاير). الرسمة لازم اللي يشوفها من غير صوت يخمّن معنى الكلام.")


def replacement(want: list[str], pid: str, used: set, recent: set, idea: list | None, allow_draw: bool = True) -> dict | None:
    """بديل لرسمة اترفضت: أيقونة اسمها فيه **كل** كلمات الحاجة المطلوبة (donut box ← لازم donut و box)، وإلا التطبيق بيرسمها.
    ليه: البديل بالكلمة الواحدة كان بيكرر نفس الغلطة («stroke FAST signs» ← mail-fast، «drooping mouth face» ← وش عادي)."""
    need = {_stem(w) for w in assets._words(want[0]) if w not in GENERIC and len(w) > 2} if want else set()
    blocked = set(used) | set(recent)
    for hit in assets.candidates("icon", want, blocked, k=8) + [h for h in [assets.fetch_icon([want[0]], blocked)] if h]:
        if need and need <= {_stem(w) for w in assets._words(hit.get("name", ""))}:
            hit = assets.ensure_local(hit)
            used.add(hit["file"])
            return {"kind": "icon", "asset": hit["file"], "asset_name": hit["name"], "license": hit.get("license"), "fetched": hit.get("fetched", False)}
    if not allow_draw:
        return None
    got = drawn.draw(pid, want, idea, blocked)
    if got:
        used.add(got["asset"])
    return got


def judge_board_visuals(scenes: list, pid: str, used: set, recent: set, toon: str, ask_fn=None) -> dict:
    slots = [(sc, it) for sc in scenes for it in sc.get("board") or [] if it.get("visual") and not it["visual"].get("drawn")]
    report = {"checked": len(slots), "rejected": [], "replaced": []}
    if not slots:
        return report
    lines = [f"{n}. فكرة المشهد: {sc.get('idea') or ''} ({' '.join(sc.get('idea_en') or [])}) · المطلوب يترسم: {', '.join(it.get('search') or [])}"
             f" · الرسمة المختارة: «{it['visual'].get('asset_name')}» ({it['visual']['kind']})" for n, (sc, it) in enumerate(slots)]
    try:
        res = (ask_fn or (lambda sy, us, sc: ask(pid, "scenes", sy, us, sc)))(JUDGE_SYSTEM, "\n".join(lines), JUDGE_SCHEMA)
    except Exception as e:  # المراجعة تحسين: لو فشلت الاختيار بالكلمات بيفضل
        report["error"] = str(e)[:200]
        return report
    for vd in res.get("verdicts") or []:
        if vd.get("fits") is not False or not (0 <= vd.get("n", -1) < len(slots)):
            continue
        sc, it = slots[vd["n"]]
        old = it["visual"]
        report["rejected"].append({"scene": sc["id"], "search": it.get("search"), "asset": old["asset"], "why": vd.get("why"), "instead": vd.get("draw_instead")})
        want = [w for w in vd.get("draw_instead") or [] if w.strip()][:3] or it.get("search") or []
        new = replacement(want, pid, used | {old["asset"]}, recent, sc.get("idea_en"))
        if new:
            it["search"] = want
        if new and new["asset"] != old["asset"]:
            it["visual"], it["kind"] = new, new["kind"]
            sc["visuals"] = [new if v is old or v.get("asset") == old["asset"] else v for v in sc.get("visuals") or []]
            report["replaced"].append({"scene": sc["id"], "from": old["asset"], "to": new["asset"]})
    return report


def judge_beats(scenes: list, pid: str, used: set, recent: set, ask_fn=None, max_draw: int = 14) -> dict:
    """نفس مراجعة المعنى للحظات البصرية: «برج إيفل» لـ «هيهات» و«كوبري» لـ «السلطة» كانوا بيعدّوا بكلمة مشتركة.
    اللي مش على قد المعنى بيتبدّل بأيقونة على قد الحاجة نفسها، أو التطبيق بيرسمها (لحد max_draw)، وإلا اللحظة بتتشال."""
    slots = [(sc, b) for sc in scenes for b in sc.get("beats") or []]
    report = {"checked": len(slots), "rejected": [], "replaced": [], "dropped": []}
    if not slots:
        return report
    lines = [f"{n}. الجزء اللي بيتقال وقتها: «{b.get('clause') or b.get('word')}» · فكرة المشهد: {sc.get('idea') or ''} · المطلوب يترسم: {', '.join(b.get('search') or [])}"
             f" · الرسمة المختارة: «{b['visual'].get('asset_name')}» ({b['visual']['kind']})" for n, (sc, b) in enumerate(slots)]
    try:
        imgs = visual_sheets([b["visual"]["asset"] for sc, b in slots]) if ask_fn is None else None
        res = (ask_fn or (lambda sy, us, sc: ask(pid, "scenes", sy, us, sc, images=imgs)))(JUDGE_SYSTEM + VISION_NOTE, "\n".join(lines), JUDGE_SCHEMA)
    except Exception as e:  # noqa: BLE001
        report["error"] = str(e)[:200]
        return report
    drew = 0
    for vd in res.get("verdicts") or []:
        if vd.get("fits") is not False or not (0 <= vd.get("n", -1) < len(slots)):
            continue
        sc, b = slots[vd["n"]]
        old = b["visual"]
        want = [w for w in vd.get("draw_instead") or [] if w.strip()][:3] or b.get("search") or []
        new = replacement(want, pid, used | {old["asset"]}, recent, sc.get("idea_en"), allow_draw=drew < max_draw)
        drew += bool(new and new.get("drawn"))
        report["rejected"].append({"scene": sc["id"], "word": b.get("word"), "asset": old["asset"], "why": vd.get("why"), "instead": want})
        if new:
            b.update(visual=new, search=want)
            report["replaced"].append({"scene": sc["id"], "from": old["asset"], "to": new["asset"]})
        else:
            b["drop"] = True
            report["dropped"].append({"scene": sc["id"], "word": b.get("word")})
    for sc in scenes:
        if sc.get("beats"):
            sc["beats"] = [b for b in sc["beats"] if not b.get("drop")]
    return report


# ---------- مشاهد الكاتب (السكريبت بيقود تنوّع الصور) ----------
WRITER_MAP = {  # نوع الصورة اللي الكاتب طلبه ← اللي لازم يبان في المشهد
    "whiteboard": {"whiteboard_drawing": "illustration (رسمة لـ draw)", "character": "illustration لشخص بيعمل اللي في draw",
                   "graphic": "icon كبيرة + text قصير", "chart": "number كبير + circle أو arrow"},
    "regular": {"whiteboard_drawing": "hero أو card برسمة (illustration) لـ draw", "character": "character (شخصية الكرتون بوضعية بتعمل draw)",
                "graphic": "icon_row أو hero بأيقونة", "chart": "stat (رقم + chart) أو versus"},
    "3d": {"whiteboard_drawing": "hero أو card برسمة", "character": "scene3d (الشخصية بتمثّل draw)", "graphic": "icon_row أو hero بأيقونة",
           "chart": "stat أو versus"},
}


def writer_scenes(script: dict) -> dict:
    """رقم الجملة ← مشهد الكاتب (visual + draw + draw_en)."""
    return {sid: sc for sc in script.get("scenes") or [] for sid in sc.get("sentence_ids", [])}


def writer_block(script: dict, vtype: str) -> str:
    if not script.get("scenes"):
        return "(السكريبت ده قديم ومفيهوش مشاهد كاتب: اختار إنت، ونوّع)"
    m = WRITER_MAP["3d" if vtype == "3d" else "whiteboard" if vtype == "whiteboard" else "regular"]
    return "\n".join(f"- جمل {sc['sentence_ids']}: {sc['visual']} ← {m.get(sc['visual'], '')} · يترسم: «{sc['draw']}» · بحث: {sc.get('draw_en') or []}"
                     for sc in script["scenes"])


def follows_writer(sc: dict, w: dict | None, vtype: str) -> bool | None:
    """المشهد ده عمل نوع الصورة اللي الكاتب طلبه؟ (None = مفيش طلب)"""
    if not w:
        return None
    v = w["visual"]
    if vtype == "whiteboard":
        kinds = {it.get("kind") for it in sc.get("board") or []}
        return {"whiteboard_drawing": bool(kinds & {"illustration"}), "character": bool(kinds & {"illustration"}),
                "graphic": bool(kinds & {"icon", "illustration", "emoji"}), "chart": "number" in kinds}[v]
    lay = sc.get("layout")
    return {"whiteboard_drawing": lay in ("hero", "card", "split", "list", "icon_row", "character") and bool(sc.get("visuals") or sc.get("items")),
            "character": lay in ("character", "scene3d"), "graphic": bool(sc.get("visuals") or any(i.get("visual") for i in sc.get("items") or [])),
            "chart": lay in ("stat", "versus")}[v]


def drawing_first(board: list) -> list:
    """أول رسمة/أيقونة/رقم في السبورة بتبقى أول عنصر. ليه: المشغّل لما الوقت ما يكفيش بيشيل العلامات وبعدين **آخر** العناصر
    (اتشاف في مشهد «اتعلّمت»: الكلمة فضلت والرسمة اتشالت، فالسبورة بقت كلام بس). أرقام الأسهم/الدواير بتتظبط على الترتيب الجديد."""
    k = next((i for i, it in enumerate(board) if it.get("kind") in ("illustration", "icon", "emoji", "number")), None)
    if not k:
        return board
    order = [k] + [i for i in range(len(board)) if i != k]
    new_of = {old: new for new, old in enumerate(order)}
    return [{**board[i], **{f: new_of[board[i][f]] for f in ("from", "to", "target") if isinstance(board[i].get(f), int) and board[i][f] in new_of}}
            for i in order]


def fill_empty_boards(scenes: list, script: dict, pid: str, used: set, recent: set, toon: str) -> dict:
    """سبورة مفيهاش ولا رسمة ولا أيقونة ولا رقم (كلام بس) = سبورة فاضية: بنحط فيها الحاجة اللي الكاتب قال تترسم (draw_en)."""
    ws = writer_scenes(script)
    rep = {"empty_before": [], "filled": [], "empty_after": [], "reordered": []}
    for sc in scenes:
        if sc.get("layout") == "board":
            nb = drawing_first(sc["board"])
            if nb is not sc["board"]:
                rep["reordered"].append(sc["id"])
                sc["board"] = nb
    for i, sc in enumerate(scenes):
        if sc.get("layout") != "board" or any(it.get("kind") in ("illustration", "icon", "emoji", "number") for it in sc.get("board") or []):
            continue
        rep["empty_before"].append(sc["id"])
        w = next((ws[x] for x in sc["sentence_ids"] if x in ws), None)
        v = None
        if w and w.get("draw_en"):
            for kind in ("illustration", "icon"):
                v = resolve_visual({"kind": kind, "search": w["draw_en"]}, pid, used, recent, toon, f"{i}w{kind}", w["draw_en"])
                if v and v["kind"] in ("illustration", "icon", "emoji"):
                    break
                v = None
        if not v:
            rep["empty_after"].append(sc["id"])
            continue
        first = next((s["text"].split()[0] for s in script["sentences"] if s["id"] == sc["sentence_ids"][0]), "")
        board = [{**it, **{f: it[f] + 1 for f in ("from", "to", "target") if isinstance(it.get(f), int)}} for it in sc["board"]]
        sc["board"] = ([{"kind": v["kind"], "visual": v, "search": w["draw_en"], "color": "ink", "cue_word": first, "from_writer": True}] + board)[:4]
        sc["visuals"].append(v)
        rep["filled"].append(sc["id"])
    return rep


# ---------- لحظات بصرية جوه كل مشهد (beats) ----------
# ليه: فيديو 88 ث طلع 13 مشهد، كل واحد فيه رسمة واحدة وعنوان من السكريبت ← «الكلام بيتكتب بس» و«الأشكال ثابتة زي صورة» و«الجرافيك قليل».
# دلوقتي كل مشهد ليه صور إضافية بتظهر مع كلامها (واحدة كل ~2 ث على قد طوله)، كل واحدة بحركة على قد معناها، والمشغّل بيوزّعها في المساحة الفاضية.
BEAT_MOTIONS = ["bounce", "spin", "pulse", "shake", "orbit", "grow", "drop", "float"]
BEATS_SCHEMA = {"type": "object", "additionalProperties": False, "required": ["scenes"], "properties": {"scenes": {"type": "array", "items": {
    "type": "object", "additionalProperties": False, "required": ["id", "beats"], "properties": {
        "id": {"type": "string"},
        "beats": {"type": "array", "maxItems": 6, "items": {"type": "object", "additionalProperties": False, "required": ["word", "clause", "search", "kind", "motion"],
                  "properties": {"word": {"type": "string"}, "clause": {"type": "string"}, "search": {"type": "array", "items": {"type": "string"}, "minItems": 1, "maxItems": 4},
                                 "kind": {"type": "string", "enum": ["icon", "illustration", "emoji"]}, "motion": {"type": "string", "enum": BEAT_MOTIONS}}}}}}}}}


SEQ_LAYOUTS = ("hero", "card", "split")          # المشاهد اللي صورتها الأساسية بتتبدل بتسلسل صور
TEXT_LAYOUTS = ("kinetic", "quote", "question")   # مشاهد كلام: بتبقى صور (الكلام في الترجمة)


def beats_needed(dur: float, layout: str = "hero") -> int:
    """عدد العناصر الإضافية في التكوين (بتتجمّع وتفضل لحد آخر المشهد): عنصر كل ~2 ث بعد الأساسي، لحد 3.
    مشهد كلام: الأول بيبقى الأساسي، فعنصر زيادة. القوايم والمقارنة والرقم: عندهم عناصرهم.
    ليه: صورة مكان صورة (كل 2.8 ث) طلّعت «قللت الموشن جرافيك ومش متوازن» (taste.md 7/7ب)."""
    n = int((dur - 1.5) / 2.0 + 0.5)
    if layout in SEQ_LAYOUTS:
        return max(1, min(3, n))
    if layout in TEXT_LAYOUTS:
        return max(2, min(4, n + 1))
    return 0


def scene_durations(scenes: list, timing: dict) -> list[float]:
    first, total = timing["first"], timing["total"]
    st = [0.0 if k == 0 else max(0.0, min(first.get(i, 1e9) for i in sc["sentence_ids"]) - 0.2) for k, sc in enumerate(scenes)]
    return [round((st[k + 1] if k + 1 < len(st) else total) - st[k], 2) for k in range(len(st))]


def shape_key(asset: str) -> frozenset:
    """كلمات اسم الشكل (من غير بادئة المكتبة ولا رقم رسمة التطبيق): hourglass-low و hourglass، falling-crown و fallen-crown = نفس الشكل."""
    a = re.sub(r"^(tabler|mdi|lucide|ph|fluent|material-symbols|carbon|icon-park-outline|streamline|flat-color-icons)-", "", asset.rsplit("/", 1)[-1].rsplit(".", 1)[0])
    ws = {_stem(w) for w in re.split(r"[-_ ]+", a.lower()) if len(w) >= 4 and not re.fullmatch(r"[0-9a-f]{6,}", w)} - {_stem(w) for w in GENERIC}
    return frozenset(ws or {a.lower()})


def dedupe_beats(scenes: list) -> int:
    """آخر خطوة: أي عنصر شكله زي الصورة الأساسية أو عنصر قبله في نفس المشهد (كلمة مشتركة في الاسم) بيتشال.
    ليه: البديل من مراجعة المعنى كان بيعدّي من غير الفحص ده، فطلع تاج بيغرق وتاج واقع في نفس المشهد."""
    n = 0
    for sc in scenes:
        seen = [shape_key(v["asset"]) for v in sc.get("visuals") or []] + [shape_key(it["visual"]["asset"]) for it in sc.get("items") or [] if it.get("visual")]
        keep = []
        for b in sc.get("beats") or []:
            k = shape_key(b["visual"]["asset"])
            if any(k & x for x in seen):
                n += 1
                continue
            seen.append(k)
            keep.append(b)
        if sc.get("beats"):
            sc["beats"] = keep
    return n


def plan_beats(pid: str, scenes: list, script: dict, used: set, recent: set, toon: str, ask_fn=None) -> dict:
    """طلب واحد للفيديو كله: لكل مشهد صور إضافية مربوطة بكلمة، والكود بيدوّر على ملفاتها (من غير رسم جديد علشان السرعة)."""
    durs = scene_durations(scenes, scene_timing(pid))
    text = {s["id"]: s["text"] for s in script["sentences"]}
    want = {sc["id"]: beats_needed(d, sc["layout"]) for sc, d in zip(scenes, durs)}
    lines = [f"{sc['id']} · {d:.1f} ث · عدد {want[sc['id']]} · {sc['layout']} · {sc.get('idea', '')} · " + " ".join(text.get(i, "") for i in sc["sentence_ids"])
             for sc, d in zip(scenes, durs) if want[sc["id"]]]
    stat = {"wanted": sum(want.values()), "placed": 0, "missing": 0, "llm_error": None}
    if not lines:
        return stat
    try:
        data = (ask_fn or (lambda s, u, sch: ask(pid, "scenes", s, u, sch)))(prompt("scene_beats", scenes="\n".join(lines)), "اعمل اللحظات البصرية لكل مشهد.", BEATS_SCHEMA)
        got = {x["id"]: x["beats"] for x in data.get("scenes") or []}
    except Exception as e:  # noqa: BLE001
        got, stat["llm_error"] = {}, str(e)[:200]
    for k, sc in enumerate(scenes):
        n = want.get(sc["id"], 0)
        if not n:
            sc["beats"] = []
            continue
        cand = list(got.get(sc["id"]) or [])
        # تأمين: لو الطلب فشل أو جاب أقل من المطلوب، نكمّل من كلمات فكرة المشهد (كل كلمة صورة)
        for term in sc.get("idea_en") or []:
            if len(cand) >= n + 2:
                break
            cand.append({"word": "", "search": [term], "kind": "icon", "motion": BEAT_MOTIONS[(k + len(cand)) % len(BEAT_MOTIONS)]})
        out = []
        # نفس أيقونة المشهد من مكتبة تانية (hand-stop و tabler-hand-stop) = تكرار، فبنقارن بالاسم من غير البادئة
        # والشكل نفسه بأسماء مختلفة (hourglass-low و hourglass، crown و crown-off) = تكرار: بنقارن بأول كلمة في الاسم
        mine = [shape_key(v["asset"]) for v in sc.get("visuals") or []] + [shape_key(it["visual"]["asset"]) for it in sc.get("items") or [] if it.get("visual")]
        for j, b in enumerate(cand):
            if len(out) >= n:
                break
            v = resolve_visual({"kind": b["kind"], "search": b["search"]}, pid, used, recent, toon, f"{k}beat{j}", sc.get("idea_en"), allow_draw=False)
            if v and any(shape_key(v["asset"]) & x for x in mine):
                v = None
            if v and v.get("kind") != "character":
                mine.append(shape_key(v["asset"]))
                out.append({"word": b.get("word") or "", "clause": b.get("clause") or "", "visual": v, "motion": b["motion"] if b["motion"] in BEAT_MOTIONS else "float", "search": b["search"]})
        sc["beats"] = out
    stat["judge"] = judge_beats(scenes, pid, used, recent, ask_fn)
    stat["duplicates_removed"] = dedupe_beats(scenes)
    for sc in scenes:
        stat["placed"] += len(sc.get("beats") or [])
    stat["missing"] = stat["wanted"] - stat["placed"]
    return stat


def judge_main_visuals(scenes: list, script: dict, pid: str, used: set, recent: set, ask_fn=None, max_draw: int = 8) -> dict:
    """مراجعة معنى الصورة الأساسية لكل مشهد 2D (وصور القوايم) على **الجمل نفسها**: «كرسي هزاز» لـ «لم يفكر سوى في قوته» كان بيعدّي.
    اللي مش على قد المعنى بيتبدّل (أيقونة على قد الحاجة أو رسمة من التطبيق)."""
    text = {x["id"]: x["text"] for x in script["sentences"]}
    slots = []
    for sc in scenes:
        said = " ".join(text.get(i, "") for i in sc["sentence_ids"])
        for v in sc.get("visuals") or []:
            if v.get("kind") != "character":
                slots.append((sc, said, v, None))
        for it in sc.get("items") or []:
            if it.get("visual"):
                slots.append((sc, f"{said} (العنصر: «{it['label']}»)", it["visual"], it))
    report = {"checked": len(slots), "rejected": [], "replaced": []}
    if not slots:
        return report
    lines = [f"{n}. الكلام اللي بيتقال: «{said}» · الرسمة المختارة: «{v.get('asset_name')}» ({v['kind']})" for n, (sc, said, v, it) in enumerate(slots)]
    try:
        imgs = visual_sheets([v["asset"] for sc, said, v, it in slots]) if ask_fn is None else None
        res = (ask_fn or (lambda sy, us, sch: ask(pid, "scenes", sy, us, sch, images=imgs)))(JUDGE_SYSTEM + VISION_NOTE, "\n".join(lines), JUDGE_SCHEMA)
    except Exception as e:  # noqa: BLE001
        report["error"] = str(e)[:200]
        return report
    drew = 0
    for vd in res.get("verdicts") or []:
        if vd.get("fits") is not False or not (0 <= vd.get("n", -1) < len(slots)):
            continue
        sc, said, old, it = slots[vd["n"]]
        want = [w for w in vd.get("draw_instead") or [] if w.strip()][:3]
        if not want:
            continue
        new = replacement(want, pid, used | {old["asset"]}, recent, sc.get("idea_en"), allow_draw=drew < max_draw)
        drew += bool(new and new.get("drawn"))
        report["rejected"].append({"scene": sc["id"], "asset": old["asset"], "why": vd.get("why"), "instead": want})
        if new and new["asset"] != old["asset"]:
            if it is not None:
                it["visual"] = new
            else:
                sc["visuals"] = [new if x is old else x for x in sc["visuals"]]
            report["replaced"].append({"scene": sc["id"], "from": old["asset"], "to": new["asset"]})
    return report


def add_beats(pid: str) -> dict:
    """لحظات بصرية لخطة موجودة (من غير ما المشاهد تتعاد): نفس الهوية والمشاهد، والصور الإضافية بس."""
    d = store.project_dir(pid)
    plan = store.read_json(d / "scenes" / "plan.json")
    script = store.read_json(d / "script.json")
    used = {v["asset"] for s in plan["scenes"] for v in s.get("visuals") or []} | {it["visual"]["asset"] for s in plan["scenes"] for it in s.get("items") or [] if it.get("visual")}
    recent = history.recent_assets(skip_pid=pid)
    plan["main_judge"] = judge_main_visuals(plan["scenes"], script, pid, used, recent)
    used |= {v["asset"] for s in plan["scenes"] for v in s.get("visuals") or []}
    stat = plan_beats(pid, plan["scenes"], script, used, recent, plan.get("character") or "", None)
    plan["beats"] = stat
    files = [b["visual"]["asset"] for s in plan["scenes"] for b in s.get("beats") or []]
    plan["credits"] = sorted(set(plan.get("credits") or []) | set(assets.credits_for(files) or []))
    store.write_json(d / "scenes" / "plan.json", plan)
    store.log(pid, f"✨ لحظات بصرية جوه المشاهد: {stat['placed']} من {stat['wanted']}" + (f" (الطلب فشل: {stat['llm_error']})" if stat["llm_error"] else ""))
    return stat


def _system(pid: str, proj: dict, vtype: str) -> tuple[str, dict]:
    d = store.project_dir(pid)
    script = store.read_json(d / "script.json")
    n = len(script["sentences"])
    secs = sentence_seconds(pid)
    # مدة كل جملة بالثواني جنبها: علشان المشهد ياخد وقت كفاية، وعدد عناصر السبورة يناسب الوقت
    sentences = "\n".join(f"{s['id']} ({secs.get(s['id'], 0):.1f} ث): {s['text']}" for s in script["sentences"])
    b = store.read_json(d / "brief.json")
    # فيديو طويل = مشاهد أكتر (مشهد كل ~5.5 ث على الأقل): 88 ث كانت 13 مشهد بس، كل واحد فيه صورة واحدة ← فيديو بيكرر نفسه
    total = sum(secs.values())
    common = dict(sentences=sentences, min_scenes=min(n, max(3, (n + 1) // 2, math.ceil(total / 5.5))), max_scenes=n, recent=history.summary(skip_pid=pid) or "(مفيش)",
                  brief=brief_stage.as_text(b) if b else "(مفيش رؤية: اختار إنت)", writer=writer_block(script, vtype))
    vg = proj["settings"].get("voice_gender", "")
    voice = {"male": "راجل", "female": "ست"}.get(vg, "غير محدد")
    speakers = "، ".join(c for c in three_d.SPEAKERS if not vg or three_d.GENDER[c] == vg)
    if vtype == "whiteboard":
        return prompt("whiteboard_plan", **common), WB_SCHEMA
    rule = {"regular": "\n\n**نوع الفيديو: عادي (2D). ممنوع scene3d.**",
            "3d": "\n\n**نوع الفيديو: 3D. أغلب المشاهد (70% على الأقل) scene3d بإخراج حر (تحت). `speaking`: true بس لو الجملة على لسان الشخصية "
                  f"(مش راوي)، واللي بيتكلم لازم يكون من دول (صوت الفيديو {voice}): {speakers}.**\n\n"
                  + prompt("direct3d", body=" | ".join(three_d.BODY_POSES), head=" | ".join(three_d.HEAD_POSES), arms=" | ".join(three_d.ARM_POSES),
                           faces=" | ".join(three_d.EXPRESSIONS), tone=("خفيف/كوميدي: مسموح رموز أنيمي وخطوط سرعة بحساب" if proj["settings"].get("mood") == "funny"
                                                                       else "جاد ومحترم: ممنوع رموز الأنيمي (emote) وخطوط السرعة (fx)"))}[vtype]
    return prompt("scene_plan", catalog=three_d.catalog_for("3d" if vtype == "3d" else "regular"), **common) + rule, schema_for(vtype)


def edit_scene(pid: str, scene_id: str, instruction: str) -> None:
    """بيعدّل مشهد واحد بس حسب طلبك، والباقي زي ما هو."""
    d = store.project_dir(pid)
    proj = store.load(pid)
    vtype = proj["settings"].get("video_type", "regular")
    plan = store.read_json(d / "scenes" / "plan.json")
    idx = next(i for i, sc in enumerate(plan["scenes"]) if sc["id"] == scene_id)
    cur = plan["scenes"][idx]
    system, sch = _system(pid, proj, vtype)
    item = sch["properties"]["scenes"]["items"]
    one = {"type": "object", "properties": {"scene": item}, "required": ["scene"], "additionalProperties": False}
    keep = ("sentence_ids", "layout", "headline", "cue_word", "visual", "items", "number_value", "number_label", "chart", "custom_brief",
            "camera", "scene3d", "enter", "idle", "board")
    def brief_of(sc):
        o = {k: v for k, v in sc.items() if k in keep}
        if "board" in o:
            o["board"] = [{k: v for k, v in x.items() if k != "visual"} for x in o["board"]]
        return o
    user = (f"الخطة الحالية للفيديو (للسياق):\n{[brief_of(sc) for sc in plan['scenes']]}\n\n"
            f"عدّل المشهد رقم {idx + 1} بس (جمل {cur['sentence_ids']})، وخلّي sentence_ids زي ما هي. المطلوب: {instruction}\n"
            f"المشهد الحالي: {brief_of(cur)}\n\nالهوية (ثابتة): {plan.get('identity')}")
    data = ask(pid, "scenes", system, user, one)
    sc = {**data["scene"], "id": scene_id, "sentence_ids": cur["sentence_ids"]}
    used = {v["asset"] for s in plan["scenes"] if s["id"] != scene_id for v in s.get("visuals", [])}
    new = finalize(sc, idx, vtype, pid, used, history.recent_assets(skip_pid=pid), plan.get("character") or TOON[0])
    if vtype == "3d":
        fix_3d([new], pid, proj["settings"].get("voice_gender", ""))
    plan["scenes"][idx] = new
    store.write_json(d / "scenes" / "plan.json", plan)
    if new["layout"] == "custom":
        if not custom.make(pid, new, plan, store.read_json(d / "script.json")):
            new["layout"] = "kinetic"
        store.write_json(d / "scenes" / "plan.json", plan)
    store.log(pid, f"✎ المشهد {idx + 1} اتعدّل: {instruction}")


def run(pid: str, instruction: str | None = None) -> None:
    d = store.project_dir(pid)
    proj = store.load(pid)
    vtype = proj["settings"].get("video_type", "regular")
    script = store.read_json(d / "script.json")
    b = store.read_json(d / "brief.json")
    system, sch = _system(pid, proj, vtype)
    user = "اعمل الهوية البصرية وخطة المشاهد.\n\n" + prefs.context_block(proj["prompt"])
    old = store.read_json(d / "scenes" / "plan.json")
    if instruction and old:
        user += f"\n\nالخطة الحالية (مختصرة):\n{old.get('raw')}\n\nالمطلوب تعديله: {instruction}"
    data = ask(pid, "scenes", system, user, sch)

    # السبورة: الإيد بترسم وبعدين الرسمة بتفضل ثانية كاملة، فالمشهد الأقصر من 3.5 ث بيتدمج (2.5 ث كانت بتخلّي الرسمة تتنقل قبل ما تتشاف)
    min_s = max(MIN_SCENE_SECONDS, 3.5) if vtype == "whiteboard" else MIN_SCENE_SECONDS
    raw, n_merged = merge_short(data["scenes"], scene_timing(pid), min_s)
    if n_merged:
        store.log(pid, f"⏱ اتدمج {n_merged} مشهد قصير (أقل من {min_s} ثانية) في اللي قبله")
    data["scenes"] = raw
    wsc = writer_scenes(script)
    for sc in data["scenes"]:   # رسمة بكلمات بحث الكاتب بتعدّي فحص «الصورة ليها علاقة بالفكرة» (الكاتب هو اللي حدد الفكرة البصرية)
        extra = [w for x in sc["sentence_ids"] if x in wsc for w in wsc[x].get("draw_en") or []]
        if extra:
            sc["idea_en"] = list(dict.fromkeys((sc.get("idea_en") or []) + extra))[:10]
    used: set = set()
    recent = history.recent_assets(skip_pid=pid)
    toon = _character(pid, recent)
    scenes = [finalize(sc, i, vtype, pid, used, recent, toon) for i, sc in enumerate(data["scenes"])]
    rejected = sum(len(s.get("rejected", [])) for s in scenes)
    if rejected:
        store.log(pid, f"✗ اترفضت {rejected} صورة مالهاش علاقة بفكرة مشهدها (المشهد بقى كلام)")
    if vtype == "3d":
        fix_3d(scenes, pid, proj["settings"].get("voice_gender", ""))
    boards = fill_empty_boards(scenes, script, pid, used, recent, toon) if vtype == "whiteboard" else {"empty_before": [], "filled": [], "empty_after": []}
    judged = judge_board_visuals(scenes, pid, used, recent, toon) if vtype == "whiteboard" else None
    if judged and judged["rejected"]:
        store.log(pid, f"🔎 مراجعة معنى الرسومات: {judged['checked']} اتراجعت · {len(judged['rejected'])} مش على قد المعنى · اتبدّل {len(judged['replaced'])}")
    drawn_n = sum(1 for sc in scenes for v in sc.get("visuals") or [] if v.get("drawn"))
    if drawn_n:
        store.log(pid, f"✏️ {drawn_n} أيقونة رسمها التطبيق بنفسه (مالقيناش في المكتبات حاجة على قد المعنى)")
    ws = writer_scenes(script)
    follow = [follows_writer(sc, next((ws[x] for x in sc["sentence_ids"] if x in ws), None), vtype) for sc in scenes]
    writer_check = {"scenes": len(scenes), "with_writer_visual": sum(f is not None for f in follow), "followed": sum(bool(f) for f in follow),
                    "not_followed": [sc["id"] for sc, f in zip(scenes, follow) if f is False], **boards}
    if boards["empty_before"]:
        store.log(pid, f"🖍 سبورة فاضية: {len(boards['empty_before'])} ← اتملت برسمة الكاتب {len(boards['filled'])} · فاضل {len(boards['empty_after'])}")

    ident = fresh_identity(data["identity"], pid, vtype)
    if vtype == "whiteboard":
        ident = {**ident, "background": "board", "look3d": "soft"}
    plan = {"version": 2, "type": vtype, "created": int(time.time()), "style": (b or {}).get("style"), "identity": ident,
            "palette": ident["palette"], "pace": data["pace"], "text_size": data["text_size"], "character": toon, "scenes": scenes,
            "min_scene": MIN_SCENE_SECONDS, "merged_short_scenes": n_merged, "rejected_visuals": rejected, "writer_check": writer_check, "visual_judge": judged,
            "raw": [{k: v for k, v in sc.items() if k in ("sentence_ids", "layout", "headline", "board")} for sc in data["scenes"]]}
    if vtype != "whiteboard":
        plan["main_judge"] = judge_main_visuals(scenes, script, pid, used, recent)
        if plan["main_judge"]["replaced"]:
            store.log(pid, f"🔎 مراجعة معنى الصور الأساسية: اتبدّل {len(plan['main_judge']['replaced'])} من {plan['main_judge']['checked']}")
        plan["beats"] = plan_beats(pid, scenes, script, used, recent, toon)
        store.log(pid, f"✨ لحظات بصرية جوه المشاهد: {plan['beats']['placed']} من {plan['beats']['wanted']}")
    files = [v["asset"] for s in scenes for v in s["visuals"]] + [it["visual"]["asset"] for s in scenes for it in s["items"] if it.get("visual")]
    files += [b["visual"]["asset"] for s in scenes for b in s.get("beats") or []]
    plan["credits"] = assets.credits_for(files)
    store.write_json(d / "scenes" / "plan.json", plan)

    # المشاهد المبتكرة: Claude بيكتب كودها (ولو فشل، المشهد بيرجع لشكل جاهز)
    for sc in scenes:
        if sc["layout"] == "custom":
            store.log(pid, f"✎ مشهد مبتكر {sc['id']}: {sc.get('custom_brief', '')[:80]}")
            ok = custom.make(pid, sc, plan, script)
            if not ok:
                sc["layout"] = "kinetic"
    store.write_json(d / "scenes" / "plan.json", plan)
    history.record(pid, plan)
