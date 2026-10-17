"""أدوات الميديا للمونتاج (FFmpeg / ffprobe / PySceneDetect): فحص الملف، قياس علو الصوت، وتقطيع المشاهد.
كله أدوات مجانية بتشتغل على الجهاز (CPU)، ومش بتلمس الملف الأصلي (بتشتغل على نسخة الشغل).
"""

import json
import re
import subprocess
from pathlib import Path


class BadMedia(Exception):
    """الملف مش بيتقري أو مفيهوش أي صوت/صورة."""


def _ratio(s: str | None) -> float | None:
    if not s or s in ("0/0", "N/A"):
        return None
    if "/" in s:
        a, b = s.split("/", 1)
        return round(float(a) / float(b), 3) if float(b) else None
    return round(float(s), 3)


def probe(path: Path) -> dict:
    """ffprobe: المدة والمقاس والفريمات ووجود الصوت. أي ملف ffprobe ما يقراهوش أو مفيهوش ولا stream بيترفض."""
    r = subprocess.run(["ffprobe", "-v", "error", "-show_format", "-show_streams", "-of", "json", str(path)],
                       capture_output=True, text=True)
    if r.returncode != 0:
        raise BadMedia("الملف ده مش بيتقري (ffprobe رفضه). اتأكد إنه فيديو mp4/mov أو صوت m4a سليم.")
    try:
        d = json.loads(r.stdout or "{}")
    except ValueError as e:
        raise BadMedia("الملف ده مش بيتقري (رد ffprobe مش مفهوم).") from e
    streams = d.get("streams") or []
    v = next((s for s in streams if s.get("codec_type") == "video" and not (s.get("disposition") or {}).get("attached_pic")), None)
    a = next((s for s in streams if s.get("codec_type") == "audio"), None)
    if not v and not a:
        raise BadMedia("الملف مفيهوش لا صورة ولا صوت.")
    dur = float((d.get("format") or {}).get("duration") or (v or a or {}).get("duration") or 0)
    if dur <= 0:
        raise BadMedia("مدة الملف صفر أو مش معروفة.")
    out = {"duration": round(dur, 3), "has_video": bool(v), "has_audio": bool(a), "format": (d.get("format") or {}).get("format_name")}
    if v:
        w, h = int(v.get("width") or 0), int(v.get("height") or 0)
        # فيديوهات الموبايل بتتسجّل بالعرض وفيها "لفّة" للعرض: FFmpeg بيلفّها وهو بيقرا، فبنحسب المقاس اللي بيتشاف
        rot = 0
        for sd in v.get("side_data_list") or []:
            if "rotation" in sd:
                rot = int(float(sd["rotation"]))
        if abs(rot) % 180 == 90:
            w, h = h, w
        out.update(width=w, height=h, rotation=rot, fps=_ratio(v.get("avg_frame_rate")) or _ratio(v.get("r_frame_rate")),
                   video_codec=v.get("codec_name"))
    if a:
        out.update(audio_codec=a.get("codec_name"), sample_rate=int(a.get("sample_rate") or 0), channels=a.get("channels"))
    return out


def loudness(path: Path) -> dict | None:
    """علو الصوت (EBU R128) من قياس loudnorm: Integrated LUFS و True Peak."""
    r = subprocess.run(["ffmpeg", "-hide_banner", "-nostats", "-i", str(path), "-vn", "-af", "loudnorm=print_format=json", "-f", "null", "-"],
                       capture_output=True, text=True)
    m = re.search(r"\{[^{}]*\"input_i\"[^{}]*\}", r.stderr, re.S)
    if not m:
        return None
    j = json.loads(m.group(0))
    f = lambda k: float(j[k]) if j.get(k) not in (None, "-inf", "inf") else None  # noqa: E731
    return {"integrated_lufs": f("input_i"), "true_peak_dbtp": f("input_tp"), "lra_lu": f("input_lra"), "threshold_lufs": f("input_thresh")}


def scenes(path: Path, duration: float, threshold: float = 27.0) -> list[dict]:
    """المشاهد من PySceneDetect (ContentDetector): كل مشهد ببدايته ونهايته بالثواني."""
    from scenedetect import ContentDetector, detect

    found = detect(str(path), ContentDetector(threshold=threshold), show_progress=False)
    if not found:
        return [{"index": 1, "start": 0.0, "end": round(duration, 3)}]
    return [{"index": i + 1, "start": round(s.get_seconds(), 3), "end": round(e.get_seconds(), 3)} for i, (s, e) in enumerate(found)]


def ffmpeg_scene_cuts(path: Path, threshold: float = 0.3) -> list[float]:
    """قطعات المشاهد من FFmpeg نفسه (فلتر scene): للمقارنة بنتيجة PySceneDetect."""
    r = subprocess.run(["ffmpeg", "-hide_banner", "-nostats", "-i", str(path), "-an", "-vf", f"select='gt(scene,{threshold})',showinfo",
                        "-f", "null", "-"], capture_output=True, text=True)
    return [round(float(t), 3) for t in re.findall(r"pts_time:([\d.]+)", r.stderr)]
