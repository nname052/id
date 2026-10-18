"""تجهيز النص للصوت (زي زرار Enhance في ElevenLabs): tags إحساس على قد معنى كل جملة، وعلامات ترقيم بتشكّل الأداء،
ومساعدة نطق للكلمات اللي ممكن تتنطق غلط بس. الكلمات نفسها ما بتتغيّرش أبدًا: الكود بيرجّع أي تغيير أو تشكيل زيادة.
الـ tags نفسها بتعدّي على tags.validate (القايمة الموثّقة + نبرة الجملة + جد/هزار + صوت واحد في المشهد)."""

import re

from .. import prefs, store
from . import tags as tagrules
from .common import TAG, ask, prompt, tokens, words_of

LINE = {"type": "object", "properties": {
    "id": {"type": "integer"}, "beat": {"type": "string", "enum": list(tagrules.BEATS)}, "evidence": {"type": "string"}, "tts": {"type": "string"},
    "pronounce": {"type": "array", "maxItems": 3, "items": {"type": "object", "properties": {
        "word": {"type": "string"}, "say": {"type": "string"}}, "required": ["word", "say"], "additionalProperties": False}}},
    "required": ["id", "beat", "evidence", "tts", "pronounce"], "additionalProperties": False}
SCHEMA = {"type": "object", "properties": {"tone": {"type": "string", "enum": ["serious", "light"]}, "lines": {"type": "array", "items": LINE}},
          "required": ["tone", "lines"], "additionalProperties": False}

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


def scene_map(script: dict, plan: dict | None = None) -> dict:
    """رقم المشهد لكل جملة: من مشاهد السكريبت (الجديد)، أو من خطة المشاهد (فيديو قديم)، وإلا كل جملة مشهد لوحدها."""
    if script.get("scenes"):
        return {sid: k for k, sc in enumerate(script["scenes"]) for sid in sc.get("sentence_ids", [])}
    if plan and plan.get("scenes"):
        return {sid: k for k, sc in enumerate(plan["scenes"]) for sid in sc.get("sentence_ids", [])}
    return {}


def plan(script: dict, settings: dict, instruction: str | None = None, only: list[int] | None = None, scenes_plan: dict | None = None,
         ask_fn=None, old: dict | None = None) -> dict:
    """السكريبت ← سطور النطق + سجل قرارات الـ tags (من غير ما يكتب حاجة). ask_fn(system, user, schema) ← dict."""
    dial, short = DIALECT.get(settings.get("dialect"), DIALECT["egyptian"])
    beats = {s["id"]: s.get("beat") for s in script["sentences"]}
    has_beats = any(beats.values())

    def line(s):
        tag = f"  [نبرة الكاتب: {beats[s['id']]}]" if beats.get(s["id"]) else ""
        return f"{s['id']}: {s['text']}{tag}" + ("" if only is None or s["id"] in only else "  (للسياق بس)")
    sentences = "\n".join(line(s) for s in script["sentences"])
    beat_list = "\n".join(f"- {b}: {h} ← " + (", ".join(f"[{t}]" for t in sorted(tagrules.BEATS[b])) or "من غير tag")
                          for b, h in tagrules.BEAT_HELP.items())
    system = prompt("tts_prep", sentences=sentences, context=prefs.context_block(), dialect=dial, dialect_short=short, beats=beat_list,
                    tone=script.get("tone") or "حدّدها إنت من الموضوع")
    user = "جهّز النص." if only is None else f"جهّز الجمل دي بس: {only}"
    if instruction:
        user += f"\n\nالمطلوب تعديله: {instruction}"
    data = ask_fn(system, user, SCHEMA)
    tone = script.get("tone") or data.get("tone") or "light"
    by_id = {l["id"]: l for l in data["lines"]}
    raw = []
    for s in script["sentences"]:
        if only is not None and s["id"] not in only and old and s["id"] in old:
            raw.append({**old[s["id"]], "keep_old": True})
            continue
        got = by_id.get(s["id"], {"tts": s["text"], "pronounce": [], "beat": "none", "evidence": ""})
        pron = {p["word"].strip(PUNCT): p["say"].strip() for p in got.get("pronounce", [])[:2] if p["word"].strip()}
        tts = enforce(got["tts"], s["text"], pron)
        if len(words_of(tts)) != len(s["text"].split()):  # احتياطي: التزامن أهم من أي حاجة
            tts = s["text"]
        # نبرة الكاتب (لو موجودة) هي اللي بتتحسب؛ مخرج الأداء بيحددها بس للسكريبتات القديمة
        beat = beats.get(s["id"]) if has_beats and beats.get(s["id"]) else got.get("beat", "none")
        raw.append({"id": s["id"], "display": s["text"], "tts": tts, "pronounce": pron, "beat": beat, "evidence": got.get("evidence", ""),
                    "writer_beat": bool(has_beats and beats.get(s["id"]))})
    fresh = [r for r in raw if not r.get("keep_old")]
    checked, report = tagrules.validate(fresh, tone, scene_map(script, scenes_plan))
    by_new = {r["id"]: r for r in checked}
    lines = []
    for r in raw:
        if r.get("keep_old"):
            lines.append({k: v for k, v in r.items() if k != "keep_old"})
            continue
        c = by_new[r["id"]]
        lines.append({"id": c["id"], "display": c["display"], "tts": prefs.apply_pronunciations(c["tts"], c["display"]), "pronounce": c["pronounce"],
                      "beat": c["beat"], "evidence": c["evidence"], "writer_beat": c.get("writer_beat", False)})
    return {"lines": lines, "tone": tone, "tags": report}


def run(pid: str, instruction: str | None = None, only: list[int] | None = None) -> None:
    """only: أرقام الجمل اللي اتغيّرت بس (تعديل جزء من السكريبت من غير ما الباقي يتجهّز من الأول)."""
    d = store.project_dir(pid)
    script = store.read_json(d / "script.json")
    proj = store.load(pid)
    old = {l["id"]: l for l in (store.read_json(d / "tts.json") or {}).get("lines", [])}
    out = plan(script, proj["settings"], instruction, only, store.read_json(d / "scenes" / "plan.json"),
               lambda system, user, schema: ask(pid, "tts", system, user, schema), old)
    store.write_json(d / "tts.json", out)
    st = out["tags"]["stats"]
    store.log(pid, f"🎭 tags: اتساب {st['kept']} · اتشال {sum(v for k, v in st.items() if k.startswith('removed'))} (مش موثّق {st['removed_unknown']}، "
                   f"مش على نبرة الجملة {st['removed_beat']}، موضوع جد {st['removed_tone']}، أكتر من صوت في المشهد {st['removed_scene_limit']})")
