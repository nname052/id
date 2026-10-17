"""فحص كل حدود الجمل (من غير رصيد): لو قصّينا عند الحد ده، القصّة هتقع في سكوت ولا جوه صوت؟
القصّة اللي بتقع جوه صوت (ديل آخر حرف أو أول حرف من الجملة اللي جنبها) هي اللي بتطلّع الحرف المكرر لما الجملة تتعاد.
بنقارن القاعدة القديمة (توقيت ثابت من الكلمات) بالجديدة (أوطى نقطة طاقة) على كل الحدود في كل الملفات.
الاستخدام: .venv/bin/python tests/audio_cut_check.py
"""

import json
import sys
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from app.pipeline.audio import ENV_HOP, _envelope, quiet_point  # noqa: E402


def level(db, t):
    i = min(len(db) - 1, max(0, int(t / ENV_HOP)))
    return float(db[i])


def main():
    rows, total = [], {"old": 0, "new": 0, "cuts": 0}
    for d in sorted(Path("videos").glob("2026-*")):
        if not (d / "words.json").exists() or not (d / "audio" / "voice.mp3").exists():
            continue
        words = json.loads((d / "words.json").read_text())["words"]
        db = _envelope(d / "audio" / "voice.mp3")
        for w0, w1 in zip(words, words[1:]):
            if w0["sid"] == w1["sid"]:
                continue
            e, s = w0["end"], w1["start"]
            # أرضية السكوت حوالين الحد ده: أوطى طاقة في ±0.35 ثانية؛ "جوه صوت" = أعلى منها بـ 20 dB
            lo, hi = max(0, int((e - 0.35) / ENV_HOP)), int((s + 0.35) / ENV_HOP)
            floor = float(np.min(db[lo:hi]))
            inside = lambda t: level(db, t) > floor + 20  # noqa: E731
            cuts = {  # نفس الحد بيتقص من ناحيتين: نهاية الجملة اللي قبله وبداية اللي بعده
                "old_end_cut": min(s - 0.02, e + 0.12), "old_start_cut": max(e + 0.02, s - 0.05),
                "old_mid_cut": (e + s) / 2, "new_cut": quiet_point(db, e, s)}
            r = {"project": d.name, "boundary": f"{w0['sid']}→{w1['sid']}", "gap": round(s - e, 3), "floor_db": round(floor, 1),
                 **{k: {"t": round(v, 3), "db": round(level(db, v), 1), "inside_sound": inside(v)} for k, v in cuts.items()}}
            old_bad = any(r[k]["inside_sound"] for k in ("old_end_cut", "old_start_cut", "old_mid_cut"))
            r["old_rule_overlap"], r["new_rule_overlap"] = old_bad, r["new_cut"]["inside_sound"]
            total["cuts"] += 1; total["old"] += old_bad; total["new"] += r["new_cut"]["inside_sound"]
            rows.append(r)
    print(json.dumps({"summary": total, "boundaries": rows}, ensure_ascii=False, indent=1))


if __name__ == "__main__":
    main()
