"""المرحلة 1: السكريبت (جمل قصيرة بالمصري + عنوان)."""

from .. import prefs, store
from ..config import MOODS, WORDS_PER_SECOND
from .common import ask, prompt

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
        "sentences": {"type": "array", "items": {"type": "string"}, "minItems": 2, "maxItems": 40},
    },
    "required": ["title", "sentences"],
    "additionalProperties": False,
}


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
    else:
        data = ask(pid, "script", system, user, SCHEMA)
    script = {"title": data["title"].strip(), "sentences": [{"id": i, "text": t.strip()} for i, t in enumerate(data["sentences"]) if t.strip()],
              "notes": data.get("notes") or []}
    store.write_json(store.project_dir(pid) / "script.json", script)
    store.update(pid, lambda p: p.__setitem__("title", p.get("title") or script["title"]))
