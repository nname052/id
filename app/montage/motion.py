"""الموشن جرافيك (نظام تركيب عام، مش حلول لكل فيديو):

1) الاختيار من الكلام (قواعد ثابتة، والسبب بيتسجّل):
   رقم ← عدّاد (counter) · مقارنة ← أعمدة (bars) · كمية/درجة (كتير/قليل/بسيط) ← مقياس (meter) · ترتيب (أول/تاني/بعدين) ← خط زمني (timeline)
   · تعريف بالاسم ← lower third · فكرة قصيرة ليها كلمة مفتاحية ← أيقونة + كلمة بتتكتب (keyword).
   أي جرافيك لازم فيه عنصر حركة (عدّاد، مقياس بيتملي، أيقونة، كتابة كلمة بكلمة، خط بيترسم). جملة نص ثابتة بس ← مرفوضة.
2) طريقة العرض لكل لحظة (mode) بقاعدة: شرح طويل فيه رقم/كمية ← explainer (الجرافيك ياخد الكادر والمتكلم يرجع بمزج)،
   مقارنة ← split، فكرة قصيرة ← overlay في مساحة فاضية، مفيش مساحة ← inset (المتكلم يصغر في ركن) أو يتشال والسبب يتسجّل.
   لو المصدر مفيهوش متكلم يتفصل (تسجيل شاشة/جرافيك): explainer و inset مقفولين.
3) المكان: محرك قواعد بيدوّر على مساحة فاضية بقناع الشخص + الوش (MediaPipe) طول وقت الجرافيك، ومن غير منطقة الترجمة.
4) التوقيت: الجرافيك بيبدأ مع أول كلمة في الجملة بالظبط، ويفضل وقت كفاية للقراية.
الرسم: صفحة HTML فيها render(t) (حتمي، من غير animations حقيقية)، Chromium بيصوّر كل فريم بالمعدل بتاع الفيديو ← PNG ← FFmpeg overlay.
الخط Alexandria (OFL)، والأيقونات Lucide (ISC).
"""

import base64
import json
import re
from pathlib import Path

import numpy as np

from ..config import ASSETS, FONTS
from .cuts import SAFE, norm

ICON_DIR = ASSETS / "icons" / "lucide"
PALETTES = {
    "clean": {"bg": "#14161c", "panel": "rgba(20,22,28,.9)", "ink": "#ffffff", "accent": "#7ee2b8", "soft": "rgba(255,255,255,.14)", "sub": "rgba(255,255,255,.72)"},
    "bold": {"bg": "#1d1d22", "panel": "rgba(255,90,31,.95)", "ink": "#ffffff", "accent": "#ffcf3f", "soft": "rgba(255,255,255,.2)", "sub": "rgba(255,255,255,.85)"},
    "elegant": {"bg": "#0e0d0c", "panel": "rgba(14,13,12,.92)", "ink": "#f4ead5", "accent": "#c9a45c", "soft": "rgba(201,164,92,.18)", "sub": "rgba(244,234,213,.7)"},
    "fresh": {"bg": "#f4f7fd", "panel": "rgba(255,255,255,.96)", "ink": "#13233f", "accent": "#2f6fe0", "soft": "rgba(47,111,224,.14)", "sub": "rgba(19,35,63,.65)"},
}
ICONS = [  # كلمة (بعد norm) ← أيقونة Lucide
    (("مبسوط", "مبسوطه", "سعيد", "فرحان", "مرتاح", "راضي"), "smile"), (("اصحاب", "صحاب", "صاحب", "ناس", "المجتمع", "مجتمع", "التفاعل", "اجتماعي", "علاقات"), "users"),
    (("كويس", "كويسه", "حلو", "حلوه", "تمام"), "thumbs-up"), (("طبيعي", "منطقي", "صح", "عادي"), "circle-check"), (("مشكله", "مشاكل", "صعب"), "triangle-alert"), (("نفسي", "شخصيتي", "شخصيه", "نفسك"), "user"),
    (("وقت", "ساعه", "ساعات", "دقيقه", "دقايق", "يوم", "سنه", "سنين"), "clock"), (("فلوس", "جنيه", "دولار", "مرتب"), "wallet"), (("شغل", "الشغل", "شغلي"), "briefcase"),
    (("موبايل", "الموبايل", "تليفون"), "smartphone"), (("تركيز", "التركيز", "هدف", "الهدف"), "target"), (("فكره", "الفكره"), "lightbulb"), (("حب", "بحب"), "heart")]
QUANT = {"كتير": 0.85, "جدا": 0.9, "اوي": 0.85, "خالص": 0.95, "عالي": 0.8, "متوسط": 0.5, "نص": 0.5, "قليل": 0.25, "شويه": 0.3, "بسيط": 0.3, "ضعيف": 0.2, "قليله": 0.25}
LEVEL_NAMES = [(0.4, "قليل"), (0.7, "متوسط"), (1.01, "كتير")]
COMPARE = re.compile(r"(اكتر من|اقل من|احسن من|مقابل|بدل|بالمقارنه|vs|versus)")
SEQ = ("اول", "تاني", "تالت", "رابع", "بعدين", "خطوه", "اخر حاجه", "first", "second", "then")
NUMW = {"اتنين": 2, "تلاته": 3, "تلات": 3, "اربعه": 4, "خمسه": 5, "سته": 6, "سبعه": 7, "تمانيه": 8, "تسعه": 9, "عشره": 10, "عشرين": 20, "تلاتين": 30,
        "اربعين": 40, "خمسين": 50, "ميه": 100, "الف": 1000}
AR_DIG = str.maketrans("0123456789", "٠١٢٣٤٥٦٧٨٩")
ENTER, EXIT = 0.28, 0.22   # دخول وخروج سريع (كان 0.45/0.35: الجرافيك كان بيبان بطيء)
SUB_BAND = (0.60, 0.83)      # منطقة الترجمة محجوزة (من الارتفاع)، مفيش جرافيك فيها
EXPLAIN_MIN = 4.5            # فكرة فيها رقم/كمية وطولها ≥ كده ← explainer


def _icon_svg(name: str) -> str:
    f = ICON_DIR / f"{name}.svg"
    if not f.exists():
        f = ICON_DIR / "sparkles.svg"
    svg = f.read_text(encoding="utf-8")
    return re.sub(r'(width|height)="\d+"', "", svg, count=2).replace("<svg", '<svg class="ic"', 1)


def _font(name: str) -> str:
    f = FONTS / name
    return base64.b64encode(f.read_bytes()).decode() if f.exists() else ""


# ---------- 1) الاختيار من الكلام ----------
def _words(idea: dict) -> list[dict]:
    return [w for c in idea["cues"] for w in c["words"]]


def _conf(ws: list[dict], cues: list[dict]) -> bool:
    edited = any(c.get("edited") for c in cues)
    ps = [w.get("p", 1.0) for w in ws]
    return edited or (bool(ps) and float(np.mean(ps)) >= 0.7 and min(ps) >= 0.4)


def _disp(w: str) -> str:
    return w.strip("«»\"'.,،؛;:؟?!…")


def _icon_for(ws: list[dict], used: set | None = None) -> tuple[str | None, dict | None]:
    """أول كلمة ليها أيقونة ما اتستخدمتش قبل كده في نفس الفيديو (علشان الكروت ما تتكررش)."""
    for w in ws:
        n = norm(w["word"])
        for keys, icon in ICONS:
            if n in {norm(k) for k in keys} and icon not in (used or set()):
                return icon, w
    return None, None


TOPIC_STOP = {norm(w) for w in ("انا", "أنا", "و", "بس", "ان", "إن", "انه", "لانه", "لأنه", "يكون", "ممكن", "كان", "هو", "هي", "ده", "دي", "في", "مع", "من",
                                  "على", "او", "أو", "مش", "ما", "لو", "اللي", "بتاعي", "كده", "جدا", "اوي")}
