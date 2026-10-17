"""حفظ وقراءة المشاريع: كل فيديو فولدر في videos/ وفيه project.json."""

import json
import os
import re
import secrets
import shutil
import threading
from datetime import datetime
from pathlib import Path

from .config import DEFAULT_SETTINGS, VIDEOS

STAGES = ["script", "tts", "brief", "scenes", "audio", "render"]
_lock = threading.Lock()


def project_dir(pid: str) -> Path:
    if not re.fullmatch(r"[\w\-]+", pid):
        raise ValueError("bad id")
    return VIDEOS / pid


def write_json(path: Path, data) -> None:
    """كتابة لملف مؤقت وبعدين rename، علشان الملف ما يبوظش لو التطبيق وقف في النص."""
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(path.suffix + ".tmp")
    tmp.write_text(json.dumps(data, ensure_ascii=False, indent=1), encoding="utf-8")
    os.replace(tmp, path)


def read_json(path: Path, default=None):
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except (FileNotFoundError, json.JSONDecodeError):
        return default


def create(prompt: str, settings: dict, direction: str = "", user_script: str = "") -> dict:
    slug = re.sub(r"[^\w]+", "-", prompt.strip())[:24].strip("-") or "video"
    pid = f"{datetime.now():%Y-%m-%d}_{secrets.token_hex(3)}"
    proj = {
        "id": pid,
        "slug": slug,
        "title": "",
        "prompt": prompt.strip(),
        "direction": direction.strip(),  # طلب الإخراج (اختياري)
        "user_script": user_script.strip(),  # سكريبت كتبه صاحب الفيديو بنفسه (اختياري)
        "settings": {**DEFAULT_SETTINGS, **settings},
        "created": datetime.now().isoformat(timespec="seconds"),
        "status": "queued",
        "stages": {s: {"status": "pending"} for s in STAGES},
        "usage": {"claude_calls": 0, "claude_by_stage": {}, "elevenlabs": {}},
        "log": [],
    }
    save(proj)
    return proj


def load(pid: str) -> dict | None:
    p = read_json(project_dir(pid) / "project.json")
    if p and "brief" not in p["stages"]:  # مشاريع قبل مرحلة الرؤية الإخراجية: نعتبرها متوافق عليها
        p["stages"] = {s: p["stages"].get(s, {"status": "approved" if s == "brief" else "pending"}) for s in STAGES}
    return p


def save(proj: dict) -> None:
    with _lock:
        write_json(project_dir(proj["id"]) / "project.json", proj)


def update(pid: str, fn) -> dict:
    """قراءة + تعديل + حفظ في خطوة واحدة (علشان الـ worker والـ API ما يكتبوش فوق بعض)."""
    with _lock:
        proj = read_json(project_dir(pid) / "project.json")
        fn(proj)
        write_json(project_dir(pid) / "project.json", proj)
        return proj


def log(pid: str, msg: str) -> None:
    def add(p):
        p["log"] = (p.get("log", []) + [f"{datetime.now():%H:%M:%S} {msg}"])[-60:]
    update(pid, add)


def list_all() -> list[dict]:
    out = []
    if VIDEOS.exists():
        for d in sorted(VIDEOS.iterdir(), reverse=True):
            if not d.is_dir():  # ملفات النظام زي .DS_Store
                continue
            p = read_json(d / "project.json")
            if p:
                out.append(p)
    return out


def delete(pid: str) -> None:
    shutil.rmtree(project_dir(pid), ignore_errors=True)
