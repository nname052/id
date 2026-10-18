"""الموشن جرافيك في المونتاج: كروت متحركة طالعة من الكلام نفسه (أرقام، أسماء ومصطلحات، والفكرة الأساسية لكل جزء).

- كل كارت مربوط بجملة اتقالت فعلًا (النص بتاعه كلمات متتالية من الكلام، وبيظهر وقت ما بتتقال). أي كارت مالوش جملة بيترفض.
- ستايل واحد لكل الكروت: خط واحد (Alexandria)، نظام ألوان واحد (حسب الطلب)، وحركة دخول واحدة (طلوع + ظهور 0.35 ث، وخروج اختفاء 0.25 ث).
- كارت واحد بس على الشاشة في نفس الوقت، ومنطقة الكروت غير منطقة الترجمة (بنختار المنطقة الأهدى في الصورة: فيها تفاصيل وحركة أقل).
- الكروت بتترسم صور شفافة في Chromium (العربي بيتشكّل صح)، والحركة نفسها في FFmpeg (overlay + fade).
"""

import base64
import re
import subprocess
from pathlib import Path

import numpy as np

from ..config import FONTS
from .cuts import DANGLING, FILLERS, SAFE, SUB_POS, norm

PUNCT = re.compile(r"[،,؛;:.!?؟…]$")

ENTER, EXIT, RISE = 0.35, 0.25, 0.022   # ثواني الدخول/الخروج، والطلوع (من ارتفاع الفريم)
MIN_SHOW, MAX_SHOW, GAP = 2.2, 4.0, 0.35
BUSY_MAX = 0.25    # أهدى منطقة للكروت فيها تفاصيل+حركة أكتر من كده ← من غير كروت (تسجيل موبايل عادي: ~0.02، فيديو عليه كتابة: ~0.6)
MIN_P, MIN_WORD_P = 0.70, 0.40          # ثقة التفريغ: الكارت ما بيتعملش من كلام مش متأكدين منه (إلا لو إنت صحّحته)
PALETTES = {
    "clean": {"bg": "rgba(17,19,24,.88)", "ink": "#ffffff", "accent": "#7ee2b8", "sub": "rgba(255,255,255,.72)"},
    "bold": {"bg": "#ff5a1f", "ink": "#ffffff", "accent": "#1d1d22", "sub": "rgba(255,255,255,.85)"},
    "elegant": {"bg": "rgba(14,13,12,.9)", "ink": "#f4ead5", "accent": "#c9a45c", "sub": "rgba(244,234,213,.7)"},
    "fresh": {"bg": "rgba(255,255,255,.95)", "ink": "#13233f", "accent": "#2f6fe0", "sub": "rgba(19,35,63,.65)"},
}
# مناطق الكروت المرشحة (نسبة من الفريم). الترجمة ليها منطقتها في SAFE (تحت).
CARD_ZONES = {"9:16": {"top": {"left": 0.08, "right": 0.84, "top": 0.09, "bottom": 0.27},
                       "middle": {"left": 0.08, "right": 0.84, "top": 0.42, "bottom": 0.58}},
              "16:9": {"top": {"left": 0.06, "right": 0.62, "top": 0.07, "bottom": 0.30},
                       "lower_third": {"left": 0.06, "right": 0.62, "top": 0.50, "bottom": 0.70}}}
STANCE = ["شايف", "المهم", "السر", "لازم", "أهم", "اهم", "الحقيقة", "بصراحة", "مشكلة", "مشكله", "أبدا", "ابدا", "دايما", "عمري", "بالعكس",
          "طبيعي", "مبسوط", "مش", "محتاج", "عايز", "نفسي", "الفرق", "السبب", "لأن", "لان", "عشان", "علشان", "important", "never", "always", "because"]
