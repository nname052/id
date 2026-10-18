"""الصورة في المونتاج: قياس الفريمات ← تصحيح لون وإضاءة طبيعي، وحدة وتنعيم بس لو المصدر محتاجهم (القرار من القياس، مش دايمًا).

- القياس على فريمات موزعة على الفيديو (FFmpeg ← numpy/OpenCV):
  الإضاءة (متوسط Y)، التباين (الانحراف المعياري لـ Y)، الحدة (تباين Laplacian)، الدوشة (MAD للتفاصيل الدقيقة)،
  الإضاءة المحروقة (% بكسلات ≥ 250)، الضلمة المطفية (% بكسلات ≤ 5)، وميل اللون (متوسط R/G/B في المناطق الرمادي/الفاتحة).
- التصحيح: توازن أبيض جزئي (بنسيب دفا خفيف علشان البشرة تفضل طبيعية)، مستويات خفيفة، gamma لو الصورة غامقة/فاتحة،
  unsharp خفيف لو الحدة قليلة، و hqdn3d خفيف لو فيه دوشة. مفيش فلتر "ستايل" غير لو إنت اخترته (looks).
- بعد التصحيح بنقيس تاني على نفس الفريمات، وبنتأكد إن الإضاءة المحروقة ما زادتش.
"""

import subprocess
from pathlib import Path

import numpy as np

STD_FPS = [23.976, 24.0, 25.0, 29.97, 30.0, 50.0, 59.94, 60.0]
# حدود القرار (اتظبطت على فيديو موبايل حقيقي + فيديوهات التطبيق)
SHARP_MIN = 60.0      # تباين Laplacian على فريم 1080 عرض: أقل من كده = ناعم ← unsharp خفيف
NOISE_MAX = 1.6       # دوشة (MAD) أعلى من كده ← hqdn3d خفيف
CAST_MIN = 0.04       # ميل لون أقل من 4% مش بيتصلّح
WB_STRENGTH = 0.7     # بنصلّح 70% من الميل بس (البشرة تفضل دافية وطبيعية)
LOOKS = {   # اختيارية: بتتطبق بس لو إنت طلبتها في الطلب أو بالكلام
    "natural": "",
    "warm": "colortemperature=temperature=5200:mix=0.6",
    "cool": "colortemperature=temperature=7600:mix=0.6",
    "cinematic": "curves=preset=medium_contrast,colorbalance=rs=-0.04:bs=0.05:rh=0.05:bh=-0.04",
    "bw": "hue=s=0,curves=preset=medium_contrast",
}


def fps_plan(probe: dict, r_rate: float | None = None) -> dict:
    """معدل الفريمات: لو المصدر معدل قياسي ثابت بنحافظ عليه. لو متغيّر (VFR) أو غريب:
    لو قريب (≤ 1%) من معدل قياسي ← نفس المعدل ثابت، والفريمات الناقصة بتتملى بمزج (مش تكرار).
    غير كده ← 30 فريم بمزج الفريمات (minterpolate blend)."""
    avg = float(probe.get("fps") or 30.0)
    nominal = r_rate or avg
    near = min(STD_FPS, key=lambda f: abs(f - nominal))
    vfr = abs(avg - nominal) / max(nominal, 1) > 0.001
    if abs(near - nominal) / near <= 0.01:
        out = 60 if near >= 59 else 50 if near >= 49 else 30 if near >= 29 else 25 if near >= 24.5 else 24
        if vfr:
            return {"source_avg": avg, "source_nominal": nominal, "out": out, "method": "minterpolate=mi_mode=blend",
                    "why": f"المصدر متغيّر (متوسط {avg:.3f}، الاسمي {nominal:g}): ثابت {out} فريم، والفريمات الناقصة بتتملى بمزج مش بتكرار"}
        return {"source_avg": avg, "source_nominal": nominal, "out": out, "method": "same",
                "why": f"المصدر {nominal:g} فريم ثابت: بنحافظ عليه"}
    return {"source_avg": avg, "source_nominal": nominal, "out": 30, "method": "minterpolate=mi_mode=blend",
            "why": f"المصدر {avg:.3f} فريم (مش قياسي): 30 فريم بمزج الفريمات"}


def r_frame_rate(path: Path) -> float | None:
    r = subprocess.run(["ffprobe", "-v", "error", "-select_streams", "v:0", "-show_entries", "stream=r_frame_rate", "-of", "csv=p=0", str(path)],
                       capture_output=True, text=True)
    try:
        a, b = (r.stdout.strip().splitlines() or ["0/0"])[0].strip(",").split("/")
        return round(float(a) / float(b), 3) if float(b) else None
    except ValueError:
        return None


