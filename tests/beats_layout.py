"""تسلسل الصور جوه مشاهد الـ 2D (player.js · buildBeats) — قاعدة taste.md 6: «الصورة لازم تاخد وقتها تتشاف».
بيمشي على الفيديو كل 0.1 ث ويشوف الصورة الكبيرة الظاهرة في كل لحظة (الأساسية أو واحدة من التسلسل):
- كل صورة بتفضل ظاهرة 2.3 ث على الأقل (إلا لو المشهد نفسه خلص).
- ولا صورة داخلة في منطقة الترجمة (تحت 1330) لما الترجمة شغالة.
والعدد على قد الطول والشكل (beats_needed).
الاستخدام (والسيرفر شغال على 8002): .venv/bin/python tests/beats_layout.py <project_id>
"""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from playwright.sync_api import sync_playwright  # noqa: E402

from app.pipeline.scenes import beats_needed  # noqa: E402

fails = []
if [beats_needed(d, "hero") for d in (5.4, 6.5, 9.3, 12)] != [0, 1, 2, 3] or beats_needed(4, "kinetic") != 1 or beats_needed(9, "list") != 0:
    fails.append("beats_needed")
pid = sys.argv[1] if len(sys.argv) > 1 else "2026-10-20_02704f"
JS = """(t) => { window.renderAt(t); const sc = [...document.querySelectorAll('#scenes .scene')].find(e => e.style.display !== 'none');
  const box = sc && sc.querySelector('.zone, .pcard, .split-vis'); if (!box) return null;
  const er = sc.getBoundingClientRect(), k = er.width / 1080;
  const vs = [...box.querySelectorAll(':scope > .vis')];
  const on = vs.map((v, i) => [i, +getComputedStyle(v).opacity]).filter(x => x[1] > 0.5).map(x => x[0]);
  const r = box.getBoundingClientRect();
  return {scene: sc.className, on, n: vs.length, bottom: (r.bottom - er.top) / k}; }"""
with sync_playwright() as p:
    br = p.chromium.launch()
    pg = br.new_page(viewport={"width": 1080, "height": 1920})
    pg.goto(f"http://localhost:8002/player/player.html?id={pid}&mode=render")
    pg.evaluate("window.ready")
    times = pg.evaluate("window.__sceneTimes")
    subs = pg.evaluate("getComputedStyle(document.querySelector('#subs')).display !== 'none'")
    shown = 0
    for s in times:
        runs, cur, t0 = [], None, s["start"]
        t = s["start"] + 0.05
        while t < s["end"] - 0.05:
            r = pg.evaluate(JS, t)
            if r is None:
                break
            if subs and r["bottom"] > 1335:
                fails.append(f"{s['id']}: الصورة داخلة في الترجمة ({r['bottom']:.0f})")
            v = r["on"][-1] if r["on"] else None
            if v != cur:
                if cur is not None:
                    runs.append((cur, round(t - t0, 2)))
                cur, t0 = v, t
            t += 0.1
        if cur is not None:
            runs.append((cur, round(t - t0, 2), "آخر المشهد"))
        if not runs:
            continue
        shown += len(runs)
        for x in runs[:-1]:
            if x[1] < 2.3:
                fails.append(f"{s['id']}: صورة {x[0]} ظاهرة {x[1]} ث بس")
        print(s["id"], f"{s['end'] - s['start']:.1f}s", "الصور:", [(x[0], x[1]) for x in runs])
    br.close()
print("صور كبيرة ظاهرة في الفيديو كله:", shown)
print("PASS" if not fails else "FAIL:\n  " + "\n  ".join(fails[:20]))
sys.exit(1 if fails else 0)
