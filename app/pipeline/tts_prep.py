"""تجهيز النص للصوت (زي زرار Enhance في ElevenLabs): tags إحساس حسب السياق، وعلامات ترقيم بتشكّل الأداء،
ومساعدة نطق للكلمات اللي ممكن تتنطق غلط بس. الكلمات نفسها ما بتتغيّرش أبدًا: الكود بيرجّع أي تغيير أو تشكيل زيادة."""

import re

from .. import prefs, store
from .common import TAG, ask, prompt, tokens, words_of

LINE = {"type": "object", "properties": {
    "id": {"type": "integer"}, "tts": {"type": "string"},
    "pronounce": {"type": "array", "maxItems": 3, "items": {"type": "object", "properties": {
        "word": {"type": "string"}, "say": {"type": "string"}}, "required": ["word", "say"], "additionalProperties": False}}},
    "required": ["id", "tts", "pronounce"], "additionalProperties": False}
SCHEMA = {"type": "object", "properties": {"lines": {"type": "array", "items": LINE}}, "required": ["lines"], "additionalProperties": False}

DIALECT = {"egyptian": ("عامية مصرية (صوت مصري)", "المصري"), "msa": ("فصحى (النطق فصيح)", "الفصحى"),
           "white": ("عربي بسيط قريب من الفصحى", "النطق العربي")}
DIAC = re.compile(r"[ً-ْٰـ]")
PUNCT = ".,!?،؟؛:…—-\"'«»()"


def base(w: str) -> str:
    """الكلمة من غير تشكيل ولا ترقيم (علشان نقارن)."""
    return DIAC.sub("", w).strip(PUNCT)


def enforce(tts: str, display: str, pron: dict) -> str:
    """بنبني نص النطق من الكلمات الأصلية، ونسيب من شغل الـ AI بس: الـ tags، والترقيم، وطريقة نطق الكلمات اللي هو علّم عليها."""
    disp = display.split()
    out, k = [], 0
    for tok in tokens(tts):
        if TAG.match(tok):
            out.append(tok)
            continue
        if k >= len(disp):
            break
        orig = disp[k]
        k += 1
        word = orig.strip(PUNCT)
        lead = re.match(f"^[{re.escape(PUNCT)}]*", tok).group(0)
        tail = re.search(f"[{re.escape(PUNCT)}]*$", tok).group(0) or re.search(f"[{re.escape(PUNCT)}]*$", orig).group(0)
        tail = tail.replace("؟", "?").replace("،", ",")  # الترقيم اللاتيني بيدّي نغمة السؤال أوضح
        say = pron.get(word) or pron.get(base(word))
        out.append(lead + (say if say else word) + tail)
    out += disp[k:]  # لو الـ AI نسي كلمات في الآخر
    return " ".join(out)


def run(pid: str, instruction: str | None = None, only: list[int] | None = None) -> None:
    """only: أرقام الجمل اللي اتغيّرت بس (تعديل جزء من السكريبت من غير ما الباقي يتجهّز من الأول)."""
    d = store.project_dir(pid)
    script = store.read_json(d / "script.json")
    proj = store.load(pid)
    old = {l["id"]: l for l in (store.read_json(d / "tts.json") or {}).get("lines", [])}
    targets = [s for s in script["sentences"] if only is None or s["id"] in only]
    dial, short = DIALECT.get(proj["settings"].get("dialect"), DIALECT["egyptian"])
    # الجمل كلها بتتبعت علشان السياق، والمطلوب يتجهّز بيتعلّم عليه
    sentences = "\n".join(f"{s['id']}: {s['text']}" + ("" if only is None or s["id"] in only else "  (للسياق بس)") for s in script["sentences"])
    system = prompt("tts_prep", sentences=sentences, context=prefs.context_block(), dialect=dial, dialect_short=short)
    user = "جهّز النص." if only is None else f"جهّز الجمل دي بس: {only}"
    if instruction:
        user += f"\n\nالمطلوب تعديله: {instruction}"
    data = ask(pid, "tts", system, user, SCHEMA)
    by_id = {l["id"]: l for l in data["lines"]}
    lines = []
    for s in script["sentences"]:
        if only is not None and s["id"] not in only and s["id"] in old:
            lines.append(old[s["id"]])
            continue
        got = by_id.get(s["id"], {"tts": s["text"], "pronounce": []})
        pron = {p["word"].strip(PUNCT): p["say"].strip() for p in got.get("pronounce", [])[:2] if p["word"].strip()}
        tts = enforce(got["tts"], s["text"], pron)
        if len(words_of(tts)) != len(s["text"].split()):  # احتياطي: التزامن أهم من أي حاجة
            tts = s["text"]
        lines.append({"id": s["id"], "display": s["text"], "tts": prefs.apply_pronunciations(tts, s["text"]), "pronounce": pron})
    store.write_json(d / "tts.json", {"lines": lines})
