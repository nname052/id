"""أدوات مشتركة بين المراحل: طلب Claude مع تسجيل الاستهلاك، وقراءة البرومبتات، وتقسيم الكلمات."""

import re

from .. import store
from ..config import LLM_MODEL, PROMPTS
from ..llm import claude_code

TAG = re.compile(r"^\[[^\]]+\]$")


def prompt(name: str, **kw) -> str:
    text = (PROMPTS / f"{name}.md").read_text(encoding="utf-8")
    for k, v in kw.items():
        text = text.replace("{" + k + "}", str(v))
    return text


def ask(pid: str, stage: str, system: str, user: str, schema: dict, model: str | None = None) -> dict:
    res = claude_code.ask(system, user, schema, model=model or LLM_MODEL)

    def count(p):
        u = p["usage"]
        u["claude_calls"] = u.get("claude_calls", 0) + 1
        u["claude_by_stage"][stage] = u["claude_by_stage"].get(stage, 0) + 1
        if res.get("rate_limit"):
            u["rate_limit"] = res["rate_limit"]
    store.update(pid, count)
    return res["data"]


def words_of(text: str) -> list[str]:
    """كلمات الجملة اللي بتتنطق (من غير الـ tags)."""
    return [w for w in text.split() if not TAG.match(w)]
