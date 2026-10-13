"""تجربة 3: سرعة الريندر والرام: renderAt(i/30) ← JPEG ← ffmpeg (pipe) على دفعات، بمتصفح واحد."""

import functools
import hashlib
import json
import os
import shutil
import subprocess
import threading
import time
import urllib.parse
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer

import psutil

from pathlib import Path

from .common import OUT, ROOT, Report, run, short

DIR = OUT / "render"
W, H, FPS = 1080, 1920, 30
TOTAL_FRAMES = 300
SEGMENT = 150  # فريمات في كل دفعة (5 ثواني)

# بنوقف requestAnimationFrame علشان لو الصفحة فيها تشغيل تلقائي ما يتخانقش مع renderAt بتاعتنا
INIT_SCRIPT = "window.__phase0 = true; window.requestAnimationFrame = () => 0; window.cancelAnimationFrame = () => {};"

PAGE_INFO_JS = """(fn) => ({
  hasRenderAt: typeof window[fn] === 'function',
  candidates: Object.keys(window).filter(k => /render|draw|seek|frame|time/i.test(k)).slice(0, 30),
  duration: window.DURATION ?? window.duration ?? window.TOTAL_DURATION ?? window.TOTAL ?? null,
  reemKufi: [...document.fonts].some(f => f.family.replace(/["']/g, '') === 'Reem Kufi' && f.status === 'loaded'),
  plexArabic: [...document.fonts].some(f => f.family.replace(/["']/g, '') === 'IBM Plex Sans Arabic' && f.status === 'loaded'),
  fontFaces: [...document.fonts].map(f => f.family.replace(/"/g, '') + ' ' + f.weight + ': ' + f.status),
  pageSize: [document.documentElement.scrollWidth, document.documentElement.scrollHeight],
})"""


class Quiet(SimpleHTTPRequestHandler):
    def log_message(self, *a):
        pass


class MemorySampler(threading.Thread):
    """بيقيس رام البرنامج وكل اللي بيشغّله (Chromium و ffmpeg) كل نص ثانية."""

    def __init__(self):
        super().__init__(daemon=True)
        self.stop_flag = threading.Event()
        self.peak_tree_mb = 0.0
        self.min_available_mb = psutil.virtual_memory().available / 2**20
        self.swap_start_mb = psutil.swap_memory().used / 2**20
        self.peak_swap_mb = self.swap_start_mb

    def run(self):
        me = psutil.Process()
        while not self.stop_flag.is_set():
            total = 0
            for p in [me, *me.children(recursive=True)]:
                try:
                    total += p.memory_info().rss
                except psutil.Error:
                    pass
            self.peak_tree_mb = max(self.peak_tree_mb, total / 2**20)
            self.min_available_mb = min(self.min_available_mb, psutil.virtual_memory().available / 2**20)
            self.peak_swap_mb = max(self.peak_swap_mb, psutil.swap_memory().used / 2**20)
            time.sleep(0.5)


def find_reference(arg: str | None):
    if arg:
        p = Path(arg) if Path(arg).is_absolute() else ROOT / arg
        return p if p.exists() else None
    files = sorted((ROOT / "reference").rglob("*.html"))
    index = [f for f in files if f.name.lower() == "index.html"]
    return (index or files or [None])[0]


def pick_encoder() -> list[str]:
    _, out, _ = run(["ffmpeg", "-hide_banner", "-encoders"])
    if "h264_videotoolbox" in out:
        return ["-c:v", "h264_videotoolbox", "-b:v", "12M"]
    return ["-c:v", "libx264", "-preset", "veryfast", "-crf", "18"]


def probe(path) -> dict:
    _, out, _ = run([
        "ffprobe", "-v", "error", "-count_frames", "-select_streams", "v:0",
        "-show_entries", "stream=nb_read_frames,width,height:format=duration", "-of", "json", str(path),
    ], timeout=120)
    try:
        data = json.loads(out)
        s = data["streams"][0]
        return {"frames": int(s["nb_read_frames"]), "w": s["width"], "h": s["height"], "duration": float(data["format"]["duration"])}
    except (json.JSONDecodeError, KeyError, IndexError, ValueError):
        return {}


def render_segment(page, fn, first, count, out_path, encoder, timings) -> tuple[bool, str]:
    cmd = ["ffmpeg", "-y", "-loglevel", "error", "-f", "image2pipe", "-framerate", str(FPS), "-c:v", "mjpeg",
           "-i", "-", *encoder, "-pix_fmt", "yuv420p", str(out_path)]
    proc = subprocess.Popen(cmd, stdin=subprocess.PIPE, stderr=subprocess.PIPE)
    try:
        for i in range(first, first + count):
            t0 = time.perf_counter()
            page.evaluate("([fn, t]) => Promise.resolve(window[fn](t))", [fn, i / FPS])
            t1 = time.perf_counter()
            jpg = page.screenshot(type="jpeg", quality=92)
            t2 = time.perf_counter()
            proc.stdin.write(jpg)
            t3 = time.perf_counter()
            timings["render"] += t1 - t0
            timings["shot"] += t2 - t1
            timings["write"] += t3 - t2
            if (i + 1) % 30 == 0:
                print(f"\r   فريم {i + 1}/{TOTAL_FRAMES}", end="", flush=True)
        proc.stdin.close()
        err = proc.stderr.read().decode(errors="replace")
        proc.wait(timeout=120)
        return proc.returncode == 0, err
    except (BrokenPipeError, OSError) as e:
        proc.kill()
        return False, f"{e}: {proc.stderr.read().decode(errors='replace')}"


