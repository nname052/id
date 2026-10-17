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


def size(aspect: str, scale: float = 1.0) -> tuple[int, int]:
    W, H = SIZES[aspect]
    return int(round(W * scale / 2)) * 2, int(round(H * scale / 2)) * 2


def render(segments: list[dict], sources: dict, aspect: str, out_dir: Path, *, scale: float = 1.0, crf: int = 20, preset: str = "medium",
           audio_file: Path | None = None, overlays: list[dict] | None = None, out_path: Path | None = None) -> Path:
    """segments: [{source, start, end, speed?}] بالترتيب؛ sources: {id: {path, has_video, has_audio, width, height}}
    scale < 1 = معاينة بدقة أقل. audio_file = تراك صوت جاهز (مرحلة الصوت) بدل صوت الأجزاء.
    overlays = [{png, x, y, start, end}] صور شفافة فوق الفيديو (سطور الترجمة)."""
    if aspect not in SIZES:
        raise ValueError("المقاس لازم يبقى 9:16 أو 16:9")
    segs = [s for s in segments if float(s["end"]) - float(s["start"]) > 0.04]
    if not segs:
        raise ValueError("مفيش أجزاء في التعديل")
    if not any(sources[s["source"]]["has_video"] for s in segs):
        raise ValueError("التعديل لازم يكون فيه جزء واحد على الأقل من فيديو")
    W, H = size(aspect, scale)
    args, chains, labels = ["ffmpeg", "-hide_banner", "-loglevel", "error", "-y"], [], []
    total = 0.0
    n_in = 0
    for k, s in enumerate(segs):
        src = sources[s["source"]]
        a, b = float(s["start"]), float(s["end"])
        dur = b - a
        sp = float(s.get("speed") or 1.0)
        out_dur = dur / sp
        total += out_dur
        vsp = f",setpts=PTS/{sp:.4f}" if sp != 1.0 else ""
        asp = f",atempo={sp:.4f}" if sp != 1.0 else ""
        # كل جزء مدخل لوحده: -ss قبل -i مع إعادة الترميز مظبوط على الفريم في FFmpeg الحديث
        args += ["-ss", f"{a:.3f}", "-t", f"{dur:.3f}", "-i", str(src["path"])]
        i = n_in; n_in += 1
        if src["has_video"]:
            chains.append(f"[{i}:v]{_video_chain(src, W, H, dur)}{vsp}[v{k}]")
        else:
            chains.append(f"color=c=black:s={W}x{H}:r={FPS}:d={out_dur:.3f},format=yuv420p,setsar=1[v{k}]")
        if src["has_audio"]:
            chains.append(f"[{i}:a]aresample=48000,aformat=sample_fmts=fltp:channel_layouts=stereo,apad,atrim=duration={dur:.3f},asetpts=PTS-STARTPTS{asp}[a{k}]")
        else:
            chains.append(f"anullsrc=r=48000:cl=stereo,atrim=duration={out_dur:.3f}[a{k}]")
        labels.append(f"[v{k}][a{k}]")
    chains.append(f"{''.join(labels)}concat=n={len(segs)}:v=1:a=1[v0][a]")
    vlab = "v0"
    for k, ov in enumerate(overlays or []):   # كل سطر ترجمة صورة شفافة بتظهر في وقتها بس
        args += ["-loop", "1", "-t", f"{total:.3f}", "-i", str(ov["png"])]
        i = n_in; n_in += 1
        chains.append(f"[{vlab}][{i}:v]overlay=x={int(ov['x'])}:y={int(ov['y'])}:enable='between(t,{ov['start']:.3f},{ov['end']:.3f})'[o{k}]")
        vlab = f"o{k}"
    amap = "[a]"
    if audio_file:   # التراك الجاهز بدل صوت الأجزاء (اللي بيتصرّف في anullsink)
        args += ["-i", str(audio_file)]
        amap = f"{n_in}:a"; n_in += 1
        chains.append("[a]anullsink")
    out_dir.mkdir(parents=True, exist_ok=True)
    out = out_path or out_dir / f"montage_{datetime.now():%Y%m%d_%H%M%S}_{aspect.replace(':', 'x')}.mp4"
    args += ["-filter_complex", ";".join(chains), "-map", f"[{vlab}]", "-map", amap,
             "-c:v", "libx264", "-preset", preset, "-crf", str(crf), "-pix_fmt", "yuv420p", "-r", str(FPS),
             "-c:a", "aac", "-b:a", "192k" if scale >= 1 else "128k", "-ar", "48000", "-t", f"{total:.3f}", "-movflags", "+faststart", str(out)]
    r = subprocess.run(args, capture_output=True, text=True)
    if r.returncode != 0 or not out.exists():
        out.unlink(missing_ok=True)
        raise RuntimeError(f"FFmpeg: {r.stderr.strip()[-400:]}")
    return out


