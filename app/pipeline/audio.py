"""المرحلة 4: الصوت من ElevenLabs (الكلام كله في طلب واحد علشان النبرة تفضل متصلة) + توقيت كل كلمة."""

import base64
import difflib
import re
import time

import requests

from .. import store
from ..config import ELEVEN_KEY, TTS_MODEL, TTS_SPEED
from .. import eleven_account
from .common import tokens, words_of

API = "https://api.elevenlabs.io"


class NeedsCredits(Exception):
    pass


def subscription() -> dict:
    r = requests.get(f"{API}/v1/user/subscription", headers={"xi-api-key": ELEVEN_KEY}, timeout=30)
    r.raise_for_status()
    d = r.json()
    return {"used": d.get("character_count", 0), "limit": d.get("character_limit", 0), "tier": d.get("tier")}


def build_text(lines: list[dict]) -> tuple[str, list[dict]]:
    """النص اللي بيروح للصوت + مكان كل كلمة فيه (بالحروف)، والكلمة المعروضة المقابلة ليها."""
    parts, spans, pos = [], [], 0
    for ln in lines:
        disp = ln["display"].split()
        k = 0
        for tok in tokens(ln["tts"]):
            if parts:
                pos += 1
            if not tok.startswith("["):
                spans.append({"sid": ln["id"], "word": disp[k] if k < len(disp) else tok, "a": pos, "b": pos + len(tok)})
                k += 1
            parts.append(tok)
            pos += len(tok)
    return " ".join(parts), spans


def words_from_alignment(text: str, spans: list[dict], al: dict) -> list[dict]:
    chars = "".join(al["characters"])
    starts, ends = al["character_start_times_seconds"], al["character_end_times_seconds"]
    if chars == text:
        mapping = {i: i for i in range(len(text))}
    else:  # ElevenLabs ممكن يغيّر حرف أو اتنين: بنربط بالمقارنة
        mapping = {}
        for m in difflib.SequenceMatcher(None, text, chars, autojunk=False).get_matching_blocks():
            for k in range(m.size):
                mapping[m.a + k] = m.b + k
    out = []
    for i, sp in enumerate(spans):
        idx = [mapping[j] for j in range(sp["a"], sp["b"]) if j in mapping]
        if idx:
            out.append({"i": i, "word": sp["word"], "sid": sp["sid"], "start": round(starts[min(idx)], 3), "end": round(ends[max(idx)], 3)})
        else:
            prev = out[-1]["end"] if out else 0
            out.append({"i": i, "word": sp["word"], "sid": sp["sid"], "start": prev, "end": prev + 0.2})
    return out


def estimate_cost(pid: str) -> int:
    tts = store.read_json(store.project_dir(pid) / "tts.json")
    return len(build_text(tts["lines"])[0]) if tts else 0


def cost_breakdown(lines: list[dict]) -> list[tuple[int, int]]:
    """التكلفة التقديرية لكل جملة (بنفس الحساب: credit لكل حرف بيتبعت)."""
    return [(ln["id"], len(build_text([ln])[0])) for ln in lines]


def guard_message(total: int, limit: int, per_sentence: list[tuple[int, int]] | None = None) -> str:
    msg = f"الصوت ده هيستهلك حوالي {total} credit، وده أكتر من حد الموافقة اللي حاطه ({limit} credit للمرة الواحدة)."
    if per_sentence:
        shown = "، ".join(f"جملة {i}: {c}" for i, c in per_sentence[:12]) + ("…" if len(per_sentence) > 12 else "")
        msg += f" التكلفة لكل جملة: {shown}."
    return msg + " تكمّل؟"


