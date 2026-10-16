"""الطابور: فيديو واحد ومرحلة واحدة في نفس الوقت (thread واحد)، وبيقف عند نقط الموافقة."""

import queue
import threading
import time
import traceback

from . import prefs, store
from .llm.claude_code import LimitReached
from .pipeline import audio, brief, render, scenes, script, tts_prep

_q: queue.Queue = queue.Queue()
PORT = 8000
REVIEW = {"script", "brief", "scenes", "audio"}       # بعدهم بنستنى موافقتك
NEXT = {"script": "brief", "brief": "scenes", "scenes": "tts", "tts": "audio", "audio": "render"}
SUB = {"audio_sentence": "audio", "audio_review": "audio"}  # مهام صغيرة جوه مرحلة الصوت
DOWNSTREAM = {"script": ["brief", "scenes", "tts", "audio", "render"], "brief": ["scenes", "render"], "scenes": ["render"], "tts": ["audio", "render"], "audio": ["render"]}


def learn(text: str, source: str) -> None:
    """ملف الذوق بيتحدّث في نفس الطابور (طلب Claude واحد في نفس الوقت)."""
    _q.put((None, "learn", {"text": text, "source": source}))


def enqueue(pid: str, job: str, **kw) -> None:
    stage = SUB.get(job, job)

    def mark(p):
        p["stages"][stage] = {**p["stages"].get(stage, {}), "status": "queued", "error": None, "job": job}
        p["status"] = "queued"
    store.update(pid, mark)
    _q.put((pid, job, kw))


def mark_stale(pid: str, stage: str) -> None:
    """اتغيّر حاجة في المرحلة دي: اللي بعدها لازم يتعاد."""
    def mark(p):
        for s in DOWNSTREAM.get(stage, []):
            if p["stages"][s].get("status") not in ("pending", None):
                p["stages"][s]["status"] = "stale"
    store.update(pid, mark)


def _run(pid: str, job: str, kw: dict) -> None:
    stage = SUB.get(job, job)
    if job in SUB:  # مهمة صغيرة اختيارية: لو فشلت، المشروع يرجع زي ما كان مع رسالة (مش "فشل")
        snap = store.load(pid)
        prev = (snap["status"], {k: dict(v) for k, v in snap["stages"].items()})
    store.update(pid, lambda p: (p["stages"][stage].update(status="running", started=time.time(), progress=None, job=job), p.update(status="running", notice=None)))
    store.log(pid, f"▶ {job}")
    try:
        if job == "script":
            script.run(pid, kw.get("instruction"))
        elif job == "brief":
            brief.run(pid, kw.get("instruction"))
        elif job == "scenes":
            scenes.run(pid, kw.get("instruction"))
        elif job == "tts":
            tts_prep.run(pid, kw.get("instruction"))
        elif job == "audio":
            audio.run(pid, kw.get("approved_credits", False))
        elif job == "render":
            render.run(pid, PORT)
        elif job == "audio_sentence":
            audio.regen_sentence(pid, kw["sid"])
        elif job == "audio_review":
            audio.review(pid)
    except LimitReached as e:
        store.update(pid, lambda p: (p["stages"][stage].update(status="waiting_limit", error=str(e)), p.update(status="waiting_limit", resets_at=e.resets_at)))
        store.log(pid, f"⏸ {stage}: {e}")
        return
    except audio.NeedsCredits as e:
        store.update(pid, lambda p: (p["stages"][stage].update(status="needs_credits", error=str(e)), p.update(status="needs_credits")))
        store.log(pid, f"⏸ {stage}: {e}")
        return
    except Exception as e:  # noqa: BLE001
        if job in SUB:
            msg = str(e)
            if "speech_to_text" in msg:
                msg = "مفتاح ElevenLabs مش معاه صلاحية Speech to Text. فعّلها من elevenlabs.io ← Developers ← API Keys، وجرّب تاني."
            store.update(pid, lambda p: (p.update(status=prev[0], stages=prev[1], notice=msg[:400])))
            store.log(pid, f"✗ {job}: {e}")
            return
        store.update(pid, lambda p: (p["stages"][stage].update(status="failed", error=str(e)[:500]), p.update(status="failed")))
        store.log(pid, f"✗ {stage}: {e}\n{traceback.format_exc()[-800:]}")
        return
    store.log(pid, f"✓ {job}")
    if job == "audio_review":  # المراجعة ما بتغيّرش الصوت: نرجّع الحالة زي ما كانت
        store.update(pid, lambda p: p.update(status=prev[0], stages=prev[1]))
        return
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
            if stage == "learn":
                try:
                    prefs.learn(kw["text"], kw["source"])
                except Exception as e:  # noqa: BLE001  (ملف الذوق مش أهم من الفيديو)
                    print("learn failed:", e)
            elif store.load(pid):
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