def frames(path: Path, times: list[float], vf: str = "", width: int = 1080) -> list[np.ndarray]:
    """فريمات RGB (عرضها width) في أوقات معينة، بعد فلتر اختياري vf."""
    out = []
    for t in times:
        chain = ",".join(x for x in [vf, f"scale={width}:-2:flags=bicubic", "format=rgb24"] if x)
        r = subprocess.run(["ffmpeg", "-v", "error", "-ss", f"{t:.3f}", "-i", str(path), "-frames:v", "1", "-vf", chain,
                            "-f", "rawvideo", "-"], capture_output=True)
        if not r.stdout:
            continue
        n = len(r.stdout) // 3
        h = n // width
        out.append(np.frombuffer(r.stdout[: h * width * 3], np.uint8).reshape(h, width, 3))
    return out


def measure(fr: list[np.ndarray]) -> dict:
    """متوسط القياسات على الفريمات."""
    import cv2

    rows = []
    for f in fr:
        g = cv2.cvtColor(f, cv2.COLOR_RGB2GRAY)
        Y = g.astype(np.float32)
        hp = Y - cv2.GaussianBlur(Y, (0, 0), 1.0)
        lo, hi = np.percentile(Y, [60, 97])
        sel = (Y >= lo) & (Y <= hi)
        rgb = f[sel].reshape(-1, 3).astype(np.float32).mean(axis=0) if sel.any() else f.reshape(-1, 3).mean(axis=0)
        hsv = cv2.cvtColor(f, cv2.COLOR_RGB2HSV)
        rows.append({"brightness": float(Y.mean()), "contrast": float(Y.std()), "sharpness": float(cv2.Laplacian(g, cv2.CV_64F).var()),
                     "noise": float(np.median(np.abs(hp)) * 1.4826), "clipped_pct": float((Y >= 250).mean() * 100),
                     "crushed_pct": float((Y <= 5).mean() * 100), "p1": float(np.percentile(Y, 1)), "p99": float(np.percentile(Y, 99)),
                     "saturation": float(hsv[..., 1].mean()), "shadows": float(Y[(Y >= np.percentile(Y, 10)) & (Y <= np.percentile(Y, 40))].mean()), "r": float(rgb[0]), "g": float(rgb[1]), "b": float(rgb[2])})
    m = {k: round(float(np.mean([r[k] for r in rows])), 2) for k in rows[0]} if rows else {}
    if m:
        gray = (m["r"] + m["g"] + m["b"]) / 3
        m["cast"] = {"r": round(m["r"] / gray - 1, 3), "g": round(m["g"] / gray - 1, 3), "b": round(m["b"] / gray - 1, 3)}
        m["cast_size"] = round(max(abs(v) for v in m["cast"].values()), 3)
        m["frames"] = len(rows)
    return m


