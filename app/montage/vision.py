"""الرؤية في المونتاج (MediaPipe، Apache 2.0، على الـ CPU): الوش والشخص في كل فريم.

- كشف الوش: BlazeFace short range ← صندوق الوش (علشان الإضاءة تتظبط على الوش، والترجمة/الجرافيك ما يغطوهوش).
- تقسيم الشخص: Selfie segmenter ← قناع الشخص كله (جسم + هدوم + شعر) ← المساحة الفاضية في الكادر، وتنعيم/تهدئة الخلفية.
- الموديلات بتتحمّل مرة واحدة في data/models (مش في git): .venv/bin/python -m app.montage.vision
كل الإحداثيات نسبة من فريم الإخراج (بعد الإطار 9:16/16:9)، علشان كل المراحل تتكلم بنفس الأرقام.
"""

import json
import subprocess
import threading
import urllib.request
from pathlib import Path

import numpy as np

from ..config import ROOT

MODELS = ROOT / "data" / "models"
URLS = {  # Google MediaPipe model zoo (Apache 2.0)
    "face": "https://storage.googleapis.com/mediapipe-models/face_detector/blaze_face_short_range/float16/1/blaze_face_short_range.tflite",
    "segment": "https://storage.googleapis.com/mediapipe-models/image_segmenter/selfie_segmenter/float16/latest/selfie_segmenter.tflite",
}
FILES = {"face": MODELS / "blaze_face_short_range.tflite", "segment": MODELS / "selfie_segmenter.tflite"}
_lock = threading.Lock()
_cache: dict = {}


def fetch() -> None:
    MODELS.mkdir(parents=True, exist_ok=True)
    for k, url in URLS.items():
        if not FILES[k].exists():
            urllib.request.urlretrieve(url, FILES[k])


def available() -> bool:
    return all(f.exists() for f in FILES.values())


def _models():
    if "face" not in _cache:
        from mediapipe.tasks.python import BaseOptions, vision
        _cache["face"] = vision.FaceDetector.create_from_options(vision.FaceDetectorOptions(
            base_options=BaseOptions(model_asset_path=str(FILES["face"])), min_detection_confidence=0.5))
        _cache["segment"] = vision.ImageSegmenter.create_from_options(vision.ImageSegmenterOptions(
            base_options=BaseOptions(model_asset_path=str(FILES["segment"])), output_confidence_masks=True))
    return _cache["face"], _cache["segment"]


def analyze(frame: np.ndarray) -> dict:
    """فريم RGB ← {faces: [[x0,y0,x1,y1,score]] نسبة، person: [x0,y0,x1,y1] نسبة أو None، mask: قناع صغير 64×114 (0..1)}."""
    import cv2
    import mediapipe as mp
    H, W = frame.shape[:2]
    with _lock:
        fd, seg = _models()
        img = mp.Image(image_format=mp.ImageFormat.SRGB, data=np.ascontiguousarray(frame))
        faces = fd.detect(img).detections
        m = seg.segment(img).confidence_masks[0].numpy_view()[..., 0].astype(np.float32)
    fs = [[d.bounding_box.origin_x / W, d.bounding_box.origin_y / H, (d.bounding_box.origin_x + d.bounding_box.width) / W,
           (d.bounding_box.origin_y + d.bounding_box.height) / H, round(float(d.categories[0].score), 3)] for d in faces]
    ys, xs = np.nonzero(m > 0.5)
    person = [xs.min() / W, ys.min() / H, (xs.max() + 1) / W, (ys.max() + 1) / H] if len(xs) > 0.002 * W * H else None
    small = cv2.resize(m, (64, round(64 * H / W)), interpolation=cv2.INTER_AREA)
    return {"faces": [[round(v, 4) for v in f] for f in fs], "person": [round(float(v), 4) for v in person] if person else None, "mask": small}


def track(path: Path, times: list[float], fit_vf: str) -> list[dict]:
    """الوش والشخص على أوقات من الملف، على فريم الإخراج نفسه (بعد الإطار)."""
    from .look import frames
    out = []
    for t, f in zip(times, frames(path, times, fit_vf, width=540)):
        a = analyze(f)
        out.append({"t": round(t, 3), "faces": a["faces"], "person": a["person"], "mask": a["mask"]})
    return out


def occupancy(samples: list[dict], thr: float = 0.35) -> np.ndarray:
    """الأماكن اللي فيها الشخص في أي لحظة من العينات (اتحاد الأقنعة) ← شبكة 0/1 بنفس مقاس القناع الصغير، مع هامش حوالين الوش."""
    if not samples:
        return np.zeros((114, 64), bool)
    occ = np.zeros_like(samples[0]["mask"], dtype=bool)
    gh, gw = occ.shape
    for s in samples:
        occ |= s["mask"] > thr
        for x0, y0, x1, y1, _ in s["faces"]:   # الوش + هامش 15% (شعر/دقن/حركة الراس)
            mx, my = (x1 - x0) * 0.15, (y1 - y0) * 0.2
            occ[max(0, int((y0 - my) * gh)):min(gh, int((y1 + my) * gh) + 1), max(0, int((x0 - mx) * gw)):min(gw, int((x1 + mx) * gw) + 1)] = True
    return occ


def overlap_ratio(occ: np.ndarray, rect: dict) -> float:
    """نسبة مساحة المستطيل (نسبة من الفريم) اللي فيها الشخص."""
    gh, gw = occ.shape
    y0, y1 = int(rect["top"] * gh), max(int(rect["top"] * gh) + 1, int(np.ceil(rect["bottom"] * gh)))
    x0, x1 = int(rect["left"] * gw), max(int(rect["left"] * gw) + 1, int(np.ceil(rect["right"] * gw)))
    cell = occ[y0:y1, x0:x1]
    return float(cell.mean()) if cell.size else 1.0


