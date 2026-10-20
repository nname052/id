"""مكتبة المونتاج من النت (مفتوحة المصدر بس، بموافقة صاحب التطبيق 2026-10-19): أصوات وصور بتتجاب مرة وتتحفظ في المشروع.

- الأصوات: Openverse (أغلبها من Freesound) برخصة CC0 بس (مش محتاجة ذكر حد). كل صوت بيتقص من السكوت ويتظبط علوه، ويتحفظ WAV
  في assets/sfx/<النوع>/ ومعاه السجل (المصدر، اللي عمله، الرخصة) في assets/sfx/catalog.json.
- الصور: Openverse برخص CC0 / public domain / CC BY. الـ CC BY بيتسجّل اسم صاحبها علشان يتكتب في وصف الفيديو.
لو النت مش موجود أو مفيش نتيجة، المونتاج بيكمّل بالأصوات اللي بيعملها التطبيق.
"""

import json
import subprocess
import threading
from pathlib import Path

import requests

from ..config import ASSETS
from ..store import read_json, write_json

SFX = ASSETS / "sfx"
PHOTOS = ASSETS / "photos"
API = "https://api.openverse.org/v1"
UA = {"User-Agent": "Mashhad-montage/1.0 (local app)"}
_lock = threading.Lock()

# النوع ← (كلمات البحث، أقصى مدة بالثواني، كام صوت نحتفظ بيه)
SFX_KINDS = {
    "whoosh": (["whoosh", "swoosh transition", "swish"], 2.0, 5),
    "pop": (["pop", "bubble pop", "blip"], 1.0, 5),
    "ding": (["ding", "bell ding", "chime notification"], 2.5, 4),
    "click": (["click", "mouse click", "ui click"], 0.6, 4),
    "impact": (["impact hit", "boom hit", "thud"], 2.5, 3),
    "riser": (["whoosh riser short", "swell rise"], 3.0, 2),
    "sparkle": (["sparkle", "magic twinkle", "shimmer"], 2.5, 3),
    "swipe": (["swipe", "page swipe", "slide whoosh"], 1.2, 3),
    # مكتبة الاستوديو v3: أنواع أكتر تتحط على أي مشهد
    "typing": (["typing keyboard", "keyboard typing short", "typewriter"], 2.5, 3),
    "camera": (["camera shutter", "camera click", "photo shutter"], 1.2, 3),
    "notify": (["notification", "message notification", "ui notification"], 1.5, 4),
    "bell": (["bell", "small bell", "service bell"], 2.5, 3),
    "cartoon": (["cartoon boing", "boing", "cartoon spring"], 1.5, 3),
    "glitch": (["glitch", "digital glitch", "static glitch"], 1.2, 3),
    "success": (["success", "positive chime", "level up"], 2.0, 3),
    "error": (["error buzz", "wrong answer", "buzzer short"], 1.2, 3),
    "coin": (["coin", "coins", "cash register"], 1.5, 3),
    "tick": (["clock tick", "ticking", "tick tock"], 2.0, 3),
    "paper": (["paper rustle", "page turn", "paper flip"], 1.5, 3),
    "laugh": (["audience laugh short", "crowd laugh"], 3.0, 2),
    "applause": (["applause short", "clapping"], 3.0, 2),
    "heartbeat": (["heartbeat", "heart beat"], 2.5, 2),
    "drum": (["drum roll short", "rimshot", "ba dum tss"], 3.0, 3),
}


# أصوات مش مناسبة لفيديو شرح هادي (اتشال «Scary Hits & Risers» و «door … kick open»): بتترفض من اسمها قبل التحميل
BANNED = ("scary", "horror", "scream", "gun", "shot", "door", "kick", "explosion", "creepy", "loop", "glass")


def _get(path: str, params: dict) -> dict:
    r = requests.get(f"{API}/{path}/", params=params, headers=UA, timeout=25)
    r.raise_for_status()
    return r.json()


def _prep_audio(src: Path, out: Path, max_s: float) -> bool:
    """mp3 ← WAV 48k مونو: شيل السكوت في الأول، وقص على أقصى مدة بتلاشي، وعلو قمّة −1 dB."""
    r = subprocess.run(["ffmpeg", "-v", "error", "-y", "-i", str(src), "-af",
                        f"silenceremove=start_periods=1:start_threshold=-45dB,atrim=0:{max_s},afade=t=out:st={max(0.05, max_s - 0.15)}:d=0.15,"
                        "dynaudnorm=p=0.89:m=10", "-ac", "1", "-ar", "48000", str(out)], capture_output=True)
    return r.returncode == 0 and out.exists() and out.stat().st_size > 2000


