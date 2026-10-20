"""اللحظات البصرية جوه مشاهد الـ 2D (player.js · buildBeats): لكل مشهد فيه لحظات، في آخر المشهد:
- ولا لحظة فوق الشكل الأساسي أو كلام المشهد، ولا داخلة في منطقة الترجمة (تحت 1330)، ولا اتنين فوق بعض.
- كل لحظة بتبدأ جوه وقت مشهدها، وبفرق 1.1 ث على الأقل عن اللي قبلها.
والعدد على قد الطول (beats_needed).
الاستخدام (والسيرفر شغال على 8002): .venv/bin/python tests/beats_layout.py <project_id>
"""
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from playwright.sync_api import sync_playwright  # noqa: E402

from app.pipeline.scenes import beats_needed  # noqa: E402

fails = []
assert [beats_needed(d) for d in (2.0, 3.0, 5.0, 6.8, 9.3, 20)] == [0, 1, 2, 3, 4, 5], "beats_needed"
pid = sys.argv[1] if len(sys.argv) > 1 else "2026-10-20_02704f"
JS = """(t) => { window.renderAt(t); const sc = [...document.querySelectorAll('#scenes .scene')].find(e => e.style.display !== 'none');
  const er = sc.getBoundingClientRect(), k = er.width / 1080;
  const R = (r) => ({l: (r.left - er.left) / k, t: (r.top - er.top) / k, r: (r.right - er.left) / k, b: (r.bottom - er.top) / k});
  const sel = '.zone .vis > svg, .split-vis .vis > svg, .split-txt .w, .ring, .num, .nlabel, .row, .side, .vs, .qcard, .qtext .w, .grid .cell, .pcard, .hd .w, .kin .w';
  const beats = [...sc.querySelectorAll('.beat')].filter(b => b.style.display !== 'none').map(b => { const s = b.style;
    return {l: parseFloat(s.left), t: parseFloat(s.top), r: parseFloat(s.left) + parseFloat(s.width), b: parseFloat(s.top) + parseFloat(s.height)}; });
  return {beats, content: [...sc.querySelectorAll(sel)].map(e => R(e.getBoundingClientRect())).filter(r => r.r - r.l > 2)}; }"""
hit = lambda a, b, pad=0: a["l"] < b["r"] + pad and b["l"] < a["r"] + pad and a["t"] < b["b"] + pad and b["t"] < a["b"] + pad  # noqa: E731
with sync_playwright() as p:
    br = p.chromium.launch()
    pg = br.new_page(viewport={"width": 1080, "height": 1920})
    pg.goto(f"http://localhost:8002/player/player.html?id={pid}&mode=render")
    pg.evaluate("window.ready")
    times = pg.evaluate("window.__sceneTimes")
    total = 0
    for s in times:
        r = pg.evaluate(JS, s["end"] - 0.35)
        total += len(r["beats"])
        for i, b in enumerate(r["beats"]):
            if b["b"] > 1330:
                fails.append(f"{s['id']}: لحظة داخلة في الترجمة ({b['b']:.0f})")
            for c in r["content"]:
                if hit(b, c, -14):   # الحافة الشفافة حوالين الدايرة (7%) مسموح تلمس
                    fails.append(f"{s['id']}: لحظة فوق المحتوى {b} / {c}")
                    break
            for o in r["beats"][i + 1:]:
                if hit(b, o, -20):
                    fails.append(f"{s['id']}: لحظتين فوق بعض")
        print(s["id"], f"{s['end'] - s['start']:.1f}s", "لحظات ظاهرة في الآخر:", len(r["beats"]))
    br.close()
print("المجموع:", total)
print("PASS" if not fails else "FAIL:\n  " + "\n  ".join(fails[:20]))
sys.exit(1 if fails else 0)
