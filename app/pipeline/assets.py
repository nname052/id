"""البحث في المكتبات: بيدوّر عندك الأول (assets/catalog.json + assets/fetched)، ولو مالقاش بيجيب من مصدر مجاني أونلاين
ويحفظه محلي ويسجّل رخصته (المكتبة بتكبر لوحدها، القسم 4.0 في التصميم)."""

import json
import re
import threading
from pathlib import Path

import requests

from ..config import ASSETS
from ..store import read_json, write_json

FETCHED = ASSETS / "fetched"
_cache: dict = {}
_lock = threading.Lock()

# مجموعات Iconify اللي رخصتها مفتوحة ومن غير ما تحتاج تذكر حد (أو MIT/Apache/ISC اللي بتطلب الرخصة في الكود بس، مش في الفيديو)
OPEN_ICON_SETS = ["mdi", "ph", "tabler", "lucide", "material-symbols", "fluent", "iconoir", "solar", "mingcute", "ri", "carbon", "hugeicons"]


def _words(text: str) -> list[str]:
    return [w for w in re.split(r"[^a-z0-9]+", text.lower()) if len(w) > 1]


def _load() -> dict:
    with _lock:
        if not _cache:
            cat = read_json(ASSETS / "catalog.json", {})
            items = []
            for it in cat.get("undraw", {}).get("items", []):
                items.append({"kind": "illustration", "file": f"undraw/{it['file']}", "name": it["title"],
                              "words": _words(it["title"] + " " + " ".join(it.get("keywords", []))), "license": "unDraw"})
            for name, tags in cat.get("icons", {}).get("lucide", {}).get("items", {}).items():
                items.append({"kind": "icon", "file": f"icons/lucide/{name}.svg", "name": name,
                              "words": _words(name.replace("-", " ") + " " + " ".join(map(str, tags))), "license": "ISC (Lucide)"})
            for name, tags in cat.get("icons", {}).get("tabler", {}).get("items", {}).items():
                items.append({"kind": "icon", "file": f"icons/tabler-outline/{name}.svg", "name": name,
                              "words": _words(name.replace("-", " ") + " " + " ".join(map(str, tags))), "license": "MIT (Tabler)", "rank": -0.5})
            for it in cat.get("emoji", {}).get("items", []):
                items.append({"kind": "emoji", "file": it["file"], "name": " ".join(it.get("tags", [])),
                              "words": _words(" ".join(it.get("tags", []))), "license": "CC BY 4.0 (Google Noto Animated Emoji)",
                              "credit": "Animated emoji by Google"})
            for it in read_json(FETCHED / "catalog.json", []):
                items.append({**it, "words": _words(it["name"] + " " + " ".join(it.get("tags", [])))})
            _cache["items"] = items
        return _cache


def _score(item: dict, query: list[str]) -> float:
    if not query:
        return 0
    s, words = 0.0, item["words"]
    name = _words(item["name"])
    for q in query:
        if q in name:
            s += 3
        elif q in words:
            s += 2
        elif any(w.startswith(q) or q.startswith(w) for w in words if len(w) > 3 and len(q) > 3):
            s += 0.8
    hits = sum(1 for q in query if q in name)
    if name and hits == len(name):
        s += 1.5            # الاسم كله كلمات بحث (زي "clock" بالظبط) أحسن من "clipboard clock"
    s -= 0.3 * (len(name) - hits)
    return s + item.get("rank", 0)


def search(kind: str, terms: list[str], exclude: set | None = None) -> dict | None:
    """أحسن عنصر من النوع ده للكلمات دي (أو None). exclude = ملفات اتستخدمت في نفس الفيديو."""
    query = _words(" ".join(terms))
    best, best_s = None, 0.0
    for it in _load()["items"]:
        if it["kind"] != kind or (exclude and it["file"] in exclude):
            continue
        s = _score(it, query)
        if s > best_s:
            best, best_s = it, s
    if best and best_s >= 2:
        return {k: v for k, v in best.items() if k != "words"} | {"score": best_s}
    if kind == "icon":
        return fetch_icon(terms, exclude)
    return None


def fetch_icon(terms: list[str], exclude: set | None = None) -> dict | None:
    """مفيش أيقونة مناسبة محلي: ندوّر في Iconify (مجموعات رخصتها مفتوحة)، وننزّلها ونسجّلها."""
    for q in [" ".join(terms[:2]), *terms]:
        try:
            r = requests.get("https://api.iconify.design/search", params={"query": q, "limit": 32}, timeout=20)
            icons = r.json().get("icons", []) if r.ok else []
        except requests.RequestException:
            return None
        for full in icons:
            prefix, name = full.split(":", 1)
            if prefix not in OPEN_ICON_SETS:
                continue
            file = f"fetched/icons/{prefix}-{name}.svg"
            if exclude and file in exclude:
                continue
            try:
                svg = requests.get(f"https://api.iconify.design/{prefix}/{name}.svg", timeout=20)
                lic = requests.get("https://api.iconify.design/collections", params={"prefixes": prefix}, timeout=20).json()
            except requests.RequestException:
                return None
            if not svg.ok or "<svg" not in svg.text:
                continue
            license_ = (lic.get(prefix, {}) or {}).get("license", {})
            path = ASSETS / file
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_text(svg.text.replace('fill="currentColor"', 'fill="currentColor"'), encoding="utf-8")
            entry = {"kind": "icon", "file": file, "name": name.replace("-", " "), "tags": [q],
                     "source": f"https://icon-sets.iconify.design/{prefix}/{name}/",
                     "license": f"{license_.get('title', '?')} ({prefix})"}
            with _lock:
                cat = read_json(FETCHED / "catalog.json", [])
                cat.append(entry)
                write_json(FETCHED / "catalog.json", cat)
                _cache.clear()
            return entry | {"score": 2, "fetched": True}
    return None


def emoji_by_name(name: str, exclude: set | None = None) -> dict | None:
    hit = search("emoji", [name, *name.split()], exclude)
    return hit


def credits_for(files: list[str]) -> list[str]:
    """سطور الشكر المطلوبة (للرخص اللي بتطلب ذكر صاحب الشغل)."""
    lines = set()
    for it in _load()["items"]:
        if it["file"] in files and it.get("credit"):
            lines.add(it["credit"])
    return sorted(lines)
