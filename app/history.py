"""ذاكرة آخر الفيديوهات: الرسومات والألوان والخطوط والأشكال اللي اتستخدمت، علشان الفيديو الجاي ما يكررهاش."""

from .config import ROOT
from .store import read_json, write_json

PATH = ROOT / "data" / "history.json"
KEEP = 8


def recent(n: int = 5) -> list[dict]:
    return read_json(PATH, [])[-n:]


def recent_assets(n: int = 5, skip_pid: str | None = None) -> set:
    return {a for h in recent(n + 1) if h["pid"] != skip_pid for a in h.get("assets", [])}


def summary(n: int = 5, skip_pid: str | None = None) -> str:
    """وصف قصير للي اتعمل قبل كده (بيتبعت لـ Claude علشان يعمل حاجة مختلفة)."""
    lines = []
    for h in recent(n + 1):
        if h["pid"] == skip_pid:
            continue
        lines.append(f"- ألوان {h.get('palette')}، خط عناوين {h.get('font_heading')}، خلفية {h.get('background')}، "
                     f"انتقال {h.get('transition')}، أشكال مشاهد: {', '.join(h.get('layouts', []))}"
                     + (f"، أسلوب {h['style']}" if h.get("style") else "")
                     + (f"، مشاهد 3D: {', '.join(h['three_d'])}" if h.get("three_d") else ""))
    return "\n".join(lines)


def record(pid: str, plan: dict) -> None:
    hist = [h for h in read_json(PATH, []) if h["pid"] != pid]
    ident = plan.get("identity", {})
    hist.append({"pid": pid, "palette": ident.get("palette"), "font_heading": ident.get("font_heading"),
                 "background": ident.get("background"), "transition": ident.get("transition"),
                 "layouts": [s.get("layout") for s in plan.get("scenes", [])], "style": plan.get("style"),
                 "three_d": [f"{s['scene3d'].get('character')} في {s['scene3d'].get('set')} ({s['scene3d'].get('camera')})"
                             for s in plan.get("scenes", []) if s.get("layout") == "scene3d" and s.get("scene3d")],
                 "assets": sorted({v["asset"] for s in plan.get("scenes", []) for v in s.get("visuals", []) if v.get("asset")})})
    PATH.parent.mkdir(exist_ok=True)
    write_json(PATH, hist[-KEEP:])
