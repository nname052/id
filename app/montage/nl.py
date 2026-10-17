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
CUT_STAGES = ("s2_cut", "s2b_cuts", "s2c_rhythm")


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
def propose(key: str, doc: dict, text: str, wbs: dict) -> dict:
    """doc = stage.json الحالي. بيرجّع {"question"} أو {"new_data", "new_params", "diff", "notes"}."""
    t = _t(text)
    data, params = copy.deepcopy(doc["data"]), copy.deepcopy(doc["params"])
    notes: list[str] = []
    if key in CUT_STAGES:
        segs = data["segments"]
        n = len(segs)
        ps = parts(t)
        if _has(r"(9:16|طولي|vertical|portrait)", t):
            data["aspect"] = "9:16"
        elif _has(r"(16:9|عرضي|horizontal|landscape)", t):
            data["aspect"] = "16:9"
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
        elif _has(SLOW, t) or _has(FAST, t):
            slow = _has(SLOW, t)
            pct = _pct(t) or 0.1
            if ps:
                idx = [_idx(k, n) for k in ps]
                if None in idx:
                    return {"question": f"فيه {n} أجزاء بس. أنهي جزء؟"}
            elif _has(ALL, t) or n == 1 or (key == "s2c_rhythm" and _has(r"(الإيقاع|الايقاع|rhythm|pace)", t)):
                idx = list(range(n))
            else:
                return {"question": f"{'أبطّأ' if slow else 'أسرّع'} أنهي جزء؟ (رقمه، ولا الفيديو كله)"}
            for i in idx:
                sp = float(segs[i].get("speed") or 1.0)
                segs[i]["speed"] = round(min(1.5, max(0.75, sp * ((1 - pct) if slow else (1 + pct)))), 3)
        elif _has(r"(بدّل|بدل|swap)", t) and len(ps) >= 2:
            a, b = _idx(ps[0], n), _idx(ps[1], n)
            if a is None or b is None:
                return {"question": f"فيه {n} أجزاء بس. أبدّل أنهي اتنين؟"}
            segs[a], segs[b] = segs[b], segs[a]
        elif _has(r"(حط|انقل|قدّم|قدم|رجّع|رجع|move|put)", t) and len(ps) >= 2 and _has(r"(قبل|بعد|before|after)", t):
            a, b = _idx(ps[0], n), _idx(ps[1], n)
            if a is None or b is None:
                return {"question": f"فيه {n} أجزاء بس. أنقل أنهي جزء فين؟"}
            seg = segs[a]
            target_id = segs[b]["id"]
            rest = [s for i, s in enumerate(segs) if i != a]
            j = next(i for i, s in enumerate(rest) if s["id"] == target_id)
            rest.insert(j if _has(r"(قبل|before)", t) else j + 1, seg)
            data["segments"] = rest
        else:
            return {"question": "تقصد إيه بالظبط؟ مثلًا: «شيل أول ثانيتين»، «خلّي الجزء التاني أبطأ»، «احذف الجزء 3»، «بدّل الجزء 1 و 2»."}
        if not data["segments"]:
            return {"question": "كده مش هيفضل أي جزء. متأكد؟ قول عدد ثواني أقل."}
    elif key == "s2a_select":
        m = re.search(r"(اللقطة|لقطة|shot)\s*(رقم\s*)?(\d+|\w+)", t)
        k = (int(m.group(3)) if m.group(3).isdigit() else ORD.get(m.group(3))) if m else None
        shots = data["shots"]
        if k is None:
            return {"question": "أنهي لقطة؟ (رقمها زي sh2)"}
        i = _idx(k, len(shots))
        if i is None:
            return {"question": f"فيه {len(shots)} لقطات بس. أنهي واحدة؟"}
        if _has(REMOVE, t):
            shots[i]["keep"], shots[i]["reason"] = False, "اتشالت بطلبك"
        elif _has(r"(رجّع|رجع|ضيف|سيب|خلي|خلّي|keep|restore|add)", t):
            shots[i]["keep"], shots[i]["reason"] = True, "اترجعت بطلبك"
        else:
            return {"question": f"أشيل اللقطة {k} ولا أرجّعها؟"}
    elif key == "s2d_subs":
        if _has(r"(أقصر|اقصر|shorter)", t):
            params["max_chars"] = max(14, int(params["max_chars"]) - 6)
        elif _has(r"(أطول|اطول|longer)", t):
            params["max_chars"] = min(60, int(params["max_chars"]) + 6)
        else:
            return {"question": "تحب السطور أقصر ولا أطول؟"}
    elif key == "s3_audio":
        music = _has(r"(المزيكا|مزيكا|الموسيقى|موسيقى|music)", t)
        up = _has(r"(علّي|علي|ارفع|زوّد|زود|عالي|أعلى|اعلى|louder|raise|increase|up)", t)
        down = _has(r"(وطّي|وطي|اخفض|قلّل|قلل|واطي|أوطى|اوطى|quieter|lower|decrease|down)", t)
        if m := re.search(r"(-?\d+(?:\.\d+)?)\s*lufs", t):
            params["target_lufs"] = max(-30.0, min(-8.0, float(m.group(1))))
        elif _has(r"(ducking|التوطية|توطية|duck)", t):
            params["duck"] = not _has(r"(شيل|من غير|بطّل|بطل|off|remove|no|disable)", t)
        elif music and _has(r"(شيل|من غير|بلاش|remove|no|without)", t):
            params["music"] = "none"
        elif music and (up or down):
            params["music_gain_db"] = round(float(params["music_gain_db"]) + (3 if up else -3), 1)
        elif music and _has(r"(رجّع|رجع|ضيف|حط|add)", t):
            params["music"] = "auto"
        elif up or down:
            params["target_lufs"] = max(-30.0, min(-8.0, float(params["target_lufs"]) + (2 if up else -2)))
        else:
            return {"question": "تقصد علو الصوت كله ولا المزيكا؟"}
    elif key == "s1_analyze":
        if _has(r"(إنجليزي|انجليزي|انجلش|english)", t):
            params["language"] = "en"
        elif _has(r"(عربي|arabic)", t):
            params["language"] = "ar"
        elif _has(r"(تلقائي|auto)", t):
            params["language"] = "auto"
        elif _has(r"(المشاهد|اللقطات|القطعات|scenes|cuts|shots)", t) and _has(r"(أكتر|اكتر|أعلى|حساس|more|higher|sensitive)", t):
            params["adaptive_threshold"] = max(1.0, float(params["adaptive_threshold"]) - 0.5)
        elif _has(r"(المشاهد|اللقطات|القطعات|scenes|cuts|shots)", t) and _has(r"(أقل|اقل|less|fewer|lower)", t):
            params["adaptive_threshold"] = float(params["adaptive_threshold"]) + 0.5
        else:
            return {"question": "تقصد لغة الكلام (عربي/إنجليزي) ولا حساسية تقطيع اللقطات؟"}
    else:
        return {"question": "التصدير مالوش تعديلات: عدّل المرحلة اللي قبله وصدّر تاني."}
    d = diff(doc["data"], data, doc["params"], params)
    if not d:
        return {"question": "التعديل ده مش هيغيّر حاجة. تقصد إيه بالظبط؟"}
    return {"new_data": data, "new_params": params, "diff": d, "notes": notes, "kind": "params" if data == doc["data"] else "data"}