NUM_WORDS = {"اتنين": 2, "اثنين": 2, "تلاته": 3, "تلاتة": 3, "ثلاثه": 3, "ثلاثة": 3, "اربعه": 4, "اربعة": 4, "خمسه": 5, "خمسة": 5, "سته": 6,
             "ستة": 6, "سبعه": 7, "سبعة": 7, "تمانيه": 8, "تمانية": 8, "ثمانية": 8, "تسعه": 9, "تسعة": 9, "عشره": 10, "عشرة": 10, "عشرين": 20,
             "تلاتين": 30, "ثلاثين": 30, "اربعين": 40, "خمسين": 50, "ستين": 60, "مية": 100, "ميه": 100, "مائة": 100, "ميتين": 200,
             "الف": 1000, "ألف": 1000, "مليون": 1000000, "two": 2, "three": 3, "four": 4, "five": 5, "ten": 10, "hundred": 100, "thousand": 1000}
UNITS = {"سنين", "سنه", "سنة", "سنوات", "شهور", "اشهر", "يوم", "ايام", "أيام", "ساعه", "ساعة", "ساعات", "دقيقه", "دقيقة", "دقايق", "مره", "مرة",
         "مرات", "جنيه", "دولار", "كيلو", "%", "في المية", "بالمية", "years", "days", "hours", "minutes", "times", "percent"}
AR_DIG = str.maketrans("0123456789", "٠١٢٣٤٥٦٧٨٩")
STOP = {norm(w) for w in ("في", "مع", "من", "على", "عن", "إلى", "الى", "و", "أو", "او", "بس", "اللي", "ده", "دي", "دول", "هو", "هي", "انا", "أنا", "انت", "إنت",
                          "احنا", "هما", "كان", "كانت", "يكون", "تكون", "ممكن", "مش", "ما", "لا", "كل", "كده", "جدا", "اوي", "يعني", "لو", "إن", "ان", "انه",
                          "إنه", "عند", "عندي", "ليا", "ليه", "بتاع", "بتاعي", "حاجة", "حاجه", "the", "a", "an", "of", "to", "in", "is", "and")}


def _clean_words(ws: list[dict]) -> list[dict]:
    """من غير حشو في الأول/الآخر، ومن غير حرف عطف/جر معلّق في الآخر."""
    ws = list(ws)
    while ws and (norm(ws[0]["word"]) in FILLERS or norm(ws[0]["word"]) in {"و", "بس", "ف", "يعني", "انا", "يا"}):
        ws.pop(0)
    while ws and (norm(ws[-1]["word"]) in FILLERS or norm(ws[-1]["word"]) in DANGLING):
        ws.pop()
    return ws


def _conf_ok(ws: list[dict], confirmed: bool) -> bool:
    if confirmed:
        return True
    ps = [w.get("p", 1.0) for w in ws]
    return bool(ps) and float(np.mean(ps)) >= MIN_P and min(ps) >= MIN_WORD_P


def _number(ws: list[dict]):
    """أول رقم متقال في الكلمات (أرقام، أو رقم بالكلام وبعده وحدة) ← (index, value)."""
    for i, w in enumerate(ws):
        t = norm(w["word"]).translate(str.maketrans("٠١٢٣٤٥٦٧٨٩", "0123456789"))
        nxt = norm(ws[i + 1]["word"]) if i + 1 < len(ws) else ""
        if re.fullmatch(r"\d+([.,]\d+)?%?", t):
            return i, t
        if t in NUM_WORDS and (nxt in {norm(u) for u in UNITS} or NUM_WORDS[t] >= 10):
            return i, str(NUM_WORDS[t])
    return None