def run(pid: str, approved_credits: bool = False) -> None:
    d = store.project_dir(pid)
    proj = store.load(pid)
    st = proj["settings"]
    lines = store.read_json(d / "tts.json")["lines"]
    text, spans = build_text(lines)
    # حد الموافقة (من صفحة الإعدادات): قبل أي طلب لـ ElevenLabs، فمفيش رصيد بيتصرف لحد ما توافق
    if not approved_credits and len(text) > eleven_account.guard():
        raise NeedsCredits(guard_message(len(text), eleven_account.guard(), cost_breakdown(lines)))
    before = subscription()
    left = before["limit"] - before["used"]
    if not approved_credits and left - len(text) < before["limit"] * 0.2:
        raise NeedsCredits(f"هيستهلك حوالي {len(text)} credit، والمتبقي {left} (هيقل عن 20%)")
    r = requests.post(
        f"{API}/v1/text-to-speech/{st['voice_id']}/with-timestamps",
        headers={"xi-api-key": ELEVEN_KEY}, params={"output_format": "mp3_44100_128"},
        json={"text": text, "model_id": TTS_MODEL, "voice_settings": {"stability": float(st.get("stability", 0.5)), "speed": TTS_SPEED}, "seed": seed_of(pid)},
        timeout=300,
    )
    if r.status_code != 200:
        raise RuntimeError(f"ElevenLabs HTTP {r.status_code}: {r.text[:300]}")
    eleven_account.record("tts_ok")
    data = r.json()
    (d / "audio").mkdir(exist_ok=True)
    import shutil
    shutil.rmtree(d / "audio" / "undo", ignore_errors=True)  # صوت جديد كله: نسخة الرجوع القديمة مبقتش تنفع
    (d / "audio" / "voice.mp3").write_bytes(base64.b64decode(data["audio_base64"]))
    store.write_json(d / "audio" / "alignment.json", data["alignment"])
    words = words_from_alignment(text, spans, data["alignment"])
    store.write_json(d / "words.json", {"source": "elevenlabs", "duration": data["alignment"]["character_end_times_seconds"][-1], "words": words})
    after = subscription()
    for _ in range(6):  # ElevenLabs بيحدّث الرصيد متأخر شوية
        if after["used"] != before["used"]:
            break
        time.sleep(2)
        after = subscription()

    def usage(p):
        p["usage"]["elevenlabs"] = {"expected": len(text), "actual": after["used"] - before["used"], "left": after["limit"] - after["used"]}
    store.update(pid, usage)


def estimated_words(pid: str) -> dict:
    """توقيت تقديري للمعاينة قبل ما الصوت يتعمل (على طول الكلمة + سكتة آخر الجملة)."""
    script = store.read_json(store.project_dir(pid) / "script.json")
    t, out = 0.3, []
    for s in script["sentences"]:
        ws = s["text"].split()
        for w in ws:
            dur = 0.16 + 0.06 * len(w)
            out.append({"i": len(out), "word": w, "sid": s["id"], "start": round(t, 3), "end": round(t + dur, 3)})
            t += dur + 0.06
            if w.endswith("..."):
                t += 0.4
        t += 0.35
    return {"source": "estimate", "duration": round(t, 2), "words": out}


# ---------- نقط القص عند السكوت الحقيقي ----------
# توقيت الكلمات من ElevenLabs بيقول الحرف خلص امتى، بس صوت آخر حرف (والنَفَس) بيكمّل بعدها شوية، وأول حرف ممكن يبدأ قبلها.
# القص على توقيت ثابت من الكلمات (زي "آخر كلمة + 0.12") كان بيقع جوه الصوت: ديل الجملة القديمة أو بداية الجملة اللي بعدها
# بيترص جنب نفس الصوت من الطلب الجديد ← حرف/مقطع بيتكرر. دلوقتي كل قصّة بتقع على أوطى نقطة طاقة فعلية بين الجملتين.
ENV_SR, ENV_HOP = 16000, 0.01


def _envelope(src) -> "np.ndarray":
    """طاقة الصوت (dB) كل 10 مللي ثانية. src: مسار ملف أو bytes."""
    import subprocess

    import numpy as np
    args = ["ffmpeg", "-v", "error", "-i", "pipe:0" if isinstance(src, (bytes, bytearray)) else str(src), "-ac", "1", "-ar", str(ENV_SR), "-f", "f32le", "-"]
    raw = subprocess.run(args, input=src if isinstance(src, (bytes, bytearray)) else None, capture_output=True, check=True).stdout
    x = np.frombuffer(raw, dtype=np.float32)
    n = int(ENV_SR * ENV_HOP)
    m = len(x) // n
    db = 20 * np.log10(np.sqrt((x[: m * n].reshape(m, n) ** 2).mean(axis=1)) + 1e-9)
    return np.convolve(db, np.ones(3) / 3, mode="same")  # تنعيم 30 مللي ثانية


