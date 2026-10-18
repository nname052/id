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


def frame_check(video: Path, cut_times: list[float], exclude: list[tuple[float, float]] | None = None) -> dict:
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
    if exclude:   # فترات الجرافيك اللي بياخد الكادر كله (explainer/split/inset): دي رسومات مش فيديو، بتتحسب لوحدها
        ex = np.zeros(len(diffs), bool)
        for a, b in exclude:
            ex[max(0, int(a * fps) - 1):min(len(diffs), int(b * fps) + 1)] = True
        gfx_dupes = int((dup & ex).sum())
        dup = dup & ~ex
    else:
        gfx_dupes = 0
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
            "dupes_total": int(dup.sum()), "dupes_at_cuts": int(sum(dup[i] for i in near)), "graphic_hold_frames": gfx_dupes, "median_diff": round(float(np.median(diffs)) if len(diffs) else 0, 2),
            "at_cuts": at_cuts}


def source_dupes(segments: list[dict], sources: dict, fps: int, method: str = "same") -> int:
    """نفس فحص الفريمات المتكررة على المصدر نفسه (الأجزاء اللي اتاخدت، بنفس المعدل): الصورة اللي ثابتة أصلًا في التصوير/الجرافيك
    مش غلطة مونتاج. الفرق بين ده وبين اللي في الإخراج = اللي المونتاج نفسه عمله."""
    total = 0
    for s in segments:
        src = sources[s["source"]]
        if not src.get("has_video"):
            continue
        m_ = src.get("fps_method", method)
        conv = f"minterpolate=fps={fps}:mi_mode=blend" if m_.startswith("minterpolate") else f"fps={fps}"
        raw = subprocess.run(["ffmpeg", "-v", "error", "-ss", f"{s['start']:.4f}", "-t", f"{s['end'] - s['start']:.4f}", "-i", str(src["path"]),
                              "-vf", f"{conv},scale=135:240,format=gray", "-f", "rawvideo", "-"], capture_output=True).stdout
        n = len(raw) // (135 * 240)
        if n < 2:
            continue
        fr = np.frombuffer(raw[: n * 135 * 240], np.uint8).reshape(n, 240, 135).astype(np.int16)[:, 67:144, :]
        total += int((np.abs(np.diff(fr, axis=0)).mean(axis=(1, 2)) < 0.15).sum())
    return total


# ---------- تصحيح على الوش + لكل لقطة (بعد كشف الوش والقناع) ----------
SKIN_WARM = (0.10, 0.20)     # دفا البشرة الطبيعي: (R−B)/(R+G+B) في نص الوش
FACE_Y = (118.0, 168.0)      # إضاءة الوش المريحة (Y من 255)
GRADE = "curves=master='0/0 0.25/0.235 0.5/0.5 0.75/0.765 1/1'"   # S خفيفة جدًا (تباين طبيعي)


def face_stats(fr: list[np.ndarray], faces: list[list[float]], masks: list[np.ndarray] | None = None) -> dict | None:
    """نص الوش (60% من الصندوق) ← متوسط RGB و Y، والخلفية (بره القناع) ← Y وكثافة التفاصيل."""
    import cv2
    rgb, ys, bgy, bge = [], [], [], []
    for k, (f, fc) in enumerate(zip(fr, faces)):
        H, W = f.shape[:2]
        if fc:
            x0, y0, x1, y1 = fc[0][:4]
            cx0, cx1 = int((x0 + (x1 - x0) * 0.2) * W), int((x1 - (x1 - x0) * 0.2) * W)
            cy0, cy1 = int((y0 + (y1 - y0) * 0.25) * H), int((y1 - (y1 - y0) * 0.15) * H)
            reg = f[cy0:cy1, cx0:cx1].reshape(-1, 3).astype(np.float32)
            if len(reg):
                rgb.append(reg.mean(axis=0))
                ys.append(float((reg @ np.array([0.299, 0.587, 0.114])).mean()))
        if masks is not None and k < len(masks):
            m = cv2.resize(masks[k], (W, H)) < 0.3
            g = cv2.cvtColor(f, cv2.COLOR_RGB2GRAY)
            if m.any():
                bgy.append(float(g[m].mean()))
                bge.append(float((cv2.Canny(g, 60, 140)[m] > 0).mean()))
    if not rgb:
        return None
    r, g, b = np.mean(rgb, axis=0)
    return {"rgb": [round(float(r), 1), round(float(g), 1), round(float(b), 1)], "y": round(float(np.mean(ys)), 1), "warm": round(float((r - b) / (r + g + b)), 3),
            "bg_y": round(float(np.mean(bgy)), 1) if bgy else None, "bg_edges": round(float(np.mean(bge)), 4) if bge else None}


