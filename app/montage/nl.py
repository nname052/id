"""تعديلات بالكلام: جملة (مصري/فصحى/إنجليزي) ← تغيير منظّم في JSON المرحلة (مش في الفيديو)، وبيتعرض كـ diff قبل التطبيق.
قواعد ثابتة من غير AI ولا API مدفوع (نفس الجملة ← نفس التغيير). لو الكلام مش واضح: سؤال واحد قصير بدل التخمين.
"""

import copy
import re

from .cuts import EDGE

AR_DIGITS = str.maketrans("٠١٢٣٤٥٦٧٨٩٫", "0123456789.")
ORD = {"الأول": 1, "الاول": 1, "أول": 1, "اول": 1, "التاني": 2, "الثاني": 2, "تاني": 2, "ثاني": 2, "التالت": 3, "الثالث": 3, "تالت": 3, "ثالث": 3,
       "الرابع": 4, "رابع": 4, "الخامس": 5, "خامس": 5, "السادس": 6, "الأخير": -1, "الاخير": -1, "آخر": -1, "اخر": -1,
       "first": 1, "second": 2, "third": 3, "fourth": 4, "fifth": 5, "sixth": 6, "last": -1}
NUMW = {"واحدة": 1, "واحد": 1, "ثانية": 1, "ثانيتين": 2, "اتنين": 2, "اثنين": 2, "تلاتة": 3, "تلات": 3, "ثلاثة": 3, "ثلاث": 3, "اربعة": 4, "أربعة": 4,
        "اربع": 4, "أربع": 4, "خمسة": 5, "خمس": 5, "ستة": 6, "عشرة": 10, "نص": 0.5,
        "one": 1, "two": 2, "three": 3, "four": 4, "five": 5, "six": 6, "ten": 10, "half": 0.5}
REMOVE = r"(شيل|شيلي|احذف|إحذف|امسح|اقطع|قص|قصّ|remove|delete|cut|trim|drop)"
PART = r"(الجزء|جزء|المقطع|مقطع|part|segment|clip)"
ALL = r"(كله|كلّه|الكل|كلها|كل الأجزاء|كل الاجزاء|all|whole|everything|entire)"
SLOW = r"(أبطأ|ابطأ|أبطء|ابطء|بطّأ|بطأ|بطّئ|ابطئ|أبطئ|أهدى|اهدى|slower|slow down)"
FAST = r"(أسرع|اسرع|سرّع|سرع|faster|speed up|quicker)"
SECS = r"(ثانية|ثواني|ثوان|ث|sec|secs|second|seconds|s)\b"


def _t(text: str) -> str:
    return " " + text.translate(AR_DIGITS).strip().lower() + " "


def _has(rx, t) -> bool:
    return re.search(rx, t) is not None


def seconds(t: str) -> float | None:
    if m := re.search(r"(\d+(?:\.\d+)?)\s*" + SECS, t):
        return float(m.group(1))
    if m := re.search(r"(ثانيتين|ثانية)", t):
        before = t[:m.start()].split()
        if m.group(1) == "ثانيتين":
            return 2.0
        if before and before[-1] in NUMW:
            return float(NUMW[before[-1]])
        return 1.0
    for w, v in NUMW.items():
        if re.search(rf"\b{w}\b\s*(ثواني|ثوان|seconds|secs)", t):
            return float(v)
    return None


def parts(t: str) -> list[int]:
    """أرقام الأجزاء المذكورة بالترتيب: "الجزء 2" / "الجزء التاني" / "تاني جزء" / "part 2" / "the second part"."""
    out = []
    for m in re.finditer(PART + r"\s*(رقم\s*)?(\d+|\w+)", t):
        v = m.group(3)
        if v.isdigit():
            out.append(int(v))
        elif v in ORD:
            out.append(ORD[v])
    for m in re.finditer(r"(\w+)\s*" + PART, t):
        if m.group(1) in ORD and ORD[m.group(1)] not in out:
            out.append(ORD[m.group(1)])
    return out


def _pct(t: str) -> float | None:
    m = re.search(r"(\d+(?:\.\d+)?)\s*(%|٪|في المية|في المائة|بالمية|percent)", t)
    return float(m.group(1)) / 100 if m else None