def quiet_point(db, t0: float, t1: float) -> float:
    """أوطى نقطة طاقة في الفجوة بين جملتين (t0 = آخر كلمة خلصت، t1 = أول كلمة بدأت).
    توقيت ElevenLabs ساعات بيتأخر/يتقدم ~0.1 ثانية، فلو مفيش سكوت حقيقي جوه الفجوة بنوسّع البحث بالتدريج
    (0، 0.06، 0.12، 0.2 ثانية) لحد ما نلاقي سكوت (جوه 20 dB من أرضية السكوت حوالين الحد). ومن بين نقط السكوت بناخد الأقرب لنص الفجوة."""
    import numpy as np
    lo, hi = max(0, int((t0 - 0.35) / ENV_HOP)), min(len(db), int((t1 + 0.35) / ENV_HOP) + 1)
    if hi <= lo:
        return max(0.0, (t0 + t1) / 2)
    floor = float(db[lo:hi].min())
    center = (t0 + t1) / 2
    best = None
    for pad in (0.0, 0.06, 0.12, 0.2):
        a, b = max(0, int((t0 - pad) / ENV_HOP)), min(len(db), int((t1 + pad) / ENV_HOP) + 1)
        if b <= a:
            continue
        seg = db[a:b]
        near = np.where(seg <= seg.min() + 1.0)[0]
        i = int(near[np.argmin(np.abs((a + near) * ENV_HOP - center))])
        best = (a + i) * ENV_HOP + ENV_HOP / 2
        if seg.min() <= floor + 20:  # لقينا سكوت حقيقي
            break
    return round(best, 3)


def splice_points(old_db, before: list, mine: list, after: list, old_dur: float,
                  new_db, g_before: list, g_mine: list, g_after: list, new_dur: float, insert: bool = False) -> tuple:
    """(a, b) في الصوت القديم و (ca, cb) في الطلب الجديد: كل قصّة عند السكوت الحقيقي بين الجملتين."""
    if insert or not mine:
        nxt = after[0]["start"] if after else old_dur
        a = b = quiet_point(old_db, before[-1]["end"], nxt) if before else 0.0
    else:
        a = quiet_point(old_db, before[-1]["end"], mine[0]["start"]) if before else quiet_point(old_db, 0.0, mine[0]["start"])
        b = quiet_point(old_db, mine[-1]["end"], after[0]["start"]) if after else old_dur
    ca = quiet_point(new_db, g_before[-1]["end"], g_mine[0]["start"]) if g_before else quiet_point(new_db, 0.0, g_mine[0]["start"])
    cb = quiet_point(new_db, g_mine[-1]["end"], g_after[0]["start"]) if g_after else min(new_dur, quiet_point(new_db, g_mine[-1]["end"], new_dur))
    return a, b, ca, cb


# ---------- إعادة جملة واحدة ----------
# الجملة لوحدها (نص قصير) بتخلي eleven_v3 يرتجل شخصية الصوت من الأول، فبتطلع كأنها صوت تاني.
# علشان كده بنبعتها وسط الجمل اللي حواليها في طلب واحد (نفس السياق اللي اتقالت فيه أول مرة)، ونقص جملتنا بس.
CTX_BEFORE, CTX_AFTER = 2, 1


def seed_of(pid: str) -> int:
    """بذرة ثابتة للمشروع: نفس البذرة في كل طلبات الصوت بتاعته."""
    import zlib
    return zlib.crc32(pid.encode()) % 4294967295


def _tts(text: str, settings: dict, seed: int) -> dict:
    body = {"text": text, "model_id": TTS_MODEL, "voice_settings": {"stability": float(settings.get("stability", 0.5)), "speed": TTS_SPEED}, "seed": seed}
    r = requests.post(f"{API}/v1/text-to-speech/{settings['voice_id']}/with-timestamps", headers={"xi-api-key": ELEVEN_KEY},
                      params={"output_format": "mp3_44100_128"}, json=body, timeout=300)
    if r.status_code != 200:
        raise RuntimeError(f"ElevenLabs HTTP {r.status_code}: {r.text[:300]}")
    eleven_account.record("tts_ok")
    return r.json()


def _context(lines: list[dict], idx: int) -> list[dict]:
    return lines[max(0, idx - CTX_BEFORE):idx + 1 + CTX_AFTER]


