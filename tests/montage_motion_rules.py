"""اختبار قواعد الموشن جرافيك والرؤية والمحاذاة (من غير ميديا):
- الاختيار من الكلام: رقم ← counter، نفي («عنديش … كتير») ← مقياس قليل مش كتير، كلمة ليها أيقونة ← keyword من نفس العبارة بس.
- جملة نص من غير أي عنصر حركة ← مرفوضة.
- طريقة العرض بقاعدة: شرح طويل فيه كمية ← explainer؛ من غير متكلم ← overlay بس.
- المكان: مفيش مستطيل فوق الوش/الشخص ولا في منطقة الترجمة؛ لو مفيش مكان ← None.
- محاذاة الكلمات على فترات الكلام (VAD) بنهاية الكلمة.
الاستخدام: .venv/bin/python tests/montage_motion_rules.py
"""

import sys
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from app.montage import cuts, motion, vision  # noqa: E402


def W(w, a, b, p=0.95):
    return {"word": w, "start": a, "end": b, "p": p}


def idea(ws, i="i1"):
    return {"id": i, "cues": [{"words": ws}], "start": ws[0]["start"], "end": ws[-1]["end"]}


def main() -> int:
    fails = []
    # رقم ← عدّاد
    g = motion.choose(idea([W("بيوفّر", 0, .4), W("تلاتين", .4, .9), W("دقيقة", .9, 1.3), W("كل", 1.3, 1.5), W("يوم", 1.5, 1.9)]), True, {})
    if g.get("kind") != "counter" or g.get("value") != 30:
        fails.append(f"number → counter: {g}")
    # نفي ← مقياس قليل
    ws = [W("ممكن", 0, .3), W("يكون", .3, .6), W("عنديش", .6, 1), W("اصحاب", 1, 1.3), W("كتير", 1.3, 1.7), W("ممكن", 2.5, 2.8), W("يكون", 2.8, 3.2),
          W("التفاعل", 4, 4.6), W("مع", 4.6, 4.8), W("المجتمع", 4.8, 5.4), W("بسيط", 5.4, 5.9)]
    g = motion.choose(idea(ws), True, {})
    if g.get("kind") != "meter" or g.get("level", 1) > 0.4 or g.get("mode") != "explainer":
        fails.append(f"negated quantity → low meter, explainer: {g}")
    g2 = motion.choose(idea(ws), False, {})
    if g2.get("mode") != "overlay":
        fails.append(f"no speaker → no explainer: {g2.get('mode')}")
    # keyword من نفس العبارة (ما يعدّيش السكتة)
    ws = [W("انا", 0, .1), W("شايف", .1, .3), W("ان", .3, .4), W("دي", .4, .6), W("حاجة", .6, 1), W("كويسة", 1, 1.5), W("يكون", 5.4, 5.6), W("شخص", 5.6, 6)]
    g = motion.choose(idea(ws), True, {})
    if g.get("kind") != "keyword" or "يكون" in g.get("title", "") or "كويسة" not in g.get("title", ""):
        fails.append(f"keyword stays in its clause: {g}")
    # نص من غير حركة ← مرفوض
    g = motion.choose(idea([W("الكلام", 0, .4), W("ده", .4, .6), W("بيتقال", .6, 1.0), W("كده", 1.0, 1.2)]), True, {})
    if "skip" not in g:
        fails.append(f"plain text must be rejected: {g}")
    # المكان: شخص في النص من 25% لتحت، وش 30–48%
    occ = np.zeros((114, 64), bool)
    occ[int(0.25 * 114):, int(0.1 * 64):int(0.86 * 64)] = True
    r = motion.place("keyword", occ, "9:16")
    if not r or r["bottom"] > 0.25 or vision.overlap_ratio(occ, r) > 0.02 or (r["bottom"] > motion.SUB_BAND[0] and r["top"] < motion.SUB_BAND[1]):
        fails.append(f"placement must avoid speaker + subtitle band: {r}")
    full = np.ones((114, 64), bool)
    if motion.place("keyword", full, "9:16") is not None:
        fails.append("no free space must return None (→ inset/skip)")
    # محاذاة على الـ VAD بنهاية الكلمة
    words = [W("ممكن", 7.94, 9.28), W("يكون", 9.28, 9.84), W("التفاعل", 9.86, 12.70), W("بتاعي", 12.70, 13.24)]
    chunks = [{"start": 8.93, "end": 11.23}, {"start": 12.0, "end": 16.16}]
    al, rep = cuts.align_to_vad(words, chunks)
    if al[2]["start"] != 12.0 or al[0]["start"] != 8.93:
        fails.append(f"VAD alignment: {[(w['word'], w['start'], w['end']) for w in al]}")
    print(f"meter: {motion.choose(idea(ws), True, {}) and 'ok'} · aligned: {[(w['word'], w['start']) for w in al]}")
    print("PASS" if not fails else "FAIL:\n  " + "\n  ".join(fails))
    return 1 if fails else 0


if __name__ == "__main__":
    sys.exit(main())
