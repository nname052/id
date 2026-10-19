"""رندر المونتاج: الأجزاء ← فيديو واحد كامل (H.264 + AAC) بفريمات ثابتة.

- كل قصّة: يا إما مزج قصير (xfade، 8–12 فريم) يا إما قطع صريح، حسب خطة الانتقالات.
  المزج بيستخدم "مقابض": فريمات من المصدر قبل/بعد القصّة، فالمدة الكلية ما بتتغيرش والصوت فاضل متزامن بالظبط.
- الصوت (مرحلة الصوت): crossfade قصير (30–80 مللي) في كل قصّة بنفس الطريقة، وتنضيف خفيف، وتوطية مزيكا، و loudnorm.
- الإطار: 9:16 من مصدر أعرض ← قصّ من النص. 16:9 من مصدر أضيق ← الصورة في النص وجنبها أسود.
- فريمات ثابتة (fps) طول الفيديو؛ لو المصدر متغيّر/غريب بنملى/نحوّل بالمزج (minterpolate blend) مش بالتكرار.
- الترجمة والكروت: صور شفافة فوق الفيديو؛ الكروت بتدخل بحركة واحدة (طلوع + ظهور) وتخرج باختفاء.
- الإخراج ملف جديد دايمًا، والمصدر عمره ما بيتكتب عليه.
"""

import subprocess
from pathlib import Path

SIZES = {"9:16": (1080, 1920), "16:9": (1920, 1080)}


def size(aspect: str, scale: float = 1.0) -> tuple[int, int]:
    W, H = SIZES[aspect]
    return int(round(W * scale / 2)) * 2, int(round(H * scale / 2)) * 2


def fit_chain(src: dict, W: int, H: int, crop_x: float = 0.5) -> str:
    sw, sh = src.get("width") or W, src.get("height") or H
    if sw / sh > W / H + 0.01:      # المصدر أعرض: قصّ (crop_x = مركز القصّة من عرض المصدر)
        return (f"crop=w='trunc(ih*{W}/{H}/2)*2':h=ih:x='max(0,min(iw-ow,iw*{crop_x:.4f}-ow/2))':y=0,"
                f"scale={W}:{H}:flags=lanczos")
    if sw / sh < W / H - 0.01:      # المصدر أضيق: الصورة كلها في النص وجنبها أسود
        return f"scale=-2:{H}:flags=lanczos,pad={W}:{H}:'(ow-iw)/2':0:black"
    return f"scale={W}:{H}:flags=lanczos"


def zoom_chain(fr: dict, W: int, H: int) -> str:
    """تأطير الجزء (jump zoom): قصّ أقرب حوالين الوش ثابت طول الجزء، وبعدين رجوع لنفس المقاس. fr = {z, cx, cy} نسبة من الكادر."""
    z = float(fr.get("z") or 1.0)
    if z <= 1.001:
        return ""
    cw, chh = int(W / z / 2) * 2, int(H / z / 2) * 2
    x = int(max(0, min(W - cw, fr.get("cx", 0.5) * W - cw / 2)))
    y = int(max(0, min(H - chh, fr.get("cy", 0.42) * H - chh / 2)))
    return f",crop={cw}:{chh}:{x}:{y},scale={W}:{H}:flags=lanczos"