def sentence_cost(pid: str, sid: int) -> int:
    lines = store.read_json(store.project_dir(pid) / "tts.json")["lines"]
    idx = next(i for i, ln in enumerate(lines) if ln["id"] == sid)
    return len(build_text(_context(lines, idx))[0])


def _mean_db(path, start: float | None = None, dur: float | None = None) -> float | None:
    """متوسط علو الصوت (dB) لجزء من ملف."""
    import subprocess
    args = ["ffmpeg", "-hide_banner", "-nostats"] + (["-ss", f"{start:.3f}"] if start is not None else []) + \
           (["-t", f"{dur:.3f}"] if dur is not None else []) + ["-i", str(path), "-af", "volumedetect", "-f", "null", "-"]
    out = subprocess.run(args, capture_output=True, text=True).stderr
    m = re.search(r"mean_volume: (-?[\d.]+) dB", out)
    return float(m.group(1)) if m else None


def undo_sentence(pid: str) -> bool:
    """بيرجّع الصوت والتوقيت زي ما كانوا قبل آخر إعادة جملة."""
    import shutil
    d = store.project_dir(pid)
    u = d / "audio" / "undo"
    if not (u / "voice.mp3").exists():
        return False
    shutil.copy(u / "voice.mp3", d / "audio" / "voice.mp3")
    shutil.copy(u / "words.json", d / "words.json")
    shutil.rmtree(u)
    return True