def diff(old: dict, new: dict, op: dict, np_: dict) -> list[dict]:
    """فرق بسيط مقروء: باراميترات، مقاس، أجزاء (اتشالت/اتغيرت/الترتيب)، لقطات."""
    out = []
    for k in sorted(set(op) | set(np_)):
        if op.get(k) != np_.get(k):
            out.append({"path": f"params.{k}", "from": op.get(k), "to": np_.get(k)})
    if old.get("aspect") != new.get("aspect"):
        out.append({"path": "aspect", "from": old.get("aspect"), "to": new.get("aspect")})
    if "segments" in old:
        oi = {s["id"]: s for s in old["segments"]}
        ni = {s["id"]: s for s in new["segments"]}
        for sid in oi:
            if sid not in ni:
                out.append({"path": f"segments[{sid}]", "from": f"{oi[sid]['start']:.2f}–{oi[sid]['end']:.2f} «{oi[sid].get('text', '')[:30]}»", "to": "اتشال"})
                continue
            for f in ("start", "end", "speed"):
                a, b = oi[sid].get(f, 1.0 if f == "speed" else None), ni[sid].get(f, 1.0 if f == "speed" else None)
                if a != b:
                    out.append({"path": f"segments[{sid}].{f}", "from": a, "to": b})
        oo, no = [s for s in oi if s in ni], [s["id"] for s in new["segments"]]
        if oo != no:
            out.append({"path": "segments.order", "from": oo, "to": no})
    if "shots" in old:
        for a, b in zip(old["shots"], new["shots"]):
            if a["keep"] != b["keep"]:
                out.append({"path": f"shots[{a['id']}].keep", "from": a["keep"], "to": b["keep"]})
    return out
