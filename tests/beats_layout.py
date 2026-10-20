"""التكوين المتوازن جوه مشاهد الـ 2D (player.js · LAYOUT.compose) — taste.md 6 و 7 و 7ب:
كمية عالية + كل عنصر بياخد وقته + الشاشة متوازنة. لكل مشهد، في آخره (قبل الانتقال):
- العناصر اللي ظهرت بتفضل ظاهرة (بتتجمّع، مش بتتبدّل)، وكل عنصر دخل قبل آخر المشهد بـ 2.3 ث على الأقل.
- ولا عنصر داخل في منطقة الترجمة (تحت 1335) لما الترجمة شغالة، ومفيش عنصرين فوق بعض (تداخل أكتر من 6%).
- التوازن: لو فيه عنصرين أو أكتر، المحتوى بيغطي فوق وتحت منطقة المحتوى (مش متكوّم في ناحية).
الاستخدام (والسيرفر شغال على 8002): .venv/bin/python tests/beats_layout.py <project_id>
"""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from playwright.sync_api import sync_playwright  # noqa: E402

from app.pipeline.scenes import beats_needed  # noqa: E402

fails = []
if [beats_needed(d, "hero") for d in (3.0, 5.4, 6.5, 9.3, 12)] != [1, 2, 3, 3, 3] or beats_needed(4, "kinetic") != 2 or beats_needed(9, "list") != 0:
    fails.append("beats_needed")
pid = sys.argv[1] if len(sys.argv) > 1 else "2026-10-20_02704f"
JS = """(t) => { window.renderAt(t); const sc = [...document.querySelectorAll('#scenes .scene')].find(e => e.style.display !== 'none');
  if (!sc || !sc.classList.contains('L-compose')) return null;
  return [...sc.querySelectorAll('.cmp')].map(w => ({op: +getComputedStyle(w).opacity, l: parseFloat(w.style.left), t: parseFloat(w.style.top),
    s: parseFloat(w.style.width), main: w.classList.contains('main')})); }"""
with sync_playwright() as p:
    br = p.chromium.launch()
    pg = br.new_page(viewport={"width": 1080, "height": 1920})
    pg.goto(f"http://localhost:8002/player/player.html?id={pid}&mode=render")
    pg.evaluate("window.ready")
    times = pg.evaluate("window.__sceneTimes")
    subs = pg.evaluate("getComputedStyle(document.querySelector('#subs')).display !== 'none'")
    total, composed = 0, 0
    for s in times:
        end = pg.evaluate(JS, s["end"] - 0.3)
        if end is None:
            continue
        composed += 1
        vis = [x for x in end if x["op"] > 0.5]
        total += len(vis)
        if len(vis) < len(end):
            fails.append(f"{s['id']}: {len(end) - len(vis)} عنصر مش ظاهر في آخر المشهد (المفروض بتتجمّع)")
        # كل عنصر مساعد ظاهر قبل آخر المشهد بـ 2.3 ث على الأقل
        early = pg.evaluate(JS, s["end"] - 2.3)
        if sum(x["op"] > 0.5 for x in early if not x["main"]) < sum(1 for x in vis if not x["main"]):
            fails.append(f"{s['id']}: عنصر دخل متأخر (أقل من 2.3 ث قبل آخر المشهد)")
        for i, a in enumerate(vis):
            if subs and a["t"] + a["s"] > 1335:
                fails.append(f"{s['id']}: عنصر داخل في الترجمة ({a['t'] + a['s']:.0f})")
            for b in vis[i + 1:]:
                ox = max(0, min(a["l"] + a["s"], b["l"] + b["s"]) - max(a["l"], b["l"]))
                oy = max(0, min(a["t"] + a["s"], b["t"] + b["s"]) - max(a["t"], b["t"]))
                if ox * oy > 0.06 * min(a["s"], b["s"]) ** 2:
                    fails.append(f"{s['id']}: عنصرين فوق بعض")
        if len(vis) >= 2:
            top, bot = min(x["t"] for x in vis), max(x["t"] + x["s"] for x in vis)
            if top > 520 or bot < 1050:
                fails.append(f"{s['id']}: مش متوازن (المحتوى من {top:.0f} لـ {bot:.0f})")
        print(s["id"], f"{s['end'] - s['start']:.1f}s", "عناصر ظاهرة في الآخر:", len(vis))
    br.close()
print(f"مشاهد متكوّنة: {composed} · عناصر: {total}")
print("PASS" if not fails else "FAIL:\n  " + "\n  ".join(fails[:20]))
sys.exit(1 if fails else 0)