def plan_face(m: dict, fs: dict | None, look: str = "natural", strength: dict | None = None, soften: float = 1.0, relight: bool = False) -> dict:
    """زي plan بس توازن الأبيض والإضاءة مظبوطين على البشرة: قوة توازن الأبيض بتتختار علشان دفا الوش يبقى طبيعي (0.10–0.20)،
    والإضاءة علشان الوش يبقى 118–168، وبعدها S خفيفة. من غير وش ← plan العادي."""
    base = plan(m, look, strength, soften)
    if not fs:
        return {**base, "face": None}
    st = strength or {}
    steps = [x for x in base["steps"] if not x.startswith(("colorchannelmixer", "eq=", "unsharp", "hqdn3d")) and x not in LOOKS.values()]
    why = [w for w in base["why"] if not w.startswith(("توازن أبيض", "إضاءة:"))]
    cast = m.get("cast") or {"r": 0, "g": 0, "b": 0}
    r, g, b = fs["rgb"]
    best = None
    for s in np.arange(0.0, 0.95, 0.05):   # قوة توازن الأبيض اللي بتخلّي دفا البشرة في النص الطبيعي
        gains = {c: 1 / (1 + s * v) for c, v in cast.items()}
        luma = lambda rr, gg, bb: 0.2126 * rr + 0.7152 * gg + 0.0722 * bb  # noqa: E731
        k = luma(m["r"], m["g"], m["b"]) / luma(m["r"] * gains["r"], m["g"] * gains["g"], m["b"] * gains["b"])
        gains = {c: max(0.75, min(1.3, v * k)) for c, v in gains.items()}
        R, G, B = r * gains["r"], g * gains["g"], b * gains["b"]
        warm = (R - B) / (R + G + B)
        err = 0 if SKIN_WARM[0] <= warm <= SKIN_WARM[1] else min(abs(warm - SKIN_WARM[0]), abs(warm - SKIN_WARM[1]))
        cand = (err, abs(s - 0.6), s, gains, warm)
        if best is None or cand[:2] < best[:2]:
            best = cand
    _, _, s, gains, warm = best
    s = s * soften
    if s > 0.01 and m.get("cast_size", 0) >= CAST_MIN and st.get("wb", True):
        gains = {c: 1 / (1 + s * v) for c, v in cast.items()}
        luma = lambda rr, gg, bb: 0.2126 * rr + 0.7152 * gg + 0.0722 * bb  # noqa: E731
        k = luma(m["r"], m["g"], m["b"]) / luma(m["r"] * gains["r"], m["g"] * gains["g"], m["b"] * gains["b"])
        gains = {c: round(max(0.75, min(1.3, v * k)), 4) for c, v in gains.items()}
        steps.insert(0, f"colorchannelmixer=rr={gains['r']}:gg={gains['g']}:bb={gains['b']}")
        why.insert(0, f"توازن أبيض على البشرة: دفا الوش {fs['warm']:.3f} ← {warm:.3f} (الطبيعي {SKIN_WARM[0]}–{SKIN_WARM[1]})، قوة {s:.0%} من ميل الكادر")
    # إضاءة الوش
    fy = fs["y"] + float(st.get("brightness", 0))
    gamma = 1.0
    if fy < FACE_Y[0]:
        # لو هنضيّ المتكلم لوحده بالقناع (relight): رفع خفيف بس للكادر كله، والباقي على المتكلم (علشان الحيطة ما تفتحش معاه)
        gamma = min(1.08 if relight else 1.35, 1 + (FACE_Y[0] + 10 - fy) / 220)
    elif fy > FACE_Y[1]:
        gamma = max(0.82, 1 - (fy - FACE_Y[1] + 10) / 260)
    gamma = round(1 + (gamma - 1) * soften, 3)
    sat = round(1.0 + float(st.get("saturation", 0)), 3)
    if abs(gamma - 1) > 0.01 or abs(sat - 1) > 0.01:
        steps.append(f"eq=gamma={gamma}:saturation={sat}")
        why.append(f"إضاءة الوش {fs['y']:.0f} (المريح {FACE_Y[0]:.0f}–{FACE_Y[1]:.0f}) ← gamma {gamma} للكادر كله" + (" (الباقي على المتكلم بالقناع)" if relight else ""))
    else:
        why.append(f"إضاءة الوش {fs['y']:.0f} في المريح، من غير gamma")
    if look in (None, "", "natural"):
        steps.append(GRADE)
        why.append("درجة لون طبيعية خفيفة (S curve صغيرة)")
    steps += [x for x in base["steps"] if x.startswith(("unsharp", "hqdn3d"))] + ([LOOKS[look]] if look and look != "natural" and LOOKS.get(look) else [])
    return {"vf": ",".join(steps), "steps": steps, "why": why, "look": look or "natural", "face": fs, "wb_strength": round(float(s), 2)}


