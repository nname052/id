"""تصدير المونتاج: الأجزاء المختارة بالترتيب ← MP4 واحد (H.264 + AAC) بالمقاس المختار.

- القطع بإعادة ترميز (re-encode) علشان يبقى مظبوط على الفريم (مش على أقرب keyframe).
- 9:16 من مصدر عرضه أكبر (زي 16:9): قصّ من النص (center-safe crop) بارتفاع الصورة كله.
- 16:9 من مصدر أضيق (طولي): الصورة كلها في النص وجنبها أسود (من غير قصّ أي حاجة من الكلام).
- مصدر صوت بس (m4a): صورة سودا بطول الجزء. مصدر من غير صوت: سكوت بطول الجزء.
- الإخراج ملف جديد في exports/، والمصدر عمره ما بيتكتب عليه.
"""

import subprocess
from datetime import datetime
from pathlib import Path

SIZES = {"9:16": (1080, 1920), "16:9": (1920, 1080)}
FPS = 30


def _video_chain(src: dict, W: int, H: int, dur: float) -> str:
    sw, sh = src.get("width") or W, src.get("height") or H
    if sw / sh > W / H:      # المصدر أعرض من الإخراج: قصّ من النص على العرض
        fit = f"crop=w='trunc(ih*{W}/{H}/2)*2':h=ih:x='(iw-ow)/2':y=0,scale={W}:{H}"
    elif sw / sh < W / H:    # المصدر أضيق: الصورة كلها في النص وجنبها أسود
        fit = f"scale=-2:{H},pad={W}:{H}:'(ow-iw)/2':0:black"
    else:
        fit = f"scale={W}:{H}"
    return f"fps={FPS},{fit},setsar=1,format=yuv420p,trim=duration={dur:.3f},setpts=PTS-STARTPTS"


def render(segments: list[dict], sources: dict, aspect: str, out_dir: Path) -> Path:
    """segments: [{source, start, end}] بالترتيب؛ sources: {id: {path, has_video, has_audio, width, height}}"""
    if aspect not in SIZES:
        raise ValueError("المقاس لازم يبقى 9:16 أو 16:9")
    segs = [s for s in segments if float(s["end"]) - float(s["start"]) > 0.04]
    if not segs:
        raise ValueError("مفيش أجزاء في التعديل")
    if not any(sources[s["source"]]["has_video"] for s in segs):
        raise ValueError("التعديل لازم يكون فيه جزء واحد على الأقل من فيديو")
    W, H = SIZES[aspect]
    args, chains, labels = ["ffmpeg", "-hide_banner", "-loglevel", "error", "-y"], [], []
    n_in = 0
    for k, s in enumerate(segs):
        src = sources[s["source"]]
        a, b = float(s["start"]), float(s["end"])
        dur = b - a
        # كل جزء مدخل لوحده: -ss قبل -i مع إعادة الترميز مظبوط على الفريم في FFmpeg الحديث
        args += ["-ss", f"{a:.3f}", "-t", f"{dur:.3f}", "-i", str(src["path"])]
        i = n_in; n_in += 1
        if src["has_video"]:
            chains.append(f"[{i}:v]{_video_chain(src, W, H, dur)}[v{k}]")
        else:
            chains.append(f"color=c=black:s={W}x{H}:r={FPS}:d={dur:.3f},format=yuv420p,setsar=1[v{k}]")
        if src["has_audio"]:
            chains.append(f"[{i}:a]aresample=48000,aformat=sample_fmts=fltp:channel_layouts=stereo,apad,atrim=duration={dur:.3f},asetpts=PTS-STARTPTS[a{k}]")
        else:
            chains.append(f"anullsrc=r=48000:cl=stereo,atrim=duration={dur:.3f}[a{k}]")
        labels.append(f"[v{k}][a{k}]")
    chains.append(f"{''.join(labels)}concat=n={len(segs)}:v=1:a=1[v][a]")
    out_dir.mkdir(parents=True, exist_ok=True)
    out = out_dir / f"montage_{datetime.now():%Y%m%d_%H%M%S}_{aspect.replace(':', 'x')}.mp4"
    args += ["-filter_complex", ";".join(chains), "-map", "[v]", "-map", "[a]",
             "-c:v", "libx264", "-preset", "medium", "-crf", "20", "-pix_fmt", "yuv420p", "-r", str(FPS),
             "-c:a", "aac", "-b:a", "192k", "-ar", "48000", "-movflags", "+faststart", str(out)]
    r = subprocess.run(args, capture_output=True, text=True)
    if r.returncode != 0 or not out.exists():
        out.unlink(missing_ok=True)
        raise RuntimeError(f"FFmpeg: {r.stderr.strip()[-400:]}")
    return out
