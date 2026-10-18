"""المرحلة 1: السكريبت (جمل قصيرة بالمصري + عنوان)، متقسّم مشاهد: كل مشهد بنوع الصورة اللي محتاجها وحاجة حقيقية تترسم،
وكل جملة بنبرتها (beat) اللي بتحدد الـ tags بعد كده. النبرة والمشاهد بيكتبهم الكاتب نفسه لأنه هو اللي عارف قصده."""

import re

from .. import prefs, store
from ..config import MOODS, WORDS_PER_SECOND
from . import tags as tagrules
from .common import ask, prompt

VISUALS = {"whiteboard_drawing": "رسمة بخط اليد لموقف/حاجة", "character": "شخصية بتعمل حاجة", "graphic": "أيقونة/رمز كبير مع كلمة",
           "chart": "رسم بياني أو رقم أو مقارنة"}
SENT = {"type": "object", "properties": {"text": {"type": "string"}, "beat": {"type": "string", "enum": list(tagrules.BEATS)}},
        "required": ["text", "beat"], "additionalProperties": False}
SCENE = {"type": "object", "properties": {"visual": {"type": "string", "enum": list(VISUALS)}, "draw": {"type": "string"},
                                           "sentences": {"type": "array", "items": SENT, "minItems": 1, "maxItems": 4}},
         "required": ["visual", "draw", "sentences"], "additionalProperties": False}
VAGUE = {"فكرة", "فكره", "معلومة", "معلومه", "كلام", "نص", "شرح", "حاجة", "حاجه", "موضوع", "الفكرة", "المعلومة", "مفهوم", "رسالة", "نصيحة",
         "idea", "concept", "text", "message", "something"}
NUM = re.compile(r"[0-9٠-٩]|واحد|اتنين|تلات|اربع|أربع|خمس|ست|سبع|تمان|تسع|عشر|مية|ألف|الف|نص|ربع|تلت|أكتر|اكتر|أقل|اقل|ضعف|%")

# اللهجة اللي بيختارها صاحب الفيديو (مصري / فصحى / عربي بسيط)
POLISH = {"type": "object", "properties": {"title": {"type": "string"}, "sentences": {"type": "array", "items": {"type": "string"}, "minItems": 1, "maxItems": 60},
          "notes": {"type": "array", "items": {"type": "string"}}}, "required": ["title", "sentences", "notes"], "additionalProperties": False}

DIALECTS = {
    "egyptian": ("**عامية مصرية** طبيعية زي ما صناع المحتوى المصريين بيتكلموا (مش عامية الشارع الخشنة، ومش فصحى متنكرة). "
                 "استخدم التعبيرات المصرية المألوفة (زي: بص، خلّي بالك، الموضوع ببساطة، يعني إيه…)، وما تخلطش فصحى وعامية في نفس الجملة."),
    "msa": ("**فصحى** سليمة وسهلة زي مذيعي الوثائقيات: جمل واضحة وكلمات مشهورة، من غير تقعير ولا كلمات قديمة نادرة، "
            "ومن غير أي كلمة عامية."),
    "white": ("**عربي بسيط** (لغة بيضاء) يفهمه أي عربي: قريب من الفصحى في الكلمات بس بروح الكلام اليومي، "
              "من غير كلمات مصرية أوي ولا فصحى تقيلة (زي: «الفكرة ببساطة إن…»، «لو جربت…»)."),
}

SCHEMA = {
    "type": "object",
    "properties": {
        "title": {"type": "string"},
        "tone": {"type": "string", "enum": ["serious", "light"]},
        "scenes": {"type": "array", "items": SCENE, "minItems": 2, "maxItems": 20},
    },
    "required": ["title", "tone", "scenes"],
    "additionalProperties": False,
}
REWRITE = {"type": "object", "properties": {"scenes": {"type": "array", "items": {"type": "object", "properties": {
    "index": {"type": "integer"}, **SCENE["properties"]}, "required": ["index", *SCENE["required"]], "additionalProperties": False}}},
    "required": ["scenes"], "additionalProperties": False}


def empty_board(sc: dict) -> str | None:
    """المشهد ده صورته هتطلع سبورة فاضية؟ بيرجّع السبب أو None."""
    draw = (sc.get("draw") or "").strip()
    words = [w for w in re.split(r"[\s،,]+", draw) if w]
    text = " ".join(x["text"] for x in sc["sentences"])
    if len(words) < 2:
        return "مفيش حاجة محددة تترسم (draw فاضي أو كلمة واحدة)"
    if all(w.strip(".").lower() in VAGUE for w in words if len(w) > 2):
        return f"اللي هيترسم كلام عام («{draw}») مش حاجة تتشاف"
    if sc["visual"] == "chart" and not NUM.search(text + " " + draw):
        return "رسم بياني من غير رقم ولا مقارنة في الكلام"
    return None