def _idx(k: int, n: int) -> int | None:
    i = n - 1 if k == -1 else k - 1
    return i if 0 <= i < n else None


# ---------- قصّ الأول/الآخر مع ضبط القصّة برّه الكلمات ----------
def _snap(t: float, words: list[dict], forward: bool) -> float:
    """القصّة لازم تقع في سكتة حقيقية (فراغ ≥ 0.12 ث بين كلمتين)، مش بس على حد كلمتين لازقين في بعض.
    لو t في سكتة بتفضل زي ما هي، وإلا بتتنقل لأقرب سكتة قدّام (لقصّ الأول) أو ورا (لقصّ الآخر)."""
    ws = sorted(words, key=lambda w: w["start"])
    if not ws:
        return round(t, 3)
    gaps = [(-1e9, ws[0]["start"])] + [(a["end"], b["start"]) for a, b in zip(ws, ws[1:]) if b["start"] - a["end"] >= 0.12] + [(ws[-1]["end"], 1e9)]
    for g0, g1 in gaps:
        if g0 + EDGE <= t <= g1 - EDGE:
            return round(t, 3)
    if forward:
        g0, g1 = next(g for g in gaps if g[0] >= t)
        return round(g0 + min(0.15, (g1 - g0) / 2), 3)
    g0, g1 = [g for g in gaps if g[1] <= t][-1]
    return round(g1 - min(0.1, (g1 - g0) / 2), 3)


def trim_start(segs, n, wbs):
    rem, out, notes = n, [], []
    for s in segs:
        s = copy.deepcopy(s)
        sp = float(s.get("speed") or 1.0)
        d = (s["end"] - s["start"]) / sp
        if rem >= d - 0.05:
            rem -= d; notes.append(f"{s['id']} اتشال كله"); continue
        if rem > 0:
            want = s["start"] + rem * sp
            t = _snap(want, wbs.get(s["source"], []), True)
            if t >= s["end"] - 0.1:
                rem = 0; notes.append(f"{s['id']} اتشال كله"); continue
            if abs(t - want) > 0.001:
                notes.append(f"بداية {s['id']} اتنقلت من {want:.2f} لـ {t:.2f} (أقرب سكتة) علشان ما نقصّش جوه كلام")
            s["start"] = t; s["cut_in"] = {"t": t, "kind": "pause", "edit": True, "requested": round(want, 3)}
            rem = 0
        out.append(s)
    return out, notes


def trim_end(segs, n, wbs):
    rem, out, notes = n, [], []
    for s in reversed(segs):
        s = copy.deepcopy(s)
        sp = float(s.get("speed") or 1.0)
        d = (s["end"] - s["start"]) / sp
        if rem >= d - 0.05:
            rem -= d; notes.append(f"{s['id']} اتشال كله"); continue
        if rem > 0:
            want = s["end"] - rem * sp
            t = _snap(want, wbs.get(s["source"], []), False)
            if t <= s["start"] + 0.1:
                rem = 0; notes.append(f"{s['id']} اتشال كله"); continue
            if abs(t - want) > 0.001:
                notes.append(f"نهاية {s['id']} اتنقلت من {want:.2f} لـ {t:.2f} (أقرب سكتة) علشان ما نقصّش جوه كلام")
            s["end"] = t; s["cut_out"] = {"t": t, "kind": "pause", "edit": True, "requested": round(want, 3)}
            rem = 0
        out.insert(0, s)
    return out, notes


# ---------- التحليل ----------
UP = r"(علّي|علي|ارفع|زوّد|زود|عالي|أعلى|اعلى|أكبر|اكبر|كبّر|كبر|louder|raise|increase|bigger|larger|up)"
DOWN = r"(وطّي|وطي|اخفض|قلّل|قلل|واطي|أوطى|اوطى|أصغر|اصغر|صغّر|صغر|quieter|lower|decrease|smaller|down)"


def _num_card(t: str):
    m = re.search(r"(الكارت|كارت|card)\s*(رقم\s*)?(\d+|\w+)", t)
    if not m:
        return None
    v = m.group(3)
    return int(v) if v.isdigit() else ORD.get(v)