# ---------- «طبيعي الأول» (الافتراضي من بعد ملاحظة المستخدم: «الصورة بقت مقرفة») ----------
# ليه: plan_face كان بيوزن الأبيض على البشرة (بيشيل دفا لمبة الأوضة) + إضاءة المتكلم لوحده بالقناع (gamma لحد 1.75) + تهدئة الخلفية ورا المتكلم.
# النتيجة اتشافت على IMG_2240: الصورة كلها مالت أخضر/رمادي، والمتكلم «مقصوص ومحطوط» على الحيطة (العزل)، والجاكيت الأبيض اتحرق.
# القاعدة دلوقتي: الدفا الطبيعي للإضاءة بيفضل زي ما هو. بنصلّح بس ميل مش طبيعي (أخضر/بنفسجي/أزرق قوي) ونصّه بس،
# وإضاءة خفيفة للكادر كله (من غير قناع)، وبعدين فحص «الطبيعية»: لو التصحيح خضّر الصورة أو برّد البشرة، بيخف لحد ما يعدّي.
TINT_MAX_UP = 0.01         # الأخضر النسبي (G − (R+B)/2) ÷ المتوسط ما يزيدش أكتر من 1%
# (اتقاس الأول بالفرق المطلق: أي تفتيح كان بيزوّده من غير ما اللون يتغيّر، فالإضاءة اترفضت والوش فضل 72)
SKIN_COOL_MAX = 0.03       # دفا البشرة ما يقلش أكتر من كده


def tint(m: dict) -> float:
    mean = max(1.0, (m["r"] + m["g"] + m["b"]) / 3)
    return round((m["g"] - (m["r"] + m["b"]) / 2) / mean, 4)


