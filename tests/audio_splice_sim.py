"""محاكاة إعادة جملة من غير ما نصرف رصيد: بنستخدم نسختين حقيقيتين من نفس الجملة موجودين على الجهاز
(الصوت قبل آخر إعادة في audio/undo، والصوت الحالي فيه الطلب الجديد)، ونركّب الجملة بالقاعدة القديمة وبالجديدة،
ونقيس: كلام زيادة جوه الحتة المتركّبة قبل أول كلمة/بعد آخر كلمة (= حرف مكرر)، وعلو الصوت عند كل قصّة.
الاستخدام: .venv/bin/python tests/audio_splice_sim.py <out_dir>
"""

import json
import subprocess
import sys
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from app.pipeline.audio import ENV_HOP, _envelope, splice_points  # noqa: E402


def old_rule(before, mine, after, old_dur, g_before, g_mine, g_after, gdur):
    a = max(before[-1]["end"] + 0.02 if before else 0.0, mine[0]["start"] - 0.05)
    b = min(after[0]["start"] - 0.02 if after else old_dur, mine[-1]["end"] + 0.12)
    ca = max((g_before[-1]["end"] + g_mine[0]["start"]) / 2 if g_before else 0.0, g_mine[0]["start"] - 0.12)
    cb = min((g_mine[-1]["end"] + g_after[0]["start"]) / 2 if g_after else gdur + 0.1, g_mine[-1]["end"] + 0.18)
    return a, b, ca, cb


def voiced(db, t0, t1, thr):
    i, j = max(0, int(t0 / ENV_HOP)), max(0, int(t1 / ENV_HOP))
    return round(float((db[i:j] > thr).sum()) * ENV_HOP, 3) if j > i else 0.0


def level_at(db, t):
    i = min(len(db) - 1, max(0, int(t / ENV_HOP)))
    return round(float(db[i]), 1)


def splice(old_mp3, a, b, take_mp3, ca, cb, out_wav):
    run = lambda *x: subprocess.run(["ffmpeg", "-y", "-v", "error", *x], check=True)  # noqa: E731
    fade = "afade=t=in:d=0.02,areverse,afade=t=in:d=0.04,areverse"
    tmp = out_wav.parent
    run("-i", str(old_mp3), "-t", f"{a:.3f}", "-ar", "44100", "-ac", "1", str(tmp / "p1.wav"))
    run("-ss", f"{ca:.3f}", "-t", f"{cb - ca:.3f}", "-i", str(take_mp3), "-af", fade, "-ar", "44100", "-ac", "1", str(tmp / "p2.wav"))
    run("-ss", f"{b:.3f}", "-i", str(old_mp3), "-ar", "44100", "-ac", "1", str(tmp / "p3.wav"))
    (tmp / "l.txt").write_text("file 'p1.wav'\nfile 'p2.wav'\nfile 'p3.wav'\n")
    run("-f", "concat", "-safe", "0", "-i", str(tmp / "l.txt"), "-c:a", "pcm_s16le", str(out_wav))


def main(out: Path):
    out.mkdir(parents=True, exist_ok=True)
    rows = []
    for d in sorted(Path("videos").glob("2026-*")):
        u = d / "audio" / "undo"
        p = json.loads((d / "project.json").read_text()) if (d / "project.json").exists() else {}
        regens = (p.get("usage") or {}).get("elevenlabs_extra") or []
        if not (u / "voice.mp3").exists() or not regens:
            continue
        sid = regens[-1]["sentence"]
        old_w, take_w = json.loads((u / "words.json").read_text()), json.loads((d / "words.json").read_text())
        ow, tw = old_w["words"], take_w["words"]
        mine = [w for w in ow if w["sid"] == sid]
        before = [w for w in ow if ow.index(w) < ow.index(mine[0])]
        after = [w for w in ow if ow.index(w) > ow.index(mine[-1])]
        g_mine = [w for w in tw if w["sid"] == sid]
        g_before = [w for w in tw if tw.index(w) < tw.index(g_mine[0])]
        g_after = [w for w in tw if tw.index(w) > tw.index(g_mine[-1])]
        old_db, take_db = _envelope(u / "voice.mp3"), _envelope(d / "audio" / "voice.mp3")
        speech = np.median(take_db[take_db > np.percentile(take_db, 40)])
        thr = speech - 22
        for name, pts in (("old_rule", old_rule(before, mine, after, old_w["duration"], g_before, g_mine, g_after, take_w["duration"])),
                          ("new_rule", splice_points(old_db, before, mine, after, old_w["duration"], take_db, g_before, g_mine, g_after,
                                                     len(take_db) * ENV_HOP))):
            a, b, ca, cb = pts
            # الكلام الزيادة جوه الحتة المتركّبة: قبل أول كلمة فيها وبعد آخر كلمة (بعد 60 مللي لنَفَس الكلمة نفسها)
            extra_pre = voiced(take_db, ca, g_mine[0]["start"] - 0.04, thr)
            extra_post = voiced(take_db, g_mine[-1]["end"] + 0.06, cb, thr)
            # وفي القديم: اللي بيرجع بعد الحتة الجديدة قبل أول كلمة من الجملة اللي بعدها (ديل الجملة القديمة)
            old_tail = voiced(old_db, b, (after[0]["start"] - 0.04) if after else b, thr)
            old_head = voiced(old_db, (before[-1]["end"] + 0.06) if before else a, a, thr)
            wav = out / f"{d.name}_s{sid}_{name}.wav"
            splice(u / "voice.mp3", a, b, d / "audio" / "voice.mp3", ca, cb, wav)
            # مقطع للسماع حوالين نهاية الجملة المتركّبة
            t_end = a + (cb - ca)
            subprocess.run(["ffmpeg", "-y", "-v", "error", "-ss", f"{max(0, t_end - 1.6):.3f}", "-t", "3.0", "-i", str(wav), str(wav.with_suffix(".clip.m4a"))], check=True)
            rows.append({"project": d.name, "sentence": sid, "rule": name, "a": a, "b": b, "ca": ca, "cb": cb,
                         "dup_speech_s": round(extra_pre + extra_post + old_tail + old_head, 3),
                         "parts": {"new_pre": extra_pre, "new_post": extra_post, "old_tail_after": old_tail, "old_head_before": old_head},
                         "level_at_cuts_db": {"a": level_at(old_db, a), "b": level_at(old_db, b), "ca": level_at(take_db, ca), "cb": level_at(take_db, cb)},
                         "speech_threshold_db": round(float(thr), 1), "clip": str(wav.with_suffix(".clip.m4a"))})
    print(json.dumps(rows, ensure_ascii=False, indent=1))


if __name__ == "__main__":
    main(Path(sys.argv[1]))
