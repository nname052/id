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
ENTER, EXIT = 0.45, 0.35
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
    # طريقة العرض
    rich = out["kind"] in ("counter", "meter", "bars", "timeline")
    forced = (brief.get("modes") or {}).get(idea["id"])
    if forced:
        out["mode"], out["mode_why"] = forced, "إنت طلبتها"
    elif rich and dur >= EXPLAIN_MIN and speaker:
        out["mode"], out["mode_why"] = "explainer", f"شرح طويل ({dur:.1f} ث) فيه {out['why']}"
    elif out["kind"] == "bars" and speaker:
        out["mode"], out["mode_why"] = "split", "مقارنة: نص للمتكلم ونص للأعمدة"
    else:
        out["mode"], out["mode_why"] = "overlay", "فكرة قصيرة: فوق الفيديو في مساحة فاضية"
    if not speaker and out["mode"] in ("explainer", "inset"):
        out["mode"], out["mode_why"] = "overlay", "المصدر مفيهوش متكلم يتفصل: explainer/inset مقفولين"
    out["idea"] = idea["id"]
    return out


# ---------- 2) المكان ----------
SIZES = {"keyword": (0.80, 0.135), "counter": (0.66, 0.17), "meter": (0.80, 0.18), "bars": (0.80, 0.20), "timeline": (0.84, 0.125), "lower_third": (0.70, 0.11)}


def place(kind: str, occ: np.ndarray, aspect: str) -> dict | None:
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
                # الأفضل: أقل تداخل، وبعدين أقرب لمنتصف العرض، وأقرب لفوق
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
  if (k === 'keyword') {
    h += `<div class="row" id="row" style="inset:${full?'auto':'0'} ${u*1.2}px ${full?'auto':'0'};${full?`top:${S.cy-u*3}px;height:${u*6}px;`:''}">
      <div class="badge" id="badge" style="width:${u*3.6}px;height:${u*3.6}px;padding:${u*.75}px">${S.icon_svg}</div>
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
}
function render(t){
  const r = document.getElementById('root'), u = S.u, k = S.kind;
  const tin = seg(t, 0, %ENTER%), tout = seg(t, D - %EXIT%, D);
  r.style.opacity = (S.mode === 'overlay' ? eo(tin) : 1) * (1 - eo(tout));
  r.style.transform = S.mode === 'overlay' ? `translateY(${(1-eo(tin))*u*1.6 - eo(tout)*u*1.0}px) scale(${0.94+0.06*back(tin)})` : '';
  // حركة خفيفة مستمرة في الخلفية (الكادر عمره ما يقف ثابت تمامًا): الإضاءة بتتحرك ببطء
  const full = r.querySelector('.full'); if (full) full.style.backgroundPosition = `${50 + 8*Math.sin(t*0.9)}% ${25 + 6*Math.cos(t*0.7)}%`, full.style.backgroundSize = '140% 140%';
  const panel = document.getElementById('panel'); if (panel) panel.style.boxShadow = `0 ${u*.4}px ${u*(1.4+0.15*Math.sin(t*2))}px rgba(0,0,0,.28)`;
  const badge = document.getElementById('badge');
  if (badge) { const b = back(seg(t, .15, .6)); badge.style.transform = `scale(${b * (1 + 0.025*Math.sin(t*3.2))}) rotate(${(1-b)*-25}deg)`; }
  if (S.tw) S.tw.forEach((w,i)=>{ const a = eo(seg(t, .12 + i*.14, .32 + i*.14)); w.style.opacity = a; w.style.transform = `translateY(${(1-a)*u*.7}px)`; });
  const ul = document.getElementById('ul'); if (ul) ul.style.width = (eo(seg(t, .3 + (S.tw||[]).length*.14, .85 + (S.tw||[]).length*.14))*100)+'%';
  if (k === 'meter') {
    const p = eo(seg(t, .7, 1.9)) * S.level; document.getElementById('fill').style.width = (p*100)+'%';
    document.getElementById('pct').textContent = Math.round(p*100).toLocaleString('ar-EG') + '٪';
    const ln = document.getElementById('lname'); ln.textContent = S.level_name; const a = back(seg(t, 1.8, 2.2)); ln.style.opacity = clamp(a); ln.style.display='inline-block'; ln.style.transform = `scale(${0.6+0.4*a})`;
  }
  if (k === 'counter') {
    const p = eo(seg(t, .3, 1.6)); document.getElementById('num').textContent = Math.round(S.value * p).toLocaleString('ar-EG');
    const arc = document.getElementById('arc'), L = +arc.getAttribute('stroke-dasharray'); arc.setAttribute('stroke-dashoffset', L*(1-p));
  }
  if (k === 'bars') S.items.forEach((it,i)=>{ document.getElementById('bf'+i).style.width = (eo(seg(t, .5+i*.35, 1.6+i*.35))*it.v*100)+'%'; });
  if (k === 'timeline') {
    const n = S.items.length; document.getElementById('line').style.width = (eo(seg(t, .3, .3+n*.5))*100)+'%';
    S.items.forEach((it,i)=>{ const a = back(seg(t, .3+i*.5, .7+i*.5)); const el = document.getElementById('st'+i); el.style.opacity = clamp(a); el.style.transform = `scale(${0.5+0.5*a})`; });
  }
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
            u = round(min(w, H * 0.6) / 30) if mode == "overlay" else round(W / 30)
            spec = {**{kk: v for kk, v in sp.items() if kk not in ("rect",)}, "u": u, "icon_svg": _icon_svg(sp.get("icon") or "sparkles"),
                    "cy": int(H * 0.42) if mode == "explainer" else int(h * 0.16) if mode == "split" else int(h * 0.5)}   # split: المحتوى في أول النص التحتاني (50–60%)، فوق الترجمة
            if mode == "inset":   # المحتوى تحت المتكلم الصغير (فوق) وفوق الترجمة
                spec["cy"] = int(H * 0.47)
            pg = b.new_page(viewport={"width": w, "height": h})
            pg.set_content(f"<html><head><style>{css}</style></head><body><div id='root'></div><script>{js}</script></body></html>")
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
            out.append({**sp, "dir": str(d), "frames": n, "x": x, "y": y, "w": w, "h": h})
        b.close()
    return out


def spec_json(g: dict) -> str:
    return json.dumps({k: v for k, v in g.items() if k not in ("dir",)}, ensure_ascii=False)
