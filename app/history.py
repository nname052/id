"""ذاكرة آخر الفيديوهات: الرسومات والألوان والخطوط والأشكال اللي اتستخدمت، علشان الفيديو الجاي ما يكررهاش."""

from .config import ROOT, SHAPE_WINDOW
from .store import read_json, write_json

PATH = ROOT / "data" / "history.json"   # سجل الاستخدام: كل شكل/أيقونة/شكل مشهد اتستخدم في كل فيديو
KEEP = max(8, SHAPE_WINDOW + 3)


def recent(n: int = SHAPE_WINDOW) -> list[dict]:
    return read_json(PATH, [])[-n:]


def _window(n: int, skip_pid: str | None) -> list[dict]:
    """آخر n فيديوهات غير الفيديو ده نفسه."""
    return [h for h in read_json(PATH, []) if h["pid"] != skip_pid][-n:]


def recent_assets(n: int = SHAPE_WINDOW, skip_pid: str | None = None) -> set:
    return {a for h in _window(n, skip_pid) for a in h.get("assets", [])}


def recent_values(key: str, n: int = SHAPE_WINDOW, skip_pid: str | None = None) -> list:
    """القيم (زي الخلفية أو خط العناوين) في آخر n فيديوهات، الأقدم الأول."""
    return [h.get(key) for h in _window(n, skip_pid) if h.get(key)]


def recent_characters(n: int = 2, skip_pid: str | None = None) -> list[str]:
    """شخصيات الـ 3D الأساسية في آخر فيديوهين (علشان ما تتكررش)."""
    out = []
    for h in recent(n + 1):
        if h["pid"] != skip_pid:
            out += [c for c in h.get("characters", []) if c not in out]
    return out


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
                 "type": plan.get("type"),
                 "characters": sorted({s["scene3d"]["character"] for s in plan.get("scenes", []) if s.get("scene3d")}),
                 "three_d": [f"{s['scene3d'].get('character')} في {s['scene3d'].get('set')} ({s['scene3d'].get('camera')})"
                             for s in plan.get("scenes", []) if s.get("layout") == "scene3d" and s.get("scene3d")],
                 # كل الملفات: صورة المشهد + صور عناصر القوايم/المقارنات + رسومات السبورة
                 "assets": sorted({v["asset"] for s in plan.get("scenes", []) for v in s.get("visuals", []) if v.get("asset")}
                                  | {it["visual"]["asset"] for s in plan.get("scenes", []) for it in s.get("items", []) if (it.get("visual") or {}).get("asset")}
                                  | {b["visual"]["asset"] for s in plan.get("scenes", []) for b in s.get("board", []) if (b.get("visual") or {}).get("asset")})})
    PATH.parent.mkdir(exist_ok=True)
    write_json(PATH, hist[-KEEP:])