def regen_sentence(pid: str, sid: int, insert: bool = False) -> None:
    """بيولّد صوت جملة واحدة (وسط الجمل اللي حواليها) ويركّبه مكانها في الصوت الكامل، وبيزحزح توقيت اللي بعدها.
    insert=True: جملة جديدة اتضافت للسكريبت (مالهاش صوت): بتتحط في مكانها بين اللي قبلها واللي بعدها."""
    import shutil
    import subprocess
    import tempfile
    from pathlib import Path

    from .. import prefs

    d = store.project_dir(pid)
    st = store.load(pid)["settings"]
    tts = store.read_json(d / "tts.json")
    for ln in tts["lines"]:  # القاموس ممكن يكون اتحدّث من ساعة ما الصوت اتعمل
        ln["tts"] = prefs.apply_pronunciations(ln["tts"], ln["display"])
    store.write_json(d / "tts.json", tts)
    lines = tts["lines"]
    idx = next(i for i, ln in enumerate(lines) if ln["id"] == sid)
    line = lines[idx]
    W = store.read_json(d / "words.json")
    words = W["words"]
    order = {ln["id"]: i for i, ln in enumerate(lines)}
    mine = [w for w in words if w["sid"] == sid]
    if insert or not mine:
        # جملة جديدة: مكانها بعد آخر كلمة في الجمل اللي قبلها
        before = [w for w in words if order.get(w["sid"], -1) < idx]
        after = [w for w in words if order.get(w["sid"], -1) > idx]
        mine = []
    else:
        before = [w for w in words if words.index(w) < words.index(mine[0])]
        after = [w for w in words if words.index(w) > words.index(mine[-1])]

    # الجملة وسط سياقها في طلب واحد، وبعدين نقص جملتنا من الصوت الجديد
    ctx = _context(lines, idx)
    text, spans = build_text(ctx)
    data = _tts(text, st, seed_of(pid))
    gen = words_from_alignment(text, spans, data["alignment"])
    gdur = data["alignment"]["character_end_times_seconds"][-1]
    g_mine = [w for w in gen if w["sid"] == sid]
    g_before = [w for w in gen if w["i"] < g_mine[0]["i"]]
    g_after = [w for w in gen if w["i"] > g_mine[-1]["i"]]
    voice = d / "audio" / "voice.mp3"
    new_bytes = base64.b64decode(data["audio_base64"])
    old_db, new_db = _envelope(voice), _envelope(new_bytes)
    # كل قصّة (في القديم وفي الجديد) عند أوطى نقطة طاقة فعلية بين الجملتين، مش على توقيت ثابت من الكلمات
    a, b, ca, cb = splice_points(old_db, before, mine, after, W["duration"], new_db, g_before, g_mine, g_after,
                                 len(new_db) * ENV_HOP, insert=insert or not mine)
    dur = cb - ca

    u = d / "audio" / "undo"  # نسخة للرجوع لو الإعادة ماعجبتكش
    u.mkdir(exist_ok=True)
    shutil.copy(voice, u / "voice.mp3")
    shutil.copy(d / "words.json", u / "words.json")
    with tempfile.TemporaryDirectory() as tmp:
        tmp = Path(tmp)
        (tmp / "new.mp3").write_bytes(new_bytes)
        # نفس علو صوت الجملة القديمة
        ref = (a, b - a) if b - a > 0.3 else ((before[0]["start"], before[-1]["end"] - before[0]["start"]) if before else (0, 2))
        old_lvl, new_lvl = _mean_db(voice, *ref), _mean_db(tmp / "new.mp3", ca, dur)
        gain = max(-8.0, min(8.0, old_lvl - new_lvl)) if old_lvl is not None and new_lvl is not None else 0.0
        run = lambda *args: subprocess.run(["ffmpeg", "-y", "-loglevel", "error", *args], check=True)
        fade = "afade=t=in:d=0.02,areverse,afade=t=in:d=0.04,areverse"
        run("-i", str(voice), "-t", f"{a:.3f}", "-ar", "44100", "-ac", "1", str(tmp / "p1.wav"))
        run("-ss", f"{ca:.3f}", "-t", f"{dur:.3f}", "-i", str(tmp / "new.mp3"), "-af", f"volume={gain:.2f}dB,{fade}", "-ar", "44100", "-ac", "1", str(tmp / "p2.wav"))
        run("-ss", f"{b:.3f}", "-i", str(voice), "-ar", "44100", "-ac", "1", str(tmp / "p3.wav"))
        (tmp / "list.txt").write_text("file 'p1.wav'\nfile 'p2.wav'\nfile 'p3.wav'\n")
        run("-f", "concat", "-safe", "0", "-i", str(tmp / "list.txt"), "-c:a", "libmp3lame", "-b:a", "128k", str(tmp / "out.mp3"))
        voice.write_bytes((tmp / "out.mp3").read_bytes())
    shift = (a + dur) - b
    new = [{**w, "start": round(w["start"] - ca + a, 3), "end": round(w["end"] - ca + a, 3)} for w in g_mine]
    for w in after:
        w["start"], w["end"] = round(w["start"] + shift, 3), round(w["end"] + shift, 3)
    out = before + new + after
    for i, w in enumerate(out):
        w["i"] = i
    store.write_json(d / "words.json", {"source": "elevenlabs", "duration": round(W["duration"] + shift, 3), "words": out})
    rv = store.read_json(d / "audio" / "review.json")
    if rv:  # الجملة اتعادت: علامات المراجعة القديمة بتاعتها مبقتش صح
        rv["flags"] = {k: v for k, v in rv.get("flags", {}).items() if int(k) != sid}
        store.write_json(d / "audio" / "review.json", rv)
    store.update(pid, lambda p: p["usage"].setdefault("elevenlabs_extra", []).append({"sentence": sid, "chars": len(text), "gain_db": round(gain, 1)}))


# ---------- مراجعة النطق (اختيارية) ----------
DIACRITICS = re.compile(r"[ً-ْٰـ]")


def _norm(w: str) -> str:
    w = DIACRITICS.sub("", w)
    w = re.sub(r"[^\w]", "", w)
    return w.replace("أ", "ا").replace("إ", "ا").replace("آ", "ا").replace("ة", "ه").replace("ى", "ي")


