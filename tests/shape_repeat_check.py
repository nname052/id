"""فحص تكرار الأشكال عبر الفيديوهات (من غير AI): بنمرّر 5 خطط مشاهد حقيقية (من مشاريعك) على كود الاختيار بالترتيب،
بسجل استخدام مؤقت، ونعدّ أي رسمة/أيقونة/إيموجي/شخصية أو خلفية أو خط عناوين اتكرر من فيديو جوه آخر N فيديوهات.
الخطة الخامسة نسخة من الأولى بالظبط (نفس الطلبات) علشان نتأكد إن الكود بيلاقي بديل بدل ما يكرر.
الاستخدام: .venv/bin/python tests/shape_repeat_check.py
"""

import copy
import json
import sys
import tempfile
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from app import history  # noqa: E402
from app.config import SHAPE_WINDOW  # noqa: E402
from app.pipeline import scenes as S  # noqa: E402


def as_request(sc: dict) -> dict:
    """المشهد زي ما Claude بيرجّعه (قبل ما الكود يختار الملفات)."""
    r = {k: v for k, v in sc.items() if k not in ("visuals", "id")}
    if sc.get("items"):
        r["items"] = [{"label": it["label"], **({"visual": {"kind": it["visual"]["kind"] if it["visual"]["kind"] != "character" else "illustration",
                                                            "search": (it["visual"].get("asset_name") or "").replace("·", " ").split()[:3]}} if it.get("visual") else {})}
                      for it in sc["items"]]
    if r.get("board"):
        r["board"] = [{k: v for k, v in b.items() if k != "visual"} | ({"kind": b["visual"]["kind"]} if b.get("visual") and b["kind"] in ("emoji",) else {})
                      for b in r["board"]]
    return r


def shapes_of(plan: dict) -> dict:
    assets = set()
    for s in plan["scenes"]:
        assets |= {v["asset"] for v in s.get("visuals", [])}
        assets |= {it["visual"]["asset"] for it in s.get("items", []) if it.get("visual")}
        assets |= {b["visual"]["asset"] for b in s.get("board", []) if b.get("visual")}
    ident = plan["identity"]
    return {"assets": assets, "background": ident.get("background"), "font_heading": ident.get("font_heading"),
            "layouts": [s.get("layout") for s in plan["scenes"]]}


def main():
    src = []
    for d in sorted(Path("videos").glob("2026-*")):
        p = d / "scenes" / "plan.json"
        if p.exists():
            src.append((d.name, json.loads(p.read_text())))
    plans = src[:4] + [(src[0][0] + "-again", copy.deepcopy(src[0][1]))]
    tmp = Path(tempfile.mkdtemp()) / "history.json"
    history.PATH = tmp  # سجل مؤقت: سجلك الحقيقي ما بيتلمسش
    log, rows = [], []
    for k, (name, plan) in enumerate(plans):
        pid = f"test{k + 1}"
        vtype = plan.get("type", "regular")
        recent = history.recent_assets(skip_pid=pid)
        ident = S.fresh_identity(dict(plan["identity"]), pid, vtype) if hasattr(S, "fresh_identity") else dict(plan["identity"])
        toon = S._character(pid, recent)
        used: set = set()
        scenes = [S.finalize(as_request(sc), i, vtype, pid, used, recent, toon) for i, sc in enumerate(plan["scenes"])]
        new_plan = {"type": vtype, "identity": ident, "scenes": scenes, "style": plan.get("style")}
        sh = shapes_of(new_plan)
        window = log[-SHAPE_WINDOW:]
        prev_assets = set().union(*[w["assets"] for w in window]) if window else set()
        rep_assets = sorted(sh["assets"] & prev_assets)
        rep_bg = sh["background"] in {w["background"] for w in window} and vtype != "whiteboard"
        rep_font = sh["font_heading"] in {w["font_heading"] for w in window}
        rows.append({"plan": k + 1, "source": name, "type": vtype, "assets": len(sh["assets"]), "repeated_assets": rep_assets,
                     "background": sh["background"], "repeated_background": rep_bg, "font_heading": sh["font_heading"], "repeated_font": rep_font,
                     "layouts": sh["layouts"]})
        log.append(sh)
        history.record(pid, new_plan)
    total = sum(len(r["repeated_assets"]) + r["repeated_background"] + r["repeated_font"] for r in rows)
    print(json.dumps({"window": SHAPE_WINDOW, "total_repeats": total, "plans": rows}, ensure_ascii=False, indent=1))


if __name__ == "__main__":
    main()
