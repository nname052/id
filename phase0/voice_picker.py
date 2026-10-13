"""صفحة اختيار الصوت: تسمع عينة كل صوت (مجانًا)، وتجرّبه بجملتك (credits)، وتختاره فيتحفظ في .env.

التشغيل: uv run python -m phase0.voice_picker   ← وافتح http://127.0.0.1:8001
"""

import json
import os
import threading
import time
import webbrowser
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

import requests

from .common import ROOT, load_env, say
from .list_voices import API, is_egyptian, my_voices, shared_arabic_voices

PORT = 8001
PAGE = ROOT / "phase0" / "voice_picker.html"
ENV_PATH = ROOT / ".env"
MODEL = "eleven_v3"
MAX_TEST_CHARS = 300  # حد للجملة التجريبية علشان ما تصرفش credits كتير بالغلط
CACHE_SECONDS = 3600

_cache: dict = {"at": 0.0, "voices": []}
_lock = threading.Lock()


def session() -> requests.Session:
    s = requests.Session()
    s.headers["xi-api-key"] = load_env().get("ELEVENLABS_API_KEY", "")
    return s


def all_voices(refresh: bool = False) -> list[dict]:
    with _lock:
        if refresh or not _cache["voices"] or time.time() - _cache["at"] > CACHE_SECONDS:
            s = session()
            seen, rows = set(), []
            for row in my_voices(s) + shared_arabic_voices(s):
                if row["voice_id"] not in seen:
                    seen.add(row["voice_id"])
                    rows.append({**row, "egyptian": is_egyptian(row)})
            rows.sort(key=lambda r: (not r["egyptian"], r["source"] != "mine", (r["name"] or "").lower()))
            _cache.update(at=time.time(), voices=rows)
        return _cache["voices"]


def set_env_value(key: str, value: str) -> None:
    """يغيّر سطر واحد في .env ويسيب الباقي زي ما هو. الكتابة على ملف مؤقت وبعدين rename، علشان الملف ما يبوظش."""
    lines = ENV_PATH.read_text(encoding="utf-8").splitlines() if ENV_PATH.exists() else []
    out, done = [], False
    for line in lines:
        if line.split("=", 1)[0].strip() == key:
            if not done:
                out.append(f"{key}={value}")
                done = True
            continue  # لو السطر متكرر نشيل التكرار
        out.append(line)
    if not done:
        out.append(f"{key}={value}")
    tmp = ENV_PATH.with_suffix(".tmp")
    tmp.write_text("\n".join(out) + "\n", encoding="utf-8")
    os.replace(tmp, ENV_PATH)


def usage() -> dict:
    r = session().get(f"{API}/v1/user/subscription", timeout=30)
    if r.status_code != 200:
        return {"error": f"HTTP {r.status_code}"}
    d = r.json()
    return {"used": d.get("character_count"), "limit": d.get("character_limit"), "tier": d.get("tier")}


class Handler(BaseHTTPRequestHandler):
    def log_message(self, *a):
        pass

    def send(self, code: int, body: bytes, ctype: str) -> None:
        self.send_response(code)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(body)

    def json(self, obj, code: int = 200) -> None:
        self.send(code, json.dumps(obj, ensure_ascii=False).encode(), "application/json; charset=utf-8")

    def body(self) -> dict:
        n = int(self.headers.get("Content-Length") or 0)
        return json.loads(self.rfile.read(n) or b"{}")

    def do_GET(self):
        try:
            if self.path == "/":
                self.send(200, PAGE.read_bytes(), "text/html; charset=utf-8")
            elif self.path.startswith("/api/voices"):
                voices = all_voices(refresh="refresh=1" in self.path)
                self.json({"voices": voices, "selected": load_env().get("ELEVENLABS_VOICE_ID", "")})
            elif self.path == "/api/usage":
                self.json(usage())
            else:
                self.send(404, b"not found", "text/plain")
        except SystemExit as e:  # list_voices بيعمل sys.exit لو الـ API رجّع خطأ
            self.json({"error": str(e)}, 502)
        except Exception as e:
            self.json({"error": str(e)[:300]}, 500)

    def do_POST(self):
        try:
            data = self.body()
            if self.path == "/api/select":
                voice_id = str(data.get("voice_id") or "").strip()
                if not voice_id.isalnum():
                    return self.json({"error": "voice_id مش صحيح"}, 400)
                set_env_value("ELEVENLABS_VOICE_ID", voice_id)
                self.json({"ok": True, "selected": voice_id})
            elif self.path == "/api/test":
                text = str(data.get("text") or "").strip()
                voice_id = str(data.get("voice_id") or "").strip()
                stability = float(data.get("stability", 0.5))
                if not text or len(text) > MAX_TEST_CHARS or not voice_id.isalnum() or stability not in (0.0, 0.5, 1.0):
                    return self.json({"error": f"الجملة لازم تكون من 1 لـ {MAX_TEST_CHARS} حرف"}, 400)
                r = session().post(
                    f"{API}/v1/text-to-speech/{voice_id}",
                    params={"output_format": "mp3_44100_128"},
                    json={"text": text, "model_id": MODEL, "voice_settings": {"stability": stability}},
                    timeout=180,
                )
                if r.status_code != 200:
                    return self.json({"error": f"ElevenLabs HTTP {r.status_code}: {r.text[:300]}"}, 502)
                self.send(200, r.content, "audio/mpeg")
            else:
                self.send(404, b"not found", "text/plain")
        except Exception as e:
            self.json({"error": str(e)[:300]}, 500)


def main() -> None:
    if not load_env().get("ELEVENLABS_API_KEY"):
        raise SystemExit("❌ ELEVENLABS_API_KEY فاضي في .env")
    server = ThreadingHTTPServer(("127.0.0.1", PORT), Handler)
    url = f"http://127.0.0.1:{PORT}"
    say(f"✅ صفحة اختيار الصوت شغالة: {url}\n   (اقفلها بـ Ctrl+C)")
    if not os.environ.get("NO_BROWSER"):
        threading.Timer(0.5, webbrowser.open, [url]).start()
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass


if __name__ == "__main__":
    main()