def fetch_sfx(kinds: list[str] | None = None) -> dict:
    """بيجيب الأصوات اللي ناقصة من كل نوع (مرة واحدة). بيرجّع عدد كل نوع."""
    cat = read_json(SFX / "catalog.json", [])
    have = {}
    for it in cat:
        if not it.get("excluded"):
            have.setdefault(it["kind"], []).append(it)
    for kind in kinds or list(SFX_KINDS):
        queries, max_s, want = SFX_KINDS[kind]
        got = have.get(kind, [])
        for q in queries:
            if len(got) >= want:
                break
            try:
                res = _get("audio", {"q": q, "license": "cc0", "page_size": 20}).get("results", [])
            except requests.RequestException:
                break
            for r in res:
                if len(got) >= want:
                    break
                if r.get("license") != "cc0" or not r.get("url") or (r.get("duration") or 99999) > max_s * 1000 * 3 or any(x["id"] == r["id"] for x in cat) \
                        or any(b in (r.get("title") or "").lower() for b in BANNED):
                    continue
                d = SFX / kind
                d.mkdir(parents=True, exist_ok=True)
                raw, wav = d / f"{r['id']}.{r.get('filetype') or 'mp3'}", d / f"{r['id']}.wav"
                try:
                    a = requests.get(r["url"], headers=UA, timeout=30)
                    a.raise_for_status()
                    raw.write_bytes(a.content)
                except requests.RequestException:
                    continue
                ok = _prep_audio(raw, wav, max_s)
                raw.unlink(missing_ok=True)
                if not ok:
                    wav.unlink(missing_ok=True)
                    continue
                it = {"id": r["id"], "kind": kind, "file": str(wav.relative_to(ASSETS)), "title": r.get("title"), "creator": r.get("creator"),
                      "license": "CC0", "source": r.get("foreign_landing_url"), "query": q}
                cat.append(it)
                got.append(it)
        have[kind] = got
    with _lock:
        write_json(SFX / "catalog.json", cat)
    return {k: len(v) for k, v in have.items()}


def sfx_files(kind: str) -> list[Path]:
    return [ASSETS / it["file"] for it in read_json(SFX / "catalog.json", [])
            if it["kind"] == kind and not it.get("excluded") and (ASSETS / it["file"]).exists()]


def exclude(banned: tuple = BANNED) -> list[str]:
    """بيشيل من المكتبة أي صوت اسمه فيه كلمة ممنوعة (بيفضل في السجل مع السبب، والملف بيتمسح)."""
    cat, gone = read_json(SFX / "catalog.json", []), []
    for it in cat:
        hit = next((b for b in banned if b in (it.get("title") or "").lower()), None)
        if hit and not it.get("excluded"):
            it["excluded"] = f"مش مناسب لفيديو شرح هادي («{hit}»)"
            (ASSETS / it["file"]).unlink(missing_ok=True)
            gone.append(it["title"])
    with _lock:
        write_json(SFX / "catalog.json", cat)
    return gone


# ---------- الصور ----------
PHOTO_SOURCES = ["stocksnap,rawpixel", "wikimedia", None]   # StockSnap الأول (صور CC0 احترافية)، وبعدين ويكيميديا، وبعدين أي مصدر
JUDGE_SCHEMA = {"type": "object", "additionalProperties": False, "required": ["best", "why"],
                "properties": {"best": {"type": "integer", "description": "رقم الصورة المناسبة (من 1)، أو 0 لو مفيش ولا واحدة مناسبة"}, "why": {"type": "string"}}}
JUDGE_SYSTEM = """إنت مراجع صور لفيديو قصير احترافي. قدامك صور مرقّمة بالترتيب (1، 2، 3…) ووصف المطلوب.
اختار الصورة اللي **بتوضّح الوصف نفسه** وشكلها احترافي ونضيف. الجمهور عربي، فلازم الصورة تكون مناسبة لمجتمع محافظ.
ارفض أي صورة فيها:
- كتابة أو علامة مائية أو لوجو؛
- محتوى ديني أو سياسي؛
- **خمرة أو إزايز/كاسات مشروبات كحولية أو سجاير**؛
- لبس مكشوف أو بوس/أحضان رومانسية؛
- أو شكلها قديم/مهزوز/مش واضح.
لو مفيش ولا واحدة مناسبة فعلًا، best = 0."""