NEG = {norm(w) for w in ("مش", "ما", "مفيش", "مافيش", "مو", "لا", "ولا", "مكنش", "مابقاش")}


def _neg_word(w: str) -> bool:
    """نفي مصري: مش/ما/مفيش، أو فعل/ضمير منفي بالشين (عنديش، مبحبش، ماعرفش)."""
    n = norm(w)
    return n in NEG or (len(n) >= 4 and n.endswith("ش") and (n.startswith(("م", "ما")) or n.startswith("عند") or n.startswith("ليك") or n.startswith("في")))


def _negated(ws: list[dict]) -> str | None:
    return next((w["word"] for w in ws if _neg_word(w["word"])), None)


def _clause(ws: list[dict], i: int, gap: float = 0.3) -> list[dict]:
    """العبارة اللي فيها الكلمة i: بتقف عند سكتة (≥ gap) أو علامة ترقيم."""
    a = i
    while a > 0 and ws[a]["start"] - ws[a - 1]["end"] < gap and not re.search(r"[،,.!?؟]$", ws[a - 1]["word"]):
        a -= 1
    b = i
    while b + 1 < len(ws) and ws[b + 1]["start"] - ws[b]["end"] < gap and not re.search(r"[،,.!?؟]$", ws[b]["word"]):
        b += 1
    return ws[a:b + 1]


def choose(idea: dict, speaker: bool, brief: dict, used_icons: set | None = None) -> dict | None:
    """فكرة ← مواصفات جرافيك (النوع + طريقة العرض + السبب) أو None مع سبب."""
    ws = _words(idea)
    if not ws:
        return None
    text = " ".join(norm(w["word"]) for w in ws)
    dur = idea["end"] - idea["start"]
    out = None
    # رقم ← عدّاد
    for i, w in enumerate(ws):
        t = norm(w["word"]).translate(str.maketrans("٠١٢٣٤٥٦٧٨٩", "0123456789"))
        val = int(t) if t.isdigit() else NUMW.get(t)
        if val is not None and (t.isdigit() or val >= 10 or (i + 1 < len(ws) and len(norm(ws[i + 1]["word"])) >= 3)):
            label = " ".join(_disp(x["word"]) for x in ws[i + 1:i + 4])
            out = {"kind": "counter", "value": val, "label": label, "at": w["start"], "first_word": w["word"], "why": f"اتقال رقم ({w['word']})"}
            break
    # مقارنة ← أعمدة
    if not out and (m := COMPARE.search(text)):
        left, right = text[:m.start()].split()[-3:], text[m.end():].split()[:3]
        if left and right:
            out = {"kind": "bars", "items": [{"label": " ".join(left), "v": 0.8}, {"label": " ".join(right), "v": 0.45}], "at": ws[0]["start"],
                   "first_word": ws[0]["word"], "why": f"مقارنة («{m.group(1)}»)"}
    # ترتيب ← خط زمني
    if not out:
        steps = [w for w in ws if norm(w["word"]) in {norm(s) for s in SEQ}]
        if len(steps) >= 2:
            items = []
            for s in steps[:4]:
                k = ws.index(s)
                items.append(" ".join(_disp(x["word"]) for x in ws[k + 1:k + 3]))
            out = {"kind": "timeline", "items": items, "at": steps[0]["start"], "first_word": steps[0]["word"], "why": f"ترتيب ({len(steps)} خطوات)"}
    # تعريف بالاسم ← lower third
    if not out and (m := re.search(r"(انا اسمي|اسمي|معاكم) (\S+)( \S+)?", text)):
        k = next(i for i, w in enumerate(ws) if norm(w["word"]) in ("اسمي", "معاكم"))
        name = " ".join(_disp(x["word"]) for x in ws[k + 1:k + 3])
        out = {"kind": "lower_third", "title": name, "label": "", "at": ws[k]["start"], "first_word": ws[k]["word"], "why": "تعريف بالاسم"}
    # كمية/درجة ← مقياس
    if not out:
        for i, w in enumerate(ws):
            n = norm(w["word"])
            if n in QUANT and i >= 1:
                cl = _clause(ws, i)
                before = [x for x in cl if x["start"] < w["start"]]
                neg = _negated(before)
                level = QUANT[n] if not neg else max(0.15, round(1 - QUANT[n] - 0.05, 2))
                subj = [x for x in before if norm(x["word"]) not in TOPIC_STOP and not _neg_word(x["word"])]
                if not subj:
                    continue
                label = " ".join(_disp(x["word"]) for x in subj[-3:])
                icon, _ = _icon_for(cl, used_icons)
                name = next(nm for lim, nm in LEVEL_NAMES if level < lim)
                out = {"kind": "meter", "title": label, "level": round(level, 2), "level_name": name, "icon": icon or "gauge",
                       "at": cl[0]["start"], "first_word": cl[0]["word"],
                       "why": f"كمية/درجة («{w['word']}»{' منفية بـ «' + neg + '»' if neg else ''}) عن «{label}»"}
                break
    # فكرة قصيرة ليها كلمة مفتاحية ← أيقونة + كلمة (من نفس العبارة بس: ما تعدّيش سكتة أو جملة)
    if not out:
        icon, kw = _icon_for(ws, used_icons)
        if icon:
            k = ws.index(kw)
            cl = _clause(ws, k)
            j = cl.index(kw)
            phrase = [x for x in cl[max(0, j - 1):j + 2] if norm(x["word"]) not in TOPIC_STOP or x is kw]
            while phrase and phrase[-1] is not kw and norm(phrase[-1]["word"]) in TOPIC_STOP:
                phrase.pop()
            out = {"kind": "keyword", "title": " ".join(_disp(x["word"]) for x in phrase), "icon": icon, "at": phrase[0]["start"],
                   "first_word": phrase[0]["word"], "why": f"فكرة قصيرة وكلمة ليها أيقونة («{kw['word']}» ← {icon})"}
    if not out:
        return {"skip": "مفيش رقم أو مقارنة أو ترتيب أو كلمة ليها أيقونة: جملة نص بس من غير حركة ← مرفوضة"}
    # الثقة على الكلمات اللي هتظهر على الجرافيك بس (مش الفكرة كلها: كلمة واحدة مش واضحة في جملة طويلة ما تلغيش الجرافيك)
    shown = {norm(x) for x in (out.get("title") or "").split()} | {norm(y) for it in out.get("items") or [] for y in (it["label"] if isinstance(it, dict) else it).split()}
    used = [w for w in ws if norm(w["word"]) in shown] or [w for w in ws if w["word"] == out["first_word"]]
    if not _conf(used, idea["cues"]):
        return {"skip": f"التفريغ مش متأكد من الكلام اللي هيظهر («{out.get('title') or ''}»): صحّح السطر في «نص الترجمة» والجرافيك هيتعمل"}
    # الهوك (أول فكرة في أول ثانية ونص): عنوان كبير بالكلمة المهمة وراها هايلايتر، بدل كارت كلمة عادي
    if idea.get("first") and idea["start"] < 1.5 and out["kind"] == "keyword":
        out = {**out, "kind": "title", "highlight": out.get("highlight") or _disp(next((w["word"] for w in ws if any(norm(w["word"]) in ks for ks, _ in ICONS)), "")),
               "why": out["why"] + " · أول جملة (هوك): عنوان كبير"}
    # طريقة العرض
    rich = out["kind"] in ("counter", "meter", "bars", "timeline")
    forced = (brief.get("modes") or {}).get(idea["id"])
    if forced:
        out["mode"], out["mode_why"] = ("pip" if forced in ("explainer", "inset") else forced), "إنت طلبتها"
    elif rich and dur >= EXPLAIN_MIN and speaker:
        # صورتك مصغّرة في دايرة والشرح بياخد باقي الشاشة (بدل explainer اللي كان بيخبّيك خالص)
        out["mode"], out["mode_why"] = "pip", f"شرح طويل ({dur:.1f} ث) فيه {out['why']}: صورتك مصغّرة والشرح في باقي الشاشة"
    elif out["kind"] == "bars" and speaker:
        out["mode"], out["mode_why"] = "split", "مقارنة: نص للمتكلم ونص للأعمدة"
    else:
        out["mode"], out["mode_why"] = "overlay", "فكرة قصيرة: فوق الفيديو في مساحة فاضية"
    if not speaker and out["mode"] in ("explainer", "inset", "pip"):
        out["mode"], out["mode_why"] = "overlay", "المصدر مفيهوش متكلم يتفصل: صورتك المصغّرة مقفولة"
    out["idea"] = idea["id"]
    return out