def handles(segments: list[dict], transitions: list[dict], sources: dict, fps: int, audio: bool = False) -> list[tuple[float, float]]:
    """لكل جزء: (قبل، بعد) بالثواني اللي هتتاخد من المصدر علشان المزج/الـ crossfade يتعمل حوالين القصّة من غير ما المدة تتغيّر."""
    hs = [[0.0, 0.0] for _ in segments]
    for k, tr in enumerate(transitions):
        a, b = segments[k], segments[k + 1]
        if audio:
            want = tr.get("audio_ms", 60) / 2000
        elif (tr["kind"] == "dissolve" or tr.get("xfade")) and tr.get("frames") and sources[a["source"]]["has_video"] and sources[b["source"]]["has_video"]:
            want = (tr["frames"] // 2) / fps
        else:
            continue
        hs[k][1] = max(0.0, min(want, sources[a["source"]]["duration"] - a["end"]))
        hs[k + 1][0] = max(0.0, min(want, b["start"]))
        if not audio:   # بالفريم بالظبط
            hs[k][1] = int(hs[k][1] * fps + 1e-6) / fps
            hs[k + 1][0] = int(hs[k + 1][0] * fps + 1e-6) / fps
    return [tuple(h) for h in hs]


def _run(args: list[str], what: str) -> None:
    r = subprocess.run(args, capture_output=True, text=True)
    if r.returncode != 0:
        raise RuntimeError(f"FFmpeg ({what}): {r.stderr.strip()[-500:]}")


def render_video(segments: list[dict], transitions: list[dict], sources: dict, aspect: str, out: Path, *, fps: int, fps_method: str = "same",
                 look_vf: str = "", crop_x: float = 0.5, audio_file: Path | None = None, subs: list[dict] | None = None,
                 cards: list[dict] | None = None, card_rise: float = 0.0, enter: float = 0.35, exit_: float = 0.25,
                 scale: float = 1.0, crf: int = 18, preset: str = "medium", gfx: list[dict] | None = None, subs_track: Path | None = None,
                 framing: list[dict] | None = None) -> dict:
    """الفيديو الكامل. segments: [{source, start, end}] (مدة كل جزء مضبوطة على الفريم)، transitions: من cuts.plan_transitions."""
    W, H = size(aspect, scale)
    hs = handles(segments, transitions, sources, fps)
    args, ch, n_in = ["ffmpeg", "-hide_banner", "-loglevel", "error", "-y"], [], 0
    lens = []
    for k, s in enumerate(segments):
        src = sources[s["source"]]
        h0, h1 = hs[k]
        a, b = s["start"] - h0, s["end"] + h1
        nf = int(round((b - a) * fps))
        lens.append(nf)
        if src["has_video"]:
            args += ["-ss", f"{a:.4f}", "-t", f"{(b - a) + 2 / fps:.4f}", "-i", str(src["path"])]
            meth = src.get("fps_method", fps_method)   # النسخة المتلوّنة فريماتها ثابتة أصلًا
            conv = f"minterpolate=fps={fps}:mi_mode=blend" if meth.startswith("minterpolate") else f"fps={fps}"
            fr = (framing or [{}] * len(segments))[k] if framing and k < len(framing) else {}
            ch.append(f"[{n_in}:v]{conv},{fit_chain(src, W, H, crop_x)}{zoom_chain(fr, W, H)},setsar=1,format=yuv420p,trim=end_frame={nf},setpts=PTS-STARTPTS,settb=1/{fps}[v{k}]")
            n_in += 1
        else:
            ch.append(f"color=c=black:s={W}x{H}:r={fps}:d={nf / fps:.4f},format=yuv420p,setsar=1,trim=end_frame={nf},setpts=PTS-STARTPTS,settb=1/{fps}[v{k}]")
    cur, L = "v0", lens[0]
    for k, tr in enumerate(transitions):
        nxt = f"v{k + 1}"
        d = int(round((hs[k][1] + hs[k + 1][0]) * fps))
        if (tr["kind"] == "dissolve" or tr.get("xfade")) and d >= 2:
            ch.append(f"[{cur}][{nxt}]xfade=transition={tr.get('xfade') or 'fade'}:duration={d / fps:.4f}:offset={(L - d) / fps:.4f}[x{k}]")
            L = L + lens[k + 1] - d
        else:
            ch.append(f"[{cur}][{nxt}]concat=n=2:v=1:a=0,settb=1/{fps}[x{k}]")   # نفس الـ timebase علشان xfade اللي بعدها
            L = L + lens[k + 1]
        cur = f"x{k}"
    total = L / fps
    if look_vf:
        ch.append(f"[{cur}]{look_vf}[lk]")
        cur = "lk"
    for k, g in enumerate(gfx or []):   # الموشن جرافيك: overlay / explainer / split / inset
        S, E = g["start"], g["start"] + g["frames"] / fps
        fade = f"fade=t=in:st={S:.3f}:d=0.3:alpha=1,fade=t=out:st={E - 0.3:.3f}:d=0.3:alpha=1"
        args += ["-framerate", str(fps), "-i", str(Path(g["dir"]) / "f_%05d.png")]
        gi = n_in; n_in += 1
        en = f"enable='between(t,{S:.3f},{E:.3f})'"
        if g["mode"] in ("split", "inset", "pip"):
            ch.append(f"[{cur}]split[gm{k}][gc{k}]")
            cx0, cy0, cw, chh = g["crop"]
            tw, th = g["target"][2], g["target"][3]
            if g["mode"] == "pip":   # صورتك في دايرة: القصّ حوالين الوش + قناع دايرة (alphamerge)
                args += ["-loop", "1", "-framerate", str(fps), "-i", str(g["mask"])]
                mi = n_in; n_in += 1
                ch.append(f"[{mi}:v]format=gray,scale={tw}:{th},trim=end_frame={g['frames'] + 2},setpts=PTS-STARTPTS+{S:.3f}/TB[gk{k}]")
                ch.append(f"[gc{k}]crop={cw}:{chh}:{cx0}:{cy0},scale={tw}:{th},format=rgba[gq{k}]")
                ch.append(f"[gq{k}][gk{k}]alphamerge,{fade}[gs{k}]")
            else:
                ch.append(f"[gc{k}]crop={cw}:{chh}:{cx0}:{cy0},scale={tw}:{th},format=yuva420p,{fade}[gs{k}]")
            base = f"gm{k}"
        else:
            base = cur
        gf = f"format=rgba,setpts=PTS-STARTPTS+{S:.3f}/TB" + (f",{fade}" if g["mode"] != "overlay" else "")
        ch.append(f"[{gi}:v]{gf}[gp{k}]")
        ch.append(f"[{base}][gp{k}]overlay=x={g['x']}:y={g['y']}:eof_action=pass:{en}[gx{k}]")
        cur = f"gx{k}"
        if g["mode"] in ("split", "inset", "pip"):
            ch.append(f"[{cur}][gs{k}]overlay=x={g['target'][0]}:y={g['target'][1]}:eof_action=pass:{en}[gy{k}]")
            cur = f"gy{k}"
    if subs_track:   # الترجمة كلمة كلمة: تراك واحد (صور بمدد) فوق كل حاجة
        args += ["-f", "concat", "-safe", "0", "-i", str(subs_track)]
        ch.append(f"[{n_in}:v]format=rgba[st]")
        ch.append(f"[{cur}][st]overlay=0:0:eof_action=pass:shortest=0[stx]")
        cur = "stx"; n_in += 1
    for k, o in enumerate(subs or []):   # سطور الترجمة: كل سطر بيظهر في وقته بس
        d = max(0.05, o["end"] - o["start"])
        args += ["-loop", "1", "-framerate", str(fps), "-t", f"{d:.3f}", "-i", str(o["png"])]
        ch.append(f"[{n_in}:v]format=rgba,setpts=PTS-STARTPTS+{o['start']:.3f}/TB[sp{k}]")
        ch.append(f"[{cur}][sp{k}]overlay=x={int(o['x'] * scale)}:y={int(o['y'] * scale)}:eof_action=pass:enable='between(t,{o['start']:.3f},{o['end']:.3f})'[so{k}]")
        cur = f"so{k}"; n_in += 1
    for k, o in enumerate(cards or []):  # الكروت: طلوع + ظهور، وخروج اختفاء
        d = max(0.5, o["end"] - o["start"])
        S, y0, rise = o["start"], int(o["y"] * scale), card_rise * H
        args += ["-loop", "1", "-framerate", str(fps), "-t", f"{d:.3f}", "-i", str(o["png"])]
        ch.append(f"[{n_in}:v]format=rgba,fade=t=in:st=0:d={enter}:alpha=1,fade=t=out:st={d - exit_:.3f}:d={exit_}:alpha=1,"
                  f"setpts=PTS-STARTPTS+{S:.3f}/TB[cp{k}]")
        ch.append(f"[{cur}][cp{k}]overlay=x={int(o['x'] * scale)}:y='{y0}+{rise:.1f}*pow(1-min(1,max(0,(t-{S:.3f})/{enter})),3)':eval=frame:"
                  f"eof_action=pass:enable='between(t,{S:.3f},{S + d:.3f})'[co{k}]")
        cur = f"co{k}"; n_in += 1
    amap = []
    if audio_file:
        args += ["-i", str(audio_file)]
        amap = ["-map", f"{n_in}:a", "-c:a", "aac", "-b:a", "192k" if scale >= 1 else "128k", "-ar", "48000"]
        n_in += 1
    out.parent.mkdir(parents=True, exist_ok=True)
    _run(args + ["-filter_complex", ";".join(ch), "-map", f"[{cur}]", *amap, "-c:v", "libx264", "-preset", preset, "-crf", str(crf),
                 "-pix_fmt", "yuv420p", "-r", str(fps), "-fps_mode", "cfr", "-t", f"{total:.4f}", "-movflags", "+faststart", str(out)], "رندر")
    return {"frames": L, "duration": round(total, 4), "fps": fps, "handles": [[round(a, 4), round(b, 4)] for a, b in hs]}


def render_audio(segments: list[dict], transitions: list[dict], sources: dict, out_wav: Path, *, fps: int, cleanup: str = "",
                 music: dict | None = None, duck: bool = True, music_stem: Path | None = None, pre_gain_db: float = 0.0, duck_release: int = 350) -> float:
    """صوت التعديل: crossfade قصير في كل قصّة (بمقابض من المصدر، فالمدة نفس مدة الفيديو)، تنضيف، ومزيكا بتوطى تحت الكلام."""
    hs = handles(segments, transitions, sources, fps, audio=True)
    args, ch, n_in = ["ffmpeg", "-hide_banner", "-loglevel", "error", "-y"], [], 0
    total = 0.0
    for k, s in enumerate(segments):
        src = sources[s["source"]]
        h0, h1 = hs[k]
        a, b = s["start"] - h0, s["end"] + h1
        total += s["end"] - s["start"]
        if src["has_audio"]:
            args += ["-ss", f"{a:.4f}", "-t", f"{b - a:.4f}", "-i", str(src["path"])]
            ch.append(f"[{n_in}:a]aresample=48000,aformat=sample_fmts=fltp:channel_layouts=stereo,apad,atrim=duration={b - a:.4f},asetpts=PTS-STARTPTS[s{k}]")
            n_in += 1
        else:
            ch.append(f"anullsrc=r=48000:cl=stereo,atrim=duration={b - a:.4f}[s{k}]")
    cur = "s0"
    for k, tr in enumerate(transitions):
        d = hs[k][1] + hs[k + 1][0]
        if d >= 0.01:
            ch.append(f"[{cur}][s{k + 1}]acrossfade=d={d:.4f}:c1=tri:c2=tri[ax{k}]")
        else:
            ch.append(f"[{cur}][s{k + 1}]concat=n=2:v=0:a=1[ax{k}]")
        cur = f"ax{k}"
    pre = [f"volume={pre_gain_db:.2f}dB"] if abs(pre_gain_db) > 0.05 else []
    chain = ",".join(pre + ([cleanup] if cleanup else []) + [f"atrim=duration={total:.4f}"])
    ch.append(f"[{cur}]{chain}[sp]")
    if music:
        args += ["-stream_loop", "-1", "-i", str(music["path"])]
        ch.append(f"[{n_in}:a]aresample=48000,aformat=sample_fmts=fltp:channel_layouts=stereo,atrim=duration={total:.4f},asetpts=PTS-STARTPTS,"
                  f"volume={float(music.get('gain_db', -16)):.1f}dB,afade=t=in:d=0.6,afade=t=out:st={max(0, total - 1.2):.3f}:d=1.2[mu]")
        n_in += 1
        if duck:
            ch += ["[sp]asplit=2[sp1][sc]", f"[mu][sc]sidechaincompress=threshold=0.02:ratio=12:attack=15:release={duck_release}:makeup=1[duck0]"]
        else:
            ch.append("[mu]anull[duck0]")
        ch.append("[duck0]asplit=2[duck][dstem]" if music_stem else "[duck0]anull[duck]")
        ch.append(("[sp1]" if duck else "[sp]") + "[duck]amix=inputs=2:duration=first:normalize=0[mix]")
        maps = ["-map", "[mix]", "-c:a", "pcm_s16le", str(out_wav)]
        if music_stem:
            maps += ["-map", "[dstem]", "-c:a", "pcm_s16le", str(music_stem)]
    else:
        maps = ["-map", "[sp]", "-c:a", "pcm_s16le", str(out_wav)]
    _run(args + ["-filter_complex", ";".join(ch)] + maps, "صوت")
    return round(total, 4)


def normalize(in_wav: Path, out_wav: Path, target: float, tp: float = -1.5, lra: float = 11.0) -> dict:
    """loudnorm على مرحلتين (قياس ← تطبيق) للهدف بالـ LUFS. بيرجّع القياس قبل وبعد."""
    from .media import loudness
    before = loudness(in_wav) or {}
    if before.get("integrated_lufs") is None:
        raise RuntimeError("الصوت ساكت خالص، مفيش حاجة تتظبط")
    f = (f"loudnorm=I={target}:TP={tp}:LRA={lra}:measured_I={before['integrated_lufs']}:measured_TP={before['true_peak_dbtp']}:"
         f"measured_LRA={before['lra_lu']}:measured_thresh={before['threshold_lufs']}:linear=true")
    _run(["ffmpeg", "-hide_banner", "-loglevel", "error", "-y", "-i", str(in_wav), "-af", f + ",aresample=48000", "-c:a", "pcm_s16le", str(out_wav)],
         "loudnorm")
    return {"before": before, "after": loudness(out_wav)}


def grade_source(src: dict, out: Path, *, fps: int, fps_method: str, aspect: str, shots: list[dict], mask: Path | None = None,
                 bg_vf: str = "", fg_vf: str = "", crop_x: float = 0.5, crf: int = 14) -> dict:
    """نسخة شغل متلوّنة من الملف كله (الإطار + الفريمات الثابتة + تصحيح كل لقطة + الخلفية ورا المتكلم بالقناع).
    shots: [{start, end, vf}] بتوقيت الملف. الرندر بعد كده بيقرا من النسخة دي من غير فلاتر تانية. الأصل ما بيتلمسش."""
    W, H = size(aspect)
    conv = f"minterpolate=fps={fps}:mi_mode=blend" if fps_method.startswith("minterpolate") else f"fps={fps}"
    args = ["ffmpeg", "-hide_banner", "-loglevel", "error", "-y", "-i", str(src["path"])]
    ch = [f"[0:v]{conv},{fit_chain(src, W, H, crop_x)},setsar=1,format=yuv420p,split={len(shots)}" + "".join(f"[s{k}]" for k in range(len(shots)))]
    for k, sh in enumerate(shots):
        ch.append(f"[s{k}]trim=start={sh['start']:.4f}:end={sh['end']:.4f},setpts=PTS-STARTPTS" + (f",{sh['vf']}" if sh.get("vf") else "") + f"[g{k}]")
    ch.append("".join(f"[g{k}]" for k in range(len(shots))) + f"concat=n={len(shots)}:v=1:a=0[g]")
    cur = "g"
    if mask and (bg_vf or fg_vf):   # المتكلم (بالقناع) ليه تصحيحه، والخلفية ليها تصحيحها
        args += ["-i", str(mask)]
        ch += ["[g]split[fg0][b]", f"[fg0]{fg_vf or 'null'}[fg]", f"[b]{bg_vf or 'null'}[bg]", f"[1:v]format=gray,scale={W}:{H}[m]",
               "[fg][m]alphamerge[fga]", "[bg][fga]overlay=format=yuv420,format=yuv420p[out]"]
        cur = "out"
    _run(args + ["-filter_complex", ";".join(ch), "-filter_complex_threads", "8", "-map", f"[{cur}]", "-an", "-c:v", "libx264", "-preset", "veryfast", "-crf", str(crf),
                 "-pix_fmt", "yuv420p", "-r", str(fps), "-fps_mode", "cfr", str(out)], "تلوين")
    return {"file": str(out)}


# ---------- مؤثرات صوت (بيعملها التطبيق، من غير ملفات من بره) ----------
SR = 48000


def _whoosh(d: float = 0.42, seed: int = 1) -> "np.ndarray":
    """ضوضاء وردي بفلتر بيتحرك من واطي لعالي ورجوع، وظرف بيعلى ويوطى: صوت «سحبة»."""
    import numpy as np
    n = int(SR * d)
    rng = np.random.default_rng(seed)
    w = rng.standard_normal(n)
    spec = np.fft.rfft(w)
    f = np.fft.rfftfreq(n, 1 / SR)
    spec /= np.sqrt(np.maximum(f, 20))            # وردي
    w = np.fft.irfft(spec, n)
    out = np.zeros(n)
    hop = 512
    for i in range(0, n, hop):                      # فلتر bandpass بيتحرك (FFT على قطع صغيرة)
        seg = w[i:i + hop * 2]
        if len(seg) < 8:
            break
        c = 350 + 2600 * np.sin(np.pi * min(1.0, i / n))
        S = np.fft.rfft(seg * np.hanning(len(seg)))
        ff = np.fft.rfftfreq(len(seg), 1 / SR)
        S *= np.exp(-((np.log(np.maximum(ff, 1)) - np.log(c)) ** 2) / 0.5)
        out[i:i + len(seg)] += np.fft.irfft(S, len(seg))[:len(out) - i]
    t = np.linspace(0, 1, n)
    env = np.sin(np.pi * t) ** 1.6
    out = out * env
    return out / (np.abs(out).max() + 1e-9)


def _pop(d: float = 0.11) -> "np.ndarray":
    import numpy as np
    t = np.arange(int(SR * d)) / SR
    x = np.sin(2 * np.pi * (520 + 1900 * np.exp(-t * 45)) * t) * np.exp(-t * 38)
    return x / (np.abs(x).max() + 1e-9)


def _flash(d: float = 0.3) -> "np.ndarray":
    import numpy as np
    t = np.arange(int(SR * d)) / SR
    rng = np.random.default_rng(7)
    x = rng.standard_normal(len(t)) * np.exp(-t * 14)
    x = np.convolve(x, np.ones(6) / 6, mode="same")
    return x / (np.abs(x).max() + 1e-9)


def _ding(d: float = 0.7) -> "np.ndarray":
    """جرس صغير: نغمتين متوافقتين بيخفّوا ببطء."""
    import numpy as np
    t = np.arange(int(SR * d)) / SR
    x = (np.sin(2 * np.pi * 1318.5 * t) + 0.6 * np.sin(2 * np.pi * 1975.5 * t) + 0.25 * np.sin(2 * np.pi * 2637 * t)) * np.exp(-t * 6.5)
    x *= np.minimum(1, t / 0.004)
    return x / (np.abs(x).max() + 1e-9)


def _click(d: float = 0.05) -> "np.ndarray":
    import numpy as np
    t = np.arange(int(SR * d)) / SR
    x = np.sin(2 * np.pi * 2200 * t) * np.exp(-t * 160) + 0.5 * np.sin(2 * np.pi * 900 * t) * np.exp(-t * 90)
    return x / (np.abs(x).max() + 1e-9)


def _swoosh(seed: int = 3) -> "np.ndarray":
    return _whoosh(0.26, seed)


SFX = {"whoosh": (_whoosh, 0.22, -0.18), "pop": (_pop, 0.16, 0.0), "flash": (_flash, 0.14, -0.05), "ding": (_ding, 0.12, 0.0),
       "click": (_click, 0.16, 0.0), "swoosh": (_swoosh, 0.14, -0.1), "sparkle": (_ding, 0.1, 0.0), "impact": (_pop, 0.14, 0.0)}   # (الصوت، الكسب، إزاحة البداية)


# توقيت كل صوت على لحظة الحركة نفسها في الرسمة (بالثواني من بداية الجرافيك). الأرقام من توقيتات الرسم في motion.JS:
# الخطوط بتترسم من 0.08 لـ 0.55 ث، والأيقونة بتكبر من 0.1 لـ 0.48، والصورة بتدخل بتلاشي 0.3 ث.
SFX_TIMING = {
    ("annotate", "check"): ("ding", 0.42, 0.09), ("annotate", "cross"): ("click", 0.3, 0.12), ("annotate", "sparkles"): ("sparkle", 0.12, 0.07),
    ("annotate", "heart"): ("sparkle", 0.38, 0.06), ("annotate", "lightning"): ("impact", 0.4, 0.06), ("annotate", "exclaim"): ("impact", 0.45, 0.06),
    ("annotate", "question"): ("click", 0.4, 0.1), ("annotate", "arrow_to_me"): ("swoosh", 0.02, 0.07),
    ("visual", None): ("pop", 0.12, 0.1), ("doodle", None): ("pop", 0.1, 0.09), ("sticker", None): ("pop", 0.05, 0.1),
    ("photo", None): ("swoosh", -0.08, 0.09), ("counter", None): ("ding", 1.55, 0.07),
}


def sfx_events(transitions: list[dict], gfx: list[dict]) -> list[dict]:
    """مؤثر واحد مع كل حاجة بتحصل على الشاشة، في اللحظة اللي الحركة بتحصل فيها بالظبط (مش أول الجرافيك وخلاص):
    صح ← ding لما العلامة تخلص رسم، غلط ← click مع آخر خط، لمعة/قلب ← sparkle مع ظهورها، أيقونة ← pop وهي بتكبر، صورة ← swoosh وهي داخلة،
    وزووم التأكيد ← whoosh خفيف، والسحبة (لقطات مختلفة) ← whoosh."""
    ev = []
    for tr in transitions:
        k = tr["kind"]
        if k in ("whip", "whip_r"):
            ev.append({"t": tr["t"], "sfx": "whoosh", "gain": 0.16, "why": "سحبة"})
        elif k in ("slide", "wipe", "circle", "zoom"):
            ev.append({"t": tr["t"], "sfx": "swoosh", "gain": 0.1, "why": f"انتقال {k}"})
        elif k == "flash":
            ev.append({"t": tr["t"], "sfx": "impact", "gain": 0.06, "why": "فلاش"})
        elif k == "jumpzoom":
            ev.append({"t": tr["t"], "sfx": "whoosh", "gain": 0.07, "why": "زووم تأكيد"})
    for g in gfx:
        k, a = g.get("kind"), g.get("annotation")
        rule = SFX_TIMING.get((k, a)) or SFX_TIMING.get((k, None))
        if rule:
            snd, off, gain = rule
            ev.append({"t": round(g["start"] + off, 3), "sfx": snd, "gain": gain, "why": f"{k}{':' + a if a else ''} (+{off:.2f} ث)"})
    return sorted(ev, key=lambda e: e["t"])


REAL = {"whoosh": "whoosh", "swoosh": "swipe", "pop": "pop", "ding": "ding", "click": "click", "sparkle": "sparkle", "impact": "impact", "flash": "whoosh"}


def _real(kind: str, k: int, pick: str | None = None):
    """صوت حقيقي من مكتبة المشروع (CC0 من Openverse/Freesound) بالدور، وعلوه متظبط (RMS −20 dB). None لو المكتبة فاضية."""
    import wave
    import numpy as np
    from . import library
    from ..config import ASSETS
    files = library.sfx_files(REAL.get(kind, kind))
    if pick and (ASSETS / pick).exists():   # الصوت اللي اخترته بالاسم من الاستوديو
        files = [ASSETS / pick]
        k = 0
    if not files:
        return None
    f = files[k % len(files)]
    with wave.open(str(f)) as w:
        x = np.frombuffer(w.readframes(w.getnframes()), np.int16).astype(np.float64) / 32768
        if w.getnchannels() > 1:
            x = x.reshape(-1, w.getnchannels()).mean(axis=1)
    rms = np.sqrt((x ** 2).mean()) + 1e-9
    x = x * min(0.1 / rms, 0.95 / (np.abs(x).max() + 1e-9))
    return x, f.name


def sfx_track(events: list[dict], total: float, out: Path) -> Path:
    """المؤثرات: صوت حقيقي من المكتبة لو موجود (بالدور علشان ما يتكررش ورا بعض)، وإلا الصوت اللي بيعمله التطبيق."""
    import wave
    import numpy as np
    buf = np.zeros(int(SR * (total + 1)))
    turn: dict = {}
    for k, e in enumerate(events):
        fn, gain, off = SFX.get(e["sfx"], SFX["pop"])
        real = _real(e["sfx"], turn.get(e["sfx"], 0), e.get("pick"))
        turn[e["sfx"]] = turn.get(e["sfx"], 0) + 1
        if real is not None:
            x, e["file"] = real[0] * e.get("gain", gain) * 2.2, real[1]
        else:
            x = (fn(seed=k + 1) if e["sfx"] in ("whoosh", "swoosh") else fn()) * e.get("gain", gain)
        i = max(0, int((e["t"] + off) * SR))
        j = min(len(buf), i + len(x))
        buf[i:j] += x[:j - i]
    pcm = (np.clip(buf, -1, 1) * 32767).astype(np.int16)
    with wave.open(str(out), "wb") as w:
        w.setnchannels(2); w.setsampwidth(2); w.setframerate(SR)
        w.writeframes(np.repeat(pcm[:, None], 2, axis=1).tobytes())
    return out


def mix_sfx(voice: Path, sfx: Path, out: Path) -> None:
    _run(["ffmpeg", "-hide_banner", "-loglevel", "error", "-y", "-i", str(voice), "-i", str(sfx), "-filter_complex",
          "[0:a][1:a]amix=inputs=2:duration=first:normalize=0[a]", "-map", "[a]", "-c:a", "pcm_s16le", str(out)], "مؤثرات الصوت")
