"""الكلام في المونتاج (أدوات مجانية على الـ CPU):
- تفريغ بـ faster-whisper مع توقيت كل كلمة (الموديل من MONTAGE_WHISPER_MODEL، الافتراضي medium:
  اتقاس على كلام مصري: small غلطه 56% وmedium حوالي 15%).
- السكتات من FFmpeg (silencedetect).
- منحنى علو الصوت كل 10 مللي (علشان القصّة تقع في أوطى نقطة).
"""

import re
import subprocess
import threading
import time
from pathlib import Path

import numpy as np

from ..config import ENV

MODEL = ENV.get("MONTAGE_WHISPER_MODEL") or "medium"
MIN_CONF = 0.5          # متوسط ثقة الكلمات أقل من كده = التفريغ مش موثوق ← نقسّم بالسكتات بدل الكلام
SR, HOP = 16000, 0.01
_model = None
_mlock = threading.Lock()


def pcm(path: Path) -> np.ndarray:
    raw = subprocess.run(["ffmpeg", "-v", "error", "-i", str(path), "-vn", "-ac", "1", "-ar", str(SR), "-f", "f32le", "-"],
                         capture_output=True, check=True).stdout
    return np.frombuffer(raw, dtype=np.float32)


def envelope(path: Path) -> np.ndarray:
    """علو الصوت بالـ dB كل 10 مللي (متنعّم على 30 مللي)."""
    x = pcm(path)
    n = int(SR * HOP)
    m = len(x) // n
    if m == 0:
        return np.full(1, -120.0)
    fr = x[: m * n].reshape(m, n)
    db = 20 * np.log10(np.sqrt((fr ** 2).mean(axis=1)) + 1e-9)
    return np.convolve(db, np.ones(3) / 3, mode="same")


def pauses(path: Path, duration: float, noise_db: float = -35, min_d: float = 0.25) -> list[dict]:
    """السكتات (FFmpeg silencedetect): أي فترة أوطى من noise_db لمدة min_d ثانية على الأقل."""
    r = subprocess.run(["ffmpeg", "-hide_banner", "-nostats", "-i", str(path), "-vn", "-af", f"silencedetect=noise={noise_db}dB:d={min_d}",
                        "-f", "null", "-"], capture_output=True, text=True)
    out, start = [], None
    for line in r.stderr.splitlines():
        if m := re.search(r"silence_start: (-?[\d.]+)", line):
            start = max(0.0, float(m.group(1)))
        elif (m := re.search(r"silence_end: ([\d.]+)", line)) and start is not None:
            out.append({"start": round(start, 3), "end": round(float(m.group(1)), 3)}); start = None
    if start is not None:
        out.append({"start": round(start, 3), "end": round(duration, 3)})
    return out


def _load():
    global _model
    if _model is None:
        from faster_whisper import WhisperModel
        _model = WhisperModel(MODEL, device="cpu", compute_type="int8")
    return _model


def transcribe(path: Path, language: str = "ar") -> dict:
    """كلام الملف بالكلمات وتوقيتها. language: ar | en | auto."""
    t0 = time.time()
    audio = pcm(path)
    with _mlock:  # موديل واحد في الذاكرة، وطلب واحد في نفس الوقت
        segs, info = _load().transcribe(audio, language=None if language == "auto" else language, word_timestamps=True,
                                        beam_size=5, vad_filter=False, condition_on_previous_text=False)
        words, segments = [], []
        for s in segs:
            first = len(words)
            for w in s.words or []:
                if w.word.strip():
                    words.append({"word": w.word.strip(), "start": round(float(w.start), 3), "end": round(float(w.end), 3), "p": round(float(w.probability), 3)})
            if len(words) > first:
                segments.append({"start": words[first]["start"], "end": words[-1]["end"], "text": s.text.strip(), "first": first, "last": len(words) - 1})
    mean_p = round(float(np.mean([w["p"] for w in words])), 3) if words else 0.0
    return {"engine": f"faster-whisper {MODEL} (CPU, int8)", "language": info.language, "language_prob": round(float(info.language_probability), 3),
            "words": words, "segments": segments, "mean_prob": mean_p, "seconds": round(time.time() - t0, 2)}


def speech_from_pauses(pause_list: list[dict], duration: float, min_len: float = 0.2) -> list[dict]:
    """الفترات اللي فيها صوت = كل حاجة بين السكتات (لو التفريغ فشل أو مش موثوق)."""
    out, t = [], 0.0
    for p in sorted(pause_list, key=lambda x: x["start"]):
        if p["start"] - t >= min_len:
            out.append({"start": round(t, 3), "end": round(p["start"], 3)})
        t = max(t, p["end"])
    if duration - t >= min_len:
        out.append({"start": round(t, 3), "end": round(duration, 3)})
    return out
