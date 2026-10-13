"""تجربة 1: هل claude -p (اشتراك Claude) بيرجّع JSON منظم، وبيشوف الصور، وبيبلّغ عن حد الاستخدام؟"""

import base64
import json
import os
import shutil
import struct
import time
import zlib
from pathlib import Path

from .common import OUT, Report, run, say, short

WORK = OUT / "claude_work"  # فولدر فاضي بيشتغل فيه claude علشان ما يقراش ملفات المشروع
RAW = OUT / "claude_raw"

SYSTEM = "You are a backend component. Answer only through the requested JSON schema."

# flags بتقلل اللي Claude Code بيحمّله مع كل طلب (أدوات، MCP، أوامر، حفظ الجلسة)
LEAN = ["--strict-mcp-config", "--disable-slash-commands", "--no-session-persistence"]

SCHEMA_TEXT = {
    "type": "object",
    "properties": {
        "title": {"type": "string"},
        "keywords": {"type": "array", "items": {"type": "string"}, "minItems": 3, "maxItems": 3},
    },
    "required": ["title", "keywords"],
    "additionalProperties": False,
}

SCHEMA_SHAPES = {
    "type": "object",
    "properties": {
        "shapes": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "shape": {"type": "string", "enum": ["square", "circle", "triangle", "other"]},
                    "color": {"type": "string", "enum": ["red", "blue", "green", "yellow", "black", "other"]},
                    "position": {
                        "type": "string",
                        "enum": ["top-left", "top-right", "bottom-left", "bottom-right", "center"],
                    },
                },
                "required": ["shape", "color", "position"],
                "additionalProperties": False,
            },
        }
    },
    "required": ["shapes"],
    "additionalProperties": False,
}

EXPECTED_SHAPES = {("square", "red", "top-left"), ("circle", "blue", "bottom-right")}


def make_test_image(path: Path, size: int = 480) -> None:
    """صورة اختبار بـ Python بس: مربع أحمر فوق شمال، ودايرة زرقا تحت يمين، على خلفية بيضا."""

    def pixel(x, y):
        if 40 <= x <= 200 and 40 <= y <= 200:
            return (220, 30, 30)
        if (x - 340) ** 2 + (y - 340) ** 2 <= 90**2:
            return (30, 60, 220)
        return (255, 255, 255)

    raw = bytearray()
    for y in range(size):
        raw.append(0)
        for x in range(size):
            raw.extend(pixel(x, y))

    def chunk(tag: bytes, data: bytes) -> bytes:
        return struct.pack(">I", len(data)) + tag + data + struct.pack(">I", zlib.crc32(tag + data) & 0xFFFFFFFF)

    png = (
        b"\x89PNG\r\n\x1a\n"
        + chunk(b"IHDR", struct.pack(">IIBBBBB", size, size, 8, 2, 0, 0, 0))
        + chunk(b"IDAT", zlib.compress(bytes(raw), 9))
        + chunk(b"IEND", b"")
    )
    path.write_bytes(png)


def claude_env() -> dict:
    """نشيل أي API key من البيئة علشان claude يستخدم الاشتراك مش الـ API."""
    env = dict(os.environ)
    for k in ("ANTHROPIC_API_KEY", "ANTHROPIC_AUTH_TOKEN"):
        env.pop(k, None)
    return env


def call(name: str, args: list[str], stdin_text: str | None = None, timeout: int = 300) -> dict:
    """يشغّل claude -p ويرجّع ملخص: الوقت، والخرج الخام، والـ JSON لو موجود."""
    t0 = time.time()
    code, out, err = run(
        ["claude", "-p", *args],
        timeout=timeout,
        cwd=WORK,
        env=claude_env(),
        input=stdin_text if stdin_text is not None else "",
    )
    secs = time.time() - t0
    (RAW / f"{name}.stdout.txt").write_text(out, encoding="utf-8")
    (RAW / f"{name}.stderr.txt").write_text(err, encoding="utf-8")
    return {"code": code, "out": out, "err": err, "secs": secs}


def parse_json_output(out: str) -> dict | None:
    try:
        return json.loads(out)
    except json.JSONDecodeError:
        # أحيانًا بيكون فيه سطور قبل الـ JSON؛ نجرّب آخر سطر
        for line in reversed(out.strip().splitlines()):
            try:
                return json.loads(line)
            except json.JSONDecodeError:
                continue
    return None


def parse_stream(out: str) -> list[dict]:
    events = []
    for line in out.splitlines():
        line = line.strip()
        if line.startswith("{"):
            try:
                events.append(json.loads(line))
            except json.JSONDecodeError:
                pass
    return events