def ideas(segments: list[dict], cues: list[dict], target: float = 5.0) -> list[dict]:
    """الأفكار الأساسية: سطور الترجمة متجمعة في أفكار حوالي target ثانية، والفكرة بتقفل بس عند نهاية جملة/عبارة أو سكتة أو قصّة
    (عمرها ما بتقفل في نص كلام). فكرة أقل من كلمتين بتنضم للي قبلها."""
    def dur(cs):
        return cs[-1]["end"] - cs[0]["start"]

    def closes(c, nxt):
        last = c["words"][-1]["word"] if c["words"] else ""
        return bool(PUNCT.search(last)) or nxt is None or nxt["start"] - c["words"][-1]["end"] >= 0.35 or nxt["segment"] != c["segment"]
    groups, cur = [], []
    for k, c in enumerate(cues):
        cur.append(c)
        nxt = cues[k + 1] if k + 1 < len(cues) else None
        if nxt is None or (dur(cur) >= target and closes(c, nxt)) or dur(cur) >= target * 1.8:
            groups.append(cur); cur = []
    if groups and len(groups) > 1 and sum(len(c["words"]) for c in groups[-1]) < 2:
        groups[-2] += groups.pop()
    out = []
    for g in groups:
        out.append({"id": f"i{len(out) + 1}", "segments": sorted({c["segment"] for c in g}), "cues": g, "start": g[0]["start"], "end": g[-1]["end"],
                    "text": " ".join(c["text"] for c in g)})
    return out




def _disp(w: str) -> str:
    return w.strip("«»\"'.,،؛;:؟?!…")


def clauses(ws: list[dict], gap: float = 0.25) -> list[list[dict]]:
    """الكلام ← عبارات كاملة: بتقف عند علامة ترقيم أو سكتة (مش في نص عبارة)."""
    out, cur = [], []
    for k, w in enumerate(ws):
        cur.append(w)
        nxt = ws[k + 1] if k + 1 < len(ws) else None
        if nxt is None or PUNCT.search(w["word"]) or nxt["start"] - w["end"] >= gap:
            out.append(cur); cur = []
    return out


LINKS = {norm(w) for w in ("مع", "و", "في", "بتاعي", "بتاعك", "بتاعنا", "بتاع", "ال")}


def topic(ws: list[dict]) -> list[dict] | None:
    """أطول سلسلة كلمات متتالية ليها معنى (ممكن بينها مع/و/في/بتاعي) تبدأ وتخلص بكلمة ليها معنى: 2–6 كلمات، ≤ 32 حرف."""
    best = None
    for i in range(len(ws)):
        if norm(ws[i]["word"]) in STOP:
            continue
        j = i
        while j + 1 < len(ws) and (norm(ws[j + 1]["word"]) not in STOP or norm(ws[j + 1]["word"]) in LINKS) and j + 1 - i < 6:
            j += 1
        while j > i and norm(ws[j]["word"]) in STOP:
            j -= 1
        run = ws[i:j + 1]
        content = [x for x in run if norm(x["word"]) not in STOP]
        if len(content) >= 2 and len(" ".join(_disp(x["word"]) for x in run)) <= 32 and (best is None or len(content) > len([x for x in best if norm(x["word"]) not in STOP])):
            best = run
    return best