def propose(key: str, doc: dict, text: str, wbs: dict) -> dict:
    """doc = stage.json الحالي. بيرجّع {"question"} أو {"new_data", "new_params", "user_params", "diff", "notes", "kind"}.
    kind = "params" (المرحلة بتتعاد بالإعدادات الجديدة) أو "data" (تعديل مباشر في البيانات: نسخة جديدة بنفس المدخل)."""
    t = _t(text)
    data, params = copy.deepcopy(doc["data"]), copy.deepcopy(doc["params"])
    ch: dict = {}           # الإعدادات اللي اتغيّرت بطلبك (بتفضل في النسخ الجاية)
    notes: list[str] = []
    if key == "s2_cut":
        segs = data["segments"]
        n = len(segs)
        ps = parts(t)
        if _has(r"(9:16|طولي|vertical|portrait)", t):
            ch["aspect"] = "9:16"
        elif _has(r"(16:9|عرضي|horizontal|landscape)", t):
            ch["aspect"] = "16:9"
        elif _has(r"(من غير مزج|بدون مزج|قطع صريح|jump ?cuts?|hard cuts?)", t):
            ch["transitions"] = "hard"
        elif _has(r"(مزج|ناعم|نعّم|نعم|smooth|dissolve|crossfade)", t) and not _has(REMOVE, t):
            ch["transitions"] = "auto"
            if _has(r"(أطول|اطول|أكتر|اكتر|longer|more)", t):
                ch["dissolve_frames"] = min(16, int(params.get("dissolve_frames") or (12 if data.get("fps", 30) >= 50 else 10)) + 2)
        elif _has(REMOVE, t) and ps:
            idx = [_idx(k, n) for k in ps]
            if None in idx:
                return {"question": f"فيه {n} أجزاء بس. أشيل أنهي واحد؟"}
            data["segments"] = [s for i, s in enumerate(segs) if i not in idx]
        elif _has(REMOVE, t) and _has(r"(أول|اول|البداية|بداية|first|beginning|start)", t):
            sec = seconds(t)
            if sec is None:
                return {"question": "أشيل كام ثانية من الأول؟"}
            data["segments"], notes = trim_start(segs, sec, wbs)
        elif _has(REMOVE, t) and _has(r"(آخر|اخر|الآخر|النهاية|نهاية|last|end)", t):
            sec = seconds(t)
            if sec is None:
                return {"question": "أشيل كام ثانية من الآخر؟"}
            data["segments"], notes = trim_end(segs, sec, wbs)
        elif _has(REMOVE, t) and _has(PART, t):
            return {"question": "أشيل أنهي جزء؟ (رقمه)"}
        elif (_has(SLOW, t) or _has(FAST, t)) and ps:
            return {"question": "مش بنغيّر سرعة الكلام نفسه (علشان الحركة ما تبانش متسرّعة). تقصد «القصّات أهدى» (نفَس أطول) ولا «أسرع» (نفَس أقصر)؟"}
        elif _has(SLOW, t) or _has(r"(نفس أطول|نفَس أطول|سيب سكتات|breath)", t):
            ch.update(dead_air=round(min(1.6, float(params["dead_air"]) + 0.3), 2), breath_out=round(min(0.5, float(params["breath_out"]) + 0.08), 2),
                      breath_in=round(min(0.35, float(params["breath_in"]) + 0.05), 2))
            if params.get("transitions") == "hard":
                ch["transitions"] = "auto"
        elif _has(FAST, t) or _has(r"(أقصر|اقصر|اشد|شد الإيقاع|tighter)", t):
            ch.update(dead_air=round(max(0.4, float(params["dead_air"]) - 0.2), 2), breath_out=round(max(0.1, float(params["breath_out"]) - 0.06), 2),
                      breath_in=round(max(0.06, float(params["breath_in"]) - 0.04), 2))
        elif _has(r"(بدّل|بدل|swap)", t) and len(ps) >= 2:
            a, b = _idx(ps[0], n), _idx(ps[1], n)
            if a is None or b is None:
                return {"question": f"فيه {n} أجزاء بس. أبدّل أنهي اتنين؟"}
            segs[a], segs[b] = segs[b], segs[a]
        elif _has(r"(حط|انقل|قدّم|قدم|رجّع|رجع|move|put)", t) and len(ps) >= 2 and _has(r"(قبل|بعد|before|after)", t):
            a, b = _idx(ps[0], n), _idx(ps[1], n)
            if a is None or b is None:
                return {"question": f"فيه {n} أجزاء بس. أنقل أنهي جزء فين؟"}
            seg, target_id = segs[a], segs[b]["id"]
            rest = [s for i, s in enumerate(segs) if i != a]
            j = next(i for i, s in enumerate(rest) if s["id"] == target_id)
            rest.insert(j if _has(r"(قبل|before)", t) else j + 1, seg)
            data["segments"] = rest
        else:
            return {"question": "تقصد إيه بالظبط؟ مثلًا: «القصّات أهدى»، «من غير مزج»، «شيل أول ثانيتين»، «احذف الجزء 3»، «بدّل الجزء 1 و 2»."}
        if not data["segments"]:
            return {"question": "كده مش هيفضل أي جزء. متأكد؟ قول عدد ثواني أقل."}
    elif key == "s3_look":
        if _has(r"(طبيعي|من غير ستايل|natural|no look)", t):
            ch["look"] = "natural"
        elif _has(r"(سينمائي|cinematic)", t):
            ch["look"] = "cinematic"
        elif _has(r"(دافي|دافئ|warm)", t):
            ch["look"] = "warm"
        elif _has(r"(بارد|cool|cold)", t):
            ch["look"] = "cool"
        elif _has(r"(أبيض وأسود|ابيض واسود|black and white|b&w)", t):
            ch["look"] = "bw"
        elif _has(r"(أفتح|افتح|نوّر|نور|brighter|lighter)", t):
            ch["brightness"] = min(40, int(params.get("brightness") or 0) + 12)
        elif _has(r"(أغمق|اغمق|darker)", t):
            ch["brightness"] = max(-40, int(params.get("brightness") or 0) - 12)
        elif _has(r"(من غير حدة|بلاش حدة|no sharpen)", t):
            ch["sharpen"] = False
        elif _has(r"(حدة|أحد|احد|sharp)", t):
            ch["sharpen"] = True
        elif _has(r"(ألوان أكتر|الوان اكتر|مشبع|saturat|more color)", t):
            ch["saturation"] = round(min(0.4, float(params.get("saturation") or 0) + 0.12), 2)
        elif _has(r"(ألوان أهدى|الوان اهدى|ألوان أقل|less color|desaturat)", t):
            ch["saturation"] = round(max(-0.4, float(params.get("saturation") or 0) - 0.12), 2)
        else:
            return {"question": "تحب الصورة أفتح ولا أغمق؟ ولا ستايل (سينمائي / دافي / بارد / أبيض وأسود / طبيعي)؟"}
    elif key == "s4_subs":
        if _has(r"(مكان|حط|انقل|position|move)", t) and _has(r"(أعلى|اعلى|فوق|higher|up)", t) or _has(r"(ارفع|علّي|علي) الترجمة", t):
            ch["pos"] = "raised"
        elif _has(r"(مكان|حط|انقل|position|move|نزّل|نزل)", t) and _has(r"(تحت|أوطى|اوطى|lower|down|bottom)", t):
            ch["pos"] = "low" if params.get("pos") == "bottom" else "bottom"
        elif _has(r"(صفرا|صفراء|أصفر|اصفر|yellow)", t):
            ch["color"] = "yellow"
        elif _has(r"(بيضا|بيضاء|أبيض|ابيض|white)", t):
            ch["color"] = "white"
        elif _has(r"(من غير خلفية|بدون خلفية|no background)", t):
            ch["panel"] = False
        elif _has(r"(بخلفية|خلفية|background)", t):
            ch["panel"] = True
        elif _has(r"(سطور|السطر|lines?)", t) and _has(r"(أقصر|اقصر|shorter)", t):
            ch["max_chars"] = max(14, int(params["max_chars"]) - 6)
        elif _has(r"(سطور|السطر|lines?)", t) and _has(r"(أطول|اطول|longer)", t):
            ch["max_chars"] = min(48, int(params["max_chars"]) + 6)
        elif _has(UP, t):
            ch["size"] = {"small": "medium", "medium": "large", "large": "large"}[params["size"]]
        elif _has(DOWN, t):
            ch["size"] = {"small": "small", "medium": "small", "large": "medium"}[params["size"]]
        else:
            return {"question": "تقصد مكان الترجمة (أعلى/تحت)، ولا حجمها (أكبر/أصغر)، ولا لونها، ولا طول السطر؟"}
    elif key == "s5_graphics":
        k = _num_card(t)
        cards = data.get("cards", [])
        if _has(REMOVE, t) and k is not None:
            i = _idx(k, len(cards))
            if i is None:
                return {"question": f"فيه {len(cards)} كروت بس. أشيل أنهي واحد؟"}
            ch["removed"] = list(params.get("removed") or []) + [cards[i]["source_text"]]
            notes.append(f"الكارت {cards[i]['id']} «{cards[i]['title']}» هيتشال، والفكرة دي هتاخد الاختيار اللي بعده لو موجود")
        elif _has(REMOVE, t) and _has(r"(الكروت|كروت|الجرافيك|جرافيك|cards|graphics)", t):
            ch["graphics"] = "off"
        elif _has(r"(رجّع|رجع|ضيف|حط|restore|add)", t) and _has(r"(الكروت|كروت|cards)", t):
            ch.update(graphics="on", removed=[], force_cards=True)
        elif _has(r"(كروت|cards)", t) and _has(r"(أكتر|اكتر|more)", t):
            ch["density"] = "many"
        elif _has(r"(كروت|cards)", t) and _has(r"(أقل|اقل|fewer|less)", t):
            ch["density"] = "few"
        elif _has(r"(دهبي|ذهبي|فخم|gold|elegant)", t):
            ch["mood"] = "elegant"
        elif _has(r"(برتقالي|جري|bold|orange)", t):
            ch["mood"] = "bold"
        elif _has(r"(أزرق|ازرق|مبهج|blue|fresh)", t):
            ch["mood"] = "fresh"
        elif _has(r"(غامق|هادي|dark|clean)", t):
            ch["mood"] = "clean"
        elif _has(REMOVE, t):
            return {"question": f"أشيل أنهي كارت؟ (رقمه من 1 لـ {len(cards)})"}
        else:
            return {"question": "تقصد إيه في الكروت؟ مثلًا: «شيل الكارت 2»، «كروت أقل»، «الكروت دهبي»."}
    elif key == "s6_audio":
        music = _has(r"(المزيكا|مزيكا|الموسيقى|موسيقى|music)", t)
        up, down = _has(UP, t), _has(DOWN, t)
        if m := re.search(r"(-?\d+(?:\.\d+)?)\s*lufs", t):
            ch["target_lufs"] = max(-30.0, min(-8.0, float(m.group(1))))
        elif _has(r"(دوشة|الدوشة|ضوضاء|وش|noise|hiss)", t):
            ch["denoise"] = "off" if _has(r"(من غير|بلاش|off|no)", t) else "strong"
        elif _has(r"(ducking|التوطية|توطية|duck)", t):
            ch["duck"] = not _has(r"(شيل|من غير|بطّل|بطل|off|remove|no|disable)", t)
        elif music and _has(r"(شيل|من غير|بلاش|remove|no|without)", t):
            ch["music"] = "none"
        elif music and (up or down):
            ch["music_gain_db"] = round(float(params["music_gain_db"]) + (3 if up else -3), 1)
        elif music and _has(r"(رجّع|رجع|ضيف|حط|add)", t):
            ch["music"] = "auto"
        elif up or down:
            ch["target_lufs"] = max(-30.0, min(-8.0, float(params["target_lufs"]) + (2 if up else -2)))
        else:
            return {"question": "تقصد علو الصوت كله، ولا المزيكا، ولا الدوشة؟"}
    elif key == "s1_analyze":
        if _has(r"(إنجليزي|انجليزي|انجلش|english)", t):
            ch["language"] = "en"
        elif _has(r"(عربي|arabic)", t):
            ch["language"] = "ar"
        elif _has(r"(تلقائي|auto)", t):
            ch["language"] = "auto"
        elif _has(r"(المشاهد|اللقطات|القطعات|scenes|cuts|shots)", t) and _has(r"(أكتر|اكتر|أعلى|حساس|more|higher|sensitive)", t):
            ch["adaptive_threshold"] = max(1.0, float(params["adaptive_threshold"]) - 0.5)
        elif _has(r"(المشاهد|اللقطات|القطعات|scenes|cuts|shots)", t) and _has(r"(أقل|اقل|less|fewer|lower)", t):
            ch["adaptive_threshold"] = float(params["adaptive_threshold"]) + 0.5
        else:
            return {"question": "تقصد لغة الكلام (عربي/إنجليزي) ولا حساسية تقطيع اللقطات؟"}
    else:
        return {"question": "المعاينة الكاملة بتتبني من المراحل اللي قبلها: اكتب التعديل في المرحلة اللي تخصه (القصّ، الصورة، الترجمة، الكروت، الصوت)."}
    params.update(ch)
    user = {**(doc.get("user_params") or {}), **ch}
    d = diff(doc["data"], data, doc["params"], params)
    if not d:
        return {"question": "التعديل ده مش هيغيّر حاجة. تقصد إيه بالظبط؟"}
    return {"new_data": data, "new_params": params, "user_params": user, "diff": d, "notes": notes, "kind": "params" if ch else "data"}


