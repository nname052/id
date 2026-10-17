"""منطق القصّ في المونتاج (دوال صافية من غير ميديا، علشان تتختبر لوحدها).

الفكرة: الكلام بيتقسّم لـ "وحدات" (جمل) عند نهاية الجملة أو سكتة طبيعية، وبعدين بنختار الوحدات حسب السياق
(نشيل الكلام المقطوع والتكرار والحشو)، ونقصّ في السكات بين الوحدات، عمر القصّة ما بتقع جوه كلمة.

توقيت whisper بيمدّ الكلمة على السكتة اللي بعدها (مثلًا "بتعدّي" 4.00–5.32 والصوت ساكت من 4.44)،
فبنظبط حدود الكلمات بالسكتات اللي FFmpeg قاسها قبل أي حاجة (refine_words).
"""

import re

import numpy as np

HOP = 0.01
SENT_END = re.compile(r"[.!?؟…]$")
FILLERS = {"اه", "آه", "اا", "ااه", "امم", "ام", "ممم", "هممم", "يعني", "uh", "um", "umm", "hmm", "eh"}
MIN_PAUSE = 0.35     # سكتة أطول من كده بين كلمتين = حد وحدة
MAX_PAUSE = 0.7      # سكتة أطول من كده جوه الجزء بتتشال (قصّة عند السكتة)
OUT_PAD = 0.15       # نفس بعد آخر كلمة قبل القصّة
IN_PAD = 0.10        # قبل أول كلمة
EDGE = 0.03          # أقل بعد عن أي كلمة


def norm(w: str) -> str:
    w = re.sub(r"[ً-ْـ،,.!؟?«»\"'…:؛\-]", "", w)
    return w.replace("أ", "ا").replace("إ", "ا").replace("آ", "ا").replace("ة", "ه").replace("ى", "ي").strip().lower()


def refine_words(words: list[dict], pauses: list[dict]) -> list[dict]:
    """حدود الكلمات من whisper + السكتات المقاسة: الكلمة ما تدخلش في سكتة."""
    out = [dict(w, raw_start=w["start"], raw_end=w["end"]) for w in words]
    for p in pauses:
        for w in out:
            # سكتة بتبدأ جوه الكلمة وتكمّل بعدها: الكلمة خلصت عند بداية السكتة
            if w["start"] < p["start"] < w["end"] <= p["end"] + 0.25:
                w["end"] = round(p["start"], 3)
            # سكتة بدأت قبل الكلمة وخلصت جواها: الكلمة بدأت عند نهاية السكتة
            if p["start"] - 0.25 <= w["start"] < p["end"] < w["end"]:
                w["start"] = round(p["end"], 3)
            # الكلمة كلها جوه سكتة (whisper افترض كلام في سكوت): نسيبها بس نعلّمها
            if p["start"] <= w["start"] and w["end"] <= p["end"]:
                w["in_silence"] = True
    for a, b in zip(out, out[1:]):  # ما يتداخلوش
        if b["start"] < a["end"]:
            b["start"] = a["end"]
    return out


def _pause_at(pauses, t0, t1):
    """أول سكتة متداخلة مع [t0, t1]."""
    return next((p for p in pauses if p["start"] <= t1 and p["end"] >= t0), None)


