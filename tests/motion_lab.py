"""معمل الحركة (المرحلة 1): بيسجّل مشهد اختبار فيديو MP4 فريم فريم، وبيحفظ قياسات كل فريم وملخص.
الاستخدام (والسيرفر شغال على 8000):
    uv run python tests/motion_lab.py cup wide out/1A_cup_wide
    uv run python tests/motion_lab.py cup hand out/1A_cup_hand
    uv run python tests/motion_lab.py duo wide out/1C_duo
"""
import json
import subprocess
import sys

from playwright.sync_api import sync_playwright

name, cam, out = sys.argv[1], sys.argv[2], sys.argv[3]
opts = json.loads(sys.argv[4]) if len(sys.argv) > 4 else {}
# معاملات تصحيح المقاس لكل مكتبة (من assets_manifest.json): المشهد بيحمّل كل موديل بمقاسه الحقيقي
try:
    opts.setdefault("factors", {k: v["value"] for k, v in json.load(open("assets_manifest.json"))["library_factors"].items()})
except FileNotFoundError:
    pass
FPS = 30
with sync_playwright() as pw:
    b = pw.chromium.launch(args=["--use-angle=metal"])
    pg = b.new_page(viewport={"width": 1080, "height": 1920})
    errs = []
    pg.on("pageerror", lambda e: errs.append(str(e)))
    pg.goto("http://127.0.0.1:8000/player/tools/lab.html")
    pg.wait_for_function("window.labReady === true", timeout=60000)
    dur = pg.evaluate(f"window.setupLab({json.dumps(name)}, {json.dumps(cam)}, {json.dumps(opts)})")
    ff = subprocess.Popen(["ffmpeg", "-loglevel", "error", "-y", "-f", "image2pipe", "-framerate", str(FPS), "-i", "-",
                           "-vf", "scale=540:960", "-c:v", "libx264", "-pix_fmt", "yuv420p", "-crf", "20", out + ".mp4"], stdin=subprocess.PIPE)
    rows = []
    for i in range(int(dur * FPS)):
        t = round(i / FPS, 4)
        rows.append(pg.evaluate(f"window.labFrame({t})"))
        ff.stdin.write(pg.screenshot(type="jpeg", quality=85))
    ff.stdin.close(); ff.wait()
    b.close()
json.dump(rows, open(out + ".json", "w"), ensure_ascii=False)
# الملخص
sole = min(r["sole"] for r in rows)
com = max(r["comOut"] for r in rows)
jump = max(r["jump"] for r in rows[1:])
pop = max(r.get("pop", 0) for r in rows[2:])
pt = max(rows[2:], key=lambda r: r.get("pop", 0))["t"]
print(f"{name}/{cam}: {len(rows)} frames  errors={errs[:2]}")
print(f"  feet: lowest sole point {sole * 100:+.1f} cm (negative = sinking)")
print(f"  balance: center of mass outside the feet by max {com * 100:.1f} cm")
print(f"  speed: fastest joint move {jump * 100:.1f} cm per frame")
print(f"  pops: largest sudden change in joint speed {pop * 100:.2f} cm/frame at t={pt}s (smooth motion < ~1.5)")
held = [r for r in rows if r.get("mode") == "held" and r.get("pen") is not None]
if held:
    print(f"  grip: closest finger to the cup surface {min(r['pen'] for r in held) * 1000:+.1f} mm (negative = inside the cup)")
if "cupGap" in rows[-1]:
    print(f"  cup on table after release: gap {rows[-1]['cupGap'] * 1000:+.1f} mm")
if "lookA" in rows[0]:
    for name2, key in (("A", "lookA"), ("B", "lookB")):
        tt = next((r["t"] for r in rows if r[key] > 0.05), None)
        print(f"  {name2} starts turning to look at the other at t={tt}s")
