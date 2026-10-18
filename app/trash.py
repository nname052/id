"""سلة المحذوفات: أي فيديو أو مونتاج بيتحذف بيتنقل هنا الأول (مش بيتمسح)، وتقدر ترجّعه من صفحة «المحذوفات».
بعد 7 أيام بيتمسح نهائي لوحده (بيتفحص كل ما التطبيق يشتغل، وكل ما صفحة المحذوفات تتفتح، ومرة كل ساعة).

ليه: الحذف كان نهائي على طول (rmtree)، والمستخدم مسح مونتاجات وكان محتاج يرجّعها.
كل عنصر في السلة فولدر: videos/_trash/<kind>__<id>__<وقت الحذف>/ وجواه الفولدر الأصلي زي ما هو + meta.json.
"""

import shutil
import threading
import time
from pathlib import Path

from .config import VIDEOS
from .store import read_json, write_json

TRASH = VIDEOS / "_trash"
KEEP_DAYS = 7
KINDS = {"video": VIDEOS, "montage": VIDEOS / "_montage"}
_lock = threading.Lock()


def move(kind: str, item_id: str, title: str = "") -> dict | None:
    """بينقل فولدر العنصر للسلة. بيرجّع بيانات العنصر في السلة (أو None لو مش موجود)."""
    src = KINDS[kind] / item_id
    if not src.is_dir():
        return None
    now = time.time()
    tid = f"{kind}__{item_id}__{int(now)}"
    dst = TRASH / tid
    with _lock:
        dst.mkdir(parents=True, exist_ok=False)
        shutil.move(str(src), str(dst / "item"))
        meta = {"tid": tid, "kind": kind, "id": item_id, "title": title or item_id, "deleted_at": now, "expires_at": now + KEEP_DAYS * 86400}
        write_json(dst / "meta.json", meta)
    return meta


def _size(p: Path) -> int:
    return sum(f.stat().st_size for f in p.rglob("*") if f.is_file())


def items() -> list[dict]:
    purge_expired()
    out = []
    if TRASH.exists():
        for d in TRASH.iterdir():
            m = read_json(d / "meta.json")
            if m and (d / "item").is_dir():
                out.append({**m, "days_left": max(0, int((m["expires_at"] - time.time()) // 86400) + 1), "size": _size(d / "item")})
    return sorted(out, key=lambda m: -m["deleted_at"])


def restore(tid: str) -> dict:
    """بيرجّع العنصر لمكانه. لو فيه حاجة بنفس الرقم في المكان الأصلي، بيرفض (ما بيكتبش فوق حاجة)."""
    d = _dir(tid)
    m = read_json(d / "meta.json")
    dst = KINDS[m["kind"]] / m["id"]
    if dst.exists():
        raise FileExistsError(f"فيه {'مونتاج' if m['kind'] == 'montage' else 'فيديو'} بنفس الرقم موجود دلوقتي")
    with _lock:
        dst.parent.mkdir(parents=True, exist_ok=True)
        shutil.move(str(d / "item"), str(dst))
        shutil.rmtree(d, ignore_errors=True)
    return m


def purge(tid: str) -> None:
    """مسح نهائي لعنصر واحد (من زرار «امسح نهائي» بعد تأكيد)."""
    shutil.rmtree(_dir(tid), ignore_errors=True)


def purge_expired() -> list[str]:
    """أي حاجة عدّى عليها 7 أيام في السلة بتتمسح نهائي."""
    gone = []
    if TRASH.exists():
        for d in TRASH.iterdir():
            m = read_json(d / "meta.json")
            if m and time.time() >= m["expires_at"]:
                shutil.rmtree(d, ignore_errors=True)
                gone.append(m["tid"])
    return gone


def _dir(tid: str) -> Path:
    d = TRASH / tid
    if "/" in tid or ".." in tid or not (d / "meta.json").exists():
        raise KeyError("العنصر ده مش في المحذوفات")
    return d


def start_janitor() -> None:
    """فحص كل ساعة (والتطبيق شغّال) للحاجات اللي عدّى عليها أسبوع."""
    def loop():
        while True:
            try:
                purge_expired()
            except Exception:
                pass
            time.sleep(3600)
    threading.Thread(target=loop, daemon=True).start()
