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
COMMA = re.compile(r"[،,؛;:]$")
FILLERS = {"اه", "آه", "اا", "ااه", "امم", "ام", "ممم", "هممم", "يعني", "uh", "um", "umm", "hmm", "eh"}
MIN_PAUSE = 0.35     # سكتة أطول من كده بين كلمتين = حد وحدة
MAX_PAUSE = 0.7      # سكتة أطول من كده جوه الجزء بتتشال (قصّة عند السكتة)
OUT_PAD = 0.15       # نفس بعد آخر كلمة قبل القصّة
IN_PAD = 0.10        # قبل أول كلمة
EDGE = 0.03          # أقل بعد عن أي كلمة


def norm(w: str) -> str:
    w = re.sub(r"[ً-ْـ،,.!؟?«»\"'…:؛\-]", "", w)
    return w.replace("أ", "ا").replace("إ", "ا").replace("آ", "ا").replace("ة", "ه").replace("ى", "ي").strip().lower()


def expected_len(word: str) -> float:
    """مدة الكلمة المتوقعة تقريبًا من عدد حروفها (كلام مصري عادي)."""
    return 0.08 + 0.075 * len(norm(word))


def refine_words(words: list[dict], pauses: list[dict]) -> list[dict]:
    """حدود الكلمات من whisper + السكتات المقاسة: الكلمة ما تدخلش في سكتة.
    whisper ساعات بيمدّ الكلمة على سكتة كاملة (مثلًا «التفاعل» 9.86–12.70 والسكتة 11.13–12.00):
    لو فيه سكتة جوه الكلمة، الكلمة بتتحط في الحتة (قبل/بعد السكتة) اللي طولها أقرب لطول الكلمة المتوقع من حروفها."""
    out = [dict(w, raw_start=w["start"], raw_end=w["end"]) for w in words]
    for w in out:
        inside = [p for p in pauses if w["start"] + 0.05 < p["start"] and p["end"] < w["end"] - 0.05]
        if inside:
            cuts_ = [w["start"]] + [x for p in inside for x in (p["start"], p["end"])] + [w["end"]]
            pieces = [(cuts_[i], cuts_[i + 1]) for i in range(0, len(cuts_), 2)]
            want = expected_len(w["word"])
            a, b = min(pieces, key=lambda pc: (abs((pc[1] - pc[0]) - want), -pc[0]))
            w["start"], w["end"], w["split_by_pause"] = round(a, 3), round(b, 3), True
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
        # آخر جملة في الملف ومفيش سكتة بعدها = الكلام كمّل (ومتسمعش كله): جملة مقطوعة
        chopped_end = u["end_kind"] == "scene_chop" or (u["end_kind"] == "source_end" and not u["silence_after"])
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


def plan_segments(units: list[dict], words: list[dict], env, duration: float, max_pause: float = MAX_PAUSE,
                  out_pad: float = OUT_PAD, in_pad: float = IN_PAD) -> list[dict]:
    """الوحدات المختارة ← أجزاء (source, start, end). القصّ بيقع في السكتة اللي حوالين الوحدة بس.
    max_pause = حد "الهوا الميت": سكتة أطول من كده بين جملتين بتتقص. out_pad/in_pad = النفَس اللي بيفضل بعد/قبل الكلام عند القصّة."""
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
        t = u["end"] if hi < lo else quiet_point(env, lo, min(hi, u["end"] + out_pad + 0.2), u["end"] + out_pad)
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
            t = quiet_point(env, max(lo, u["start"] - in_pad - 0.2), hi, u["start"] - in_pad) if hi >= lo else round((pe + u["start"]) / 2, 3)
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


# ---------- أهمية الفكرة (للكروت) ----------
def importance(seg: dict, first: bool) -> float:
    text = seg.get("text", "")
    dur = max(0.1, seg["end"] - seg["start"])
    n = len(text.split())
    score = 0.35 + 0.25 * first + 0.15 * bool(re.search(r"[0-9٠-٩]", text)) + 0.1 * bool(re.search(r"[؟?!]", text))
    score += 0.15 * min(1.0, (n / dur) / 3.0) + 0.1 * (len(text) >= 40)
    return round(min(1.0, score), 2)


