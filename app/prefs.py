"""ذوقك وقاموس النطق: ملفات في data/ بتتبعت مع كل فيديو، وبتكبر مع الوقت.

- data/style_profile.md: تفضيلاتك الثابتة (Claude بيطلّعها من أفكارك وتعديلاتك، وإنت تقدر تعدّلها من صفحة "ذوقي").
- data/pronunciations.json: {"كلمة": "نطقها الصح"} بيتطبّق على كل فيديو قبل الصوت.
"""

import re

from .config import ROOT
from .llm import claude_code
from .store import read_json, write_json

DATA = ROOT / "data"
STYLE = DATA / "style_profile.md"
PRON = DATA / "pronunciations.json"
PUNCT = "؟?!.,،:;…\"'«»()"


def style() -> str:
    return STYLE.read_text(encoding="utf-8").strip() if STYLE.exists() else ""


def save_style(text: str) -> None:
    DATA.mkdir(exist_ok=True)
    STYLE.write_text(text.strip() + "\n", encoding="utf-8")


def context_block(prompt: str = "") -> str:
    """بيتحط في برومبت كل مرحلة: طلبك في الفيديو ده + ذوقك الثابت."""
    out = []
    if prompt:
        out.append(f"طلب صاحب الفيديو بالنص (اتبع أي تفاصيل فيه تخص مرحلتك):\n{prompt}")
    if style():
        out.append(f"ذوق صاحب الفيديو الثابت (طبّقه دايمًا إلا لو الطلب قال غير كده):\n{style()}")
    return "\n\n".join(out)


LEARN_SCHEMA = {"type": "object", "properties": {"profile": {"type": "string"}, "changed": {"type": "boolean"}},
                "required": ["profile", "changed"], "additionalProperties": False}


def learn(text: str, source: str) -> bool:
    """Claude بيقرا كلامك الجديد ويحدّث ملف الذوق (التفضيلات الثابتة بس، مش موضوع الفيديو)."""
    system = ("إنت بتحافظ على ملف قصير بذوق صاحب قناة تيك توك عربية بتعمل فيديوهات موشن جرافيك. "
              "اقرا الكلام الجديد وطلّع منه **التفضيلات اللي تنفع لكل الفيديوهات** (أسلوب السكريبت، الإيقاع، سرعة الحركة، حجم الخط، الألوان، "
              "الحاجات اللي مش بيحبها، الصوت والنطق…). تجاهل موضوع الفيديو نفسه وأي حاجة خاصة بفيديو واحد. "
              "ادمجها مع الملف الحالي من غير تكرار، ولو فيه تعارض الجديد يكسب. الملف نقط قصيرة بالعامية المصرية، وبحد أقصى 14 نقطة. "
              "لو مفيش حاجة جديدة تستاهل، رجّع الملف زي ما هو و changed=false.")
    user = f"الملف الحالي:\n{style() or '(فاضي)'}\n\nالكلام الجديد ({source}):\n{text}"
    data = claude_code.ask(system, user, LEARN_SCHEMA, model="sonnet")["data"]
    if data.get("changed") and data.get("profile", "").strip():
        save_style(data["profile"])
        return True
    return False


def pronunciations() -> dict:
    return read_json(PRON, {})


def save_pronunciations(d: dict) -> None:
    DATA.mkdir(exist_ok=True)
    write_json(PRON, {k.strip(): v.strip() for k, v in d.items() if k.strip() and v.strip()})


def apply_pronunciations(tts: str, display: str) -> str:
    """بيبدّل الكلمات اللي في القاموس بنطقها الصح (كلمة بكلمة، فعدد الكلمات ما بيتغيّرش)."""
    d = pronunciations()
    if not d:
        return tts
    from .pipeline.common import tokens
    toks, disp = tokens(tts), display.split()  # الـ tag اللي فيه مسافة ([short pause]) حتة واحدة
    k = 0
    for i, tok in enumerate(toks):
        if tok.startswith("["):
            continue
        word = disp[k].strip(PUNCT) if k < len(disp) else ""
        k += 1
        if word in d:
            tail = re.search(f"[{re.escape(PUNCT)}]+$", tok)
            toks[i] = d[word] + (tail.group(0) if tail else "")
    return " ".join(toks)
