"""حساب ElevenLabs: الرصيد، حالة المفتاح، وحد الموافقة قبل أي صوت.

- المفتاح بيتقرا من .env (ELEVENLABS_API_KEY) في config.py بس، وعمره ما بيرجع للمتصفح ولا بيتكتب في لوج أو ملف:
  الدوال هنا بترجّع أرقام محسوبة بس.
- كل الطلبات هنا قراءة بس (GET /v1/user/subscription) ومش بتصرف رصيد.
- حد المفتاح نفسه (Credit limit) مفيش endpoint يقراه أو يغيّره لمفتاح شخصي (الموجود في الـ API لمفاتيح service accounts بس)،
  فبيتغيّر من elevenlabs.io، وإحنا بنعرف إن المفتاح "محدود" لو آخر طلب صوت رجع quota_exceeded.
"""

import json
import time

import requests

from .config import ELEVEN_KEY, ROOT

API = "https://api.elevenlabs.io"
DATA = ROOT / "data"
SETTINGS = DATA / "app_settings.json"
EVENTS = DATA / "elevenlabs_events.json"
DEFAULT_GUARD = 200  # credit لكل مرة: أكتر من كده لازم موافقة قبل ما الصوت يتعمل


def _read(path, default):
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except (FileNotFoundError, ValueError):
        return default


def _write(path, data) -> None:
    DATA.mkdir(exist_ok=True)
    path.write_text(json.dumps(data, ensure_ascii=False, indent=1), encoding="utf-8")


# ---------- حد الموافقة (إنت اللي بتحدده، وعمره ما بيتغيّر لوحده) ----------
def guard() -> int:
    v = _read(SETTINGS, {}).get("credit_guard", DEFAULT_GUARD)
    return int(v) if isinstance(v, (int, float)) and v >= 1 else DEFAULT_GUARD


def set_guard(value: int) -> int:
    value = max(1, int(value))
    s = _read(SETTINGS, {})
    s["credit_guard"] = value
    _write(SETTINGS, s)
    return value


# ---------- آخر حالة للمفتاح (من نتيجة طلبات الصوت نفسها) ----------
def record(kind: str) -> None:
    """kind: tts_ok | quota_exceeded"""
    ev = _read(EVENTS, {})
    ev[f"{kind}_at"] = time.time()
    _write(EVENTS, ev)


def account() -> dict:
    """الرصيد وحالة المفتاح. طلب قراءة بس، ومن غير ما المفتاح يطلع في الرد."""
    checked = time.time()
    if not ELEVEN_KEY:
        return {"key_status": "missing", "checked_at": checked}
    try:
        r = requests.get(f"{API}/v1/user/subscription", headers={"xi-api-key": ELEVEN_KEY}, timeout=30)
    except requests.RequestException as e:
        return {"key_status": "unreachable", "error": type(e).__name__, "checked_at": checked}
    if r.status_code in (401, 403):
        return {"key_status": "invalid", "http": r.status_code, "checked_at": checked}
    if r.status_code != 200:
        return {"key_status": "error", "http": r.status_code, "checked_at": checked}
    d = r.json()
    used, limit = int(d.get("character_count") or 0), int(d.get("character_limit") or 0)
    ev = _read(EVENTS, {})
    limited = ev.get("quota_exceeded_at", 0) > ev.get("tts_ok_at", 0)
    return {
        "key_status": "limited" if limited else "active",
        "credits_used": used,
        "credits_limit": limit,
        "credits_remaining": max(0, limit - used),
        "reset_unix": d.get("next_character_count_reset_unix"),
        "refresh_period": d.get("character_refresh_period"),
        "tier": d.get("tier"),
        "subscription_status": d.get("status"),
        "last_quota_exceeded_at": ev.get("quota_exceeded_at"),
        "last_tts_ok_at": ev.get("tts_ok_at"),
        "checked_at": checked,
    }
