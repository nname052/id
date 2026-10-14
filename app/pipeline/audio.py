"""المرحلة 4: الصوت من ElevenLabs (الكلام كله في طلب واحد علشان النبرة تفضل متصلة) + توقيت كل كلمة."""

import base64
import difflib
import re
import time

import requests

from .. import store
from ..config import ELEVEN_KEY, TTS_MODEL
from .common import words_of

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
        for tok in ln["tts"].split():
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


def run(pid: str, approved_credits: bool = False) -> None:
    d = store.project_dir(pid)
    proj = store.load(pid)
    st = proj["settings"]
    text, spans = build_text(store.read_json(d / "tts.json")["lines"])
    before = subscription()
    left = before["limit"] - before["used"]
    if not approved_credits and left - len(text) < before["limit"] * 0.2:
        raise NeedsCredits(f"هيستهلك حوالي {len(text)} credit، والمتبقي {left} (هيقل عن 20%)")
    r = requests.post(
        f"{API}/v1/text-to-speech/{st['voice_id']}/with-timestamps",
        headers={"xi-api-key": ELEVEN_KEY}, params={"output_format": "mp3_44100_128"},
        json={"text": text, "model_id": TTS_MODEL, "voice_settings": {"stability": float(st.get("stability", 0.5))}},
        timeout=300,
    )
    if r.status_code != 200:
        raise RuntimeError(f"ElevenLabs HTTP {r.status_code}: {r.text[:300]}")
    data = r.json()
    (d / "audio").mkdir(exist_ok=True)
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


# ---------- إعادة جملة واحدة ----------
def _tts(text: str, settings: dict, prev: str = "", nxt: str = "") -> dict:
    body = {"text": text, "model_id": TTS_MODEL, "voice_settings": {"stability": float(settings.get("stability", 0.5))}}
    if prev or nxt:
        body |= {"previous_text": prev, "next_text": nxt}  # علشان نبرة الجملة تفضل متصلة باللي حواليها
    r = requests.post(f"{API}/v1/text-to-speech/{settings['voice_id']}/with-timestamps", headers={"xi-api-key": ELEVEN_KEY},
                      params={"output_format": "mp3_44100_128"}, json=body, timeout=300)
    if r.status_code == 400 and (prev or nxt):  # لو الموديل مش بيقبل السياق: من غيره
        return _tts(text, settings)
    if r.status_code != 200:
        raise RuntimeError(f"ElevenLabs HTTP {r.status_code}: {r.text[:300]}")
    return r.json()


def regen_sentence(pid: str, sid: int) -> None:
    """بيولّد صوت جملة واحدة ويركّبه مكانها في الصوت الكامل، وبيزحزح توقيت اللي بعدها."""
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
    mine = [w for w in words if w["sid"] == sid]
    before = [w for w in words if words.index(w) < words.index(mine[0])]
    after = [w for w in words if words.index(w) > words.index(mine[-1])]
    a = max(before[-1]["end"] + 0.02 if before else 0.0, mine[0]["start"] - 0.05)
    b = min(after[0]["start"] - 0.02 if after else W["duration"], mine[-1]["end"] + 0.12)
    data = _tts(line["tts"], st, " ".join(l["display"] for l in lines[max(0, idx - 2):idx]), " ".join(l["display"] for l in lines[idx + 1:idx + 3]))
    text, spans = build_text([line])
    new = words_from_alignment(text, spans, data["alignment"])
    dur = data["alignment"]["character_end_times_seconds"][-1] + 0.08
    with tempfile.TemporaryDirectory() as tmp:
        tmp = Path(tmp)
        (tmp / "new.mp3").write_bytes(base64.b64decode(data["audio_base64"]))
        voice = d / "audio" / "voice.mp3"
        run = lambda *args: subprocess.run(["ffmpeg", "-y", "-loglevel", "error", *args], check=True)
        run("-i", str(voice), "-t", f"{a:.3f}", "-ar", "44100", "-ac", "1", str(tmp / "p1.wav"))
        run("-i", str(tmp / "new.mp3"), "-t", f"{dur:.3f}", "-ar", "44100", "-ac", "1", str(tmp / "p2.wav"))
        run("-ss", f"{b:.3f}", "-i", str(voice), "-ar", "44100", "-ac", "1", str(tmp / "p3.wav"))
        (tmp / "list.txt").write_text("file 'p1.wav'\nfile 'p2.wav'\nfile 'p3.wav'\n")
        run("-f", "concat", "-safe", "0", "-i", str(tmp / "list.txt"), "-c:a", "libmp3lame", "-b:a", "128k", str(tmp / "out.mp3"))
        voice.write_bytes((tmp / "out.mp3").read_bytes())
    shift = (a + dur) - b
    for w in new:
        w["start"], w["end"] = round(w["start"] + a, 3), round(w["end"] + a, 3)
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
    store.update(pid, lambda p: p["usage"].setdefault("elevenlabs_extra", []).append({"sentence": sid, "chars": len(line["tts"])}))


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