def plan_natural(m: dict, fs: dict | None, look: str = "natural", strength: dict | None = None, soften: float = 1.0) -> dict:
    st = strength or {}
    steps, why = [], []
    if st.get("denoise") is True or (st.get("denoise") is None and m["noise"] > NOISE_MAX):
        steps.append("hqdn3d=luma_spatial=1.5:chroma_spatial=1.2:luma_tmp=2.5:chroma_tmp=2")
        why.append(f"تنعيم دوشة خفيف (الدوشة {m['noise']:.2f} > {NOISE_MAX})")
    cast = m.get("cast") or {"r": 0, "g": 0, "b": 0}
    warm_light = cast["r"] > 0 and cast["b"] < 0 and cast["g"] <= cast["r"]
    unnatural = (cast["g"] > 0.03 and cast["g"] >= cast["r"]) or cast["g"] < -0.05 or cast["b"] > 0.05
    if unnatural and st.get("wb", True) and soften > 0:
        k0 = 0.5 * soften
        gains = {c: 1 / (1 + k0 * v) for c, v in cast.items()}
        luma = lambda r, g, b: 0.2126 * r + 0.7152 * g + 0.0722 * b  # noqa: E731
        k = luma(m["r"], m["g"], m["b"]) / luma(m["r"] * gains["r"], m["g"] * gains["g"], m["b"] * gains["b"])
        gains = {c: round(max(0.85, min(1.15, v * k)), 4) for c, v in gains.items()}
        steps.append(f"colorchannelmixer=rr={gains['r']}:gg={gains['g']}:bb={gains['b']}")
        why.append(f"ميل لون مش طبيعي ({', '.join(f'{c.upper()} {v:+.1%}' for c, v in cast.items())}): صلّحنا {k0:.0%} منه بس")
    else:
        why.append("ألوان الإضاءة زي ما هي" + (" (دفا لمبة الأوضة طبيعي ومريح، مش بيتشال)" if warm_light else f" (الميل {m.get('cast_size', 0):.1%} طبيعي)"))
    # إضاءة: الكادر كله، خفيفة، على الوش لو موجود (من غير قناع ومن غير ما الفاتح يتحرق)
    y = (fs or {}).get("y") or m["brightness"]
    gamma = 1.0
    if y < 105:
        gamma = min(1.15, 1 + (115 - y) / 300)
    elif y > 185:
        gamma = max(0.92, 1 - (y - 175) / 400)
    gamma = round((1 + (gamma - 1) * soften) * (1 + float(st.get("brightness", 0)) / 120), 3)
    sat = round(1.0 + float(st.get("saturation", 0)), 3)
    if abs(gamma - 1) > 0.01 or abs(sat - 1) > 0.01:
        steps.append(f"eq=gamma={gamma}:saturation={sat}")
        why.append(f"إضاءة خفيفة للكادر كله: gamma {gamma} ({'الوش' if fs else 'المتوسط'} {y:.0f})")
    else:
        why.append(f"من غير تغيير إضاءة ({'الوش' if fs else 'المتوسط'} {y:.0f})" + ("" if soften > 0 or gamma == 1 else ""))
    if soften > 0:
        steps.append("curves=master='0/0 0.25/0.24 0.5/0.5 0.75/0.76 1/1'")
        why.append("تباين طبيعي خفيف جدًا")
    if st.get("sharpen") is True or (st.get("sharpen") is None and m["sharpness"] < SHARP_MIN / 2):
        steps.append("unsharp=5:5:0.25:5:5:0")
        why.append(f"حدة خفيفة (الحدة {m['sharpness']:.1f})")
    if look and look != "natural" and LOOKS.get(look):
        steps.append(LOOKS[look])
        why.append(f"ستايل «{look}» (إنت اللي اخترته)")
    return {"vf": ",".join(steps), "steps": steps, "why": why, "look": look or "natural", "face": fs}


def natural_check(before: dict, after: dict, fs_before: dict | None, fs_after: dict | None) -> dict:
    """التصحيح ما خضّرش الصورة، وما برّدش البشرة، وما حرقش ولا طفّى."""
    c = check(before, after)
    dt = round(tint(after) - tint(before), 4)
    dw = round(fs_after["warm"] - fs_before["warm"], 3) if fs_before and fs_after else 0.0
    ok = c["no_new_clipping"] and c["no_new_crush"] and dt <= TINT_MAX_UP and dw >= -SKIN_COOL_MAX
    return {**c, "tint_delta": dt, "skin_warm_delta": dw, "ok": ok}