def build_units(words: list[dict], segments: list[dict], pauses: list[dict], scene_cuts: list[float], duration: float,
                source: str, min_pause: float = MIN_PAUSE) -> list[dict]:
    """الكلمات (المظبوطة) ← وحدات. الحد بين وحدتين = سكتة ≥ min_pause، أو علامة نهاية جملة، أو قطع مشهد بيقطع الكلام."""
    seg_last = {s["last"] for s in segments}
    units, cur = [], []

    def close(kind):
        if cur:
            units.append({"words": list(cur), "end_kind": kind})
            cur.clear()

    # كل قطع مشهد بيتنسب لأقرب حد بين كلمتين (في حدود 0.25 ثانية)
    chop = set()
    for c in scene_cuts:
        near = [(abs((words[i]["end"] + words[i + 1]["start"]) / 2 - c), i) for i in range(len(words) - 1)
                if words[i]["end"] - 0.25 <= c <= words[i + 1]["start"] + 0.25]
        if near and c > 0.05:
            chop.add(min(near)[1])
    for i, w in enumerate(words):
        cur.append(i)
        if i == len(words) - 1:
            close("source_end")
            break
        nxt = words[i + 1]
        gap = nxt["start"] - w["end"]
        if i in chop and gap < 0.15:
            close("scene_chop")      # قطع مشهد في نص الكلام
        elif SENT_END.search(w["word"]) or (i in seg_last and gap >= 0.12):
            close("sentence_end")
        elif gap >= min_pause:
            close("pause")
    out = []
    for k, u in enumerate(units):
        ws = [words[i] for i in u["words"]]
        prev_kind = units[k - 1]["end_kind"] if k else "source_start"
        start, end = ws[0]["start"], ws[-1]["end"]
        out.append({"id": f"{source}u{k + 1}", "source": source, "start": start, "end": end, "first": u["words"][0], "last": u["words"][-1],
                    "text": " ".join(w["word"] for w in ws), "n_words": len(ws), "p_mean": round(float(np.mean([w["p"] for w in ws])), 3),
                    "end_kind": u["end_kind"], "start_kind": prev_kind,
                    "silence_before": bool(_pause_at(pauses, start - 0.12, start - 0.02)) and start > 0.05,
                    "silence_after": bool(_pause_at(pauses, end + 0.02, end + 0.12)) and end < duration - 0.05})
    return out


def units_from_pauses(speech: list[dict], source: str) -> list[dict]:
    """لو التفريغ فشل/مش موثوق: كل فترة فيها صوت بين سكتتين = وحدة، والحد = سكتة."""
    return [{"id": f"{source}u{k + 1}", "source": source, "start": s["start"], "end": s["end"], "first": None, "last": None, "text": "",
             "n_words": 0, "p_mean": None, "end_kind": "pause", "start_kind": "pause" if k else "source_start",
             "silence_before": k > 0 or s["start"] > 0.05, "silence_after": True} for k, s in enumerate(speech)]


def choose(units: list[dict], duration: float) -> list[dict]:
    """الاختيار حسب السياق: لكل وحدة keep وسبب. بنشيل الكلام المقطوع والتكرار والحشو والكلام اللي مش مفهوم."""
    for u in units:
        u["keep"], u["reason"] = True, "جملة كاملة"
        dur = u["end"] - u["start"]
        words = [norm(x) for x in u["text"].split()]
        chopped_end = u["end_kind"] == "scene_chop" or (u["end_kind"] == "source_end" and not u["silence_after"] and u["end"] >= duration - 0.15)
        chopped_start = u["start_kind"] == "scene_chop" or (u["start"] <= 0.05 and not u["silence_before"])
        if chopped_end and u["n_words"]:
            u["keep"], u["reason"] = False, "جملة مقطوعة (الكلام اتقطع قبل ما يخلص)"
        elif chopped_start and (dur < 1.0 or u["n_words"] <= 1):
            u["keep"], u["reason"] = False, "حتة كلمة في أول لقطة"
        elif words and all(w in FILLERS for w in words):
            u["keep"], u["reason"] = False, "حشو (آه/يعني)"
        elif u["p_mean"] is not None and u["p_mean"] < 0.35 and dur < 1.5:
            u["keep"], u["reason"] = False, "كلام مش مفهوم (ثقة التفريغ قليلة)"
    # إعادة نفس الجملة (take تاني): نسيب آخر واحدة
    for a, b in zip(units, units[1:]):
        if a["keep"] and b["keep"] and a["n_words"] >= 3 and _similar(a["text"], b["text"]) >= 0.75:
            a["keep"], a["reason"] = False, f"اتعادت بعدها ({b['id']})"
    return units


def _similar(x: str, y: str) -> float:
    a, b = [norm(w) for w in x.split()], [norm(w) for w in y.split()]
    if not a or not b:
        return 0.0
    common = sum(min(a.count(w), b.count(w)) for w in set(a))
    return common / max(len(a), len(b))


def quiet_point(env, lo: float, hi: float, target: float) -> float:
    """أوطى نقطة صوت في [lo, hi]، ولو فيه أكتر من نقطة قريبة من بعض نختار الأقرب للـ target."""
    if hi - lo < 2 * HOP or env is None or len(env) < 2:
        return round(min(max(target, lo), hi), 3)
    i0, i1 = max(0, int(lo / HOP)), min(len(env) - 1, int(hi / HOP))
    if i1 <= i0:
        return round((lo + hi) / 2, 3)
    seg = env[i0:i1 + 1]
    floor = float(seg.min())
    cand = [i0 + k for k, v in enumerate(seg) if v <= floor + 3]   # كل النقط اللي في حدود 3 dB من الأوطى
    best = min(cand, key=lambda i: abs(i * HOP - target))
    return round(min(max(best * HOP, lo), hi), 3)