# ---------- 2) المكان ----------
SIZES = {"keyword": (0.80, 0.15), "counter": (0.66, 0.17), "meter": (0.80, 0.18), "bars": (0.80, 0.20), "timeline": (0.84, 0.125), "lower_third": (0.70, 0.11),
         "title": (0.90, 0.17), "illus": (0.84, 0.30), "sticker": (0.30, 0.17), "checklist": (0.84, 0.22), "vs": (0.88, 0.16), "clock": (0.74, 0.16),
         "doodle": (0.34, 0.19), "annotate": (0.26, 0.147), "visual": (0.27, 0.152)}
STYLES = ("dark", "light", "accent", "glass", "marker")   # بتتبادل: مفيش جرافيكين ورا بعض بنفس الشكل
ENTERS = ("pop", "slide", "wipe", "drop")
PIP = {"9:16": (0.29, 0.055, 0.42), "16:9": (0.06, 0.12, 0.36)}   # صورتك المصغّرة: (x, y, القطر) نسبة من العرض/الارتفاع/العرض


def pip_geom(W: int, H: int, aspect: str) -> list[int]:
    """مكان ومقاس دايرة صورتك المصغّرة (بكسل): فوق في النص في الطولي، وعلى الشمال في العرضي."""
    x, y, d = PIP.get(aspect, PIP["9:16"])
    D = int(round(d * W / 2)) * 2
    return [int((W - D) / 2) if aspect == "9:16" else int(x * W), int(y * H), D]


def style_for(k: int, prev: str | None, kind: str) -> tuple[str, str]:
    """ستايل ودخول الجرافيك رقم k: بيتبادلوا، ومفيش اتنين ورا بعض زي بعض. العنوان (هوك) دايمًا بالهايلايتر."""
    if kind == "title":
        return "marker", "drop"
    st = STYLES[k % len(STYLES)]
    if st == prev:
        st = STYLES[(k + 1) % len(STYLES)]
    return st, ENTERS[k % len(ENTERS)]


def mask_png(D: int, out: Path) -> Path:
    """دايرة بيضا على أسود بمقاس صورتك المصغّرة (قناع الـ FFmpeg)، حوافها ناعمة."""
    from PIL import Image, ImageDraw, ImageFilter
    big = Image.new("L", (D * 4, D * 4), 0)
    ImageDraw.Draw(big).ellipse([0, 0, D * 4 - 1, D * 4 - 1], fill=255)
    big.resize((D, D), Image.LANCZOS).filter(ImageFilter.GaussianBlur(0.6)).save(out)
    return out


def place(kind: str, occ: np.ndarray, aspect: str, prefer_y: float | None = None, prefer_side: str | None = None) -> dict | None:
    """أحسن مستطيل فاضي للجرافيك: مفيش وش، والشخص ≤ 2% منه، بره منطقة الترجمة وبره عمود أزرار تيك توك. بيرجّع rect (نسبة) أو None."""
    from .vision import overlap_ratio
    w, h = SIZES[kind]
    if aspect == "16:9":
        w, h = w * 0.55, h * 1.6
    best = None
    for scale in (1.0, 0.85, 0.72):
        ww, hh = w * scale, h * scale
        for top in np.arange(0.06, 0.95 - hh, 0.01):
            bottom = top + hh
            if bottom > SUB_BAND[0] and top < SUB_BAND[1]:
                continue
            for left in np.arange(0.04, 0.86 - ww + 1e-6, 0.02):
                r = {"left": round(float(left), 3), "top": round(float(top), 3), "right": round(float(left + ww), 3), "bottom": round(float(bottom), 3)}
                ov = overlap_ratio(occ, r)
                if ov > 0.02:
                    continue
                # الأفضل: أقل تداخل، وبعدين (لو فيه تفضيل) قريب من ارتفاع الراس وفي الناحية المطلوبة، وإلا أقرب لمنتصف العرض وفوق
                if prefer_y is not None:
                    cxr = left + ww / 2
                    side_pen = 0 if prefer_side is None else (0.0 if (cxr > 0.5) == (prefer_side == "right") else 0.25)
                    score = ov * 10 + abs((top + hh / 2) - prefer_y) * 1.5 + side_pen + 0.15 * abs(cxr - (0.75 if prefer_side == "right" else 0.25))
                else:
                    score = ov * 10 + abs((left + ww / 2) - 0.45) + 0.3 * top
                if best is None or score < best[0]:
                    best = (score, r, ov, scale)
        if best:
            return {**best[1], "overlap": round(best[2], 4), "scale": best[3]}
    return None


# ---------- 3) الرسم ----------
CSS = """
html,body{margin:0;background:transparent;overflow:hidden}
*{box-sizing:border-box}
#root{position:absolute;inset:0;font-family:Card,sans-serif;direction:rtl;color:var(--ink)}
.ic{width:100%;height:100%;stroke:currentColor;fill:none;stroke-width:2;stroke-linecap:round;stroke-linejoin:round}
.panel{position:absolute;inset:0;border-radius:calc(var(--u)*1.1);background:var(--panel);box-shadow:0 calc(var(--u)*.4) calc(var(--u)*1.4) rgba(0,0,0,.28)}
.full{position:absolute;inset:0;background:radial-gradient(120% 80% at 50% 25%, var(--soft), transparent 60%), var(--bg)}
.row{position:absolute;display:flex;align-items:center;gap:calc(var(--u)*.9)}
.badge{flex:none;border-radius:50%;background:var(--accent);color:var(--bg);display:grid;place-items:center}
.t{font-weight:800;line-height:1.25}
.w{display:inline-block;margin-inline-end:.28em}
.l{color:var(--sub);font-weight:600}
.track{position:relative;border-radius:999px;background:var(--soft);overflow:hidden}
.fill{position:absolute;inset:0 0 0 auto;border-radius:999px;background:var(--accent)}
.bar{position:absolute;bottom:0;border-radius:calc(var(--u)*.4) calc(var(--u)*.4) 0 0;background:var(--accent)}
/* ستايلات الكارت (بتتبادل علشان مفيش جرافيكين ورا بعض بنفس الشكل) */
#root.s-light{--ink:#14161c;--sub:rgba(20,22,28,.66);--soft:rgba(20,22,28,.1)}
#root.s-light .panel{background:rgba(255,255,255,.97)}
#root.s-accent{--ink:#fff;--sub:rgba(255,255,255,.88);--soft:rgba(255,255,255,.25)}
#root.s-accent .panel{background:var(--accent)}
#root.s-accent .badge{background:#fff;color:var(--accent)}
#root.s-accent .fill,#root.s-accent .bar{background:#fff}
#root.s-glass .panel{background:rgba(255,255,255,.17);border:calc(var(--u)*.12) solid rgba(255,255,255,.42);box-shadow:none}
#root.s-glass{--ink:#fff;--sub:rgba(255,255,255,.86)}
#root.s-marker .panel{background:transparent;box-shadow:none}
#root.s-marker .t{color:#fff;-webkit-text-stroke:calc(var(--u)*.16) #111;paint-order:stroke fill;text-shadow:0 calc(var(--u)*.2) calc(var(--u)*.6) rgba(0,0,0,.35)}
#root.s-marker .l{color:#fff;-webkit-text-stroke:calc(var(--u)*.1) #111;paint-order:stroke fill}
.hl{position:absolute;z-index:-1;background:var(--accent);border-radius:calc(var(--u)*.35);transform-origin:right center}
.ring{position:absolute;border-radius:50%}
.blob{position:absolute;border-radius:50%;background:var(--accent);opacity:.12}
.badge svg,#art svg{width:100%;height:100%;overflow:visible}
#art{display:grid;place-items:center}
"""