def review(pid: str) -> None:
    """بيحوّل الصوت لكلام مكتوب (ElevenLabs Speech to Text) ويقارنه بالسكريبت، ويعلّم الكلمات اللي اتنطقت مختلف."""
    import difflib as dl

    d = store.project_dir(pid)
    with open(d / "audio" / "voice.mp3", "rb") as f:
        r = requests.post(f"{API}/v1/speech-to-text", headers={"xi-api-key": ELEVEN_KEY},
                          data={"model_id": "scribe_v1", "language_code": "ara", "tag_audio_events": "false"},
                          files={"file": ("voice.mp3", f, "audio/mpeg")}, timeout=300)
    if r.status_code != 200:
        raise RuntimeError(f"مراجعة النطق: ElevenLabs HTTP {r.status_code}: {r.text[:200]}")
    heard = [_norm(w["text"]) for w in r.json().get("words", []) if w.get("type", "word") == "word" and _norm(w["text"])]
    words = store.read_json(d / "words.json")["words"]
    expected = [_norm(w["word"]) for w in words]
    flags: dict = {}
    for op, i1, i2, j1, j2 in dl.SequenceMatcher(None, expected, heard, autojunk=False).get_opcodes():
        if op == "equal":
            continue
        for i in range(i1, i2):  # كلمة اتنطقت مختلف أو اتشالت
            heard_as = " ".join(heard[j1:j2])
            if heard_as and dl.SequenceMatcher(None, expected[i], heard_as).ratio() > 0.8:
                continue  # فرق بسيط في الكتابة مش في النطق
            flags.setdefault(str(words[i]["sid"]), []).append({"i": words[i]["i"], "word": words[i]["word"], "heard": heard_as})
    store.write_json(d / "audio" / "review.json", {"flags": flags, "heard": " ".join(heard)})


def remove_sentence(pid: str, sid: int) -> None:
    """جملة اتشالت من السكريبت: بنشيل صوتها ونقرّب اللي بعدها (وبنسيب سكتة طبيعية بين الجملتين)."""
    import shutil
    import subprocess
    import tempfile
    from pathlib import Path

    d = store.project_dir(pid)
    W = store.read_json(d / "words.json")
    words = W["words"]
    mine = [w for w in words if w["sid"] == sid]
    if not mine:
        return
    before = [w for w in words if w["end"] <= mine[0]["start"] and w["sid"] != sid]
    after = [w for w in words if w["start"] >= mine[-1]["end"] and w["sid"] != sid]
    a = mine[0]["start"] - 0.05 if before else 0.0
    b = after[0]["start"] - 0.05 if after else W["duration"]
    voice = d / "audio" / "voice.mp3"
    u = d / "audio" / "undo"
    u.mkdir(exist_ok=True)
    shutil.copy(voice, u / "voice.mp3")
    shutil.copy(d / "words.json", u / "words.json")
    with tempfile.TemporaryDirectory() as tmp:
        tmp = Path(tmp)
        run = lambda *args: subprocess.run(["ffmpeg", "-y", "-loglevel", "error", *args], check=True)
        run("-i", str(voice), "-t", f"{max(a, 0.01):.3f}", "-ar", "44100", "-ac", "1", str(tmp / "p1.wav"))
        run("-ss", f"{b:.3f}", "-i", str(voice), "-ar", "44100", "-ac", "1", str(tmp / "p3.wav"))
        (tmp / "list.txt").write_text("file 'p1.wav'\nfile 'p3.wav'\n")
        run("-f", "concat", "-safe", "0", "-i", str(tmp / "list.txt"), "-c:a", "libmp3lame", "-b:a", "128k", str(tmp / "out.mp3"))
        voice.write_bytes((tmp / "out.mp3").read_bytes())
    shift = a - b
    for w in after:
        w["start"], w["end"] = round(w["start"] + shift, 3), round(w["end"] + shift, 3)
    out = before + after
    for i, w in enumerate(out):
        w["i"] = i
    store.write_json(d / "words.json", {"source": "elevenlabs", "duration": round(W["duration"] + shift, 3), "words": out})