def structured(result: dict | None):
    if not result:
        return None
    if result.get("structured_output") is not None:
        return result["structured_output"]
    # احتياطي: لو الـ JSON رجع كنص في result
    try:
        return json.loads(result.get("result") or "")
    except (json.JSONDecodeError, TypeError):
        return None


def describe_result(rep: Report, result: dict | None, secs: float) -> None:
    if not result:
        return
    model_usage = result.get("modelUsage") or result.get("model_usage") or {}
    rep.kv("الوقت", f"{secs:.1f} ثانية")
    rep.kv("الموديل المستخدم", ", ".join(model_usage.keys()) or "مش معروف")
    rep.kv("عدد الـ turns", result.get("num_turns"))
    u = result.get("usage") or {}
    tokens_in = sum(int(u.get(k) or 0) for k in ("input_tokens", "cache_creation_input_tokens", "cache_read_input_tokens"))
    rep.kv("التوكنز", f"داخل {tokens_in:,} (منهم cache read {int(u.get('cache_read_input_tokens') or 0):,})، وخارج {int(u.get('output_tokens') or 0):,}")
    rep.kv("total_cost_usd (تقدير بس، مش بيتدفع مع الاشتراك)", result.get("total_cost_usd"))


def looks_like_auth_error(text: str) -> bool:
    t = text.lower()
    return any(w in t for w in ("login", "log in", "authenticat", "/login", "api key", "unauthorized"))


def shapes_ok(data) -> tuple[bool, str]:
    if not isinstance(data, dict):
        return False, "مفيش JSON"
    got = {(s.get("shape"), s.get("color"), s.get("position")) for s in data.get("shapes", [])}
    ok = EXPECTED_SHAPES <= got
    return ok, f"اللي شافه: {sorted(got)}"