JS = r"""
const clamp=(x,a=0,b=1)=>Math.min(b,Math.max(a,x)), seg=(t,a,b)=>clamp((t-a)/(b-a));
const eo=x=>1-Math.pow(1-clamp(x),3), back=x=>{x=clamp(x);const c=1.7;return 1+(c+1)*Math.pow(x-1,3)+c*Math.pow(x-1,2)};
let S, D;
function words(el, text){ el.innerHTML = text.split(/\s+/).map(w=>`<span class="w">${w}</span>`).join(''); return [...el.children]; }
function setup(spec, dur){
  S = spec; D = dur; const r = document.getElementById('root'), u = S.u;
  r.style.setProperty('--u', u+'px');
  const full = S.mode !== 'overlay';
  let h = '';
  if (full) h += `<div class="full"></div>`; else h += `<div class="panel" id="panel"></div>`;
  const k = S.kind;
  r.className = 's-' + (S.style || 'dark');
  if (S.mode === 'pip') {
    // صورتك مصغّرة في دايرة (الفيديو نفسه بيتحط فيها بالـ FFmpeg) وحواليها حلقة متحركة، والشرح بياخد باقي الشاشة
    const P = S.pip; // [x, y, d] بكسل
    h += `<div class="blob" id="b1" style="width:${u*14}px;height:${u*14}px;left:${-u*4}px;top:${S.H*0.62}px"></div>
      <div class="blob" id="b2" style="width:${u*9}px;height:${u*9}px;right:${-u*2}px;top:${u*2}px"></div>
      <div class="ring" style="left:${P[0]-u*.45}px;top:${P[1]-u*.45}px;width:${P[2]+u*.9}px;height:${P[2]+u*.9}px;border:${u*.3}px solid var(--accent)"></div>
      <svg id="spin" width="${P[2]+u*2.4}" height="${P[2]+u*2.4}" style="position:absolute;left:${P[0]-u*1.2}px;top:${P[1]-u*1.2}px">
        <circle cx="${(P[2]+u*2.4)/2}" cy="${(P[2]+u*2.4)/2}" r="${P[2]/2+u*.95}" fill="none" stroke="var(--accent)" stroke-width="${u*.18}" stroke-dasharray="${u*.6} ${u*1.1}" opacity=".7"/></svg>`;
    const top = S.cy;
    if (k === 'meter') h += `<div class="t" id="title" style="position:absolute;inset-inline:${u*2}px;top:${top}px;text-align:center;font-size:${u*2.7}px;text-wrap:balance"></div>
      <div class="track" id="track" style="position:absolute;inset-inline:${u*3}px;top:${top+u*7.5}px;height:${u*1.8}px"><div class="fill" id="fill" style="width:0"></div></div>
      <div class="l" style="position:absolute;inset-inline:${u*3}px;top:${top+u*10.2}px;font-size:${u*2.2}px;display:flex;justify-content:space-between">
        <span id="lname" style="color:var(--accent);font-weight:800"></span><span id="pct" dir="ltr"></span></div>`;
    else if (k === 'counter') h += `<div class="t" id="num" dir="ltr" style="position:absolute;left:0;right:0;text-align:center;top:${top}px;font-size:${u*6.5}px;color:var(--accent)"></div>
      <div class="t" id="title" style="position:absolute;inset-inline:${u*2}px;text-align:center;top:${top+u*8.2}px;font-size:${u*2.4}px"></div>`;
    else if (k === 'bars') h += S.items.map((it,i)=>`<div class="t" id="bl${i}" style="position:absolute;inset-inline:${u*2.5}px;top:${top+u*i*5.4}px;font-size:${u*2.3}px">${it.label}</div>
      <div class="track" style="position:absolute;inset-inline:${u*2.5}px;top:${top+u*(3+i*5.4)}px;height:${u*1.5}px"><div class="fill" id="bf${i}" style="width:0;${i?'opacity:.55':''}"></div></div>`).join('');
    else if (k === 'illus') h += `<div id="art" style="position:absolute;left:${u*2.5}px;right:${u*2.5}px;top:${top}px;height:${S.H*0.2}px">${S.svg}</div>
      <div class="t" id="title" style="position:absolute;inset-inline:${u*2}px;text-align:center;top:${top+S.H*0.2+u*1.2}px;font-size:${u*2.7}px;text-wrap:balance"></div>`;
    else if (k === 'timeline') h += S.items.map((it,i)=>`<div id="st${i}" class="row" style="right:${u*3}px;left:${u*3}px;top:${top+u*i*3.6}px">
        <div class="badge" style="width:${u*2.6}px;height:${u*2.6}px;font-weight:800;font-size:${u*1.4}px">${(i+1).toLocaleString('ar-EG')}</div>
        <div class="t" style="font-size:${u*2.1}px">${it}</div></div>`).join('');
    else h += `<div class="badge" id="badge" style="position:absolute;left:calc(50% - ${u*2.6}px);top:${top}px;width:${u*5.2}px;height:${u*5.2}px;padding:${u*1.05}px">${S.icon_svg}</div>
      <div class="t" id="title" style="position:absolute;inset-inline:${u*2}px;text-align:center;top:${top+u*6.6}px;font-size:${u*3}px;text-wrap:balance"></div>
      <div id="ul" style="position:absolute;left:30%;width:0;height:${u*.35}px;top:${top+u*10.6}px;background:var(--accent);border-radius:9px"></div>`;
    r.innerHTML = h;
    if (document.getElementById('title')) S.tw = words(document.getElementById('title'), S.title || '');
    prepDraw();
    return;
  }
  if (k === 'title') {
    // عنوان الهوك: كلام كبير والكلمة المهمة وراها هايلايتر بيتمد
    h += `<div class="t" id="title" style="position:absolute;inset:0;display:flex;flex-wrap:wrap;align-content:center;justify-content:center;text-align:center;padding:0 ${u}px;font-size:${u*2.9}px;line-height:1.35"></div>`;
    r.innerHTML = h;
    S.tw = words(document.getElementById('title'), S.title || '');
    const hi = S.tw.findIndex(w => w.textContent.replace(/[^\p{L}]/gu,'') === (S.highlight||'').replace(/[^\p{L}]/gu,''));
    if (hi >= 0) { const w = S.tw[hi]; w.style.position = 'relative'; w.style.color = S.style === 'accent' ? 'var(--ink)' : '#fff'; w.style.webkitTextStroke = '0';
      w.insertAdjacentHTML('afterbegin', `<span class="hl" id="hl" style="inset:${-u*.1}px ${-u*.35}px ${-u*.05}px ${-u*.35}px"></span>`); }
    return;
  }
  if (k === 'visual') {
    // أيقونة ملوّنة في دايرة زجاج بيضا بضل ناعم، وحلقة بلون التأكيد بتترسم حواليها، ونقط صغيرة بتلف
    const D = Math.min(S.bw, S.bh) * 0.9, R = D / 2;
    r.innerHTML = `<div id="vb" style="position:absolute;left:${(S.bw-D)/2}px;top:${(S.bh-D)/2}px;width:${D}px;height:${D}px">
      <div style="position:absolute;inset:6%;border-radius:50%;background:radial-gradient(circle at 35% 30%,#ffffff,#f1f3f7);box-shadow:0 ${u*.35}px ${u*1.1}px rgba(0,0,0,.3)"></div>
      <svg id="ring" width="${D}" height="${D}" style="position:absolute;inset:0;overflow:visible"><circle cx="${R}" cy="${R}" r="${R*.97}" fill="none" stroke="var(--accent)" stroke-width="${u*.22}" stroke-linecap="round"
        stroke-dasharray="${2*Math.PI*R*.97}" stroke-dashoffset="${2*Math.PI*R*.97}" transform="rotate(-90 ${R} ${R})"/></svg>
      ${[0,1,2].map(i=>`<div class="dot" id="dt${i}" style="position:absolute;width:${u*(.55-i*.12)}px;height:${u*(.55-i*.12)}px;border-radius:50%;background:var(--accent);left:${R}px;top:${R}px"></div>`).join('')}
      <div id="art" style="position:absolute;inset:20%">${S.svg}</div></div>`;
    S.R = R;
    if (!S.color) prepDraw();
    return;
  }
  if (k === 'doodle' || k === 'annotate') {
    // رسمة/شخبطة بالماركر على الفيديو نفسه (من غير كارت ولا كلام)
    const inner = k === 'doodle' ? S.svg : `<svg viewBox="0 0 ${S.bw} ${S.bh}" width="${S.bw}" height="${S.bh}">${annot(S.annotation, S.bw, S.bh, S.side || 'right', S.face || [0.3,0.3,0.7,0.7], u)}</svg>`;
    r.innerHTML = `<div id="art" style="position:absolute;inset:${k === 'doodle' ? '6%' : '0'};filter:drop-shadow(0 ${u*.1}px ${u*.22}px rgba(0,0,0,.6))">${inner}</div>`;
    prepDraw();
    return;
  }
  if (k === 'sticker') {
    // إيموجي متحرك (Lottie) جنب الوش، من غير كارت
    r.innerHTML = `<div id="lot" style="position:absolute;inset:0"></div>`;
    S.anim = lottie.loadAnimation({container: document.getElementById('lot'), renderer: 'svg', loop: true, autoplay: false, animationData: S.lottie});
    return;
  }
  if (k === 'illus') {
    h += `<div id="art" style="position:absolute;left:${u*1.2}px;right:${u*1.2}px;top:${u*1}px;bottom:${u*4.4}px">${S.svg}</div>
      <div class="t" id="title" style="position:absolute;inset-inline:${u*1.2}px;bottom:${u*1}px;text-align:center;font-size:${u*2}px"></div>`;
  } else if (k === 'checklist') {
    h += S.items.map((it,i)=>`<div class="row" id="ck${i}" style="right:${u*1.4}px;left:${u*1.4}px;top:${u*(1.1+i*3.1)}px">
      <svg width="${u*2.4}" height="${u*2.4}" viewBox="0 0 24 24" style="flex:none"><circle cx="12" cy="12" r="11" fill="var(--accent)"/>
      <path id="cm${i}" d="M7 12.5l3.2 3.2L17 9" fill="none" stroke="var(--bg)" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round" stroke-dasharray="16" stroke-dashoffset="16"/></svg>
      <div class="t" style="font-size:${u*1.9}px">${it}</div></div>`).join('');
  } else if (k === 'vs') {
    h += `<div class="t" id="va" style="position:absolute;right:${u*1}px;width:38%;top:calc(50% - ${u*1.5}px);text-align:center;font-size:${u*2.2}px">${S.items[0]}</div>
      <div class="t" id="vb" style="position:absolute;left:${u*1}px;width:38%;top:calc(50% - ${u*1.5}px);text-align:center;font-size:${u*2.2}px;opacity:.75">${S.items[1]}</div>
      <div class="badge" id="vsb" style="position:absolute;left:calc(50% - ${u*1.8}px);top:calc(50% - ${u*1.8}px);width:${u*3.6}px;height:${u*3.6}px;font-weight:900;font-size:${u*1.4}px;direction:ltr">VS</div>`;
  } else if (k === 'clock') {
    const R = u*3.2, c = R + u/2;
    h += `<svg width="${c*2}" height="${c*2}" style="position:absolute;right:${u*1.2}px;top:calc(50% - ${c}px)">
      <circle cx="${c}" cy="${c}" r="${R}" fill="none" stroke="var(--accent)" stroke-width="${u*.42}"/>
      ${[...Array(12)].map((_,i)=>`<line x1="${c}" y1="${c-R+u*.55}" x2="${c}" y2="${c-R+u*(i%3?0.9:1.25)}" stroke="var(--ink)" stroke-width="${u*.17}" stroke-linecap="round" transform="rotate(${i*30} ${c} ${c})"/>`).join('')}
      <line id="hh" x1="${c}" y1="${c}" x2="${c}" y2="${c-R*.5}" stroke="var(--ink)" stroke-width="${u*.36}" stroke-linecap="round"/>
      <line id="mh" x1="${c}" y1="${c}" x2="${c}" y2="${c-R*.78}" stroke="var(--accent)" stroke-width="${u*.24}" stroke-linecap="round"/>
      <circle cx="${c}" cy="${c}" r="${u*.4}" fill="var(--accent)"/></svg>
      <div class="t" id="title" style="position:absolute;right:${c*2+u*2.2}px;left:${u}px;top:calc(50% - ${u*1.4}px);font-size:${u*2.1}px"></div>`;
  } else if (k === 'keyword') {
    h += `<div class="row" id="row" style="inset:${full?'auto':'0'} ${u*1.2}px ${full?'auto':'0'};${full?`top:${S.cy-u*3}px;height:${u*6}px;`:''}">
      <div class="badge" id="badge" style="width:${u*(S.svg?5.4:3.6)}px;height:${u*(S.svg?5.4:3.6)}px;padding:${u*(S.svg?.85:.75)}px">${S.icon_svg}</div>
      <div><div class="t" id="title" style="font-size:${u*2.2}px"></div><div id="ul" style="height:${u*.32}px;width:0;background:var(--accent);border-radius:9px;margin-top:${u*.35}px"></div></div></div>`;
  } else if (k === 'meter' && full) {
    h += `<div class="badge" id="badge" style="position:absolute;left:calc(50% - ${u*3}px);top:${S.cy-u*13.5}px;width:${u*6}px;height:${u*6}px;padding:${u*1.2}px">${S.icon_svg}</div>
      <div class="t" id="title" style="position:absolute;inset-inline:${u*2}px;top:${S.cy-u*6.2}px;text-align:center;font-size:${u*2.8}px;text-wrap:balance"></div>
      <div class="track" id="track" style="position:absolute;inset-inline:${u*3}px;top:${S.cy+u*2.6}px;height:${u*1.8}px"><div class="fill" id="fill" style="width:0"></div></div>
      <div class="l" id="lvl" style="position:absolute;inset-inline:${u*3}px;top:${S.cy+u*5.2}px;font-size:${u*2.2}px;display:flex;justify-content:space-between">
        <span id="lname" style="color:var(--accent);font-weight:800"></span><span id="pct" dir="ltr"></span></div>`;
  } else if (k === 'meter') {
    h += `<div class="row" style="top:${u*1}px;inset-inline:${u*1.4}px"><div class="badge" id="badge" style="width:${u*2.8}px;height:${u*2.8}px;padding:${u*.6}px">${S.icon_svg}</div>
      <div class="t" id="title" style="font-size:${u*1.9}px"></div></div>
      <div class="track" id="track" style="position:absolute;inset-inline:${u*1.4}px;top:${u*5.2}px;height:${u*1.2}px"><div class="fill" id="fill" style="width:0"></div></div>
      <div class="l" id="lvl" style="position:absolute;inset-inline:${u*1.4}px;top:${u*7}px;font-size:${u*1.4}px;display:flex;justify-content:space-between">
        <span id="lname" style="color:var(--accent);font-weight:800"></span><span id="pct" dir="ltr"></span></div>`;
  } else if (k === 'counter') {
    const R = u*(full?7:3.4);
    h += `<svg id="ring" width="${R*2+u}" height="${R*2+u}" style="position:absolute;${full?`left:calc(50% - ${R+u/2}px);top:${S.cy-R*1.5}px`:`right:${u*1}px;top:calc(50% - ${R+u/2}px)`}">
      <circle cx="${R+u/2}" cy="${R+u/2}" r="${R}" stroke="var(--soft)" stroke-width="${u*.6}" fill="none"/>
      <circle id="arc" cx="${R+u/2}" cy="${R+u/2}" r="${R}" stroke="var(--accent)" stroke-width="${u*.6}" fill="none" stroke-linecap="round" transform="rotate(-90 ${R+u/2} ${R+u/2})" stroke-dasharray="${2*Math.PI*R}" stroke-dashoffset="${2*Math.PI*R}"/></svg>
      <div class="t" id="num" dir="ltr" style="position:absolute;${full?`left:0;right:0;text-align:center;top:${S.cy-R*1.5+R-u*2}px;font-size:${u*4}px`:`right:${u*1.5}px;width:${R*2}px;text-align:center;top:calc(50% - ${u*1.6}px);font-size:${u*2.6}px`};color:var(--accent)"></div>
      <div class="t" id="title" style="position:absolute;${full?`left:${u}px;right:${u}px;text-align:center;top:${S.cy+R*0.7}px;font-size:${u*2.2}px`:`right:${R*2+u*2.6}px;left:${u}px;top:calc(50% - ${u*1.4}px);font-size:${u*1.9}px`}"></div>`;
  } else if (k === 'bars') {
    const z = full ? 1.7 : 1, top0 = full ? S.cy - u*4 : u;
    h += S.items.map((it,i)=>`<div class="t" id="bl${i}" style="position:absolute;inset-inline:${u*1.4*z}px;top:${top0+u*z*i*3.8}px;font-size:${u*1.5*z}px">${it.label}</div>
      <div class="track" style="position:absolute;inset-inline:${u*1.4*z}px;top:${top0+u*z*(2.1+i*3.8)}px;height:${u*1.1*z}px"><div class="fill" id="bf${i}" style="width:0;${i?'opacity:.55':''}"></div></div>`).join('');
  } else if (k === 'timeline') {
    const n = S.items.length;
    const pad = u*5;
    h += `<div style="position:absolute;inset-inline:${pad}px;top:${u*2.6}px;height:${u*.25}px;background:var(--soft)"><div id="line" style="height:100%;width:0;background:var(--accent);margin-inline-start:auto"></div></div>` +
      S.items.map((it,i)=>`<div id="st${i}" style="position:absolute;top:${u*1.5}px;right:calc(${pad}px + ${i/(Math.max(1,n-1))} * (100% - ${pad*2}px) - ${u*4.5}px);width:${u*9}px;display:flex;flex-direction:column;align-items:center">
        <div style="width:${u*2.2}px;height:${u*2.2}px;border-radius:50%;background:var(--accent);color:var(--bg);display:grid;place-items:center;font-weight:800;font-size:${u*1.2}px">${(i+1).toLocaleString('ar-EG')}</div>
        <div class="l" style="font-size:${u*1.15}px;margin-top:${u*.4}px;text-align:center;line-height:1.3">${it}</div></div>`).join('');
  } else if (k === 'lower_third') {
    h += `<div id="lbar" style="position:absolute;right:${u}px;top:${u}px;bottom:${u}px;width:${u*.5}px;background:var(--accent);border-radius:9px"></div>
      <div class="t" id="title" style="position:absolute;right:${u*2.2}px;top:calc(50% - ${u*1.4}px);font-size:${u*2.2}px"></div>`;
  }
  r.innerHTML = h;
  if (document.getElementById('title')) S.tw = words(document.getElementById('title'), S.title || '');
  prepDraw();
}
// شخبطة الماركر: مسارات على قد الصندوق وعلى قد مكان الوش (side = الوش ناحية إيه من الصندوق)
function annot(type, w, h, side, face, u){
  const sw = u*.4, W = (d, c='#fff', extra='') => `<path d="${d}" fill="none" stroke="${c}" stroke-width="${sw}" stroke-linecap="round" stroke-linejoin="round" ${extra}/>`;
  const dir = side === 'right' ? -1 : 1;   // الصندوق يمين الوش ← السهم بيشاور شمال
  const fx = side === 'right' ? 0 : w, fy = h*0.55;
  if (type === 'arrow_to_me') {
    const x0 = side === 'right' ? w*.92 : w*.08, y0 = h*.18, x1 = side === 'right' ? w*.1 : w*.9, y1 = h*.62;
    const cx = (x0+x1)/2, cy = y0 - h*.05;
    const a = Math.atan2(y1-cy, x1-cx), L = u*2.2;
    return W(`M${x0} ${y0} Q${cx} ${cy} ${x1} ${y1}`) + W(`M${x1 - L*Math.cos(a-0.5)} ${y1 - L*Math.sin(a-0.5)} L${x1} ${y1} L${x1 - L*Math.cos(a+0.5)} ${y1 - L*Math.sin(a+0.5)}`);
  }
  if (type === 'circle_me') {
    const cx = w/2, cy = h/2, rx = w*.44, ry = h*.44; let d = '';
    for (let i = 0; i <= 56; i++) { const t = -Math.PI*.6 + i/56*Math.PI*2.15, k = 1 + 0.04*Math.sin(i*.7); d += `${i?'L':'M'}${(cx + Math.cos(t)*rx*k).toFixed(1)} ${(cy + Math.sin(t)*ry*k).toFixed(1)}`; }
    return W(d, '#ffd23f');
  }
  if (type === 'sparkles') {
    const star = (x, y, r) => `M${x} ${y-r} Q${x} ${y} ${x+r} ${y} Q${x} ${y} ${x} ${y+r} Q${x} ${y} ${x-r} ${y} Q${x} ${y} ${x} ${y-r}`;
    return W(star(w*.5, h*.35, u*2.2), '#ffd23f') + W(star(w*.2, h*.7, u*1.3)) + W(star(w*.8, h*.72, u*1.5));
  }
  if (type === 'check') return W(`M${w*.25} ${h*.55} L${w*.43} ${h*.75} L${w*.78} ${h*.25}`, '#5be38f');
  if (type === 'cross') return W(`M${w*.28} ${h*.25} L${w*.72} ${h*.75}`, '#ff5a5a') + W(`M${w*.72} ${h*.25} L${w*.28} ${h*.75}`, '#ff5a5a');
  if (type === 'heart') { const x = w/2, y = h*.32, r = Math.min(w, h)*.24;
    return W(`M${x} ${y+r*1.6} C${x-r*2.2} ${y+r*.4} ${x-r*1.2} ${y-r*1.2} ${x} ${y-r*.1} C${x+r*1.2} ${y-r*1.2} ${x+r*2.2} ${y+r*.4} ${x} ${y+r*1.6}`, '#ff4d6d'); }
  if (type === 'lightning') return W(`M${w*.58} ${h*.08} L${w*.36} ${h*.52} L${w*.55} ${h*.52} L${w*.4} ${h*.92} L${w*.68} ${h*.42} L${w*.48} ${h*.42} Z`, '#ffd23f');
  if (type === 'question' || type === 'exclaim') {
    const q = (x, y, r) => type === 'question'
      ? W(`M${x-r} ${y-r*.6} Q${x-r} ${y-r*1.6} ${x} ${y-r*1.6} Q${x+r} ${y-r*1.6} ${x+r} ${y-r*.7} Q${x+r} ${y} ${x} ${y+r*.25} L${x} ${y+r*.75}`) + W(`M${x} ${y+r*1.45} L${x} ${y+r*1.5}`)
      : W(`M${x} ${y-r*1.6} L${x} ${y+r*.6}`) + W(`M${x} ${y+r*1.4} L${x} ${y+r*1.45}`);
    return q(w*.5, h*.5, u*2) + q(w*.22, h*.62, u*1.1) + q(w*.8, h*.6, u*1.2);
  }
  return '';
}
// الأيقونة/الرسمة بتترسم خط بخط بسرعة، وبعدين الألوان بتتملا (زي السبورة بس أسرع)
function prepDraw(){
  const host = document.querySelector('#art svg, .badge svg'); S.draw = [];
  if (S.kind === 'annotate') { for (const el of host.querySelectorAll('path')) { const L = el.getTotalLength(); el.style.strokeDasharray = `${L} ${L}`; el.style.strokeDashoffset = L; S.draw.push({el, Ls: L, filled: false}); } return; }
  if (!host) return;
  for (const el of host.querySelectorAll('path,circle,line,polyline,polygon,rect,ellipse')) {
    if (el.closest('defs,clipPath,mask')) continue;
    let L = 0; try { L = el.getTotalLength(); } catch(e) {}
    if (!(L > 0)) continue;
    const cs = getComputedStyle(el), filled = cs.fill && cs.fill !== 'none' && !/rgba\(0, 0, 0, 0\)/.test(cs.fill);
    el.style.vectorEffect = 'non-scaling-stroke';
    const m = el.getCTM(), Ls = L * (m ? Math.hypot(m.a, m.b) : 1);
    if (S.kind === 'illus') { el.style.stroke = 'var(--ink)'; el.style.strokeWidth = (S.u*.09)+'px'; }
    if (S.kind === 'visual') { el.style.stroke = '#2b2d42'; el.style.strokeWidth = (S.u*.2)+'px'; }
    if (S.kind === 'doodle') { el.style.stroke = '#fff'; el.style.strokeWidth = (S.u*.36)+'px'; el.style.strokeLinecap = 'round'; el.style.strokeLinejoin = 'round';
      if (filled) el.style.fill = '#fff'; }
    el.style.strokeDasharray = `${Ls} ${Ls}`; el.style.strokeDashoffset = Ls;
    if (filled) el.style.fillOpacity = 0;
    S.draw.push({el, Ls, filled});
  }
}
function render(t){
  const r = document.getElementById('root'), u = S.u, k = S.kind;
  const tin = seg(t, 0, %ENTER%), tout = seg(t, D - %EXIT%, D);
  r.style.opacity = (S.mode === 'overlay' ? eo(tin) : 1) * (1 - eo(tout));
  if (S.mode === 'overlay') {
    // الدخول بيتغيّر من جرافيك للتاني: pop / slide (من اليمين) / wipe (بيتكشف من اليمين) / drop (من فوق)
    const a = S.enter || 'pop', o = eo(tout);
    if (a === 'slide') r.style.transform = `translateX(${(1-eo(tin))*u*7 - o*u*4}px)`;
    else if (a === 'drop') r.style.transform = `translateY(${-(1-back(tin))*u*2.6 - o*u*1}px)`;
    else if (a === 'wipe') { r.style.clipPath = `inset(0 0 0 ${(1-eo(seg(t,0,%ENTER%*1.4)))*100}%)`; r.style.transform = `translateY(${-o*u}px)`; }
    else r.style.transform = `translateY(${(1-eo(tin))*u*1.6 - o*u*1.0}px) scale(${0.94+0.06*back(tin)})`;
  } else r.style.transform = '';
  const spin = document.getElementById('spin'); if (spin) spin.style.transform = `rotate(${t*28}deg)`;
  ['b1','b2'].forEach((id,i)=>{ const b = document.getElementById(id); if (b) b.style.transform = `translate(${Math.sin(t*(0.6+i*.3))*u*1.2}px, ${Math.cos(t*(0.5+i*.2))*u*1.4}px) scale(${1+0.06*Math.sin(t*(1+i))})`; });
  const hl = document.getElementById('hl'); if (hl) hl.style.transform = `scaleX(${eo(seg(t, .55, 1.05))})`;
  // حركة خفيفة مستمرة في الخلفية (الكادر عمره ما يقف ثابت تمامًا): الإضاءة بتتحرك ببطء
  const full = r.querySelector('.full'); if (full) full.style.backgroundPosition = `${50 + 8*Math.sin(t*0.9)}% ${25 + 6*Math.cos(t*0.7)}%`, full.style.backgroundSize = '140% 140%';
  const panel = document.getElementById('panel'); if (panel) panel.style.boxShadow = `0 ${u*.4}px ${u*(1.4+0.15*Math.sin(t*2))}px rgba(0,0,0,.28)`;
  const badge = document.getElementById('badge');
  if (badge) { const b = back(seg(t, .15, .6)); badge.style.transform = `scale(${b * (1 + 0.025*Math.sin(t*3.2))}) rotate(${(1-b)*-25}deg)`; }
  if (S.tw) S.tw.forEach((w,i)=>{ const a = eo(seg(t, .1 + i*.08, .26 + i*.08)); w.style.opacity = a; w.style.transform = `translateY(${(1-a)*u*.7}px)`; });
  const ul = document.getElementById('ul'); if (ul) ul.style.width = (eo(seg(t, .3 + (S.tw||[]).length*.14, .85 + (S.tw||[]).length*.14))*100)+'%';
  if (k === 'meter') {
    const p = eo(seg(t, .7, 1.9)) * S.level; document.getElementById('fill').style.width = (p*100)+'%';
    document.getElementById('pct').textContent = Math.round(p*100).toLocaleString('ar-EG') + '٪';
    const ln = document.getElementById('lname'); ln.textContent = S.level_name; const a = back(seg(t, 1.8, 2.2)); ln.style.opacity = clamp(a); ln.style.display='inline-block'; ln.style.transform = `scale(${0.6+0.4*a})`;
  }
  if (k === 'counter') {
    const p = eo(seg(t, .3, 1.6)); document.getElementById('num').textContent = Math.round(S.value * p).toLocaleString('ar-EG');
    const arc = document.getElementById('arc'); if (arc) { const L = +arc.getAttribute('stroke-dasharray'); arc.setAttribute('stroke-dashoffset', L*(1-p)); }
    if (S.mode === 'pip') { const n = document.getElementById('num'); n.style.transform = `scale(${0.7+0.3*back(seg(t,.2,.7))})`; }
  }
  if (k === 'bars') S.items.forEach((it,i)=>{ document.getElementById('bf'+i).style.width = (eo(seg(t, .5+i*.35, 1.6+i*.35))*it.v*100)+'%'; });
  if (k === 'timeline') {
    const n = S.items.length; const ln = document.getElementById('line'); if (ln) ln.style.width = (eo(seg(t, .3, .3+n*.5))*100)+'%';
    S.items.forEach((it,i)=>{ const a = back(seg(t, .3+i*.5, .7+i*.5)); const el = document.getElementById('st'+i); el.style.opacity = clamp(a); el.style.transform = `scale(${0.5+0.5*a})`; });
  }
  if (S.draw && S.draw.length) {
    const p = eo(seg(t, .08, k === 'illus' ? .85 : .55)), f = seg(t, k === 'illus' ? .6 : .4, k === 'illus' ? 1.1 : .75);
    S.draw.forEach(d => { d.el.style.strokeDashoffset = d.Ls * (1 - p); d.el.style.strokeOpacity = p > 0.002 ? 1 : 0; if (d.filled) d.el.style.fillOpacity = f; });
  }
  // حركة على قد الشكل بعد ما يترسم: قلب بينبض، جرس بيتهز، موبايل بيرن، لمبة بتنور، وغير كده طفو خفيف
  const idl = document.querySelector('.badge svg, #art svg');
  if (idl && t > .6) { const q = t - .6, I = S.idle || 'float';
    idl.style.transformOrigin = I === 'swing' ? '50% 8%' : '50% 50%';
    idl.style.transform = I === 'beat' ? `scale(${1 + .09*Math.max(0, Math.sin(q*7))})` : I === 'swing' ? `rotate(${12*Math.sin(q*9)*Math.exp(-q*1.2)}deg)`
      : I === 'buzz' ? `translateX(${(Math.sin(q*60)*S.u*.12)*(Math.sin(q*3)>0?1:0)}px)` : I === 'spin' ? `rotate(${q*90}deg)` : `translateY(${Math.sin(q*3)*S.u*.15}px)`;
    if (I === 'glow') idl.style.filter = `drop-shadow(0 0 ${S.u*(.3+.3*Math.sin(q*5))}px var(--accent))`; }
  if (k === 'visual') {
    const vb = document.getElementById('vb'), a = back(seg(t, 0, .38)), o = eo(seg(t, D - .25, D));
    vb.style.transform = `scale(${a * (1 - .25*o)}) rotate(${(1-a)*-14}deg) translateY(${Math.sin(t*2.2)*S.u*.18}px)`; vb.style.opacity = 1 - o;
    const ring = document.querySelector('#ring circle'), L = +ring.getAttribute('stroke-dasharray'); ring.setAttribute('stroke-dashoffset', L*(1 - eo(seg(t, .15, .7))));
    const art = document.getElementById('art'), ia = back(seg(t, .1, .48)); art.style.transform = `scale(${ia})`;
    [0,1,2].forEach(i => { const d = document.getElementById('dt'+i), ang = t*(1.4 + i*.5) + i*2.1, rr = S.R*(1.05 + i*.06);
      d.style.transform = `translate(${Math.cos(ang)*rr - 3}px, ${Math.sin(ang)*rr - 3}px)`; d.style.opacity = clamp(seg(t, .4 + i*.1, .7 + i*.1)) * (1 - o); });
  }
  if (k === 'sticker' && S.anim) {
    const L = Math.max(1, S.lottie.op - S.lottie.ip); S.anim.goToAndStop(S.lottie.ip + ((t * S.lottie.fr) % L), true);
    const a = back(seg(t, 0, .32)); r.style.transform = `scale(${a}) rotate(${(1-a)*-25 + 4*Math.sin(t*5)}deg)`; r.style.clipPath = 'none';
  }
  if (k === 'checklist') S.items.forEach((it,i)=>{ const a = eo(seg(t, .15+i*.32, .4+i*.32)), el = document.getElementById('ck'+i);
    el.style.opacity = a; el.style.transform = `translateX(${(1-a)*S.u*3}px)`; document.getElementById('cm'+i).setAttribute('stroke-dashoffset', 16*(1-eo(seg(t, .35+i*.32, .6+i*.32)))); });
  if (k === 'vs') { const a = eo(seg(t,.05,.35)), b = eo(seg(t,.25,.55)), c = back(seg(t,.45,.75));
    document.getElementById('va').style.transform = `translateX(${(1-a)*S.u*5}px)`; document.getElementById('va').style.opacity = a;
    document.getElementById('vb').style.transform = `translateX(${-(1-b)*S.u*5}px)`; document.getElementById('vb').style.opacity = b*.75;
    document.getElementById('vsb').style.transform = `scale(${c}) rotate(${(1-c)*180}deg)`; }
  if (k === 'clock') { const sp = eo(seg(t, 0, 1.4)); const cx = document.getElementById('mh').getAttribute('x1'), cy = document.getElementById('mh').getAttribute('y1');
    document.getElementById('mh').setAttribute('transform', `rotate(${sp*720 + t*30} ${cx} ${cy})`); document.getElementById('hh').setAttribute('transform', `rotate(${sp*60 + t*2.5} ${cx} ${cy})`); }
  if (k === 'lower_third') { const a = eo(seg(t, 0, .5)); document.getElementById('lbar').style.transform = `scaleY(${a})`; }
}
"""