# ---------- الانتقالات بين الأجزاء ----------
SHARP = {norm(w) for w in ("بس", "لكن", "بالعكس", "طيب", "المهم", "اولا", "أولا", "تانيا", "ثانيا", "اخيرا", "أخيرا", "خلينا", "لكن", "ومع", "but", "however", "anyway")}


def idea_change(a_text: str, b_text: str) -> tuple[str, str]:
    """تغيير الفكرة عند القصّة: «حاد» لو اللي بعدها بيبدأ بكلمة قلب/انتقال (بس، لكن، بالعكس، المهم…)؛ غير كده «هادي».
    (اتجرّب كمان «مفيش كلمات مشتركة» كعلامة فكرة جديدة: طلع كل قصّة حادة على تسجيل حقيقي، لأن الجمل المتتالية نادرًا ما بتكرر كلمات، فاتشال.)"""
    bw = [norm(w) for w in b_text.split()]
    if bw and bw[0] in SHARP:
        return "sharp", f"اللي بعد القصّة بيبدأ بـ «{b_text.split()[0]}» (انتقال/قلب فكرة)"
    return "soft", "الكلام مكمّل من غير كلمة انتقال (اتشال هوا ميت أو تكرار بس)"


# كلمات بتبدأ نقطة جديدة في عدّ (أولًا/تانيًا/خطوة…) ← زووم، وكلمات مفاجأة/كشف ← فلاش
ENUM = {norm(w) for w in ("اولا", "أولا", "تانيا", "ثانيا", "تالتا", "ثالثا", "رابعا", "اخيرا", "أخيرا", "خطوه", "خطوة", "النقطه", "النقطة", "اول", "أول",
                          "تاني", "تالت", "رابع", "first", "second", "third", "step", "finally")}
REVEAL = {norm(w) for w in ("الحقيقه", "الحقيقة", "المفاجأه", "المفاجأة", "المفاجاه", "تخيل", "تخيّل", "السر", "الصدمه", "الصدمة", "فجأة", "فجأه", "surprise", "imagine")}
# xfade لكل نوع انتقال (والمدة بالثواني). whip بيتبادل اتجاهه علشان ما يبانش متكرر
XFADE = {"dissolve": ("fade", None), "whip": ("smoothleft", 0.22), "whip_r": ("smoothright", 0.22), "zoom": ("zoomin", 0.32), "flash": ("fadewhite", 0.2),
         "fadeblack": ("fadeblack", 0.4), "slide": ("slideleft", 0.3), "circle": ("circleopen", 0.4), "blur": ("hblur", 0.35), "wipe": ("wipeleft", 0.3)}
# أسماء الانتقالات للاستوديو (اختيار يدوي لكل قطعة)
TRANSITION_KINDS = {"hard": "قطع عادي", "jumpzoom": "زووم على الوش", "dissolve": "مزج ناعم", "fadeblack": "إظلام", "flash": "فلاش أبيض",
                    "whip": "سحبة سريعة", "slide": "انزلاق", "zoom": "زووم دخول", "circle": "دايرة بتتفتح", "blur": "ضباب", "wipe": "مسح"}


def apply_overrides(transitions: list[dict], overrides: dict, fps: int) -> int:
    """اختيارك لكل قطعة من الاستوديو بيكسب على الخطة الأوتوماتيك: {رقم القطعة: {kind, speed}}. speed: fast/normal/slow."""
    n = 0
    for tr in transitions:
        o = (overrides or {}).get(str(tr["index"]))
        if not o or o.get("kind") not in TRANSITION_KINDS:
            continue
        k = o["kind"]
        mult = {"fast": 0.6, "normal": 1.0, "slow": 1.7}.get(o.get("speed", "normal"), 1.0)
        base = XFADE[k][1] if k in XFADE and XFADE[k][1] else (0.33 if k == "dissolve" else 0)
        frames = int(round(base * mult * fps)) if k in XFADE else 0
        frames += frames % 2
        tr.update(kind=k, xfade=XFADE[k][0] if k in XFADE else None, frames=frames, zoom_after=PUNCH_Z if k == "jumpzoom" else 1.0,
                  reason=f"اختيارك: {TRANSITION_KINDS[k]}" + (f" ({ {'fast': 'سريع', 'slow': 'بطيء'}[o['speed']] })" if o.get("speed") in ("fast", "slow") else ""))
        n += 1
    return n