def candidates(idea: dict, focus: list[str]) -> list[dict]:
    """كل كارت ممكن للفكرة دي بنوعه وسكوره. النص دايمًا كلمات متتالية اتقالت (عبارة كاملة، مش حتة من جملتين)."""
    out = []
    fset = {norm(x) for f in focus for x in f.split()}
    ws = [dict(w, cue=c["id"], edited=bool(c.get("edited"))) for c in idea["cues"] for w in c["words"]]
    for i, w in enumerate(ws):   # مصطلح طلبته في الطلب ("ركّز على: …") أو كلمة إنجليزي وسط الكلام
        if (norm(w["word"]) in fset or re.fullmatch(r"[A-Za-z][A-Za-z\-]{2,}", _disp(w["word"]))) and _conf_ok([w], w["edited"]):
            out.append({"kind": "term", "score": 3.0 if norm(w["word"]) in fset else 2.0, "title": _disp(w["word"]), "label": "",
                        "words": [w], "at": w["start"], "cue": w["cue"]})
    for cl in clauses(ws):
        confirmed = all(w["edited"] for w in cl)
        if (num := _number(cl)) is not None:
            i, val = num
            lab = _clean_words(cl[i + 1:i + 4]) or _clean_words(cl[max(0, i - 3):i])
            if _conf_ok(cl[max(0, i - 1):i + 3], confirmed):
                out.append({"kind": "number", "score": 2.5, "title": val.translate(AR_DIG), "label": " ".join(_disp(x["word"]) for x in lab),
                            "words": cl[i:i + 1] + lab, "at": cl[i]["start"], "cue": cl[i]["cue"]})
        cw = _clean_words(cl)
        txt = " ".join(_disp(x["word"]) for x in cw)
        content = [x for x in cw if norm(x["word"]) not in STOP and len(norm(x["word"])) >= 3]
        # العبارة كلها بتتحط، أو مفيش كارت (مش بنقصّ في المعنى)، ولازم فيها كلمتين ليهم معنى على الأقل (مش «في المكمل»)
        shape_ok = 2 <= len(cw) <= 7 and len(txt) <= 38 and len(content) >= 2
        if not shape_ok and len(cw) > 6:   # جملة طويلة: موضوعها (كلمات ليها معنى ومتوصلة بـ مع/و/في) كارت عنوان، من غير ما نغيّر معنى الجملة
            t = topic(cw)
            if t and _conf_ok(t, confirmed):
                out.append({"kind": "term", "score": 1.6, "title": " ".join(_disp(x["word"]) for x in t), "label": "", "words": t, "at": t[0]["start"], "cue": t[0]["cue"]})
        if shape_ok and not _conf_ok(cw, confirmed):
            idea["lowconf"] = idea.get("lowconf", 0) + 1
        if shape_ok and _conf_ok(cw, confirmed):
            score = 1.0 + 0.6 * any(norm(st) in {norm(x["word"]) for x in cw} for st in STANCE) + 0.4 * (3 <= len(cw) <= 5) \
                + 0.6 * float(np.mean([x.get("p", 1) for x in cw])) + 0.3 * bool(PUNCT.search(cl[-1]["word"]))
            out.append({"kind": "claim", "score": round(score, 3), "title": txt, "label": "", "words": cw, "at": cw[0]["start"], "cue": cw[0]["cue"]})
    return sorted(out, key=lambda x: -x["score"])


def plan(segments: list[dict], cues: list[dict], brief: dict, removed: set | None = None) -> tuple[list[dict], list[dict]]:
    """الأفكار ← كارت لكل فكرة (حسب الكثافة)، وكارت واحد بس على الشاشة. بيرجّع (cards, ideas مع سبب لو مفيش كارت).
    removed = نصوص كروت إنت شلتها (الفكرة بتاخد الاختيار اللي بعده لو موجود)."""
    if brief.get("graphics") == "off":
        return [], [{**i, "card": None, "why": "الكروت مقفولة من الطلب"} for i in ideas(segments, cues)]
    density = brief.get("density", "normal")
    show_mul = 1.15 if brief.get("pace") == "calm" else 0.9 if brief.get("pace") == "fast" else 1.0
    its = ideas(segments, cues)
    cards = []
    for it in its:
        allc = candidates(it, brief.get("focus") or [])
        cs = [c for c in allc if norm(" ".join(w["word"] for w in c["words"])) not in (removed or set()) and norm(c["title"]) not in (removed or set())]
        it["card"], it["why"] = None, None
        if not cs:
            it["why"] = ("إنت شلت الكارت ده" if allc else "الكلام هنا التفريغ مش متأكد منه (ثقة قليلة): صحّح السطر في «نص الترجمة» والكارت هيتعمل"
                         if it.get("lowconf") else "مفيش عبارة كاملة قصيرة (2–7 كلمات ليهم معنى) تنفع كارت")
            continue
        picks = cs[:2] if density == "many" and it["end"] - it["start"] >= 6 else cs[:1]
        if density == "few" and cs[0]["kind"] == "claim" and cs[0]["score"] < 2.2:
            it["why"] = "الكروت قليلة (من الطلب): الفكرة دي مالهاش رقم أو مصطلح"
            continue
        for p in picks:
            n = len(p["words"])
            show = min(MAX_SHOW, max(MIN_SHOW, (1.0 + 0.32 * n) * show_mul))
            cards.append({"idea": it["id"], "kind": p["kind"], "title": p["title"], "label": p["label"], "start": round(p["at"], 3),
                          "end": round(p["at"] + show, 3), "score": p["score"], "cue": p["cue"], "source_text": " ".join(w["word"] for w in p["words"])})
        it["card"] = True
    # كارت واحد بس في نفس الوقت: لو اتداخلوا، اللي بعده يستنى (لو لسه في وقت فكرته) أو يتشال
    cards.sort(key=lambda c: c["start"])
    kept = []
    for c in cards:
        if kept and c["start"] < kept[-1]["end"] + GAP:
            shift = kept[-1]["end"] + GAP
            it = next(i for i in its if i["id"] == c["idea"])
            if shift <= it["end"] + 0.6 and shift + MIN_SHOW <= it["end"] + 3.0:
                c["end"] = round(shift + (c["end"] - c["start"]), 3); c["start"] = round(shift, 3)
            elif c["score"] > kept[-1]["score"] + 0.5 and c["start"] - kept[-1]["start"] >= MIN_SHOW:
                kept[-1]["end"] = round(c["start"] - GAP, 3)
            else:
                it["why"] = it.get("why") or "كارت الفكرة اللي قبلها لسه على الشاشة"
                continue
        kept.append(c)
    total = sum(s["end"] - s["start"] for s in segments)
    for k, c in enumerate(kept):
        c["id"] = f"k{k + 1}"
        c["end"] = round(min(c["end"], total), 3)
    for it in its:
        it["card"] = next((c["id"] for c in kept if c["idea"] == it["id"]), None)
        it.pop("cues", None); it.pop("lowconf", None)
    return kept, its


