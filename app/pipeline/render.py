"""المرحلة 5: التصدير. متصفح واحد ← JPEG ← ffmpeg على دفعات (150 فريم) بتكمّل من مكانها لو حصل وقف."""

import json
import math
import shutil
import subprocess

from .. import store
from ..config import FPS, H, W

SEGMENT = 150


def _ffprobe_frames(path) -> int:
    p = subprocess.run(["ffprobe", "-v", "error", "-count_frames", "-select_streams", "v:0", "-show_entries", "stream=nb_read_frames",
                        "-of", "json", str(path)], capture_output=True, text=True, timeout=120)
    try:
        return int(json.loads(p.stdout)["streams"][0]["nb_read_frames"])
    except (KeyError, IndexError, ValueError, json.JSONDecodeError):
        return 0


def _encoder() -> list[str]:
    out = subprocess.run(["ffmpeg", "-hide_banner", "-encoders"], capture_output=True, text=True).stdout
    return ["-c:v", "h264_videotoolbox", "-b:v", "14M"] if "h264_videotoolbox" in out else ["-c:v", "libx264", "-preset", "veryfast", "-crf", "18"]


def run(pid: str, port: int) -> None:
    from playwright.sync_api import sync_playwright

    d = store.project_dir(pid)
    rdir = d / "render"
    rdir.mkdir(exist_ok=True)
    state = store.read_json(rdir / "state.json", {"done": []})
    enc = _encoder()
    with sync_playwright() as pw:
        browser = pw.chromium.launch(args=["--use-angle=metal", "--enable-gpu", "--ignore-gpu-blocklist"])
        page = browser.new_page(viewport={"width": W, "height": H})
        page.set_default_timeout(300_000)
        errors = []
        page.on("pageerror", lambda e: errors.append(str(e)))
        page.add_init_script("window.requestAnimationFrame = () => 0;")
        page.goto(f"http://127.0.0.1:{port}/player/player.html?id={pid}&mode=render")
        page.evaluate("() => window.ready")
        if errors:
            raise RuntimeError("خطأ في المشغّل: " + errors[0][:300])
        duration = page.evaluate("() => window.DURATION")
        total = math.ceil(duration * FPS)
        nseg = math.ceil(total / SEGMENT)
        for k in range(nseg):
            seg = rdir / f"seg_{k:04d}.mp4"
            first, count = k * SEGMENT, min(SEGMENT, total - k * SEGMENT)
            if k in state["done"] and seg.exists():
                continue
            proc = subprocess.Popen(["ffmpeg", "-y", "-loglevel", "error", "-f", "image2pipe", "-framerate", str(FPS), "-c:v", "mjpeg", "-i", "-",
                                     *enc, "-pix_fmt", "yuv420p", str(seg)], stdin=subprocess.PIPE)
            for i in range(first, first + count):
                page.evaluate("t => renderAt(t)", i / FPS)
                proc.stdin.write(page.screenshot(type="jpeg", quality=92))
                if i % 30 == 0:
                    store.update(pid, lambda p, i=i: p["stages"]["render"].__setitem__("progress", {"done": i, "total": total}))
            proc.stdin.close()
            proc.wait()
            if proc.returncode != 0 or _ffprobe_frames(seg) != count:
                raise RuntimeError(f"الدفعة {k + 1} اتصدّرت ناقصة")
            state["done"].append(k)
            store.write_json(rdir / "state.json", state)
        browser.close()

    # الدمج من غير إعادة ترميز، وبعدين الصوت
    (rdir / "list.txt").write_text("".join(f"file 'seg_{k:04d}.mp4'\n" for k in range(nseg)), encoding="utf-8")
    silent = rdir / "video.mp4"
    subprocess.run(["ffmpeg", "-y", "-loglevel", "error", "-f", "concat", "-safe", "0", "-i", str(rdir / "list.txt"), "-c", "copy", str(silent)], check=True)
    out = d / "output"
    out.mkdir(exist_ok=True)
    final = out / "video.mp4"
    voice = d / "audio" / "voice.mp3"
    if voice.exists():
        subprocess.run(["ffmpeg", "-y", "-loglevel", "error", "-i", str(silent), "-i", str(voice), "-c:v", "copy", "-c:a", "aac", "-b:a", "192k",
                        "-af", "apad", "-shortest", str(final)], check=True)
    else:
        shutil.copy(silent, final)
    subprocess.run(["ffmpeg", "-y", "-loglevel", "error", "-ss", "1.2", "-i", str(final), "-frames:v", "1", "-vf", "scale=360:640", str(out / "thumb.jpg")], check=True)
    plan = store.read_json(d / "scenes" / "plan.json", {})
    if plan.get("credits"):
        (out / "credits.txt").write_text("\n".join(plan["credits"]) + "\n", encoding="utf-8")
    shutil.rmtree(rdir, ignore_errors=True)  # الدفعات خلصت شغلها

    def done(p):
        p["stages"]["render"]["progress"] = {"done": total, "total": total}
        p["duration"] = round(duration, 1)
    store.update(pid, done)