def fix_lines(doc: dict, lines: dict) -> dict:
    """تصحيح سطور الترجمة: لكل سطر النص الصح ← تصحيحات على مستوى الكلمة (fixes) بتفضل حتى لو القصّ اتغيّر بعدين.
    نفس عدد الكلمات ← كلمة بكلمة. عدد مختلف ← الكلمات بتتوزع على نفس التوقيت (الزيادة على آخر كلمة، والناقص بيندمج)."""
    cues = {c["id"]: c for c in doc["data"]["cues"]}
    fixes = dict((doc.get("user_params") or {}).get("fixes") or doc["params"].get("fixes") or {})
    out_diff, notes = [], []
    for cid, txt in lines.items():
        c = cues.get(cid)
        new = (txt or "").split()
        if not c or not new or " ".join(new) == c["text"]:
            continue
        old = c["words"]
        for i, w in enumerate(old):
            if i < len(new) - 1 and i < len(old) - 1:
                val = new[i]
            elif i == min(len(new), len(old)) - 1:
                val = " ".join(new[i:])
            else:
                val = ""
            if val != w["word"] or val == "":
                fixes[f"{w['source']}:{w['src_i']}"] = val
        out_diff.append({"path": f"{cid} ({c['start']:.1f}–{c['end']:.1f} ث)", "from": c["text"], "to": " ".join(new)})
        if len(new) != len(old):
            notes.append(f"{cid}: عدد الكلمات اتغيّر ({len(old)} ← {len(new)})، فالكلمات اتوزعت على نفس توقيت السطر")
    if not out_diff:
        return {"question": "مفيش تغيير في النص."}
    params = {**doc["params"], "fixes": fixes}
    return {"new_params": params, "user_params": {**(doc.get("user_params") or {}), "fixes": fixes}, "diff": out_diff, "notes": notes}