def render_audio(segments: list[dict], sources: dict, out_wav: Path, *, music: dict | None = None, duck: bool = True,
                 music_stem: Path | None = None) -> float:
    """صوت التعديل لوحده (بنفس القصّ والسرعة) + مزيكا تحت الكلام لو موجودة، والمزيكا بتوطى لوحدها وقت الكلام (sidechain).
    music: {path, gain_db}. music_stem = نسخة من المزيكا بعد التوطية لوحدها (علشان نقيس التوطية). بيرجّع المدة."""
    args, chains, labels, n_in, total = ["ffmpeg", "-hide_banner", "-loglevel", "error", "-y"], [], [], 0, 0.0
    for k, s in enumerate(segments):
        src = sources[s["source"]]
        a, b = float(s["start"]), float(s["end"])
        dur, sp = b - a, float(s.get("speed") or 1.0)
        total += dur / sp
        args += ["-ss", f"{a:.3f}", "-t", f"{dur:.3f}", "-i", str(src["path"])]
        if src["has_audio"]:
            chains.append(f"[{n_in}:a]aresample=48000,aformat=sample_fmts=fltp:channel_layouts=stereo,apad,atrim=duration={dur:.3f},asetpts=PTS-STARTPTS"
                          + (f",atempo={sp:.4f}" if sp != 1.0 else "") + f"[s{k}]")
        else:
            chains.append(f"anullsrc=r=48000:cl=stereo,atrim=duration={dur / sp:.3f}[s{k}]")
        labels.append(f"[s{k}]"); n_in += 1
    chains.append(f"{''.join(labels)}concat=n={len(segments)}:v=0:a=1[sp]")
    maps = []
    if music:
        args += ["-stream_loop", "-1", "-i", str(music["path"])]
        chains.append(f"[{n_in}:a]aresample=48000,aformat=sample_fmts=fltp:channel_layouts=stereo,atrim=duration={total:.3f},asetpts=PTS-STARTPTS,"
                      f"volume={float(music.get('gain_db', -16)):.1f}dB[mu]")
        n_in += 1
        if duck:
            chains.append("[sp]asplit=2[sp1][sc]")
            chains.append("[mu][sc]sidechaincompress=threshold=0.02:ratio=12:attack=15:release=350:makeup=1[duck0]")
            chains.append("[duck0]asplit=2[duck][dstem]" if music_stem else "[duck0]anull[duck]")
            chains.append("[sp1][duck]amix=inputs=2:duration=first:normalize=0[mix]")
        else:
            chains.append("[mu]asplit=2[duck][dstem]" if music_stem else "[mu]anull[duck]")
            chains.append("[sp][duck]amix=inputs=2:duration=first:normalize=0[mix]")
        maps = ["-map", "[mix]", "-c:a", "pcm_s16le", str(out_wav)]
        if music_stem:
            maps += ["-map", "[dstem]", "-c:a", "pcm_s16le", str(music_stem)]
    else:
        maps = ["-map", "[sp]", "-c:a", "pcm_s16le", str(out_wav)]
    r = subprocess.run(args + ["-filter_complex", ";".join(chains)] + maps, capture_output=True, text=True)
    if r.returncode != 0:
        raise RuntimeError(f"FFmpeg (صوت): {r.stderr.strip()[-400:]}")
    return round(total, 3)


def normalize(in_wav: Path, out_wav: Path, target: float, tp: float = -1.5, lra: float = 11.0) -> dict:
    """loudnorm على مرحلتين (قياس ← تطبيق خطي) للهدف بالـ LUFS. بيرجّع القياس قبل وبعد."""
    from .media import loudness
    before = loudness(in_wav) or {}
    if before.get("integrated_lufs") is None:
        raise RuntimeError("الصوت ساكت خالص، مفيش حاجة تتظبط")
    f = (f"loudnorm=I={target}:TP={tp}:LRA={lra}:measured_I={before['integrated_lufs']}:measured_TP={before['true_peak_dbtp']}:"
         f"measured_LRA={before['lra_lu']}:measured_thresh={before['threshold_lufs']}:linear=true")
    r = subprocess.run(["ffmpeg", "-hide_banner", "-loglevel", "error", "-y", "-i", str(in_wav), "-af", f + ",aresample=48000",
                        "-c:a", "pcm_s16le", str(out_wav)], capture_output=True, text=True)
    if r.returncode != 0:
        raise RuntimeError(f"FFmpeg (loudnorm): {r.stderr.strip()[-300:]}")
    return {"before": before, "after": loudness(out_wav)}