def run_tests(rep: Report, args) -> None:
    rep.h("تجربة 1: Claude Code (claude -p) باشتراكك")
    WORK.mkdir(parents=True, exist_ok=True)
    RAW.mkdir(parents=True, exist_ok=True)

    if not shutil.which("claude"):
        rep.check("claude متسطّب", False, "مش لاقي أمر claude. شوف phase0/README.md (خطوة 3)")
        return

    code, out, err = run(["claude", "--version"], timeout=30)
    rep.check("claude متسطّب", code == 0, (out or err).strip())
    if os.environ.get("ANTHROPIC_API_KEY"):
        rep.check("ANTHROPIC_API_KEY في البيئة", None, "موجود في التيرمينال، والتجربة شالته علشان تستخدم الاشتراك")

    # --- 1.1 طلب نصي يرجّع JSON ---
    rep.h("1.1 طلب نصي ← JSON منظم (--json-schema)", 3)
    r = call(
        "text_json",
        [
            "Suggest a short Egyptian-Arabic TikTok title about the fear of failure, plus exactly 3 keywords.",
            "--output-format", "json",
            "--json-schema", json.dumps(SCHEMA_TEXT),
            "--system-prompt", SYSTEM,
            "--permission-mode", "dontAsk",
            "--tools", "",
            *LEAN,
        ],
    )
    res = parse_json_output(r["out"])
    data = structured(res)
    if res is None:
        auth = looks_like_auth_error(r["out"] + r["err"])
        rep.check("الرد JSON", False, "شكله مش مسجّل دخول: شغّل claude واكتب /login" if auth else "الخرج مش JSON")
        rep.code(short(r["out"] + "\n" + r["err"]), "text")
        rep.save()
        return
    if res.get("is_error"):
        auth = looks_like_auth_error(str(res.get("result", "")))
        rep.check("الطلب نجح", False, ("مش مسجّل دخول؟ " if auth else "") + short(res.get("result", ""), 300))
    valid = isinstance(data, dict) and isinstance(data.get("title"), str) and len(data.get("keywords", [])) == 3
    rep.check("JSON منظم بالـ schema", valid, "في حقل structured_output" if res.get("structured_output") else "")
    rep.code(data if data is not None else short(res.get("result", "")))
    describe_result(rep, res, r["secs"])
    rep.save()

    # --- 1.2 صورة عن طريق أداة Read ---
    rep.h("1.2 صورة ← عن طريق أداة Read", 3)
    img = WORK / "test_shapes.png"
    make_test_image(img)
    r = call(
        "image_read_tool",
        [
            f"Use the Read tool to open the image file at {img} and list every shape you see in it.",
            "--output-format", "json",
            "--json-schema", json.dumps(SCHEMA_SHAPES),
            "--system-prompt", SYSTEM + " You may use the Read tool to view image files.",
            "--tools", "Read",
            "--allowedTools", "Read",
            "--permission-mode", "dontAsk",
            *LEAN,
        ],
    )
    res = parse_json_output(r["out"])
    ok, detail = shapes_ok(structured(res))
    rep.check("Claude شاف الصورة صح (Read)", ok, detail)
    describe_result(rep, res, r["secs"])
    rep.save()

    # --- 1.3 صورة base64 في stream-json + قراءة rate_limit_event ---
    rep.h("1.3 صورة ← base64 في stream-json (+ حدث حد الاستخدام)", 3)
    b64 = base64.b64encode(img.read_bytes()).decode()
    message = {
        "type": "user",
        "message": {
            "role": "user",
            "content": [
                {"type": "text", "text": "List every shape you see in this image."},
                {"type": "image", "source": {"type": "base64", "media_type": "image/png", "data": b64}},
            ],
        },
    }
    r = call(
        "image_stream_json",
        [
            "--input-format", "stream-json",
            "--output-format", "stream-json",
            "--verbose",
            "--json-schema", json.dumps(SCHEMA_SHAPES),
            "--system-prompt", SYSTEM,
            "--permission-mode", "dontAsk",
            "--tools", "",
            *LEAN,
        ],
        stdin_text=json.dumps(message) + "\n",
    )
    events = parse_stream(r["out"])
    types: dict[str, int] = {}
    for e in events:
        key = e.get("type", "?") + ("/" + e["subtype"] if e.get("subtype") else "")
        types[key] = types.get(key, 0) + 1
    result_ev = next((e for e in reversed(events) if e.get("type") == "result"), None)
    ok, detail = shapes_ok(structured(result_ev))
    rep.check("Claude شاف الصورة صح (stream-json)", ok, detail)
    rep.kv("أنواع الأحداث", f"`{json.dumps(types, ensure_ascii=False)}`")
    describe_result(rep, result_ev, r["secs"])
    rate_events = [e for e in events if "rate_limit" in e.get("type", "")]
    rep.check("حدث rate_limit_event موجود", bool(rate_events), "" if rate_events else "مش ظاهر، وهنعتمد على رسالة الخطأ بدله")
    if rate_events:
        rep.line("آخر حدث لحد الاستخدام (فيه وقت التجديد ونسبة الاستخدام):")
        rep.code(rate_events[-1])
    if not events:
        rep.code(short(r["out"] + "\n" + r["err"]), "text")
    rep.save()

    # --- 1.4 الموديلات المتاحة على اشتراكك ---
    rep.h("1.4 الموديلات المتاحة على اشتراكك", 3)
    rows = []
    for alias in ("sonnet", "opus"):
        r = call(f"model_{alias}", ["Reply with the single word OK.", "--output-format", "json", "--model", alias, "--tools", "", *LEAN])
        res = parse_json_output(r["out"]) or {}
        used = ", ".join((res.get("modelUsage") or {}).keys()) or "-"
        good = bool(res) and not res.get("is_error")
        rows.append([alias, "✅" if good else "❌", used, f"{r['secs']:.1f}s", short(res.get("result", r["err"]), 80).replace("\n", " ")])
        rep.summary.append((f"موديل {alias} متاح", good, used))
    rep.table(["alias", "شغال", "الموديل الفعلي", "الوقت", "الرد"], rows)
    rep.save()

    # --- 1.5 الحمل الثابت لكل طلب: الإعدادات العادية مقابل المخففة ---
    rep.h("1.5 حجم كل طلب: الإعدادات العادية مقابل المخففة", 3)
    rows = []
    for label, extra in (("عادي", []), ("مخفف", ["--system-prompt", SYSTEM, "--tools", "", *LEAN])):
        r = call(f"overhead_{label}", ["Reply with the single word OK.", "--output-format", "json", *extra])
        u = (parse_json_output(r["out"]) or {}).get("usage") or {}
        tokens_in = sum(int(u.get(k) or 0) for k in ("input_tokens", "cache_creation_input_tokens", "cache_read_input_tokens"))
        rows.append([label, f"{tokens_in:,}", f"{r['secs']:.1f}s"])
    rep.table(["الإعداد", "توكنز داخلة لطلب فاضي", "الوقت"], rows)
    rep.save()
    say(f"\nالمخرجات الخام في: {RAW}")