def diff(old: dict, new: dict, op: dict, np_: dict) -> list[dict]:
    """فرق بسيط مقروء: إعدادات، مقاس، أجزاء (اتشالت/اتغيرت/الترتيب)."""
    out = []
    for k in sorted(set(op) | set(np_)):
        if op.get(k) != np_.get(k) and k != "fixes":
            out.append({"path": f"params.{k}", "from": op.get(k), "to": np_.get(k)})
    if old.get("aspect") != new.get("aspect"):
        out.append({"path": "aspect", "from": old.get("aspect"), "to": new.get("aspect")})
    if "segments" in old and old.get("segments") != new.get("segments"):
        oi = {s["id"]: s for s in old["segments"]}
        ni = {s["id"]: s for s in new["segments"]}
        for sid in oi:
            if sid not in ni:
                out.append({"path": f"segments[{sid}]", "from": f"{oi[sid]['start']:.2f}–{oi[sid]['end']:.2f} «{oi[sid].get('text', '')[:30]}»", "to": "اتشال"})
                continue
            for f in ("start", "end"):
                if oi[sid].get(f) != ni[sid].get(f):
                    out.append({"path": f"segments[{sid}].{f}", "from": oi[sid].get(f), "to": ni[sid].get(f)})
        oo, no = [s for s in oi if s in ni], [s["id"] for s in new["segments"]]
        if oo != no:
            out.append({"path": "segments.order", "from": oo, "to": no})
    return out