# ---------- صوتك إنت (تسجيل أو ملف) ----------
def user_voice(pid: str, raw_path: str) -> None:
    """الصوت اللي سجّلته أو رفعته: بنظبط مستواه، وبنعرف توقيت كل كلمة من السكريبت عليه (forced alignment من ElevenLabs)،
    علشان الكلام على الشاشة وحركة البق يمشوا مع صوتك بالظبط."""
    import subprocess
    d = store.project_dir(pid)
    (d / "audio").mkdir(exist_ok=True)
    voice = d / "audio" / "voice.mp3"
    # مستوى صوت ثابت ومريح (loudnorm) + شيل السكوت الطويل في الأول
    subprocess.run(["ffmpeg", "-y", "-loglevel", "error", "-i", raw_path, "-af",
                    "silenceremove=start_periods=1:start_threshold=-45dB:start_silence=0.15,loudnorm=I=-16:TP=-1.5:LRA=11",
                    "-ar", "44100", "-ac", "1", "-c:a", "libmp3lame", "-b:a", "160k", str(voice)], check=True)
    lines = [{"id": s["id"], "display": s["text"], "tts": s["text"]} for s in store.read_json(d / "script.json")["sentences"]]
    text, spans = build_text(lines)
    dur = float(subprocess.run(["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", str(voice)],
                               capture_output=True, text=True).stdout.strip() or 0)
    words, how = None, "ElevenLabs"
    try:
        with open(voice, "rb") as f:
            r = requests.post(f"{API}/v1/forced-alignment", headers={"xi-api-key": ELEVEN_KEY},
                              files={"file": ("voice.mp3", f, "audio/mpeg")}, data={"text": text}, timeout=600)
        if r.status_code != 200:
            raise RuntimeError(f"HTTP {r.status_code}: {r.text[:160]}")
        chars = r.json()["characters"]
        al = {"characters": [c["text"] for c in chars], "character_start_times_seconds": [c["start"] for c in chars],
              "character_end_times_seconds": [c["end"] for c in chars]}
        store.write_json(d / "audio" / "alignment.json", al)
        words = words_from_alignment(text, spans, al)
    except Exception as e:  # noqa: BLE001  (رصيد/مفتاح/نت): بنظبط التوقيت على الجهاز
        store.log(pid, f"⚠ المحاذاة من ElevenLabs ما نفعتش ({str(e)[:120]})، بنظبط التوقيت على الجهاز من السكتات")
        words, how = local_align(voice, lines, dur), "على الجهاز"
    store.log(pid, f"✓ توقيت الكلام اتظبط على صوتك ({how})")
    store.write_json(d / "words.json", {"source": "user", "duration": round(dur, 3), "words": words})
    store.write_json(d / "tts.json", {"lines": lines})


def local_align(voice, lines: list[dict], dur: float) -> list[dict]:
    """توقيت تقريبي من غير إنترنت: بنلاقي السكتات في الصوت، ونوزّع الجمل على الكلام حسب طولها، ونثبّت حدود كل جملة على أقرب سكتة،
    وجوه الجملة الكلمات بتتوزع حسب عدد حروفها."""
    import re as _re
    import subprocess
    out = subprocess.run(["ffmpeg", "-hide_banner", "-nostats", "-i", str(voice), "-af", "silencedetect=noise=-35dB:d=0.22", "-f", "null", "-"],
                         capture_output=True, text=True).stderr
    starts = [float(x) for x in _re.findall(r"silence_start: ([\d.]+)", out)]
    ends = [float(x) for x in _re.findall(r"silence_end: ([\d.]+)", out)]
    sil = list(zip(starts, ends + [dur] * (len(starts) - len(ends))))
    # مقاطع الكلام = الوقت اللي بين السكتات
    speech, cur = [], 0.0
    for a, b in sil:
        if a - cur > 0.05:
            speech.append((cur, a))
        cur = b
    if dur - cur > 0.05:
        speech.append((cur, dur))
    total = sum(b - a for a, b in speech) or dur
    def real(x):  # من "وقت كلام" لوقت حقيقي
        for a, b in speech:
            if x <= b - a:
                return a + x
            x -= b - a
        return speech[-1][1] if speech else x
    lens = [max(1, len(l["display"].replace(" ", ""))) for l in lines]
    acc, bounds = 0, [speech[0][0] if speech else 0.0]
    mids = [(a + b) / 2 for a, b in sil]
    for n in lens[:-1]:
        acc += n
        t = real(total * acc / sum(lens))
        near = min(mids, key=lambda m: abs(m - t), default=t)
        bounds.append(near if abs(near - t) < 0.9 and near > bounds[-1] + 0.3 else t)
    bounds.append(speech[-1][1] if speech else dur)
    words = []
    for i, l in enumerate(lines):
        s0, s1 = bounds[i], bounds[i + 1]
        # بنشيل السكتة اللي في أول/آخر الجملة
        for a, b in sil:
            if a <= s0 + 0.05 < b: s0 = b
            if a < s1 - 0.05 <= b: s1 = a
        ws = l["display"].split(); n = sum(max(1, len(w)) for w in ws) or 1
        t = s0
        for w in ws:
            span = (s1 - s0) * max(1, len(w)) / n
            words.append({"i": len(words), "word": w, "sid": l["id"], "start": round(t, 3), "end": round(t + span * 0.9, 3)})
            t += span
    return words