FANCY = ("whip", "zoom", "flash")
FANCY_GAP = 5.0       # ثواني بين أي انتقالين «ظاهرين» (أكتر من كده بيبقى زحمة ومش احترافي)
JUMP_ZOOMS = (1.0, 1.14, 1.0, 1.22)   # تأطير الأجزاء ورا بعض في نفس اللقطة: واسع ← أقرب ← واسع ← أقرب أكتر


PUNCH_Z = 1.16       # زووم التأكيد على الوش
PUNCH_GAP = 4.0      # ثواني بين أي زوومين تأكيد


def plan_transitions(segments: list[dict], scene_cuts: dict, pace: str = "normal", fps: int = 30, dissolve_frames: int | None = None,
                     audio_ms: int = 60, motion: list[dict] | None = None, style: str = "auto") -> list[dict]:
    """لكل قصّة بين جزئين: نوعها وسببه، و crossfade للصوت في كل قصّة.
    ليه اتغيّر (مرتين): الأول كان مزج على كل jump cut (بيبان هاوي). وبعدين jump zoom متبادل في كل قصّة + سحبة/فلاش (طلع «هرجلة» ومش ماشي
    مع فيديو متكلم واحد). دلوقتي هادي ومقصود زي فيديوهات المتكلم المحترفة:
    - نفس اللقطة: قطع عادي بنفس التأطير (الـ jump cut العادي).
    - لحظة تأكيد (اللي بعدها بيبدأ بـ بس/لكن/الحقيقة/أولًا… أو فيه رقم): «زووم تأكيد» = الجزء ده أقرب على الوش، واللي بعده بيرجع عادي.
      وبين كل زوومين {PUNCH_GAP} ث على الأقل.
    - لقطة مختلفة أو ملف تاني: قطع صريح، ولو الفكرة اتقلبت: سحبة سريعة (whip). والحركة المكمّلة: قطع على الحركة.
    - style="simple": المزج القديم. style="hard" أو إيقاع سريع: قطع صريح بس."""
    df = dissolve_frames or (12 if fps >= 50 else 10)
    out, t, last_punch, whips = [], 0.0, -99.0, 0
    for k, (a, b) in enumerate(zip(segments, segments[1:])):
        t += (a["end"] - a["start"]) / float(a.get("speed") or 1.0)
        cuts_src = scene_cuts.get(a["source"], [])
        shot = a["source"] != b["source"] or b["start"] < a["end"] or any(a["end"] - 0.05 <= c <= b["start"] + 0.05 for c in cuts_src) \
            or any(b["start"] - 0.05 <= c <= a["end"] + 0.05 for c in cuts_src)
        mv = (motion or [{}] * len(segments))[k] if motion and k < len(motion) else {}
        change, change_why = idea_change(a.get("text", ""), b.get("text", ""))
        btxt = (b.get("text") or "").split()
        firsts = {norm(w) for w in btxt[:3]}
        has_num = any(ch.isdigit() for ch in (b.get("text") or ""))
        if style == "hard" or pace == "fast":
            kind, why = "hard", "طلبك إيقاع سريع: jump cut مقصود" if pace == "fast" else "طلبك: قطع صريح"
        elif style == "simple":
            kind, why = ("hard", "لقطة مختلفة: قطع صريح") if shot else ("dissolve", f"مزج {df} فريم يخفي النطّة")
        elif mv.get("matched"):
            kind, why = "match", f"الحركة مكمّلة في نفس الاتجاه (تشابه {mv['cos']}): قطع على الحركة"
        elif shot:
            if change == "sharp":
                whips += 1
                kind, why = ("whip" if whips % 2 else "whip_r"), f"لقطة مختلفة والفكرة اتقلبت ({change_why}): سحبة سريعة"
            else:
                kind, why = "hard", "لقطة مختلفة: قطع صريح"
        else:
            emph = change == "sharp" or firsts & (ENUM | REVEAL) or has_num
            if emph and t - last_punch >= PUNCH_GAP and pace != "calm":
                kind, why = "jumpzoom", "لحظة تأكيد («" + " ".join(btxt[:2]) + "»): زووم على الوش للجزء ده بس"
                last_punch = t
            else:
                kind, why = "hard", "نفس اللقطة: قطع عادي بنفس التأطير" + (" (فيه زووم تأكيد قريب)" if emph else "")
        dur = XFADE[kind][1] if kind in XFADE and XFADE[kind][1] else (df / fps if kind == "dissolve" else 0)
        frames = int(round(dur * fps)) if kind in XFADE else 0
        if kind in XFADE and frames % 2:
            frames += 1
        out.append({"index": k + 1, "after": a["id"], "before": b["id"], "t": round(t, 3), "kind": kind, "xfade": XFADE[kind][0] if kind in XFADE else None,
                    "frames": frames, "fps": fps, "audio_ms": audio_ms, "reason": why, "idea_change": change, "motion": mv,
                    "zoom_after": PUNCH_Z if kind == "jumpzoom" else 1.0})
    return out


