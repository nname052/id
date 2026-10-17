"""المرحلة 2: خطة المشاهد. Claude بيعمل هوية بصرية جديدة لكل فيديو (ألوان، خطوط، خلفية، انتقالات) ويختار شكل كل مشهد
من 12 شكل، والبحث في كل المكتبات بيحصل هنا من غير AI، مع ذاكرة بتمنع تكرار الرسومات من الفيديوهات اللي فاتت.
المشاهد اللي نوعها custom بيصممها Claude بالكود في custom.py."""

import hashlib
import re
import time

from .. import history, prefs, store
from ..config import ASSETS, MIN_SCENE_SECONDS
from . import assets, brief as brief_stage, custom, three_d
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
    "scenes": {"type": "array", "minItems": 1, "maxItems": 20, "items": SCENE}},
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


def resolve_visual(v: dict | None, pid: str, used: set, recent: set, toon: str, salt: str) -> dict | None:
    """بيلاقي الملف للصورة: من النوع المطلوب، ولو مفيش بينزل للنوع اللي بعده."""
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
    terms = v.get("search") or []
    for kind in order:
        q = assets.emoji_terms(v.get("emoji_name") or " ".join(terms)) if kind == "emoji" else terms
        if not q:
            continue
        hit = assets.pick(kind, q, used, recent, _seed(pid, salt, kind))
        if hit:
            used.add(hit["file"])
            return {"kind": kind, "asset": hit["file"], "asset_name": hit["name"], "license": hit.get("license"),
                    "fetched": hit.get("fetched", False)}
    return None


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
                v = resolve_visual({"kind": it["kind"], "search": it.get("search") or []}, pid, used, recent, toon, f"{i}b{j}")
                if v and v["kind"] in ("illustration", "icon", "emoji"):
                    it["visual"] = v; it["kind"] = v["kind"]; out["visuals"].append(v)
                else:
                    it["kind"], it["text"] = "text", it.get("text") or " ".join(it.get("search") or [])[:24]
        return out
    if sc.get("visual") and sc["visual"].get("kind") != "character" and not matches_idea(sc["visual"].get("search"), sc.get("idea_en")):
        out.setdefault("rejected", []).append({"search": sc["visual"].get("search"), "idea_en": sc.get("idea_en")})
    elif sc.get("visual"):
        v = resolve_visual(sc["visual"], pid, used, recent, toon, f"{i}v")
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


def _system(pid: str, proj: dict, vtype: str) -> tuple[str, dict]:
    d = store.project_dir(pid)
    script = store.read_json(d / "script.json")
    n = len(script["sentences"])
    secs = sentence_seconds(pid)
    # مدة كل جملة بالثواني جنبها: علشان المشهد ياخد وقت كفاية، وعدد عناصر السبورة يناسب الوقت
    sentences = "\n".join(f"{s['id']} ({secs.get(s['id'], 0):.1f} ث): {s['text']}" for s in script["sentences"])
    b = store.read_json(d / "brief.json")
    common = dict(sentences=sentences, min_scenes=max(3, (n + 1) // 2), max_scenes=n, recent=history.summary(skip_pid=pid) or "(مفيش)",
                  brief=brief_stage.as_text(b) if b else "(مفيش رؤية: اختار إنت)")
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

    raw, n_merged = merge_short(data["scenes"], scene_timing(pid))
    if n_merged:
        store.log(pid, f"⏱ اتدمج {n_merged} مشهد قصير (أقل من {MIN_SCENE_SECONDS} ثانية) في اللي قبله")
    data["scenes"] = raw
    used: set = set()
    recent = history.recent_assets(skip_pid=pid)
    toon = _character(pid, recent)
    scenes = [finalize(sc, i, vtype, pid, used, recent, toon) for i, sc in enumerate(data["scenes"])]
    rejected = sum(len(s.get("rejected", [])) for s in scenes)
    if rejected:
        store.log(pid, f"✗ اترفضت {rejected} صورة مالهاش علاقة بفكرة مشهدها (المشهد بقى كلام)")
    if vtype == "3d":
        fix_3d(scenes, pid, proj["settings"].get("voice_gender", ""))

    ident = fresh_identity(data["identity"], pid, vtype)
    if vtype == "whiteboard":
        ident = {**ident, "background": "board", "look3d": "soft"}
    plan = {"version": 2, "type": vtype, "created": int(time.time()), "style": (b or {}).get("style"), "identity": ident,
            "palette": ident["palette"], "pace": data["pace"], "text_size": data["text_size"], "character": toon, "scenes": scenes,
            "min_scene": MIN_SCENE_SECONDS, "merged_short_scenes": n_merged, "rejected_visuals": rejected,
            "raw": [{k: v for k, v in sc.items() if k in ("sentence_ids", "layout", "headline", "board")} for sc in data["scenes"]]}
    files = [v["asset"] for s in scenes for v in s["visuals"]] + [it["visual"]["asset"] for s in scenes for it in s["items"] if it.get("visual")]
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
