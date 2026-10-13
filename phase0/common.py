"""أدوات مشتركة لتجارب المرحلة 0: التقرير، وقراءة .env، وتشغيل الأوامر."""

import json
import subprocess
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "phase0" / "out"
REPORT_PATH = ROOT / "phase0_results.md"


def say(text: str = "") -> None:
    print(text, flush=True)


def load_env() -> dict:
    """يقرا .env بشكل بسيط (KEY=VALUE) من غير ما يغيّر متغيرات البيئة."""
    env = {}
    path = ROOT / ".env"
    if not path.exists():
        return env
    for line in path.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        env[key.strip()] = value.strip().strip('"').strip("'")
    return env


def run(cmd: list[str], timeout: int = 60, **kwargs) -> tuple[int, str, str]:
    """يشغّل أمر ويرجّع (returncode, stdout, stderr). لو الأمر مش موجود يرجّع 127."""
    try:
        p = subprocess.run(cmd, capture_output=True, text=True, timeout=timeout, **kwargs)
        return p.returncode, p.stdout, p.stderr
    except FileNotFoundError:
        return 127, "", f"command not found: {cmd[0]}"
    except subprocess.TimeoutExpired:
        return 124, "", f"timeout after {timeout}s"


def short(text, limit: int = 1500) -> str:
    text = str(text)
    return text if len(text) <= limit else text[:limit] + f"\n… (+{len(text) - limit} chars)"


class Report:
    """تقرير Markdown واحد بيتحفظ بعد كل خطوة، علشان لو حصل وقف النتايج تفضل موجودة."""

    def __init__(self, path: Path = REPORT_PATH):
        self.path = path
        self.parts: list[str] = []
        self.secrets: list[str] = []
        self.summary: list[tuple[str, object, str]] = []

    def add_secret(self, value: str | None) -> None:
        if value and len(value) > 6:
            self.secrets.append(value)

    def h(self, title: str, level: int = 2) -> None:
        self.parts.append(f"\n{'#' * level} {title}\n")
        say(f"\n{'=' * 8} {title} {'=' * 8}")

    def line(self, text: str) -> None:
        self.parts.append(text)
        say(text)

    def kv(self, key: str, value) -> None:
        self.line(f"- **{key}:** {value}")

    def check(self, name: str, passed, detail: str = "", summary: bool = True) -> None:
        """passed: True = نجح، False = فشل، None = تحذير / مش متأكد."""
        mark = {True: "✅", False: "❌"}.get(passed, "⚠️")
        self.line(f"- {mark} {name}" + (f": {detail}" if detail else ""))
        if summary:
            self.summary.append((name, passed, detail))

    def code(self, obj, lang: str = "json") -> None:
        text = obj if isinstance(obj, str) else json.dumps(obj, ensure_ascii=False, indent=2)
        self.parts.append(f"```{lang}\n{text}\n```")

    def table(self, headers: list[str], rows: list[list]) -> None:
        self.parts.append("| " + " | ".join(headers) + " |")
        self.parts.append("|" + "---|" * len(headers))
        for r in rows:
            self.parts.append("| " + " | ".join(str(c) for c in r) + " |")
        for r in rows:
            say("   " + "  |  ".join(str(c) for c in r))

    def save(self) -> None:
        text = "\n".join(self.parts) + "\n"
        for secret in self.secrets:
            text = text.replace(secret, "[REDACTED]")
        self.path.write_text(text, encoding="utf-8")