def segment_zooms(transitions: list[dict], n: int) -> list[float]:
    """تأطير (زووم) كل جزء من خطة الانتقالات."""
    z = [JUMP_ZOOMS[0]] + [tr.get("zoom_after", 1.0) for tr in transitions]
    return (z + [1.0] * n)[:n]


# ---------- الترجمة ----------
SAFE = {"9:16": {"left": 0.08, "right": 0.84, "top": 0.62, "bottom": 0.80},   # تحت، فوق كابشن تيك توك (آخر 20%) وبعيد عن الأزرار (يمين)
        "16:9": {"left": 0.10, "right": 0.90, "top": 0.74, "bottom": 0.92}}
SUB_POS = {"bottom": 0.0, "raised": -0.06, "low": 0.04}   # إزاحة نهاية الترجمة (من ارتفاع الفريم) جوه منطقة تحت
DANGLING = {norm(w) for w in ("في", "مع", "من", "على", "عن", "و", "او", "أو", "اللي", "بس", "لو", "إن", "ان", "يا", "ده", "دي", "لأن", "عشان",
                              "علشان", "لما", "بتاع", "بتاعي", "ال", "and", "or", "the", "to", "of", "a", "in", "with", "but")}


STARTERS = {norm(w) for w in ("بس", "او", "أو", "لكن", "لأن", "لان", "عشان", "علشان", "اللي", "لو", "ممكن", "مش", "يعني", "بالعكس", "كمان", "and", "but", "or", "because")}
TIED = {norm(w) for w in ("بتاعي", "بتاعك", "بتاعه", "بتاعها", "بتاعنا", "كده", "خالص", "جدا", "أوي", "اوي", "كتير", "ده", "دي", "دول")}


def out_words(segments: list[dict], words_by_source: dict) -> list[dict]:
    """كل كلمة متقالة في الإخراج بتوقيتها على تايملاين الإخراج (بعد القصّ)."""
    out, t_off = [], 0.0
    for s in segments:
        sp = float(s.get("speed") or 1.0)
        for i, w in enumerate(words_by_source.get(s["source"], [])):
            if s["start"] <= (w["start"] + w["end"]) / 2 <= s["end"]:
                out.append({"word": w["word"], "start": round(t_off + (max(w["start"], s["start"]) - s["start"]) / sp, 3),
                            "end": round(t_off + (min(w["end"], s["end"]) - s["start"]) / sp, 3), "p": w.get("p", 1.0),
                            "segment": s["id"], "source": s["source"], "src_i": w.get("src_i", i), "orig": w.get("orig", w["word"])})
        t_off += (s["end"] - s["start"]) / sp
    return out


