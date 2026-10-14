"""المرحلة 3: تجهيز النص للنطق (تشكيل الكلمات الصعبة بس، ونفس عدد الكلمات علشان الترجمة تتزامن)."""

from .. import store
from .common import ask, prompt, words_of

LINE = {"type": "object", "properties": {"id": {"type": "integer"}, "tts": {"type": "string"}},
        "required": ["id", "tts"], "additionalProperties": False}
SCHEMA = {"type": "object", "properties": {"lines": {"type": "array", "items": LINE}},
          "required": ["lines"], "additionalProperties": False}


def run(pid: str, instruction: str | None = None) -> None:
    d = store.project_dir(pid)
    script = store.read_json(d / "script.json")
    sentences = "\n".join(f"{s['id']}: {s['text']}" for s in script["sentences"])
    data = ask(pid, "tts", prompt("tts_prep", sentences=sentences), "جهّز النص.", SCHEMA, model="sonnet")
    by_id = {l["id"]: l["tts"].strip() for l in data["lines"]}
    lines, fixed = [], 0
    for s in script["sentences"]:
        tts = by_id.get(s["id"], s["text"])
        if len(words_of(tts)) != len(s["text"].split()):  # عدد الكلمات اختلف: نرجع للنص الأصلي علشان التزامن
            tts, fixed = s["text"], fixed + 1
        lines.append({"id": s["id"], "display": s["text"], "tts": tts})
    store.write_json(d / "tts.json", {"lines": lines})
    if fixed:
        store.log(pid, f"tts: {fixed} جملة رجعت للنص الأصلي (عدد الكلمات اختلف)")
