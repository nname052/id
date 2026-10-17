"""حالة المونتاج: كل مونتاج فولدر لوحده في videos/_montage/<id>/ (منفصل تمامًا عن مشاريع التوليد).

videos/_montage/<id>/
  montage.json            الحالة: المصادر، التحليل، التعديل، التصدير
  original/<n>_<name>     الملف زي ما اترفع بالظبط (عمره ما بيتعدّل) + بصمته sha256
  work/<n>.<ext>          نسخة الشغل (التحليل والتصدير بيقروا منها)
  work/<n>.analysis.json  التحليل جنب نسخة الشغل
  edit.json               التعديل: قايمة (المصدر، البداية، النهاية) بالترتيب + مقاس الإخراج
  exports/*.mp4           الإخراج (ملف جديد كل مرة)
"""

import hashlib
import re
import secrets
import shutil
import threading
from datetime import datetime
from pathlib import Path

from ..config import VIDEOS
from ..store import read_json, write_json

ROOT = VIDEOS / "_montage"
ALLOWED = {".mp4": "video", ".mov": "video", ".m4a": "audio"}
_lock = threading.Lock()


def mdir(mid: str) -> Path:
    if not re.fullmatch(r"[\w\-]+", mid):
        raise ValueError("bad id")
    return ROOT / mid


def sha256(path: Path) -> str:
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def new_id() -> str:
    return f"{datetime.now():%Y-%m-%d}_{secrets.token_hex(3)}"


def load(mid: str) -> dict | None:
    return read_json(mdir(mid) / "montage.json")


def save(m: dict) -> None:
    write_json(mdir(m["id"]) / "montage.json", m)


def update(mid: str, fn) -> dict:
    with _lock:
        m = load(mid)
        fn(m)
        save(m)
        return m


def list_all() -> list[dict]:
    out = []
    if ROOT.exists():
        for d in sorted(ROOT.iterdir(), reverse=True):
            m = read_json(d / "montage.json")
            if m:
                out.append(m)
    return out


def delete(mid: str) -> None:
    shutil.rmtree(mdir(mid), ignore_errors=True)


def safe_name(name: str) -> str:
    stem, ext = Path(name).stem, Path(name).suffix.lower()
    stem = re.sub(r"[^\w\-]+", "_", stem, flags=re.UNICODE).strip("_")[:60] or "file"
    return stem + ext
