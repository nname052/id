"""المرحلة 4: الصوت من ElevenLabs (الكلام كله في طلب واحد علشان النبرة تفضل متصلة) + توقيت كل كلمة."""

import base64
import difflib
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
