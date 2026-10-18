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
# تمهيد عام للهجة المصرية (مش فيه كلام الفيديو): على تسجيل موبايل حقيقي الثقة طلعت من 0.69 لـ 0.74، وبقى فيه ترقيم
# (علامات الترقيم بتساعد في حدود الجمل والسطور)، وكلمات زي «كتير/كويسة» اتفهمت صح بدل «كثير/جويزة».
DIALECT_PROMPT = {"ar": "ده كلام باللهجة المصرية العامية. إزيك، عامل إيه؟ النهارده هحكيلك حاجة، علشان كده دلوقتي برضه."}
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


def silence_threshold(env: np.ndarray) -> dict:
    """حد السكوت حسب التسجيل نفسه (مش رقم ثابت): بين أرضية الدوشة (10%) وعلو الكلام (90%).
    تسجيل موبايل بعيد كلامه حوالين −49 dB: الحد الثابت −35 كان بيعد الكلام الواطي سكوت."""
    noise, speech_ = float(np.percentile(env, 10)), float(np.percentile(env, 90))
    thr = noise + 0.4 * (speech_ - noise)
    thr = min(-30.0, max(noise + 6.0, thr))
    return {"threshold_db": round(thr, 1), "noise_db": round(noise, 1), "speech_db": round(speech_, 1)}


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
                                        beam_size=5, vad_filter=False, condition_on_previous_text=False, initial_prompt=DIALECT_PROMPT.get(language))
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
            "words": words, "segments": segments, "mean_prob": mean_p, "seconds": round(time.time() - t0, 2),
            "prompt": DIALECT_PROMPT.get(language)}


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


def noise_floor(path: Path, pause_list: list[dict]) -> float | None:
    """أرضية الدوشة: علو الصوت (dB RMS) في نص السكتات الطويلة (بعيد عن أطراف الكلام)."""
    env = envelope(path)
    vals = []
    for p in pause_list:
        a, b = p["start"] + 0.08, p["end"] - 0.08
        if b - a >= 0.1:
            vals += list(env[int(a / HOP):int(b / HOP)])
    return round(float(np.median(vals)), 1) if vals else None


def cut_jumps(path: Path, times: list[float], win: float = 0.03) -> list[dict]:
    """عند كل قصّة: الفرق في العلو بين الـ 30 مللي اللي قبلها واللي بعدها، وأكبر قفزة sample-to-sample (تكّة) حواليها."""
    x = pcm(path)
    out = []
    for t in times:
        i = int(t * SR)
        w = int(win * SR)
        a, b = x[max(0, i - w):i], x[i:i + w]
        if len(a) < 10 or len(b) < 10:
            continue
        ra, rb = 20 * np.log10(np.sqrt((a ** 2).mean()) + 1e-9), 20 * np.log10(np.sqrt((b ** 2).mean()) + 1e-9)
        seg = x[max(0, i - w):i + w]
        step = float(np.abs(np.diff(seg)).max()) if len(seg) > 1 else 0.0
        out.append({"t": round(t, 3), "jump_db": round(float(abs(ra - rb)), 1), "level_db": round(float(max(ra, rb)), 1), "max_step": round(step, 4)})
    return out