def plan_segments(units: list[dict], words: list[dict], env, duration: float, max_pause: float = MAX_PAUSE) -> list[dict]:
    """الوحدات المختارة ← أجزاء (source, start, end). القصّ بيقع في السكتة اللي حوالين الوحدة بس."""
    segs, cur = [], None

    def prev_end(u):    # آخر كلمة قبل الوحدة (أو بداية الملف)
        return words[u["first"] - 1]["end"] if u["first"] else (0.0 if u["first"] == 0 else _prev_unit_end(units, u))

    def next_start(u):  # أول كلمة بعد الوحدة (أو نهاية الملف)
        if u["last"] is not None and u["last"] + 1 < len(words):
            return words[u["last"] + 1]["start"]
        return _next_unit_start(units, u, duration)

    def close():
        u = cur["last_unit"]
        lo, hi = u["end"] + EDGE, next_start(u) - EDGE
        t = u["end"] if hi < lo else quiet_point(env, lo, min(hi, u["end"] + 0.35), u["end"] + OUT_PAD)
        if hi < lo:
            t = round((u["end"] + next_start(u)) / 2, 3)
        cur["seg"].update(end=t, cut_out={"t": t, "kind": "source_end" if t >= duration - 0.01 else ("pause" if u["end_kind"] == "source_end" else u["end_kind"]), "window": [round(u["end"], 3), round(next_start(u), 3)]})
        segs.append(cur["seg"])

    prev = None
    for u in units:
        if not u["keep"]:
            prev = None
            continue
        if cur and prev is not None and prev["source"] == u["source"] and u["start"] - prev["end"] <= max_pause and u["start_kind"] != "scene_chop":
            cur["seg"]["units"].append(u["id"]); cur["seg"]["text"] += " " + u["text"]; cur["last_unit"] = u
        else:
            if cur:
                close()
            pe = prev_end(u)
            lo, hi = pe + EDGE, u["start"] - EDGE
            t = quiet_point(env, max(lo, u["start"] - 0.3), hi, u["start"] - IN_PAD) if hi >= lo else round((pe + u["start"]) / 2, 3)
            kind = "source_start" if t <= 0.01 else ("pause" if u["start_kind"] == "source_start" else u["start_kind"])
            cur = {"seg": {"source": u["source"], "start": t, "units": [u["id"]], "text": u["text"],
                           "cut_in": {"t": t, "kind": kind, "window": [round(pe, 3), round(u["start"], 3)]}}, "last_unit": u}
        prev = u
    if cur:
        close()
    for k, s in enumerate(segs):
        s["id"] = f"g{k + 1}"
        s["speed"] = 1.0
    return segs


def _prev_unit_end(units, u):
    k = units.index(u)
    return units[k - 1]["end"] if k else 0.0


def _next_unit_start(units, u, duration):
    k = units.index(u)
    return units[k + 1]["start"] if k + 1 < len(units) else duration


def cut_report(segments: list[dict], words_by_source: dict, env_by_source: dict | None = None, silence_db: float = -35) -> dict:
    """كل قصّة (بداية/نهاية جزء) ← هل وقعت جوه كلمة؟ ونوعها (نهاية جملة / سكتة)."""
    cuts, inside, inside_raw, kinds, loud = [], 0, 0, {}, 0
    for s in segments:
        ws = words_by_source.get(s["source"], [])
        for side in ("cut_in", "cut_out"):
            c = s[side]
            if c["kind"] in ("source_start", "source_end"):
                continue   # أول/آخر الملف مش قصّة
            t = c["t"]
            w_in = next((w for w in ws if w["start"] < t < w["end"]), None)
            w_raw = next((w for w in ws if w.get("raw_start", w["start"]) < t < w.get("raw_end", w["end"])), None)
            db = None
            if env_by_source and s["source"] in env_by_source:
                env = env_by_source[s["source"]]
                db = round(float(env[min(len(env) - 1, int(t / HOP))]), 1)
                loud += db > silence_db
            inside += bool(w_in); inside_raw += bool(w_raw)
            kinds[c["kind"]] = kinds.get(c["kind"], 0) + 1
            cuts.append({"segment": s["id"], "side": side, "t": t, "kind": c["kind"], "inside_word": w_in["word"] if w_in else None,
                         "inside_raw_whisper_word": w_raw["word"] if w_raw else None, "level_db": db})
    return {"cuts": len(cuts), "inside_word": inside, "inside_raw_whisper_span": inside_raw, "above_silence": loud, "by_kind": kinds, "list": cuts}