def check_scenes(scenes: list[dict]) -> list[dict]:
    return [{"index": k, "why": w} for k, sc in enumerate(scenes) if (w := empty_board(sc))]


def flatten(data: dict) -> dict:
    """المشاهد ← script.json: جمل مسطّحة (id, text, beat, scene) + مشاهد بأرقام جملها (باقي المراحل بتقرا sentences زي ما هي)."""
    sentences, scenes = [], []
    for k, sc in enumerate(data["scenes"]):
        ids = []
        for x in sc["sentences"]:
            t = x["text"].strip()
            if t:
                sentences.append({"id": len(sentences), "text": t, "beat": x.get("beat", "none"), "scene": k})
                ids.append(sentences[-1]["id"])
        if ids:
            scenes.append({"index": k, "visual": sc["visual"], "draw": sc["draw"].strip(), "sentence_ids": ids})
    return {"sentences": sentences, "scenes": scenes}


def run(pid: str, instruction: str | None = None) -> None:
    proj = store.load(pid)
    st = proj["settings"]
    words = int(st["duration"] * WORDS_PER_SECOND)
    dialect = DIALECTS.get(st["dialect"], DIALECTS["egyptian"])
    system = prompt("script", dialect_rule=dialect, mood=MOODS.get(st["mood"], st["mood"]), words=words,
                    max_words=int(words * 1.15), duration=st["duration"])
    user = f"فكرة الفيديو: {proj['prompt']}"
    if prefs.style():
        user += f"\n\nذوق صاحب القناة الثابت (طبّقه):\n{prefs.style()}"
    old = store.read_json(store.project_dir(pid) / "script.json")
    if instruction and old:
        user += "\n\nالسكريبت الحالي:\n" + "\n".join(s["text"] for s in old["sentences"]) + f"\n\nالمطلوب تعديله: {instruction}"
    if proj.get("user_script") and not (instruction and old):
        # السكريبت مكتوب بإيد صاحبه: بنظبطه وننسّقه بس
        system = prompt("script_polish", dialect_rule=dialect)
        user = f"موضوع الفيديو: {proj['prompt']}\n\nالسكريبت اللي كتبه:\n{proj['user_script']}"
        data = ask(pid, "script", system, user, POLISH)
        store.log(pid, "✎ ظبطنا سكريبتك: " + ("، ".join(data.get("notes") or []) or "من غير تغييرات"))
        script = {"title": data["title"].strip(), "sentences": [{"id": i, "text": t.strip()} for i, t in enumerate(data["sentences"]) if t.strip()],
                  "notes": data.get("notes") or []}
    else:
        data = ask(pid, "script", system, user, SCHEMA)
        data, visual_report = fix_empty_boards(data, lambda sy, us, sc: ask(pid, "script", sy, us, sc), dialect)
        script = {"title": data["title"].strip(), "tone": data["tone"], **flatten(data), "notes": [], "visual_check": visual_report}
        if visual_report["flagged_before"]:
            store.log(pid, f"🖍 {len(visual_report['flagged_before'])} مشهد كان هيبقى سبورة فاضية واتعاد كتابته · فاضل {len(visual_report['flagged_after'])}")
    store.write_json(store.project_dir(pid) / "script.json", script)
    store.update(pid, lambda p: p.__setitem__("title", p.get("title") or script["title"]))


def fix_empty_boards(data: dict, ask_fn, dialect: str) -> tuple[dict, dict]:
    """أي مشهد صورته هتطلع سبورة فاضية بيتعاد كتابته مرة واحدة (نفس المعنى، بس فيه حاجة حقيقية تترسم)."""
    flagged = check_scenes(data["scenes"])
    report = {"flagged_before": flagged, "flagged_after": flagged, "rewritten": []}
    if not flagged:
        return data, report
    listing = "\n".join(f"{f['index']}: [{data['scenes'][f['index']]['visual']}] draw=«{data['scenes'][f['index']]['draw']}» · "
                         + " / ".join(x["text"] for x in data["scenes"][f["index"]]["sentences"]) + f"  ← المشكلة: {f['why']}" for f in flagged)
    system = prompt("script_visual_fix", dialect_rule=dialect, visuals="\n".join(f"- {k}: {v}" for k, v in VISUALS.items()))
    user = "السكريبت كله:\n" + "\n".join(f"{k}: " + " / ".join(x["text"] for x in sc["sentences"]) for k, sc in enumerate(data["scenes"])) + \
           f"\n\nالمشاهد اللي محتاجة تتعاد:\n{listing}"
    got = ask_fn(system, user, REWRITE)
    scenes = list(data["scenes"])
    for sc in got.get("scenes", []):
        if 0 <= sc["index"] < len(scenes) and any(f["index"] == sc["index"] for f in flagged):
            scenes[sc["index"]] = {k: sc[k] for k in ("visual", "draw", "sentences")}
            report["rewritten"].append(sc["index"])
    data = {**data, "scenes": scenes}
    report["flagged_after"] = check_scenes(scenes)
    return data, report