def find_photo(terms: list[str], used: set, judge=None) -> dict | None:
    """صورة حقيقية برخصة مفتوحة للحاجة دي. المرشحين من StockSnap/ويكيميديا (CC0/public domain/CC BY)، وبعدين مراجعة بالنظر:
    الذكاء الاصطناعي بيشوف المصغّرات ويختار اللي بتوضّح الوصف (من غير كتابة ولا لوجو). ليه: البحث بالعنوان بس جاب يافطة دينية وآلة كاتبة."""
    import base64
    stop = {"a", "an", "the", "of", "at", "by", "with", "and", "in", "on", "to", "for", "his", "her", "their", "its", "is", "are", "very", "content", "lively"}
    words = [w for w in " ".join(terms).lower().replace(",", " ").split() if w not in stop]
    q = " ".join(words[:4]) or " ".join(terms[:2])
    cands = []
    for src, qq in [(src, qq) for qq in dict.fromkeys([q, " ".join(words[:3]), " ".join(words[:2])]) if qq for src in PHOTO_SOURCES]:
        if len(cands) >= 6:
            break
        params = {"q": qq, "license": "cc0,pdm" if src else "cc0,pdm,by", "page_size": 12, "mature": "false"}
        if src:
            params["source"] = src
        try:
            res = _get("images", params).get("results", [])
        except requests.RequestException:
            return None
        for r in res:
            w, h = r.get("width") or 0, r.get("height") or 0
            if w >= 800 and h and 0.6 <= w / h <= 1.8 and f"photos/{r['id']}.jpg" not in used and r.get("thumbnail") and r["id"] not in {c["id"] for c in cands}:
                cands.append(r)
    cands = cands[:6]
    thumbs = []
    for r in cands:
        try:
            t = requests.get(r["thumbnail"], headers=UA, timeout=20)
            t.raise_for_status()
            thumbs.append(("image/jpeg", base64.b64encode(t.content).decode()))
        except requests.RequestException:
            thumbs.append(None)
    banned = {x["id"] for x in read_json(PHOTOS / "catalog.json", []) if x.get("banned")}
    pairs = [(r, t) for r, t in zip(cands, thumbs) if t and r["id"] not in banned]
    if not pairs:
        return None
    try:
        from ..config import LLM_MODEL
        from ..llm import claude_code
        verdict = (judge or (lambda imgs, text: claude_code.ask(JUDGE_SYSTEM, text, JUDGE_SCHEMA, model=LLM_MODEL, images=imgs)["data"]))(
            [t for _, t in pairs], f"الوصف المطلوب: {q}\nعدد الصور: {len(pairs)}")
    except Exception:
        return None
    k = int(verdict.get("best") or 0)
    if not (1 <= k <= len(pairs)):
        return None
    r = pairs[k - 1][0]
    PHOTOS.mkdir(parents=True, exist_ok=True)
    out = PHOTOS / f"{r['id']}.jpg"
    if not out.exists():
        try:
            a = requests.get(r["url"], headers=UA, timeout=40)
            a.raise_for_status()
        except requests.RequestException:
            return None
        tmp = PHOTOS / f"{r['id']}.src"
        tmp.write_bytes(a.content)
        ok = subprocess.run(["ffmpeg", "-v", "error", "-y", "-i", str(tmp), "-vf", "scale='min(1200,iw)':-2", "-q:v", "3", str(out)], capture_output=True).returncode == 0
        tmp.unlink(missing_ok=True)
        if not ok:
            return None
    lic = (r.get("license") or "").upper()
    meta = {"id": r["id"], "file": str(out.relative_to(ASSETS)), "title": r.get("title"), "creator": r.get("creator"), "license": lic,
            "source": r.get("foreign_landing_url"), "query": q, "judge": verdict.get("why"),
            "credit": None if lic in ("CC0", "PDM") else f"«{r.get('title')}» — {r.get('creator')} ({lic})"}
    with _lock:
        cat = read_json(PHOTOS / "catalog.json", [])
        if not any(x["id"] == r["id"] for x in cat):
            cat.append(meta)
            write_json(PHOTOS / "catalog.json", cat)
    used.add(meta["file"])
    return meta


def ban_photo(pid: str, why: str) -> None:
    """صورة اتشافت مش مناسبة: بتفضل في السجل بالسبب ومابتتختارش تاني، والملف بيتمسح."""
    with _lock:
        cat = read_json(PHOTOS / "catalog.json", [])
        for x in cat:
            if x["id"] == pid:
                x["banned"] = why
                (ASSETS / x["file"]).unlink(missing_ok=True)
        write_json(PHOTOS / "catalog.json", cat)


if __name__ == "__main__":   # .venv/bin/python -m app.montage.library
    print(json.dumps({"excluded": exclude(), "have": fetch_sfx()}, ensure_ascii=False))