def maps_to_speech(card: dict, cues: list[dict]) -> bool:
    """الكارت مربوط بجملة اتقالت: نصه كلمات متتالية من الكلام (ممكن تعدّي من سطر للي بعده)، وبيظهر وقت ما أول كلمة فيه بتتقال."""
    ws = [w for c in cues for w in c["words"]]
    src = [norm(w["word"]) for w in ws]
    tgt = [norm(w) for w in card["source_text"].split()]
    for i in range(len(src) - len(tgt) + 1):
        if tgt and src[i:i + len(tgt)] == tgt and abs(ws[i]["start"] - card["start"]) <= 0.6 + GAP + MAX_SHOW:
            return ws[i]["start"] - 0.05 <= card["start"] <= ws[i + len(tgt) - 1]["end"] + MAX_SHOW
    return False


# ---------- المنطقة: الأهدى في الصورة ----------
def busyness(frames: list[np.ndarray], zone: dict) -> float:
    """التفاصيل (حواف) + الحركة (فرق بين الفريمات) جوه المنطقة. أقل = أهدى = أنسب للكارت."""
    import cv2
    if not frames:
        return 0.0
    H, W = frames[0].shape[:2]
    y0, y1, x0, x1 = int(zone["top"] * H), int(zone["bottom"] * H), int(zone["left"] * W), int(zone["right"] * W)
    edges = [float((cv2.Canny(cv2.cvtColor(f[y0:y1, x0:x1], cv2.COLOR_RGB2GRAY), 60, 140) > 0).mean()) for f in frames]
    grays = [cv2.cvtColor(f[y0:y1, x0:x1], cv2.COLOR_RGB2GRAY).astype(np.float32) for f in frames]
    motion = [float(np.abs(a - b).mean()) / 255 for a, b in zip(grays, grays[1:])] or [0.0]
    return round(float(np.mean(edges)) + 2 * float(np.mean(motion)), 4)


def choose_zone(aspect: str, frames: list[np.ndarray]) -> tuple[str, dict]:
    zs = CARD_ZONES[aspect]
    scores = {k: busyness(frames, z) for k, z in zs.items()}
    best = min(scores, key=scores.get)
    return best, scores


def rects_overlap(a: dict, b: dict) -> bool:
    return a["x"] < b["x"] + b["w"] and b["x"] < a["x"] + a["w"] and a["y"] < b["y"] + b["h"] and b["y"] < a["y"] + a["h"]