def bg_plan(fs: dict | None, subject_y: float | None) -> dict:
    """الخلفية ورا المتكلم (بالقناع): لو مليانة تفاصيل ← تنعيم خفيف؛ لو أفتح من الوش بكتير ← تهدئة إضاءتها؛ غير كده ولا حاجة."""
    if not fs or fs.get("bg_y") is None:
        return {"vf": "", "why": "مفيش وش/قناع: الخلفية زي ما هي"}
    if fs["bg_edges"] is not None and fs["bg_edges"] > 0.06:
        return {"vf": "gblur=sigma=5", "why": f"الخلفية فيها تفاصيل كتير ({fs['bg_edges']:.3f} > 0.06): تنعيم خفيف ورا المتكلم بس"}
    gap = fs["bg_y"] - fs["y"]
    if gap > 30:
        k = round(max(0.88, 1 - (gap - 30) / 500), 3)
        return {"vf": f"colorchannelmixer=rr={k}:gg={k}:bb={k},eq=saturation=0.92", "why": f"الخلفية أفتح من الوش بـ {gap:.0f}: تهدئة إضاءتها ×{k} ورا المتكلم بس (علشان العين تروح للوش)"}
    return {"vf": "", "why": f"الخلفية هادية والفرق مع الوش {gap:.0f}: من غير تغيير"}


def subtitle_lag(video: Path, cues: list[dict], subs: list[dict], fps: int) -> dict:
    """تأخير ظهور كل كلمة في الفيديو النهائي نفسه: أول فريم منطقة الترجمة بتتغيّر فيه (ظهور الكلمة) مقارنة بتوقيت الكلمة.
    بنقيس على منطقة السطر بس (غامق/فاتح بيتغيّر لما الكلمة تظهر)."""
    if not cues or not subs:
        return {"n": 0}
    W, H = 270, 480
    raw = subprocess.run(["ffmpeg", "-v", "error", "-i", str(video), "-vf", f"scale={W}:{H},format=gray", "-f", "rawvideo", "-"], capture_output=True).stdout
    n = len(raw) // (W * H)
    fr = np.frombuffer(raw[: n * W * H], np.uint8).reshape(n, H, W).astype(np.int16)
    lags = []
    for c in cues:
        groups = [x for x in subs if x.get("cue", x["id"]) == c["id"]]   # ترجمة التيك توك: السطر متقسم مجموعات
        if not groups:
            continue
        sx, sy = W / 1080 if W < H else W / 1920, H / 1920 if W < H else H / 1080
        for w in c["words"]:
            o = next((g for g in groups if g["start"] - 0.05 <= w["start"] < g["end"]), groups[0])
            y0, y1, x0, x1 = int(o["y"] * sy), int((o["y"] + o["h"]) * sy) + 1, int(o["x"] * sx), int((o["x"] + o["w"]) * sx) + 1
            k = int(round(w["start"] * fps))
            lo, hi = max(1, k - 6), min(n - 1, k + 12)
            if hi <= lo:
                continue
            d = [float(np.abs(fr[i, y0:y1, x0:x1] - fr[i - 1, y0:y1, x0:x1]).mean()) for i in range(lo, hi + 1)]
            # أول قفزة واضحة في منطقة السطر (مش أكبر قفزة: الكلمة اللي بعدها ممكن تعمل قفزة أكبر لو قريبة)
            base = float(np.median(d))
            j = next((q for q, v in enumerate(d) if v > max(2.0, 5 * base)), None)
            if j is not None:
                lags.append(round(((lo + j) / fps - w["start"]) * 1000))
    if not lags:
        return {"n": 0}
    ab = [abs(x) for x in lags]
    return {"n": len(lags), "median_ms": int(np.median(lags)), "max_ms": int(max(ab)), "under_100": sum(x < 100 for x in ab), "frame_ms": round(1000 / fps, 1)}