def subtitle_cues(segments: list[dict], words_by_source: dict, max_chars: int = 30, min_dur: float = 1.2, max_dur: float = 5.0,
                  gap_break: float = 0.25) -> list[dict]:
    """سطور الترجمة على توقيت الكلمات:
    - السطر بيخلص عند سكتة (≥ gap_break) أو نهاية جملة، أو لما يطول (أطول من max_chars ← بيتقسم عند أكبر سكتة جواه)، وعمره ما يخلص بحرف جر/عطف معلّق.
    - كل سطر على الشاشة بين min_dur و max_dur ثانية: السطر القصير بيتدمج مع اللي جنبه (سطرين بالكتير)، أو بيفضل في السكتة اللي بعده."""
    ws = out_words(segments, words_by_source)
    total = sum((s["end"] - s["start"]) / float(s.get("speed") or 1.0) for s in segments)
    # 1) عبارات عند السكتات / نهاية الجملة / تغيير الجزء
    phrases, cur = [], []
    for k, w in enumerate(ws):
        cur.append(w)
        nxt = ws[k + 1] if k + 1 < len(ws) else None
        clause = COMMA.search(w["word"]) and len(" ".join(x["word"] for x in cur)) >= 10
        if nxt is None or nxt["segment"] != w["segment"] or nxt["start"] - w["end"] >= gap_break or SENT_END.search(w["word"]) or clause:
            phrases.append(cur); cur = []

    # 2) عبارة طويلة (أكتر من سطرين أو max_dur) ← تتقسم عند أكبر فراغ جواها، وقبل كلمة بتبدأ عبارة (و/بس/أو/لأن/اللي…)،
    #    ومش بعد كلمة معلّقة ولا بين كلمة واللي بيكمّلها (زي «التفاعل | بتاعي»)
    def split(p):
        if len(" ".join(x["word"] for x in p)) <= max_chars * 2 and p[-1]["end"] - p[0]["start"] <= max_dur or len(p) < 2:
            return [p]

        def score(i):
            a, b = norm(p[i - 1]["word"]), norm(p[i]["word"])
            return ((p[i]["start"] - p[i - 1]["end"]) * 4 + 0.6 * bool(COMMA.search(p[i - 1]["word"])) + 0.4 * (b in STARTERS or b.startswith("و"))
                    - 1.0 * (a in DANGLING) - 0.8 * (b in TIED) - 0.04 * abs(i - len(p) / 2))
        best = max(range(1, len(p)), key=score)
        return split(p[:best]) + split(p[best:])
    lines = [x for p in phrases for x in split(p)]
    forced = sum(len(split(p)) - 1 for p in phrases)
    # كلمة معلّقة في آخر السطر ← تروح لأول اللي بعده (لو نفس الجزء)
    for a, b in zip(lines, lines[1:]):
        while len(a) > 1 and norm(a[-1]["word"]) in DANGLING and a[-1]["segment"] == b[0]["segment"]:
            b.insert(0, a.pop())

    # 3) سطر أقصر من min_dur ومفيش مكان بعده ← يندمج مع اللي جنبه (سطرين بالكتير)
    merged = True
    while merged:
        merged = False
        for i, ln in enumerate(lines):
            room = (lines[i + 1][0]["start"] if i + 1 < len(lines) else total) - ln[0]["start"]
            if room >= min_dur or len(lines) == 1:
                continue
            for j in (i + 1, i - 1):   # اللي بعده الأول، وبعدين اللي قبله
                if not 0 <= j < len(lines):
                    continue
                a, b = (ln, lines[j]) if j > i else (lines[j], ln)
                if len(" ".join(x["word"] for x in a + b)) <= max_chars * 2 and b[-1]["end"] - a[0]["start"] <= max_dur:
                    lines[min(i, j)] = a + b
                    del lines[max(i, j)]
                    merged = True
                    break
            if merged:
                break
    # 4) لسه فيه سطر قصير (الكلام متواصل والدمج يطلّع أكتر من سطرين): نحرّك الحد بينه وبين اللي جنبه لحد ما الاتنين ياخدوا وقت كفاية
    def room(k):
        return (lines[k + 1][0]["start"] if k + 1 < len(lines) else total) - lines[k][0]["start"]
    for i in range(len(lines)):
        if room(i) >= min_dur:
            continue
        for j in (i + 1, i - 1):
            if not 0 <= j < len(lines):
                continue
            a_i, b_i = min(i, j), max(i, j)
            both = lines[a_i] + lines[b_i]
            end_b = lines[b_i + 1][0]["start"] if b_i + 1 < len(lines) else total
            opts = []
            for k in range(1, len(both)):
                p1, p2 = both[:k], both[k:]
                if (len(" ".join(x["word"] for x in p1)) <= max_chars * 2 and len(" ".join(x["word"] for x in p2)) <= max_chars * 2
                        and p2[0]["start"] - p1[0]["start"] >= min_dur and end_b - p2[0]["start"] >= min_dur and norm(p1[-1]["word"]) not in DANGLING):
                    opts.append((p2[0]["start"] - p1[-1]["end"] - 0.3 * (norm(p2[0]["word"]) in TIED), k))
            if opts:
                k = max(opts)[1]
                lines[a_i], lines[b_i] = both[:k], both[k:]
                break
    cues = []
    for i, ln in enumerate(lines):
        nxt = lines[i + 1][0]["start"] if i + 1 < len(lines) else total
        start = ln[0]["start"]
        end = max(ln[-1]["end"] + 0.2, start + min_dur)
        end = min(end, nxt - 0.04, start + max_dur, total)
        cues.append({"start": round(start, 3), "end": round(end, 3), "text": " ".join(w["word"] for w in ln).rstrip("،,.؛;:"), "segment": ln[0]["segment"],
                     "words": [{k: w[k] for k in ("word", "start", "end", "p", "source", "src_i", "orig")} for w in ln],
                     "p_mean": round(float(np.mean([w["p"] for w in ln])), 3)})
    # لسه أقصر من min_dur (مفيش دمج ينفع): بياخد من السكتة اللي قبله (يظهر قبل أول كلمة بشوية، مش بعد ما الكلام يخلص)
    for k, c in enumerate(cues):
        short = min_dur - (c["end"] - c["start"])
        if short > 0:
            floor = cues[k - 1]["end"] + 0.04 if k else 0.0
            c["start"] = round(max(floor, c["start"] - short), 3)
    for c in cues:
        c["id"] = f"c{cues.index(c) + 1}"
    if cues:
        cues[0]["forced_breaks"] = forced
    return cues