def plan(m: dict, look: str = "natural", strength: dict | None = None, soften: float = 1.0) -> dict:
    """القياس ← سلسلة فلاتر FFmpeg + سبب كل فلتر. strength: تعديلات من الكلام (brightness ±، sharpen on/off، …).
    soften < 1 = نفس التصحيح بس أخف (لو النسخة الكاملة حرقت الفاتح أو طفّت الغامق)."""
    st = strength or {}
    steps, why = [], []
    # 1) دوشة أولًا (قبل الحدة)
    if st.get("denoise") is True or (st.get("denoise") is None and m["noise"] > NOISE_MAX):
        steps.append("hqdn3d=luma_spatial=2:chroma_spatial=1.5:luma_tmp=3:chroma_tmp=2.5")
        why.append(f"تنعيم دوشة خفيف (الدوشة {m['noise']:.2f} > {NOISE_MAX})")
    else:
        why.append(f"من غير تنعيم دوشة (الدوشة {m['noise']:.2f} ≤ {NOISE_MAX}، الصورة نضيفة)")
    # 2) توازن الأبيض: 60% من الميل بس
    cast = m.get("cast") or {}
    if m.get("cast_size", 0) >= CAST_MIN and st.get("wb", True):
        g = {c: 1 / (1 + WB_STRENGTH * v) for c, v in cast.items()}
        # نفس الإضاءة (luma) قبل وبعد على اللون المرجعي: التصحيح بيغيّر اللون بس، مش بيغمّق الصورة
        luma = lambda r, gg, b: 0.2126 * r + 0.7152 * gg + 0.0722 * b  # noqa: E731
        k = luma(m["r"], m["g"], m["b"]) / luma(m["r"] * g["r"], m["g"] * g["g"], m["b"] * g["b"])
        g = {c: round(max(0.75, min(1.3, v * k)), 4) for c, v in g.items()}
        steps.append(f"colorchannelmixer=rr={g['r']}:gg={g['g']}:bb={g['b']}")
        why.append(f"توازن أبيض: ميل {', '.join(f'{c.upper()} {v:+.1%}' for c, v in cast.items())} ← صلّحنا {WB_STRENGTH:.0%} منه (البشرة تفضل دافية)")
    else:
        g = {"r": 1.0, "g": 1.0, "b": 1.0}
        why.append(f"توازن الأبيض سليم (الميل {m.get('cast_size', 0):.1%})")
    # 3) المستويات: نسحب الأسود لو مرفوع، والأبيض لو مضغوط (من غير ما نحرق)
    p1, p99 = m["p1"], m["p99"]
    imin = min(p1 - 20, 20) / 255 if p1 > 26 else 0.0           # الأسود ← حوالي 20 (مش صفر: من غير ضلمة مطفية)
    imax = (imin * 255 + (p99 - imin * 255) * 255 / 232) / 255 if p99 < 222 else 1.0   # الأبيض ← حوالي 232 (من غير حرق)
    imax = max(min(imax, 1.0), imin + 0.5)
    imin, imax = imin * soften, 1 - (1 - imax) * soften
    if imin > 0.002 or imax < 0.998:
        steps.append(f"colorlevels=rimin={imin:.3f}:gimin={imin:.3f}:bimin={imin:.3f}:rimax={imax:.3f}:gimax={imax:.3f}:bimax={imax:.3f}")
        why.append(f"مستويات: الأسود {p1:.0f} والأبيض {p99:.0f} ← تباين أوضح من غير ما الفاتح يتحرق")
    # 4) gamma: الصورة غامقة أو فاتحة زيادة
    b = m["brightness"] + float(st.get("brightness", 0))
    gamma = 1.0
    if b < 95:
        gamma = min(1.35, 1 + (110 - b) / 160)
    elif b > 175:
        gamma = max(0.82, 1 - (b - 160) / 200)
    elif m.get("shadows", 128) < 115:   # الضل والدرجات الغامقة (فيها الوش غالبًا) غامقة: رفع خفيف للنص من غير ما الفاتح يتحرق
        gamma = round(min(1.12, 1 + (115 - m["shadows"]) / 300), 3)
    gamma = round((1 + (gamma - 1) * soften) * (1 + float(st.get("brightness", 0)) / 120), 3)
    sat = round(1.0 + float(st.get("saturation", 0)), 3)
    if abs(gamma - 1) > 0.01 or abs(sat - 1) > 0.01:
        steps.append(f"eq=gamma={gamma}:saturation={sat}")
        why.append(f"إضاءة: gamma {gamma} (متوسط {m['brightness']:.0f}، الدرجات الغامقة {m.get('shadows', 0):.0f})" + (f" · تشبّع ×{sat}" if abs(sat - 1) > 0.01 else ""))
    # 5) الحدة
    if st.get("sharpen") is True or (st.get("sharpen") is None and m["sharpness"] < SHARP_MIN):
        amt = 0.45 if m["sharpness"] < SHARP_MIN / 2 else 0.3
        steps.append(f"unsharp=5:5:{amt}:5:5:0")
        why.append(f"حدة خفيفة unsharp {amt} (الحدة {m['sharpness']:.1f} < {SHARP_MIN})")
    else:
        why.append(f"من غير حدة إضافية (الحدة {m['sharpness']:.1f})")
    # 6) ستايل اختياري
    if look and look != "natural" and LOOKS.get(look):
        steps.append(LOOKS[look])
        why.append(f"ستايل «{look}» (إنت اللي اخترته)")
    return {"vf": ",".join(steps), "steps": steps, "why": why, "look": look or "natural"}


def check(before: dict, after: dict) -> dict:
    """مفيش إضاءة محروقة جديدة ولا ضلمة مطفية جديدة."""
    return {"no_new_clipping": after["clipped_pct"] <= max(0.5, before["clipped_pct"] + 0.2),
            "no_new_crush": after["crushed_pct"] <= max(0.5, before["crushed_pct"] + 0.2),
            "clipped_pct": [before["clipped_pct"], after["clipped_pct"]], "crushed_pct": [before["crushed_pct"], after["crushed_pct"]]}