def motion_vec(path: Path, t: float, dt: float, vf: str = "") -> list[float]:
    """متوسط الحركة (optical flow) بين فريمين: [dx, dy, المقدار] بالبكسل على فريم عرضه 270."""
    import cv2
    fr = frames(path, [max(0.0, t), max(0.0, t + dt)], vf, width=270)
    if len(fr) < 2:
        return [0.0, 0.0, 0.0]
    a, b = (cv2.cvtColor(x, cv2.COLOR_RGB2GRAY) for x in fr)
    flow = cv2.calcOpticalFlowFarneback(a, b, None, 0.5, 3, 15, 3, 5, 1.2, 0)
    mag = np.linalg.norm(flow, axis=2)
    m = mag > max(0.5, np.percentile(mag, 75))      # الأجزاء اللي بتتحرك فعلًا
    dx, dy = (float(flow[..., 0][m].mean()), float(flow[..., 1][m].mean())) if m.any() else (0.0, 0.0)
    return [round(dx, 2), round(dy, 2), round(float(np.hypot(dx, dy)), 2)]


def motion_match(path_a: Path, ta: float, path_b: Path, tb: float, vf: str = "") -> dict:
    """هل الحركة قبل القصّة وبعدها في نفس الاتجاه؟ (قطع على الحركة)"""
    a = motion_vec(path_a, ta - 0.1, 0.1, vf)
    b = motion_vec(path_b, tb, 0.1, vf)
    cos = (a[0] * b[0] + a[1] * b[1]) / (a[2] * b[2]) if a[2] > 0 and b[2] > 0 else 0.0
    return {"a": a, "b": b, "cos": round(cos, 2), "matched": a[2] >= 1.2 and b[2] >= 1.2 and cos >= 0.7}


def fg_plan(fs: dict | None) -> dict:
    """المتكلم بس (بالقناع): لو وشه أغمق من المريح ← إضاءة عليه هو (gamma) لحد ~128؛ لو بشرته دافية زيادة عن 0.20 ← تبريد خفيف عليه هو.
    ده بيحل إن الوش غامق والحيطة ورا فاتحة: تفتيح الكادر كله كان هيحرق الحيطة قبل ما الوش يوصل."""
    if not fs:
        return {"vf": "", "why": "مفيش وش"}
    steps, why = [], []
    y = fs["y"]
    if y < FACE_Y[0]:
        target = 128.0
        g = round(min(1.75, float(np.log(max(y, 5) / 255) / np.log(target / 255))), 3)
        steps.append(f"eq=gamma={g}")
        why.append(f"وش المتكلم {y:.0f} أغمق من المريح ({FACE_Y[0]:.0f}): إضاءة عليه هو بس gamma {g} (هدف ~{target:.0f})")
    r, gg, b = fs["rgb"]
    S = r + gg + b
    if fs["warm"] > SKIN_WARM[1]:
        a = min(0.12, max(0.0, ((r - b) - 0.19 * S) / (r + b)))
        if steps:   # الـ gamma العالية بتبرّد البشرة لوحدها (الأزرق الغامق بيعلى أكتر): نص التبريد بس (اتقاس: 0.298 ← 0.086 بالتبريد الكامل)
            a *= 0.5
        a = round(a, 3)
        if a > 0.005:
            steps.append(f"colorchannelmixer=rr={1 - a}:bb={1 + a}")
            why.append(f"بشرته دافية زيادة ({fs['warm']:.3f} > {SKIN_WARM[1]}): تبريد خفيف عليه هو ({a:.0%})")
    return {"vf": ",".join(steps), "why": " · ".join(why) or f"وش المتكلم مظبوط ({y:.0f}، دفا {fs['warm']:.3f}): من غير تصحيح إضافي"}