def render(specs: list[dict], W: int, H: int, fps: int, out_root: Path, mood: str) -> list[dict]:
    """كل جرافيك ← فولدر PNG (فريم لكل 1/fps) + مكانه ومقاسه. overlay: صندوق الجرافيك بس (شفاف)؛ explainer/inset: الكادر كله؛ split: النص اللي تحت."""
    from playwright.sync_api import sync_playwright
    pal = PALETTES.get(mood, PALETTES["clean"])
    css = (f"@font-face{{font-family:Card;src:url(data:font/ttf;base64,{_font('Alexandria-Variable.ttf')});font-weight:100 900}}"
           f":root{{{';'.join(f'--{k}:{v}' for k, v in pal.items())}}}" + CSS)
    js = JS.replace("%ENTER%", str(ENTER)).replace("%EXIT%", str(EXIT))
    lot = (ASSETS / "vendor" / "lottie_svg.min.js").read_text(encoding="utf-8") if any(x.get("kind") == "sticker" for x in specs) else ""
    out = []
    with sync_playwright() as p:
        b = p.chromium.launch()
        for k, sp in enumerate(specs):
            mode = sp["mode"]
            if mode == "overlay":
                r = sp["rect"]
                w, h = int(round((r["right"] - r["left"]) * W / 2)) * 2, int(round((r["bottom"] - r["top"]) * H / 2)) * 2
                x, y = int(r["left"] * W), int(r["top"] * H)
            elif mode == "split":
                w, h, x, y = W, H // 2, 0, H // 2
            else:
                w, h, x, y = W, H, 0, 0
            u = round(W / 30) if sp.get("kind") in ("doodle", "annotate", "visual") else round(min(w, H * 0.6) / 30) if mode == "overlay" else round(W / 30)   # الماركر على قد الكادر
            spec = {**{kk: v for kk, v in sp.items() if kk not in ("rect",)}, "u": u, "icon_svg": sp.get("svg") or _icon_svg(sp.get("icon") or "sparkles"), "H": H,
                    "cy": int(H * 0.42) if mode == "explainer" else int(h * 0.16) if mode == "split" else int(h * 0.5)}   # split: المحتوى في أول النص التحتاني (50–60%)، فوق الترجمة
            if mode == "inset":   # المحتوى تحت المتكلم الصغير (فوق) وفوق الترجمة
                spec["cy"] = int(H * 0.47)
            if mode == "pip":     # الشرح تحت دايرة صورتك وفوق الترجمة
                spec["pip"] = sp["pip"]
                spec["cy"] = sp["pip"][1] + sp["pip"][2] + int(H * 0.04)
            spec["bw"], spec["bh"] = w, h
            pg = b.new_page(viewport={"width": w, "height": h})
            pg.set_content(f"<html><head><style>{css}</style></head><body><div id='root'></div><script>{lot}</script><script>{js}</script></body></html>")
            pg.evaluate("document.fonts.ready")
            dur = sp["end"] - sp["start"]
            pg.evaluate("([s, d]) => setup(s, d)", [spec, dur])
            d = out_root / f"g{k + 1:02d}"
            d.mkdir(parents=True, exist_ok=True)
            n = int(round(dur * fps))
            for i in range(n):
                pg.evaluate("t => render(t)", i / fps)
                pg.screenshot(path=str(d / f"f_{i + 1:05d}.png"), omit_background=(mode == "overlay"))
            pg.close()
            extra = {}
            if mode == "pip":
                extra["mask"] = str(mask_png(sp["pip"][2], d / "pip_mask.png"))
            out.append({**sp, **extra, "dir": str(d), "frames": n, "x": x, "y": y, "w": w, "h": h})
        b.close()
    return out


def spec_json(g: dict) -> str:
    return json.dumps({k: v for k, v in g.items() if k not in ("dir",)}, ensure_ascii=False)
