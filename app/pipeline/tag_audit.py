"""مراجعة tags الإحساس على سكريبتات موجودة (من غير ما نلمس المشروع نفسه): «قبل» = tts.json الحالي، «بعد» = التجهيز الجديد (tts_prep.plan)
بيتكتب في docs/tag_audit/<pid>.json علشان يتقري. ما بيصرفش أي credit (مفيش صوت).
الاستخدام: .venv/bin/python -m app.pipeline.tag_audit <pid> [<pid> …]"""

import json
import sys

from .. import store
from ..config import LLM_MODEL, ROOT
from ..llm import claude_code
from . import tags as tagrules
from . import tts_prep

OUT = ROOT / "docs" / "tag_audit"


def collect(lines: list[dict]) -> list[dict]:
    out = []
    for ln in lines:
        for t in tagrules.tags_of(ln["tts"]):
            out.append({"id": ln["id"], "tag": t, "allowed": t in tagrules.ALLOWED, "sentence": ln.get("display", ""), "beat": ln.get("beat")})
    return out


def audit(pid: str) -> dict:
    d = store.project_dir(pid)
    script = store.read_json(d / "script.json")
    proj = store.load(pid)
    before = (store.read_json(d / "tts.json") or {}).get("lines", [])
    after = tts_prep.plan(script, proj["settings"], scenes_plan=store.read_json(d / "scenes" / "plan.json"),
                          ask_fn=lambda system, user, schema: claude_code.ask(system, user, schema, model=LLM_MODEL)["data"])
    res = {"pid": pid, "title": proj.get("title"), "tone": after["tone"], "before": collect(before), "after": collect(after["lines"]),
           "after_lines": [{k: l[k] for k in ("id", "display", "tts", "beat", "evidence")} for l in after["lines"]], "decisions": after["tags"]}
    OUT.mkdir(parents=True, exist_ok=True)
    (OUT / f"{pid}.json").write_text(json.dumps(res, ensure_ascii=False, indent=1), encoding="utf-8")
    return res


if __name__ == "__main__":
    for pid in sys.argv[1:]:
        r = audit(pid)
        print(f"== {pid} «{r['title']}» tone={r['tone']} · قبل {len(r['before'])} tag (مش موثّق {sum(not x['allowed'] for x in r['before'])}) · "
              f"بعد {len(r['after'])} tag (مش موثّق {sum(not x['allowed'] for x in r['after'])}) · {r['decisions']['stats']}")
        for ln in r["after_lines"]:
            print(f"  {ln['id']} [{ln['beat']}] «{ln['evidence']}» {ln['tts']}")
