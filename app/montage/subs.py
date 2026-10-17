"""سطور الترجمة كصور شفافة (Chromium من Playwright علشان العربي يتشكّل صح؛ FFmpeg هنا مفيهوش drawtext ولا libass).
شكل بسيط ثابت (من غير تصميم): أبيض على خلفية غامقة نص شفافة، جوه المنطقة الآمنة.
"""

import base64
from pathlib import Path

from ..config import FONTS
from .cuts import SAFE


def _font() -> str:
    f = FONTS / "IBMPlexSansArabic-Bold.ttf"
    return base64.b64encode(f.read_bytes()).decode() if f.exists() else ""


def render_cues(cues: list[dict], aspect: str, W: int, H: int, out_dir: Path) -> list[dict]:
    """كل سطر ← PNG شفاف + مكانه (x, y) جوه المنطقة الآمنة. بيرجّع overlays للـ render ومقاسات الصناديق للتحقق."""
    from playwright.sync_api import sync_playwright

    out_dir.mkdir(parents=True, exist_ok=True)
    safe = SAFE[aspect]
    max_w = int((safe["right"] - safe["left"]) * W)
    cx = (safe["left"] + safe["right"]) / 2 * W
    bottom = safe["bottom"] * H
    fs = round(H * (0.034 if aspect == "9:16" else 0.05))
    font = _font()
    css = (f"@font-face{{font-family:S;src:url(data:font/ttf;base64,{font})}}" if font else "") + \
        f"""html,body{{margin:0;background:transparent}}
        #c{{display:inline-block;max-width:{max_w}px;direction:rtl;text-align:center;font:700 {fs}px/1.35 S,sans-serif;color:#fff;
        background:rgba(0,0,0,.55);padding:{round(fs * .25)}px {round(fs * .5)}px;border-radius:{round(fs * .3)}px;box-sizing:border-box}}"""
    out = []
    with sync_playwright() as p:
        b = p.chromium.launch()
        pg = b.new_page(viewport={"width": W, "height": H})
        pg.set_content(f"<html><head><style>{css}</style></head><body><div id='c'></div></body></html>")
        pg.evaluate("document.fonts.ready")
        for k, c in enumerate(cues):
            pg.evaluate("t => { document.getElementById('c').textContent = t; }", c["text"])
            el = pg.locator("#c")
            box = el.bounding_box()
            png = out_dir / f"cue_{k + 1:03d}.png"
            el.screenshot(path=str(png), omit_background=True)
            w, h = round(box["width"]), round(box["height"])
            x, y = round(cx - w / 2), round(bottom - h)
            inside = x >= safe["left"] * W - 1 and x + w <= safe["right"] * W + 1 and y >= safe["top"] * H - 1 and y + h <= bottom + 1
            out.append({"png": str(png), "x": x, "y": y, "w": w, "h": h, "start": c["start"], "end": c["end"], "inside_safe_area": inside})
        b.close()
    return out