def faces_at(samples: list[dict], t: float) -> list[list[float]]:
    """صناديق الوش في أقرب عينة لوقت معيّن."""
    if not samples:
        return []
    s = min(samples, key=lambda x: abs(x["t"] - t))
    return s["faces"]


def mask_video(src: Path, out: Path, fps: int, conv: str, fit_vf: str, W: int, H: int, feather: float = 0.004) -> dict:
    """قناع الشخص لكل فريم من الملف (بعد تحويل الفريمات والإطار) ← فيديو رمادي (أبيض = الشخص).
    التنعيم: Gaussian على الحواف (feather من العرض) + متوسط متحرك على الوقت (علشان الحواف ما ترتعشش)."""
    import cv2
    w, h = 270, round(270 * H / W)
    dec = subprocess.Popen(["ffmpeg", "-v", "error", "-i", str(src), "-vf", f"{conv},{fit_vf},scale={w}:{h},format=rgb24", "-f", "rawvideo", "-"],
                           stdout=subprocess.PIPE)
    enc = subprocess.Popen(["ffmpeg", "-v", "error", "-y", "-f", "rawvideo", "-pix_fmt", "gray", "-s", f"{w}x{h}", "-r", str(fps), "-i", "-",
                            "-vf", f"scale={W}:{H}:flags=bicubic", "-c:v", "libx264", "-crf", "12", "-pix_fmt", "yuv420p", str(out)], stdin=subprocess.PIPE)
    prev, n, cover = None, 0, []
    sig = max(0.6, feather * w)
    while True:
        raw = dec.stdout.read(w * h * 3)
        if len(raw) < w * h * 3:
            break
        f = np.frombuffer(raw, np.uint8).reshape(h, w, 3)
        with _lock:
            import mediapipe as mp
            _, seg = _models()
            m = seg.segment(mp.Image(image_format=mp.ImageFormat.SRGB, data=np.ascontiguousarray(f))).confidence_masks[0].numpy_view()[..., 0]
        # حافة أنضف: القناع أحدّ، وبيتقلص بكسلين جوه الجسم، وبعدين تنعيم ضيق — علشان تصحيح المتكلم ما يسيبش «هالة» على الحيطة جنبه
        m = np.clip((m.astype(np.float32) - 0.5) * 3.0 + 0.5, 0, 1)
        m = cv2.erode(m, np.ones((3, 3), np.uint8), iterations=1)
        m = cv2.GaussianBlur(m, (0, 0), sig)
        m = m if prev is None else 0.6 * m + 0.4 * prev
        prev = m
        cover.append(float((m > 0.5).mean()))
        enc.stdin.write((np.clip(m, 0, 1) * 255).astype(np.uint8).tobytes())
        n += 1
    enc.stdin.close()
    enc.wait(); dec.wait()
    return {"frames": n, "coverage_mean": round(float(np.mean(cover)) if cover else 0.0, 3), "file": str(out)}


if __name__ == "__main__":
    fetch()
    print({k: (str(v), v.exists()) for k, v in FILES.items()})


def track_stream(path: Path, fps: float, fit_vf: str, conv: str = "", start: float = 0.0, dur: float | None = None) -> list[dict]:
    """نفس track بس بفك واحد للملف كله (fps عينات في الثانية): أسرع بكتير من فريم فريم."""
    w = 360
    vf = ",".join(x for x in [conv, fit_vf, f"fps={fps}", f"scale={w}:-2", "format=rgb24"] if x)
    args = ["ffmpeg", "-v", "error", "-ss", f"{start:.3f}"] + (["-t", f"{dur:.3f}"] if dur else []) + ["-i", str(path), "-vf", vf, "-f", "rawvideo", "-"]
    probe = subprocess.run(["ffmpeg", "-v", "error", "-ss", f"{start:.3f}", "-i", str(path), "-frames:v", "1", "-vf",
                            ",".join(x for x in [fit_vf, f"scale={w}:-2"] if x), "-f", "rawvideo", "-pix_fmt", "rgb24", "-"], capture_output=True).stdout
    h = len(probe) // (w * 3)
    raw = subprocess.run(args, capture_output=True).stdout
    n = len(raw) // (w * h * 3)
    out = []
    for i in range(n):
        f = np.frombuffer(raw[i * w * h * 3:(i + 1) * w * h * 3], np.uint8).reshape(h, w, 3)
        a = analyze(f)
        out.append({"t": round(start + i / fps, 3), "faces": a["faces"], "person": a["person"], "mask": a["mask"]})
    return out


def save_samples(samples: list[dict], path: Path) -> None:
    np.savez_compressed(path, t=np.array([s["t"] for s in samples]), mask=np.array([(s["mask"] * 255).astype(np.uint8) for s in samples]),
                        meta=json.dumps([{"faces": s["faces"], "person": s["person"]} for s in samples]))


def load_samples(path: Path) -> list[dict]:
    z = np.load(path)
    meta = json.loads(str(z["meta"]))
    return [{"t": float(t), "mask": m.astype(np.float32) / 255, **mm} for t, m, mm in zip(z["t"], z["mask"], meta)]


def window(samples: list[dict], a: float, b: float) -> list[dict]:
    """العينات اللي في وقت معيّن من الملف (مع هامش عينة)."""
    sel = [s for s in samples if a - 0.21 <= s["t"] <= b + 0.21]
    return sel or ([min(samples, key=lambda s: abs(s["t"] - (a + b) / 2))] if samples else [])
