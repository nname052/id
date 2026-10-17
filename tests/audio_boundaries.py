"""قياس حدود الجمل في الصوت (من غير ما نصرف رصيد): بنقرا voice.mp3 و words.json الموجودين.

1) كل حد بين جملتين: الفجوة بين آخر كلمة وأول كلمة (لو سالبة = تداخل في التوقيت).
2) الجمل اللي اتعادت (آخر إعادة، من نسخة undo): بنعرف مكان القص بالظبط ونقيس "الصوت الزيادة"
   اللي جه مع الجملة الجديدة قبل أول كلمة فيها أو بعد آخر كلمة (ده اللي بيطلع حرف مكرر).
الاستخدام: .venv/bin/python tests/audio_boundaries.py [videos/<pid> ...]
"""

import json
import subprocess
import sys
from pathlib import Path

import numpy as np

SR, HOP = 16000, 0.01


def load(path: Path) -> np.ndarray:
    raw = subprocess.run(["ffmpeg", "-v", "error", "-i", str(path), "-ac", "1", "-ar", str(SR), "-f", "f32le", "-"], capture_output=True, check=True).stdout
    return np.frombuffer(raw, dtype=np.float32)


def env_db(x: np.ndarray) -> np.ndarray:
    n = int(SR * HOP)
    m = len(x) // n
    fr = x[: m * n].reshape(m, n)
    return 20 * np.log10(np.sqrt((fr ** 2).mean(axis=1)) + 1e-9)


def voiced_secs(db: np.ndarray, t0: float, t1: float, thr: float) -> float:
    a, b = max(0, int(t0 / HOP)), max(0, int(t1 / HOP))
    return round(float((db[a:b] > thr).sum()) * HOP, 3) if b > a else 0.0


def sentence_bounds(words: list[dict]) -> list[tuple[int, int, float, float]]:
    out = []
    for w0, w1 in zip(words, words[1:]):
        if w0["sid"] != w1["sid"]:
            out.append((w0["sid"], w1["sid"], w0["end"], w1["start"]))
    return out


def analyze(d: Path) -> dict:
    W = json.loads((d / "words.json").read_text())
    words = W["words"]
    db = env_db(load(d / "audio" / "voice.mp3"))
    speech = np.median(db[db > np.percentile(db, 40)])
    thr = speech - 22  # "فيه كلام" لو الطاقة أعلى من (متوسط الكلام − 22 dB)
    res = {"project": d.name, "threshold_db": round(float(thr), 1), "boundaries": []}
    for s0, s1, e, s in sentence_bounds(words):
        res["boundaries"].append({"from": s0, "to": s1, "gap": round(s - e, 3), "timestamp_overlap": s < e})
    # آخر جملة اتعادت: مكان القص من الكلمات القديمة (undo) والجديدة
    u = d / "audio" / "undo" / "words.json"
    p = json.loads((d / "project.json").read_text())
    regens = (p.get("usage") or {}).get("elevenlabs_extra") or []
    if u.exists() and regens:
        sid = regens[-1]["sentence"]
        old = json.loads(u.read_text())
        ow, nw = old["words"], words
        mine_o = [w for w in ow if w["sid"] == sid]
        before = [w for w in ow if ow.index(w) < ow.index(mine_o[0])]
        after = [w for w in ow if ow.index(w) > ow.index(mine_o[-1])]
        a = max(before[-1]["end"] + 0.02 if before else 0.0, mine_o[0]["start"] - 0.05)
        b = min(after[0]["start"] - 0.02 if after else old["duration"], mine_o[-1]["end"] + 0.12)
        shift = W["duration"] - old["duration"]
        dur = shift + b - a
        mine_n = [w for w in nw if w["sid"] == sid]
        pre = (a, mine_n[0]["start"])        # جزء الجملة الجديدة قبل أول كلمة فيها
        post = (mine_n[-1]["end"], a + dur)  # وبعد آخر كلمة فيها
        res["splice"] = {"sentence": sid, "cut_in": round(a, 3), "cut_out": round(a + dur, 3),
                         "pre_roll": [round(x, 3) for x in pre], "post_roll": [round(x, 3) for x in post],
                         # كلام جوه الـ pre/post roll = صوت من الجملة اللي جنبها اتكرر مع الجديدة
                         "extra_speech_pre": voiced_secs(db, pre[0], pre[1] - 0.04, thr),
                         "extra_speech_post": voiced_secs(db, post[0] + 0.06, post[1], thr)}
    return res


if __name__ == "__main__":
    dirs = [Path(x) for x in sys.argv[1:]] or sorted(p for p in Path("videos").glob("2026-*") if (p / "words.json").exists() and (p / "audio" / "voice.mp3").exists())
    print(json.dumps([analyze(d) for d in dirs], ensure_ascii=False, indent=1))