def frame_check(video: Path, cut_times: list[float]) -> dict:
    """فريمات الإخراج: هل المعدل ثابت؟ وهل فيه فريمات متكررة (نفس الصورة مرتين ورا بعض)، خصوصًا عند القصّات؟
    متكرر = متوسط الفرق بين فريمين ورا بعض < 0.15 من 255 (على نسخة رمادي صغيرة 135×240، في نص الصورة بس: بعيد عن الترجمة والكروت
    علشان ظهور سطر/كارت ما يتحسبش نطّة). عند كل قصّة بنرجّع الفروق ±6 فريم، وأكبر فرق مقارنة بالمتوسط (نطّة/judder)."""
    r = subprocess.run(["ffprobe", "-v", "error", "-select_streams", "v:0", "-show_entries", "stream=r_frame_rate,avg_frame_rate,nb_frames",
                        "-of", "default=nw=1", str(video)], capture_output=True, text=True)
    meta = dict(line.split("=", 1) for line in r.stdout.split() if "=" in line)
    rate = lambda s: round(float(s.split("/")[0]) / float(s.split("/")[1]), 3) if "/" in s and float(s.split("/")[1]) else 0.0  # noqa: E731
    raw = subprocess.run(["ffmpeg", "-v", "error", "-i", str(video), "-vf", "scale=135:240,format=gray", "-f", "rawvideo", "-"], capture_output=True).stdout
    fr = np.frombuffer(raw, np.uint8)
    n = len(fr) // (135 * 240)
    fr = fr[: n * 135 * 240].reshape(n, 240, 135).astype(np.int16)[:, 67:144, :]   # الصورة نفسها (28%–60%): من غير الترجمة والكروت
    diffs = np.abs(np.diff(fr, axis=0)).mean(axis=(1, 2)) if n > 1 else np.zeros(0)
    fps = rate(meta.get("r_frame_rate", "0/1"))
    dup = diffs < 0.15
    near = set()
    for t in cut_times:
        k = int(round(t * fps))
        near.update(range(max(0, k - 3), min(len(diffs), k + 3)))
    med = float(np.median(diffs)) if len(diffs) else 0.0
    at_cuts = []
    for t in cut_times:
        k = int(round(t * fps))
        win = [round(float(diffs[i]), 2) for i in range(max(0, k - 6), min(len(diffs), k + 6))]
        at_cuts.append({"t": t, "diffs": win, "max": max(win) if win else 0, "ratio_to_median": round(max(win) / med, 1) if win and med else None})
    return {"frames": int(n), "r_fps": fps, "avg_fps": rate(meta.get("avg_frame_rate", "0/1")), "constant": abs(fps - rate(meta.get("avg_frame_rate", "0/1"))) < 0.01,
            "dupes_total": int(dup.sum()), "dupes_at_cuts": int(sum(dup[i] for i in near)), "median_diff": round(float(np.median(diffs)) if len(diffs) else 0, 2),
            "at_cuts": at_cuts}


def source_dupes(segments: list[dict], sources: dict, fps: int, method: str = "same") -> int:
    """نفس فحص الفريمات المتكررة على المصدر نفسه (الأجزاء اللي اتاخدت، بنفس المعدل): الصورة اللي ثابتة أصلًا في التصوير/الجرافيك
    مش غلطة مونتاج. الفرق بين ده وبين اللي في الإخراج = اللي المونتاج نفسه عمله."""
    total = 0
    for s in segments:
        src = sources[s["source"]]
        if not src.get("has_video"):
            continue
        conv = f"minterpolate=fps={fps}:mi_mode=blend" if method.startswith("minterpolate") else f"fps={fps}"
        raw = subprocess.run(["ffmpeg", "-v", "error", "-ss", f"{s['start']:.4f}", "-t", f"{s['end'] - s['start']:.4f}", "-i", str(src["path"]),
                              "-vf", f"{conv},scale=135:240,format=gray", "-f", "rawvideo", "-"], capture_output=True).stdout
        n = len(raw) // (135 * 240)
        if n < 2:
            continue
        fr = np.frombuffer(raw[: n * 135 * 240], np.uint8).reshape(n, 240, 135).astype(np.int16)[:, 67:144, :]
        total += int((np.abs(np.diff(fr, axis=0)).mean(axis=(1, 2)) < 0.15).sum())
    return total