def run_tests(rep: Report, args) -> None:
    rep.h("تجربة 3: سرعة الريندر والرام (متصفح واحد ← JPEG ← ffmpeg)")
    DIR.mkdir(parents=True, exist_ok=True)
    vm = psutil.virtual_memory()
    rep.kv("الرام", f"{vm.total / 2**30:.1f} GB، والمتاح دلوقتي {vm.available / 2**30:.1f} GB")

    if not shutil.which("ffmpeg") or not shutil.which("ffprobe"):
        rep.check("ffmpeg متسطّب", False, "شغّل: brew install ffmpeg")
        return
    ref = find_reference(args.reference)
    if not ref:
        rep.check("الفيديو المرجعي موجود", False, "حط ملف HTML في فولدر reference/")
        return
    if not ref.resolve().is_relative_to(ROOT):
        rep.check("الفيديو المرجعي جوه فولدر المشروع", False, f"{ref}: انقله لفولدر reference/")
        return
    rel = ref.resolve().relative_to(ROOT).as_posix()
    rep.check("الفيديو المرجعي موجود", True, rel)
    fonts = sorted(p.name for p in (ROOT / "fonts").glob("*") if p.suffix.lower() in (".ttf", ".otf", ".woff", ".woff2"))
    rep.kv("ملفات الخطوط في fonts/", ", ".join(fonts) or "مفيش")

    from playwright.sync_api import sync_playwright

    handler = functools.partial(Quiet, directory=str(ROOT))
    server = ThreadingHTTPServer(("127.0.0.1", 0), handler)
    threading.Thread(target=server.serve_forever, daemon=True).start()
    url = f"http://127.0.0.1:{server.server_address[1]}/{urllib.parse.quote(rel)}"

    sampler = MemorySampler()
    sampler.start()
    errors: list[str] = []
    try:
        with sync_playwright() as pw:
            # PHASE0_CHROMIUM: مسار متصفح بديل (مش محتاجه على الماك)
            exe = os.environ.get("PHASE0_CHROMIUM")
            browser = pw.chromium.launch(**({"executable_path": exe} if exe else {}))
            page = browser.new_page(viewport={"width": W, "height": H}, device_scale_factor=1)
            page.on("pageerror", lambda e: errors.append(f"pageerror: {e}"))
            page.on("console", lambda m: errors.append(f"console.{m.type}: {m.text}") if m.type == "error" and "404" not in m.text else None)
            # أي ملف مش موجود (خط، صورة…) بيظهر هنا باسمه، ما عدا favicon
            page.on("response", lambda r: errors.append(f"404: {r.url}") if r.status == 404 and "favicon" not in r.url else None)
            page.add_init_script(INIT_SCRIPT)
            page.goto(url, wait_until="load", timeout=60_000)
            page.evaluate("() => document.fonts.ready.then(() => true)")

            fn = args.render_fn
            info = page.evaluate(PAGE_INFO_JS, fn)
            rep.check(f"الدالة {fn}(t) موجودة", info["hasRenderAt"], "" if info["hasRenderAt"] else f"أسماء قريبة: {info['candidates']}")
            rep.check("خط Reem Kufi محمّل من ملف محلي", info["reemKufi"])
            rep.check("خط IBM Plex Sans Arabic محمّل من ملف محلي", info["plexArabic"])
            rep.kv("الخطوط في الصفحة", "; ".join(info["fontFaces"]) or "-")
            rep.kv("مقاس الصفحة", info["pageSize"])
            rep.kv("مدة الفيديو المرجعي (لو متعرّفة)", info["duration"])
            rep.save()
            if not info["hasRenderAt"]:
                rep.line(f"شغّل تاني بالاسم الصح: `./phase0/run_all.sh --only render --render-fn <الاسم>`")
                return

            # --- 3.1 الحتمية: نفس t لازم يطلع نفس الصورة مهما كان الترتيب ---
            rep.h("3.1 الحتمية (deterministic)", 3)
            order = [0.5, 2.0, 4.75, 2.0, 0.5, 4.75, 8.0, 0.5]
            hashes: dict[float, set] = {}
            for t in order:
                page.evaluate("([fn, t]) => Promise.resolve(window[fn](t))", [fn, t])
                digest = hashlib.sha256(page.screenshot(type="png")).hexdigest()[:12]
                hashes.setdefault(t, set()).add(digest)
            stable = all(len(v) == 1 for v in hashes.values())
            rep.check("نفس الوقت ← نفس الصورة (بترتيب عشوائي)", stable, json.dumps({str(k): sorted(v) for k, v in hashes.items()}))
            rep.save()

            # --- 3.2 السرعة: PNG مقابل JPEG (التصوير بس) ---
            rep.h("3.2 سرعة التصوير: PNG مقابل JPEG (60 فريم)", 3)
            for kind in ("png", "jpeg"):
                t0 = time.perf_counter()
                for i in range(60):
                    page.evaluate("([fn, t]) => Promise.resolve(window[fn](t))", [fn, i / FPS])
                    page.screenshot(type=kind, **({"quality": 92} if kind == "jpeg" else {}))
                fps = 60 / (time.perf_counter() - t0)
                rep.kv(f"{kind.upper()}", f"{fps:.1f} فريم/ثانية")
            rep.save()

            # --- 3.3 التجربة الكاملة: 300 فريم على دفعتين ← دمج ---
            rep.h(f"3.3 تصدير {TOTAL_FRAMES} فريم ({TOTAL_FRAMES // FPS} ثواني) على دفعات، ودمجهم", 3)
            encoder = pick_encoder()
            rep.kv("الـ encoder", encoder[1])
            timings = {"render": 0.0, "shot": 0.0, "write": 0.0}
            segments = []
            t_start = time.perf_counter()
            for n, first in enumerate(range(0, TOTAL_FRAMES, SEGMENT), start=1):
                seg = DIR / f"seg_{n:04d}.mp4"
                ok, err = render_segment(page, fn, first, min(SEGMENT, TOTAL_FRAMES - first), seg, encoder, timings)
                if not ok and encoder[1] != "libx264":
                    rep.check(f"دفعة {n} بـ {encoder[1]}", False, short(err, 200) + "، هنجرّب libx264")
                    encoder = ["-c:v", "libx264", "-preset", "veryfast", "-crf", "18"]
                    ok, err = render_segment(page, fn, first, min(SEGMENT, TOTAL_FRAMES - first), seg, encoder, timings)
                if not ok:
                    rep.check(f"دفعة {n}", False, short(err, 300))
                    return
                segments.append(seg)
            print()
            elapsed = time.perf_counter() - t_start
            browser.close()

        list_file = DIR / "segments.txt"
        list_file.write_text("".join(f"file '{s.name}'\n" for s in segments), encoding="utf-8")
        final = DIR / "reference_10s.mp4"
        code, _, err = run(["ffmpeg", "-y", "-loglevel", "error", "-f", "concat", "-safe", "0", "-i", str(list_file), "-c", "copy", str(final)], timeout=120)
        info = probe(final) if code == 0 else {}
        rep.check(
            "الدمج من غير إعادة ترميز",
            info.get("frames") == TOTAL_FRAMES and info.get("w") == W and info.get("h") == H,
            f"{info.get('frames')} فريم، {info.get('w')}×{info.get('h')}، {info.get('duration', 0):.2f} ثانية" if info else short(err, 300),
        )
        fps = TOTAL_FRAMES / elapsed
        rep.kv("الوقت الكلي", f"{elapsed:.1f} ثانية ← **{fps:.1f} فريم/ثانية**")
        per = {k: f"{v / TOTAL_FRAMES * 1000:.0f}ms" for k, v in timings.items()}
        rep.kv("متوسط الفريم", f"renderAt {per['render']} + screenshot {per['shot']} + ffmpeg {per['write']}")
        rep.summary.append(("سرعة التصدير", True, f"{fps:.1f} فريم/ثانية"))

        rep.h("3.4 التقدير لوقت التصدير على جهازك", 3)
        rows = [[label, f"{frames / fps / 60:.1f} دقيقة"] for label, frames in (("10 ثواني", 300), ("60 ثانية", 1800), ("5 دقايق", 9000))]
        rep.table(["مدة الفيديو", "وقت التصدير المتوقع"], rows)
        rep.line(f"ملف الفيديو التجريبي: `{final.relative_to(ROOT)}` (افتحه واتأكد إن شكله مظبوط)")
    finally:
        sampler.stop_flag.set()
        sampler.join(timeout=2)
        server.shutdown()
        rep.h("3.5 الرام أثناء التجربة", 3)
        rep.kv("أعلى رام للبرنامج + Chromium + ffmpeg", f"{sampler.peak_tree_mb:.0f} MB")
        rep.kv("أقل رام متاحة في الجهاز", f"{sampler.min_available_mb:.0f} MB")
        rep.kv("الـ swap", f"{sampler.swap_start_mb:.0f} ← أعلى {sampler.peak_swap_mb:.0f} MB")
        rep.summary.append(("أعلى رام للريندر", None, f"{sampler.peak_tree_mb:.0f} MB"))
        if errors:
            rep.check("أخطاء في الصفحة", None, f"{len(errors)} خطأ")
            rep.code(short("\n".join(errors[:20]), 3000), "text")
        rep.save()
