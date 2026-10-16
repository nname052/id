"""المرحلة 2: خطة المشاهد. Claude بيعمل هوية بصرية جديدة لكل فيديو (ألوان، خطوط، خلفية، انتقالات) ويختار شكل كل مشهد
من 12 شكل، والبحث في كل المكتبات بيحصل هنا من غير AI، مع ذاكرة بتمنع تكرار الرسومات من الفيديوهات اللي فاتت.
المشاهد اللي نوعها custom بيصممها Claude بالكود في custom.py."""

import hashlib
import re
import time

from .. import history, prefs, store
from ..config import ASSETS
from . import assets, custom
from .common import ask, prompt

LAYOUTS = ["hero", "kinetic", "split", "stat", "list", "versus", "quote", "question", "icon_row", "card", "character", "custom"]
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
    "enter": {"type": "string", "enum": ["rise", "pop", "draw", "fade", "slide"]},
    "idle": {"type": "string", "enum": ["float", "pulse", "wobble", "none"]}},
    "required": ["sentence_ids", "layout", "headline", "cue_word", "enter", "idle"], "additionalProperties": False}
SCHEMA = {"type": "object", "properties": {
    "identity": {"type": "object", "properties": {
        "palette": {"type": "object", "properties": {k: HEX for k in ("bg", "ink", "accent", "accent2", "surface")},
                    "required": ["bg", "ink", "accent", "accent2", "surface"], "additionalProperties": False},
        "font_heading": {"type": "string", "enum": HEADING_FONTS},
        "font_body": {"type": "string", "enum": BODY_FONTS},
        "background": {"type": "string", "enum": ["solid", "gradient", "blobs", "grid", "split", "stripes", "spotlight", "paper"]},
        "transition": {"type": "string", "enum": ["rise", "slide", "zoom", "wipe", "flash"]}},
        "required": ["palette", "font_heading", "font_body", "background", "transition"], "additionalProperties": False},
    "pace": {"type": "string", "enum": ["calm", "normal", "energetic"]},
    "text_size": {"type": "string", "enum": ["normal", "large"]},
    "scenes": {"type": "array", "minItems": 1, "maxItems": 20, "items": SCENE}},
    "required": ["identity", "pace", "text_size", "scenes"], "additionalProperties": False}

POSE_FILE = {"cheer": "cheer0", "walk": "walk0", "run": "run0", "climb": "climb0"}
TOON = ["Male person", "Female person", "Male adventurer", "Female adventurer"]


def _seed(*parts) -> int:
    return int(hashlib.md5("|".join(map(str, parts)).encode()).hexdigest()[:8], 16)


def _character(pid: str, recent: set) -> str:
    """شخصية كرتون واحدة للفيديو كله (نفس الشخص في كل مشاهده)، ومختلفة عن آخر الفيديوهات لو ينفع."""
    options = [c for c in TOON if not any(c in a for a in recent)] or TOON
    return options[_seed(pid, "char") % len(options)]


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


def run(pid: str, instruction: str | None = None) -> None:
    d = store.project_dir(pid)
    script = store.read_json(d / "script.json")
    n = len(script["sentences"])
    sentences = "\n".join(f"{s['id']}: {s['text']}" for s in script["sentences"])
    system = prompt("scene_plan", sentences=sentences, min_scenes=max(3, (n + 1) // 2), max_scenes=n,
                    recent=history.summary(skip_pid=pid) or "(مفيش)")
    user = "اعمل الهوية البصرية وخطة المشاهد.\n\n" + prefs.context_block(store.load(pid)["prompt"])
    old = store.read_json(d / "scenes" / "plan.json")
    if instruction and old:
        user += f"\n\nالخطة الحالية (مختصرة):\n{old.get('raw')}\n\nالمطلوب تعديله: {instruction}"
    data = ask(pid, "scenes", system, user, SCHEMA)

    used: set = set()
    recent = history.recent_assets(skip_pid=pid)
    toon = _character(pid, recent)
    scenes = []
    for i, sc in enumerate(data["scenes"]):
        out = {**sc, "id": f"s{i + 1:02d}"}
        out["visuals"] = []
        if sc.get("visual"):
            v = resolve_visual(sc["visual"], pid, used, recent, toon, f"{i}v")
            if v:
                out["visuals"].append(v)
        out["items"] = []
        for j, it in enumerate(sc.get("items") or []):
            out["items"].append({"label": it["label"], "visual": resolve_visual(it.get("visual"), pid, used, recent, toon, f"{i}i{j}")})
        # شكل محتاج صورة ومالقيناش: بيتحوّل لشكل كلام بس بدل ما يبقى فاضي
        if out["layout"] in ("hero", "split", "card", "character") and not out["visuals"]:
            out["layout"] = "kinetic"
        if out["layout"] in ("list", "versus", "icon_row") and len(out["items"]) < 2:
            out["layout"] = "kinetic"
        if out["layout"] == "stat" and not re.search(r"\d", out.get("number_value") or ""):
            out["layout"] = "kinetic"
        scenes.append(out)

    ident = data["identity"]
    plan = {"version": 2, "created": int(time.time()), "identity": ident, "palette": ident["palette"], "pace": data["pace"], "text_size": data["text_size"],
            "character": toon, "scenes": scenes,
            "raw": [{k: v for k, v in sc.items() if k in ("sentence_ids", "layout", "headline")} for sc in data["scenes"]]}
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
