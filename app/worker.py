"""الطابور: فيديو واحد ومرحلة واحدة في نفس الوقت (thread واحد)، وبيقف عند نقط الموافقة."""

import queue
import threading
import time
import traceback

from . import store
from .llm.claude_code import LimitReached
from .pipeline import audio, render, scenes, script, tts_prep

_q: queue.Queue = queue.Queue()
PORT = 8000
REVIEW = {"script", "scenes", "audio"}       # بعدهم بنستنى موافقتك
NEXT = {"script": "scenes", "scenes": "tts", "tts": "audio", "audio": "render"}
DOWNSTREAM = {"script": ["scenes", "tts", "audio", "render"], "scenes": ["render"], "tts": ["audio", "render"], "audio": ["render"]}


def enqueue(pid: str, stage: str, **kw) -> None:
    def mark(p):
        p["stages"][stage] = {**p["stages"].get(stage, {}), "status": "queued", "error": None}
        p["status"] = "queued"
    store.update(pid, mark)
    _q.put((pid, stage, kw))


def mark_stale(pid: str, stage: str) -> None:
    """اتغيّر حاجة في المرحلة دي: اللي بعدها لازم يتعاد."""
    def mark(p):
        for s in DOWNSTREAM.get(stage, []):
            if p["stages"][s].get("status") not in ("pending", None):
                p["stages"][s]["status"] = "stale"
    store.update(pid, mark)


def _run(pid: str, stage: str, kw: dict) -> None:
    store.update(pid, lambda p: (p["stages"][stage].update(status="running", started=time.time(), progress=None), p.update(status="running")))
    store.log(pid, f"▶ {stage}")
    try:
        if stage == "script":
            script.run(pid, kw.get("instruction"))
        elif stage == "scenes":
            scenes.run(pid, kw.get("instruction"))
        elif stage == "tts":
            tts_prep.run(pid, kw.get("instruction"))
        elif stage == "audio":
            audio.run(pid, kw.get("approved_credits", False))
        elif stage == "render":
            render.run(pid, PORT)
    except LimitReached as e:
        store.update(pid, lambda p: (p["stages"][stage].update(status="waiting_limit", error=str(e)), p.update(status="waiting_limit", resets_at=e.resets_at)))
        store.log(pid, f"⏸ {stage}: {e}")
        return
    except audio.NeedsCredits as e:
        store.update(pid, lambda p: (p["stages"][stage].update(status="needs_credits", error=str(e)), p.update(status="needs_credits")))
        store.log(pid, f"⏸ {stage}: {e}")
        return
    except Exception as e:  # noqa: BLE001
        store.update(pid, lambda p: (p["stages"][stage].update(status="failed", error=str(e)[:500]), p.update(status="failed")))
        store.log(pid, f"✗ {stage}: {e}\n{traceback.format_exc()[-800:]}")
        return
    store.log(pid, f"✓ {stage}")
    mark_stale(pid, stage)
    if stage in REVIEW:
        store.update(pid, lambda p: (p["stages"][stage].update(status="review"), p.update(status="awaiting_review")))
    elif stage == "render":
        store.update(pid, lambda p: (p["stages"][stage].update(status="approved"), p.update(status="done")))
    else:  # tts: بيكمّل للصوت على طول
        store.update(pid, lambda p: p["stages"][stage].update(status="approved"))
        enqueue(pid, NEXT[stage])


def approve(pid: str, stage: str) -> None:
    store.update(pid, lambda p: p["stages"][stage].update(status="approved"))
    if stage in NEXT:
        enqueue(pid, NEXT[stage])


def _loop() -> None:
    while True:
        pid, stage, kw = _q.get()
        try:
            if store.load(pid):
                _run(pid, stage, kw)
        finally:
            _q.task_done()


def start(port: int) -> None:
    global PORT
    PORT = port
    # التطبيق وقف وفيه مرحلة كانت شغالة: نعلّمها فاشلة علشان تقدر تعيدها
    for p in store.list_all():
        changed = False
        for s, v in p["stages"].items():
            if v.get("status") in ("running", "queued"):
                v["status"], v["error"], changed = "failed", "التطبيق وقف في النص. اضغط إعادة المحاولة.", True
        if changed:
            p["status"] = "failed"
            store.save(p)
    threading.Thread(target=_loop, daemon=True).start()