# ---------- محاذاة الكلمات على فترات الكلام (VAD) ----------
def align_to_vad(words: list[dict], chunks: list[dict]) -> tuple[list[dict], dict]:
    """توقيت بداية الكلمة من whisper ممكن يزيح ثواني لورا (بيمدّ الكلمة على السكتة اللي قبلها، زي «التفاعل» 9.86–12.70 والكلام بادئ 12.00).
    اتقاس على تسجيل حقيقي: نهاية الكلمة عند whisper بتقع في فترة الكلام (VAD) الصح في كل الحالات اللي اتراجعت
    (اتأكدنا بتفريغ كل فترة لوحدها: «التفاعل» في 12.00–16.16، «كتير» في 16.58–17.31، «بس» في 17.86–19.68).
    القاعدة: الكلمة في الفترة اللي فيها نهايتها (بالترتيب)، وأول كلمة في الفترة بتبدأ مع أول صوتها، والباقي ما يخرجش بره الفترة."""
    if not words or not chunks:
        return words, {"aligned": False}
    out = [dict(w, raw_start=w.get("raw_start", w["start"]), raw_end=w.get("raw_end", w["end"])) for w in words]
    j_prev = 0
    for w in out:
        e = w["raw_end"]
        inside = [k for k, c in enumerate(chunks) if c["start"] - 0.05 <= e <= c["end"] + 0.05]
        j = inside[0] if inside else min(range(len(chunks)), key=lambda k: min(abs(chunks[k]["start"] - e), abs(chunks[k]["end"] - e)))
        j = max(j, j_prev)   # بالترتيب
        w["chunk"], j_prev = j, j
    moved = 0
    for k, w in enumerate(out):
        c = chunks[w["chunk"]]
        first = k == 0 or out[k - 1]["chunk"] != w["chunk"]
        prev_end = out[k - 1]["end"] if k else 0.0
        start = c["start"] if first else max(w["raw_start"], prev_end, c["start"])
        end = min(max(w["raw_end"], start + 0.05), c["end"])
        if end <= start:
            end = min(c["end"], start + 0.05)
        if abs(start - w["raw_start"]) > 0.15:
            moved += 1
        w["start"], w["end"] = round(start, 3), round(end, 3)
    return out, {"aligned": True, "chunks": len(chunks), "moved": moved, "words": len(out)}