# ---------- الرسم (صور شفافة) ----------
def _font(name: str) -> str:
    f = FONTS / name
    return base64.b64encode(f.read_bytes()).decode() if f.exists() else ""


SUB_FS = {"small": 0.026, "medium": 0.031, "large": 0.037}


def sub_font_px(aspect: str, H: int, size: str) -> int:
    return round(H * SUB_FS.get(size, 0.031) * (1 if aspect == "9:16" else 1.45))


def chars_per_line(aspect: str, W: int, H: int, size: str) -> int:
    """كام حرف عربي بيدخل في سطر واحد جوه المنطقة الآمنة بالخط ده (اتقاس: الحرف ~0.55 من حجم الخط في IBM Plex Arabic Bold، والخلفية واخدة حرف)."""
    safe = SAFE[aspect]
    fs = sub_font_px(aspect, H, size)
    return max(12, int(((safe["right"] - safe["left"]) * W - fs) / (0.55 * fs)))


def render(cues: list[dict], cards: list[dict], aspect: str, W: int, H: int, out_dir: Path, sub_style: dict, mood: str, card_zone: dict) -> dict:
    """الترجمة والكروت ← PNG شفافة + مكان كل واحدة. sub_style: {size, color, panel, pos}."""
    from playwright.sync_api import sync_playwright

    out_dir.mkdir(parents=True, exist_ok=True)
    safe = SAFE[aspect]
    fs = sub_font_px(aspect, H, sub_style.get("size", "medium"))
    color = {"white": "#ffffff", "yellow": "#ffd23f"}[sub_style.get("color", "white")]
    panel = sub_style.get("panel", True)
    max_w = int((safe["right"] - safe["left"]) * W)
    cx = (safe["left"] + safe["right"]) / 2 * W
    bottom = (safe["bottom"] + SUB_POS.get(sub_style.get("pos", "bottom"), 0)) * H
    pal = PALETTES.get(mood, PALETTES["clean"])
    cz = card_zone
    cw_max = int((cz["right"] - cz["left"]) * W)
    cfs = round(H * (0.034 if aspect == "9:16" else 0.05))
    sub_css = (f"#s{{display:inline-block;max-width:{max_w}px;direction:rtl;text-align:center;font:700 {fs}px/1.38 Sub,sans-serif;color:{color};"
               f"padding:{round(fs * .22)}px {round(fs * .5)}px;border-radius:{round(fs * .32)}px;box-sizing:border-box;"
               + ("background:rgba(8,8,10,.62);" if panel else f"-webkit-text-stroke:{max(2, round(fs * .07))}px rgba(0,0,0,.85);paint-order:stroke fill;"
                  "text-shadow:0 2px 6px rgba(0,0,0,.6);") + "}")
    card_css = f"""#wrap{{display:inline-block;padding:{round(cfs * .5)}px}}
      #k{{display:flex;align-items:stretch;gap:{round(cfs * .45)}px;width:max-content;max-width:{cw_max - cfs}px;direction:rtl;background:{pal['bg']};color:{pal['ink']};
        border-radius:{round(cfs * .42)}px;padding:{round(cfs * .42)}px {round(cfs * .62)}px;box-shadow:0 {round(cfs * .2)}px {round(cfs * .7)}px rgba(0,0,0,.28);
        font-family:Card,sans-serif;box-sizing:border-box}}
      #k .bar{{width:{max(5, round(cfs * .14))}px;border-radius:9px;background:{pal['accent']};flex:none}}
      #k .tx{{display:flex;flex-direction:column;justify-content:center;gap:{round(cfs * .1)}px}}
      #k .t{{font-weight:800;font-size:{cfs}px;line-height:1.3;text-wrap:balance}}
      #k.number .t{{font-size:{round(cfs * 2.1)}px;line-height:1.05;color:{pal['accent'] if mood != 'bold' else pal['ink']}}}
      #k.term .t{{color:{pal['accent'] if mood != 'bold' else pal['ink']}}}
      #k .l{{font-weight:600;font-size:{round(cfs * .62)}px;line-height:1.35;color:{pal['sub']};text-wrap:balance}}"""
    css = (f"@font-face{{font-family:Sub;src:url(data:font/ttf;base64,{_font('IBMPlexSansArabic-Bold.ttf')})}}"
           f"@font-face{{font-family:Card;src:url(data:font/ttf;base64,{_font('Alexandria-Variable.ttf')});font-weight:100 900}}"
           f"html,body{{margin:0;background:transparent}}{sub_css}{card_css}")
    subs_out, cards_out = [], []
    with sync_playwright() as p:
        b = p.chromium.launch()
        pg = b.new_page(viewport={"width": W, "height": H})
        pg.set_content(f"<html><head><style>{css}</style></head><body><div id='s'></div><div id='wrap'><div id='k'></div></div></body></html>")
        pg.evaluate("document.fonts.ready")
        for k, c in enumerate(cues):
            pg.evaluate("t => { document.getElementById('s').textContent = t; }", c["text"])
            el = pg.locator("#s")
            box = el.bounding_box()
            png = out_dir / f"sub_{k + 1:03d}.png"
            el.screenshot(path=str(png), omit_background=True)
            w, h = round(box["width"]), round(box["height"])
            x, y = round(cx - w / 2), round(bottom - h)
            inside = x >= safe["left"] * W - 1 and x + w <= safe["right"] * W + 1 and y >= safe["top"] * H - 1 and y + h <= (safe["bottom"] + 0.05) * H + 1
            subs_out.append({"id": c["id"], "png": str(png), "x": x, "y": y, "w": w, "h": h, "start": c["start"], "end": c["end"],
                             "inside_bottom_zone": inside, "lines": round(h / (fs * 1.38 + fs * .44))})
        pg.evaluate("document.getElementById('s').textContent = ''")
        for k, c in enumerate(cards):
            pg.evaluate("""c => { const k = document.getElementById('k'); k.className = c.kind;
              k.innerHTML = '<div class="bar"></div><div class="tx"><div class="t"></div>' + (c.label ? '<div class="l"></div>' : '') + '</div>';
              k.querySelector('.t').textContent = c.title; if (c.label) k.querySelector('.l').textContent = c.label; }""", c)
            el = pg.locator("#wrap")
            box = el.bounding_box()
            png = out_dir / f"card_{k + 1:03d}.png"
            el.screenshot(path=str(png), omit_background=True)
            w, h = round(box["width"]), round(box["height"])
            zx = (cz["left"] + cz["right"]) / 2 * W
            x = round(zx - w / 2)
            y = round(cz["top"] * H + max(0, ((cz["bottom"] - cz["top"]) * H - h) / 2))
            cards_out.append({"id": c["id"], "png": str(png), "x": x, "y": y, "w": w, "h": h, "start": c["start"], "end": c["end"],
                              "inside_card_zone": y >= cz["top"] * H - 1 and y + h <= cz["bottom"] * H + 1 + RISE * H})
        b.close()
    # مفيش كارت فوق ترجمة (في نفس الوقت ونفس المكان)
    overlaps = sum(1 for s in subs_out for k in cards_out if s["start"] < k["end"] and k["start"] < s["end"]
                   and rects_overlap(s, {**k, "y": k["y"], "h": k["h"] + round(RISE * H)}))
    return {"subs": subs_out, "cards": cards_out, "overlaps": overlaps, "sub_font_px": fs, "card_font_px": cfs}


def still(video: Path, t: float, out: Path, crop: tuple[float, float, float, float] | None = None, width: int = 540) -> Path:
    """فريم واحد من فيديو (للتقارير ولقطات الكلوز أب)."""
    vf = f"scale={width}:-2"
    if crop:
        x0, y0, x1, y1 = crop
        vf = f"crop=iw*{x1 - x0:.4f}:ih*{y1 - y0:.4f}:iw*{x0:.4f}:ih*{y0:.4f}," + vf
    subprocess.run(["ffmpeg", "-v", "error", "-y", "-ss", f"{t:.3f}", "-i", str(video), "-frames:v", "1", "-vf", vf, "-q:v", "3", str(out)], check=True)
    return out