# ---------- الإيقاع (المتقدم S2c) ----------
def importance(seg: dict, first: bool) -> float:
    text = seg.get("text", "")
    dur = max(0.1, seg["end"] - seg["start"])
    n = len(text.split())
    score = 0.35 + 0.25 * first + 0.15 * bool(re.search(r"[0-9٠-٩]", text)) + 0.1 * bool(re.search(r"[؟?!]", text))
    score += 0.15 * min(1.0, (n / dur) / 3.0) + 0.1 * (len(text) >= 40)
    return round(min(1.0, score), 2)


def rhythm(segments: list[dict], unit_index: dict) -> list[dict]:
    """المدة حسب أهمية الفكرة: المهم بياخد نفَس أطول بعده وسرعته طبيعية، والأقل أهمية بيتشد (سرعة أعلى شوية وسكتة أقصر).
    حدود القصّ بتفضل جوه نفس السكتة (window) فعمرها ما تدخل في كلمة."""
    out = []
    for k, s in enumerate(segments):
        s = {**s}
        imp = importance(s, k == 0)
        s["importance"] = imp
        s["speed"] = 1.0 if imp >= 0.6 else (1.05 if imp >= 0.45 else 1.1)
        lo, hi = s["cut_out"]["window"]
        before = s["end"]
        if s["cut_out"]["kind"] not in ("source_end",):
            hold = 0.3 if imp >= 0.6 else 0.08
            t = round(min(max(lo + hold, lo + EDGE), hi - EDGE if hi - EDGE > lo + EDGE else lo + EDGE), 3)
            s["end"] = t; s["cut_out"] = {**s["cut_out"], "t": t}
        s["rhythm"] = {"importance": imp, "speed": s["speed"], "end_before": before, "end_after": s["end"],
                       "duration_before": round(before - s["start"], 3), "duration_after": round((s["end"] - s["start"]) / s["speed"], 3)}
        out.append(s)
    return out


# ---------- الترجمة (المتقدم S2d) ----------
SAFE = {"9:16": {"left": 0.06, "right": 0.84, "top": 0.12, "bottom": 0.72},   # بعيد عن أزرار تيك توك (يمين) والكابشن (تحت)
        "16:9": {"left": 0.08, "right": 0.92, "top": 0.08, "bottom": 0.90}}


def subtitle_cues(segments: list[dict], words_by_source: dict, max_chars: int = 32, max_dur: float = 2.8) -> list[dict]:
    """الكلام على توقيت الإخراج: كل سطر كلمات متتالية من نفس الجزء (≤ max_chars حرف و ≤ max_dur ثانية)."""
    cues, t_off = [], 0.0
    for s in segments:
        sp = float(s.get("speed") or 1.0)
        ws = [w for w in words_by_source.get(s["source"], []) if s["start"] <= (w["start"] + w["end"]) / 2 <= s["end"]]
        line = []

        def flush():
            if line:
                a = t_off + (line[0]["start"] - s["start"]) / sp
                b = t_off + (line[-1]["end"] - s["start"]) / sp
                cues.append({"start": round(max(t_off, a), 3), "end": round(b, 3), "text": " ".join(w["word"] for w in line), "segment": s["id"]})
                line.clear()

        for w in ws:
            txt = " ".join(x["word"] for x in line + [w])
            # السطر بيخلص عند سكتة (حد جملة) أو لما يطول
            if line and (w["start"] - line[-1]["end"] >= 0.25 or len(txt) > max_chars or (w["end"] - line[0]["start"]) > max_dur):
                flush()
            line.append(w)
            if SENT_END.search(w["word"]):
                flush()
        flush()
        t_off += (s["end"] - s["start"]) / sp
    for a, b in zip(cues, cues[1:]):   # السطر يفضل لحد اللي بعده بشوية (من غير ما يتداخلوا)
        a["end"] = round(min(b["start"], a["end"] + 0.25), 3)
    if cues:
        cues[-1]["end"] = round(min(t_off, cues[-1]["end"] + 0.25), 3)
    return cues
