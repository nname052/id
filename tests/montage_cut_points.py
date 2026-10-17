"""اختبار اختيار نقط القصّ في المونتاج (من غير ميديا): نص تجريبي بتوقيت كل كلمة.
لازم: ولا قصّة جوه كلمة، وكل قصّة عند نهاية جملة أو سكتة، والاختيار حسب السياق (حشو / جملة اتعادت / كلام مقطوع بيتشال).
وكمان التعديل بالكلام ("شيل أول/آخر N ثواني") لازم ينقل القصّة لأقرب سكتة.
الاستخدام: .venv/bin/python tests/montage_cut_points.py   (بيطبع النتيجة، وبيرجع exit 1 لو فيه فشل)
"""

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from app.montage import cuts, nl  # noqa: E402


def W(word, a, b, p=0.95):
    return {"word": word, "start": a, "end": b, "p": p}


# نص تجريبي (20 ثانية): جمل بعلامات، سكتات، كلمات لازقة في بعض، حشو، جملة اتعادت، وقطع لقطة في نص الكلام
WORDS = [
    W("النهارده", 0.40, 0.95), W("هنتكلم", 0.95, 1.40), W("عن", 1.40, 1.55), W("التركيز.", 1.55, 2.20),          # جملة 1 (نقطة)
    W("أول", 2.80, 3.05), W("حاجة", 3.05, 3.40), W("اقفل", 3.40, 3.80), W("الموبايل", 3.80, 4.40),            # جملة 2 (سكتة بعدها)
    W("آه", 5.10, 5.40, 0.6),                                                                                   # حشو لوحده
    W("تاني", 6.00, 6.30), W("حاجة", 6.30, 6.60), W("اشتغل", 6.60, 7.00), W("بالساعة", 7.00, 7.60),          # take أول
    W("تاني", 8.20, 8.50), W("حاجة", 8.50, 8.80), W("اشتغل", 8.80, 9.20), W("بالساعة", 9.20, 9.80),          # نفس الجملة اتعادت
    W("وفي", 10.40, 10.70), W("الآخر", 10.70, 11.10), W("خد", 11.10, 11.40), W("بريك", 11.40, 11.95),        # بيتقطع بقطع لقطة
    W("قصير", 12.00, 12.40),                                                                                   # حتة بعد القطع (12.0)
    W("وكده", 13.20, 13.60), W("خلصنا", 13.60, 14.30),                                                          # جملة أخيرة
]
SEGMENTS = [{"start": 0.40, "end": 2.20, "first": 0, "last": 3}, {"start": 2.80, "end": 4.40, "first": 4, "last": 7},
            {"start": 5.10, "end": 5.40, "first": 8, "last": 8}, {"start": 6.00, "end": 7.60, "first": 9, "last": 12},
            {"start": 8.20, "end": 9.80, "first": 13, "last": 16}, {"start": 10.40, "end": 12.40, "first": 17, "last": 21},
            {"start": 13.20, "end": 14.30, "first": 22, "last": 23}]
SCENE_CUTS = [11.97]
DURATION = 15.0
PAUSES = [{"start": 0.0, "end": 0.40}, {"start": 2.20, "end": 2.80}, {"start": 4.40, "end": 5.10}, {"start": 5.40, "end": 6.00},
          {"start": 7.60, "end": 8.20}, {"start": 9.80, "end": 10.40}, {"start": 12.40, "end": 13.20}, {"start": 14.30, "end": 15.0}]


def main() -> int:
    fails = []
    units = cuts.choose(cuts.build_units(WORDS, SEGMENTS, PAUSES, SCENE_CUTS, DURATION, "s1"), DURATION)
    segs = cuts.plan_segments(units, WORDS, None, DURATION)
    rep = cuts.cut_report(segs, {"s1": WORDS})
    kept = [u["text"] for u in units if u["keep"]]
    dropped = {u["text"]: u["reason"] for u in units if not u["keep"]}

    # 1) ولا قصّة جوه كلمة
    if rep["inside_word"]:
        fails.append(f"cuts inside a word: {[c for c in rep['list'] if c['inside_word']]}")
    # 2) كل قصّة عند نهاية جملة أو سكتة (والمسافة لأقرب كلمة ≥ EDGE)
    for c in rep["list"]:
        if c["kind"] not in ("sentence_end", "pause"):
            fails.append(f"cut at {c['t']} has kind {c['kind']}")
        near = min(min(abs(c["t"] - w["start"]), abs(c["t"] - w["end"])) for w in WORDS)
        if near < cuts.EDGE - 1e-6:
            fails.append(f"cut at {c['t']} is {near:.3f}s from a word edge")
    # 3) الاختيار حسب السياق
    expect_dropped = {"آه": "حشو", "تاني حاجة اشتغل بالساعة": "اتعادت", "وفي الآخر خد بريك": "مقطوعة", "قصير": "حتة كلمة"}
    for text, why in expect_dropped.items():
        if text not in dropped or why not in dropped[text]:
            fails.append(f"expected «{text}» dropped ({why}), got {dropped.get(text, 'kept')}")
    if kept.count("تاني حاجة اشتغل بالساعة") != 1:
        fails.append("the retake should keep exactly one take (the last)")
    # 4) التعديل بالكلام: القصّة بتتنقل لأقرب سكتة (حتى لو الكلمتين لازقين في بعض)
    wbs = {"s1": WORDS}
    trimmed, notes = nl.trim_start(segs, 1.2, wbs)      # 1.2 ث من الأول بيقع جوه "هنتكلم"/"عن" (لازقين)
    t_in = trimmed[0]["start"]
    if any(w["start"] < t_in < w["end"] for w in WORDS) or not any(a["end"] <= t_in <= b["start"] and b["start"] - a["end"] >= 0.12 for a, b in zip(WORDS, WORDS[1:])):
        fails.append(f"trim_start landed at {t_in}, not inside a real pause")
    trimmed_end, _ = nl.trim_end(segs, 0.5, wbs)
    t_out = trimmed_end[-1]["end"]
    if any(w["start"] < t_out < w["end"] for w in WORDS):
        fails.append(f"trim_end landed inside a word at {t_out}")

    print(f"units: {len(units)} · kept: {len(kept)} · dropped: {len(dropped)}")
    for t, why in dropped.items():
        print(f"  dropped «{t}»: {why}")
    print(f"segments: {[(s['id'], s['start'], s['end']) for s in segs]}")
    print(f"cuts: {rep['cuts']} · inside a word: {rep['inside_word']} · by kind: {rep['by_kind']}")
    print(f"trim 1.2 s from start → cut at {t_in} ({notes}) · trim 0.5 s from end → cut at {t_out}")
    print("PASS" if not fails else "FAIL:\n  " + "\n  ".join(fails))
    return 1 if fails else 0


if __name__ == "__main__":
    sys.exit(main())
