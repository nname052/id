"""المرحلة 3: تجهيز النص للنطق: التشكيل الضروري، والإحساس (audio tags) حسب السياق، ونفس عدد الكلمات علشان الترجمة تتزامن."""

from .. import prefs, store
from .common import ask, prompt, words_of

LINE = {"type": "object", "properties": {"id": {"type": "integer"}, "tts": {"type": "string"}},
        "required": ["id", "tts"], "additionalProperties": False}
SCHEMA = {"type": "object", "properties": {"lines": {"type": "array", "items": LINE}},
          "required": ["lines"], "additionalProperties": False}


def run(pid: str, instruction: str | None = None) -> None:
    d = store.project_dir(pid)
    script = store.read_json(d / "script.json")
    sentences = "\n".join(f"{s['id']}: {s['text']}" for s in script["sentences"])
    proj = store.load(pid)
    name = {"msa": "tts_prep_msa", "white": "tts_prep_white"}.get(proj["settings"].get("dialect"), "tts_prep_egyptian")
    system = prompt(name, sentences=sentences, context=prefs.context_block(), tags=prompt("tts_tags"))
    user = "جهّز النص."
    if instruction:
        user += f"\n\nالمطلوب تعديله: {instruction}"
    data = ask(pid, "tts", system, user, SCHEMA)  # opus: التشكيل والإحساس محتاجين فهم كويس للسياق
    by_id = {l["id"]: l["tts"].strip() for l in data["lines"]}
    lines, fixed = [], 0
    for s in script["sentences"]:
        tts = by_id.get(s["id"], s["text"])
        if len(words_of(tts)) != len(s["text"].split()):  # عدد الكلمات اختلف: نرجع للنص الأصلي علشان التزامن
            tts, fixed = s["text"], fixed + 1
        lines.append({"id": s["id"], "display": s["text"], "tts": prefs.apply_pronunciations(tts, s["text"])})
    store.write_json(d / "tts.json", {"lines": lines})
    if fixed:
        store.log(pid, f"tts: {fixed} جملة رجعت للنص الأصلي (عدد الكلمات اختلف)")
