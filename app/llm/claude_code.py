"""طبقة Claude: بتشغّل `claude -p` باشتراكك (Claude Code الأصلي على جهازك)، وبترجّع JSON منظم.

نفس الإعدادات اللي اتجرّبت في المرحلة 0: system prompt خاص + من غير أدوات + flags تخفيف (حمل ثابت أقل بحوالي 25 مرة).
"""

import json
import os
import subprocess
import tempfile
from pathlib import Path

LEAN = ["--strict-mcp-config", "--disable-slash-commands", "--no-session-persistence"]


class LLMError(Exception):
    pass


class LimitReached(LLMError):
    """وصلت لحد الاشتراك. resets_at = وقت التجديد (unix) لو معروف."""

    def __init__(self, msg: str, resets_at=None):
        super().__init__(msg)
        self.resets_at = resets_at


def _env() -> dict:
    env = dict(os.environ)
    for k in ("ANTHROPIC_API_KEY", "ANTHROPIC_AUTH_TOKEN"):
        env.pop(k, None)  # علشان claude يستخدم الاشتراك مش API key
    return env


def ask(system: str, prompt: str, schema: dict, model: str = "opus", timeout: int = 600, images: list[tuple[str, str]] | None = None) -> dict:
    """طلب واحد ← {"data": <JSON حسب الـ schema>, "rate_limit": {...} أو None}. images: [(media_type, base64)] بتتبعت قبل الكلام (مراجعة بالنظر)."""
    content = [{"type": "image", "source": {"type": "base64", "media_type": mt, "data": b64}} for mt, b64 in images or []]
    message = {"type": "user", "message": {"role": "user", "content": content + [{"type": "text", "text": prompt}]}}
    cmd = ["claude", "-p", "--input-format", "stream-json", "--output-format", "stream-json", "--verbose",
           "--json-schema", json.dumps(schema), "--system-prompt", system, "--model", model,
           "--tools", "", "--permission-mode", "dontAsk", *LEAN]
    with tempfile.TemporaryDirectory() as work:  # فولدر فاضي علشان claude ما يقراش ملفات المشروع
        try:
            p = subprocess.run(cmd, input=json.dumps(message) + "\n", capture_output=True, text=True,
                               timeout=timeout, cwd=work, env=_env())
        except FileNotFoundError:
            raise LLMError("أداة الذكاء الاصطناعي مش متسطّبة على الجهاز. سطّبها وسجّل دخول.")
        except subprocess.TimeoutExpired:
            raise LLMError(f"الذكاء الاصطناعي ما ردّش في {timeout} ثانية")
    events = []
    for line in p.stdout.splitlines():
        line = line.strip()
        if line.startswith("{"):
            try:
                events.append(json.loads(line))
            except json.JSONDecodeError:
                pass
    rate = next((e.get("rate_limit_info") or e for e in reversed(events) if e.get("type") == "rate_limit_event"), None)
    result = next((e for e in reversed(events) if e.get("type") == "result"), None)
    if rate and str(rate.get("status", "")).startswith("rejected"):
        raise LimitReached("وصلت لحد استخدام الذكاء الاصطناعي", rate.get("resets_at") or rate.get("resetsAt"))
    if not result:
        text = (p.stdout + p.stderr)[-600:]
        if any(w in text.lower() for w in ("login", "log in", "/login", "unauthorized")):
            raise LLMError("أداة الذكاء الاصطناعي مش مسجّلة دخول: سجّل دخول من التيرمينال (/login)")
        raise LLMError(f"رد غير متوقع من الذكاء الاصطناعي: {text}")
    if result.get("is_error"):
        msg = str(result.get("result", ""))
        if "limit" in msg.lower():
            raise LimitReached(msg[:200], (rate or {}).get("resets_at"))
        raise LLMError(msg[:400])
    data = result.get("structured_output")
    if data is None:
        try:
            data = json.loads(result.get("result") or "")
        except (json.JSONDecodeError, TypeError):
            raise LLMError("الذكاء الاصطناعي ما رجّعش JSON")
    return {"data": data, "rate_limit": rate}


def check() -> dict:
    """claude متسطّب؟ (من غير ما نعمل طلب)"""
    try:
        p = subprocess.run(["claude", "--version"], capture_output=True, text=True, timeout=20)
        return {"installed": p.returncode == 0, "version": p.stdout.strip()}
    except (FileNotFoundError, subprocess.TimeoutExpired):
        return {"installed": False, "version": ""}
