"""السيرفر: الصفحات + الـ API. التشغيل: ./run.sh (أو uvicorn app.main:app --port 8000)."""

import os
import threading
from pathlib import Path
import time

from fastapi import UploadFile, FastAPI, HTTPException, Request
from fastapi.responses import FileResponse, JSONResponse, RedirectResponse
from fastapi.staticfiles import StaticFiles
from fastapi.templating import Jinja2Templates
from pydantic import BaseModel

from . import prefs, store, worker
from .config import APP, ASSETS, DEFAULT_SETTINGS, ELEVEN_KEY, FONTS, MOODS, VIDEO_TYPES
from .llm import claude_code
from .pipeline import audio as audio_stage

PORT = int(os.environ.get("APP_PORT", "8000"))
app = FastAPI(title="TikTok Motion")
app.mount("/static", StaticFiles(directory=APP / "web" / "static"), name="static")
app.mount("/player", StaticFiles(directory=APP / "player"), name="player")
app.mount("/assets", StaticFiles(directory=ASSETS), name="assets")
app.mount("/fonts", StaticFiles(directory=FONTS), name="fonts")
pages = Jinja2Templates(directory=APP / "web" / "templates")
pages.env.globals["v"] = int(time.time())  # رقم نسخة لملفات الواجهة: بيتغيّر مع كل تشغيل، فالمتصفح ما يستخدمش نسخة قديمة


@app.middleware("http")
async def _no_stale_files(request: Request, call_next):
    """ملفات الواجهة والمشغّل: المتصفح يتأكد من آخر نسخة كل مرة (من غير كده بيفضل شايل نسخة قديمة بعد أي تعديل)."""
    response = await call_next(request)
    if request.url.path.startswith(("/static/", "/player/")):
        response.headers["Cache-Control"] = "no-cache"
    return response


@app.on_event("startup")
def _start() -> None:
    worker.start(PORT)


# ---------- الصفحات ----------
@app.get("/")
def home():
    return RedirectResponse("/library" if store.list_all() else "/new")


@app.get("/new")
def page_new(request: Request):
    return pages.TemplateResponse(request, "new.html", {"moods": MOODS, "defaults": DEFAULT_SETTINGS})


@app.get("/p/{pid}")
def page_project(request: Request, pid: str):
    if not store.load(pid):
        raise HTTPException(404)
    return pages.TemplateResponse(request, "project.html", {"pid": pid})


@app.get("/style")
def page_style(request: Request):
    return pages.TemplateResponse(request, "style.html", {})


class StyleBody(BaseModel):
    profile: str
    pronunciations: dict[str, str]


@app.get("/api/style")
def get_style():
    return {"profile": prefs.style(), "pronunciations": prefs.pronunciations()}


@app.put("/api/style")
def put_style(body: StyleBody):
    prefs.save_style(body.profile)
    prefs.save_pronunciations(body.pronunciations)
    return {"ok": True}


@app.get("/library")
def page_library(request: Request):
    return pages.TemplateResponse(request, "library.html", {})


# ---------- الأصوات ----------
_voices = {"at": 0.0, "list": []}
_vlock = threading.Lock()


@app.get("/api/voices")
def voices():
    with _vlock:
        if not _voices["list"] or time.time() - _voices["at"] > 3600:
            import requests
            from phase0.list_voices import is_egyptian, my_voices, shared_arabic_voices
            s = requests.Session()
            s.headers["xi-api-key"] = ELEVEN_KEY
            seen, rows = set(), []
            for r in my_voices(s) + shared_arabic_voices(s):
                if r["voice_id"] not in seen and r.get("preview_url"):
                    seen.add(r["voice_id"])
                    rows.append({k: r.get(k) for k in ("name", "voice_id", "accent", "gender", "age", "use_case", "preview_url", "source")} | {"egyptian": is_egyptian(r)})
            rows.sort(key=lambda r: (not r["egyptian"], r["source"] != "mine", (r["name"] or "").lower()))
            _voices.update(at=time.time(), list=rows)
        return _voices["list"]


@app.get("/api/usage")
def usage():
    try:
        el = audio_stage.subscription()
    except Exception as e:  # noqa: BLE001
        el = {"error": str(e)[:120]}
    return {"elevenlabs": el, "claude": claude_code.check()}


# ---------- المشاريع ----------
class NewProject(BaseModel):
    prompt: str
    direction: str = ""
    user_script: str = ""
    settings: dict = {}


@app.post("/api/projects")
def create(body: NewProject):
    if len(body.prompt.strip()) < 3 and len(body.user_script.split()) < 5:
        raise HTTPException(400, "اكتب موضوع الفيديو أو السكريبت")
    allowed = {k: v for k, v in body.settings.items() if k in DEFAULT_SETTINGS}
    allowed["duration"] = max(10, min(60, int(allowed.get("duration", 30))))
    if allowed.get("video_type") not in VIDEO_TYPES:
        allowed["video_type"] = "regular"
    if allowed.get("voice_source") not in ("eleven", "record", "upload"):
        allowed["voice_source"] = "eleven"
    p = store.create(body.prompt, allowed, body.direction, body.user_script)
    worker.enqueue(p["id"], "script")
    worker.learn(body.prompt, "فكرة فيديو جديد")
    if body.direction.strip():
        worker.learn(body.direction, "طلب إخراج لفيديو جديد")
    return {"id": p["id"]}


@app.get("/api/projects")
def list_projects():
    out = []
    for p in store.list_all():
        d = store.project_dir(p["id"])
        out.append({k: p.get(k) for k in ("id", "title", "prompt", "created", "status", "duration")}
                   | {"thumb": (d / "output" / "thumb.jpg").exists(), "video": (d / "output" / "video.mp4").exists()})
    return out


def _get(pid: str) -> dict:
    p = store.load(pid)
    if not p:
        raise HTTPException(404)
    return p


@app.get("/api/projects/{pid}")
def get_project(pid: str):
    p = _get(pid)
    d = store.project_dir(pid)
    plan = store.read_json(d / "scenes" / "plan.json")
    return p | {
        "script": store.read_json(d / "script.json"),
        "brief": store.read_json(d / "brief.json"),
        "plan": plan and {k: v for k, v in plan.items() if k != "raw"},
        "tts": store.read_json(d / "tts.json"),
        "has_audio": (d / "audio" / "voice.mp3").exists(),
        "has_video": (d / "output" / "video.mp4").exists(),
        "credits_text": (d / "output" / "credits.txt").read_text(encoding="utf-8") if (d / "output" / "credits.txt").exists() else "",
        "audio_cost": audio_stage.estimate_cost(pid) if (d / "tts.json").exists() else None,
        "words": (store.read_json(d / "words.json") or {}).get("words") if (d / "audio" / "voice.mp3").exists() else None,
        "review": store.read_json(d / "audio" / "review.json"),
        "can_undo": (d / "audio" / "undo" / "voice.mp3").exists(),
    }


class Patch(BaseModel):
    title: str


@app.patch("/api/projects/{pid}")
def rename(pid: str, body: Patch):
    _get(pid)
    store.update(pid, lambda p: p.__setitem__("title", body.title.strip()[:80]))
    return {"ok": True}


@app.delete("/api/projects/{pid}")
def delete(pid: str):
    _get(pid)
    store.delete(pid)
    return {"ok": True}


class ScriptEdit(BaseModel):
    title: str | None = None
    sentences: list[str]


@app.put("/api/projects/{pid}/script")
def edit_script(pid: str, body: ScriptEdit):
    p = _get(pid)
    lines = [s.strip() for s in body.sentences if s.strip()]
    if not lines:
        raise HTTPException(400, "السكريبت فاضي")
    store.write_json(store.project_dir(pid) / "script.json",
                     {"title": body.title or p.get("title", ""), "sentences": [{"id": i, "text": t} for i, t in enumerate(lines)]})
    worker.mark_stale(pid, "script")
    return {"ok": True}


class Instruction(BaseModel):
    instruction: str | None = None


@app.post("/api/projects/{pid}/stages/{stage}/approve")
def approve(pid: str, stage: str):
    p = _get(pid)
    if stage not in p["stages"]:
        raise HTTPException(400)
    worker.approve(pid, stage)
    return {"ok": True}


@app.post("/api/projects/{pid}/stages/{stage}/regenerate")
def regenerate(pid: str, stage: str, body: Instruction):
    p = _get(pid)
    if stage not in p["stages"]:
        raise HTTPException(400)
    instruction = (body.instruction or "").strip() or None
    worker.enqueue(pid, stage, instruction=instruction)
    if instruction:
        worker.learn(instruction, f"تعديل طلبه في مرحلة {stage}")
    return {"ok": True}


@app.post("/api/projects/{pid}/stages/audio/reopen")
def reopen_audio(pid: str):
    """من الفيديو الجاهز ترجع لمرحلة الصوت (تسمع الجمل، تصلّح، وتصدّر تاني)."""
    _get(pid)
    store.update(pid, lambda p: (p["stages"]["audio"].update(status="review"), p.update(status="awaiting_review", notice=None)))
    return {"ok": True}


@app.post("/api/projects/{pid}/audio/sentence/{sid}")
def audio_sentence(pid: str, sid: int):
    _get(pid)
    worker.enqueue(pid, "audio_sentence", sid=sid)
    return {"ok": True}


# ---------- تعديل جزء من الفيديو ----------
class ScriptEditBody(BaseModel):
    sentences: list[dict]


class TtsEditBody(BaseModel):
    lines: list[dict]


@app.post("/api/projects/{pid}/edit/script")
def edit_script_part(pid: str, body: ScriptEditBody):
    _get(pid)
    worker.enqueue(pid, "edit_script", sentences=body.sentences)
    return {"ok": True}


@app.post("/api/projects/{pid}/edit/tts")
def edit_tts_part(pid: str, body: TtsEditBody):
    _get(pid)
    if not (store.project_dir(pid) / "audio" / "voice.mp3").exists():
        # لسه مفيش صوت: الحفظ على طول (من غير طابور)
        from .pipeline import edits
        try:
            edits.tts_lines(pid, body.lines)
        except ValueError as e:
            raise HTTPException(400, str(e))
        return {"ok": True, "sync": True}
    worker.enqueue(pid, "edit_tts", lines=body.lines)
    return {"ok": True}


@app.post("/api/projects/{pid}/edit/scene/{scene_id}")
def edit_scene_part(pid: str, scene_id: str, body: Instruction):
    _get(pid)
    if not (body.instruction or "").strip():
        raise HTTPException(400, "اكتب التعديل اللي عاوزه")
    worker.enqueue(pid, "edit_scene", scene_id=scene_id, instruction=body.instruction.strip())
    worker.learn(body.instruction, "تعديل مشهد")
    return {"ok": True}


@app.post("/api/projects/{pid}/audio/upload")
async def audio_upload(pid: str, file: UploadFile):
    """صوتك (تسجيل من الموقع أو ملف): بيتحفظ وبعدين بيتظبط توقيت الكلام عليه في الطابور."""
    _get(pid)
    d = store.project_dir(pid) / "audio"
    d.mkdir(exist_ok=True)
    ext = (Path(file.filename or "voice.webm").suffix or ".webm").lower()
    if ext not in (".webm", ".ogg", ".mp3", ".wav", ".m4a", ".aac", ".mp4", ".flac", ".aiff", ".aif", ".opus"):
        raise HTTPException(400, "نوع الملف ده مش مدعوم (MP3، WAV، M4A، WebM)")
    raw = d / f"user_raw{ext}"
    raw.write_bytes(await file.read())
    worker.enqueue(pid, "audio_user", raw=str(raw))
    return {"ok": True}


@app.post("/api/projects/{pid}/audio/need-voice")
def audio_need_voice(pid: str):
    """ترجع لتسجيل/رفع صوتك من الأول."""
    _get(pid)
    store.update(pid, lambda p: (p["stages"]["audio"].update(status="needs_voice"), p.update(status="awaiting_review")))
    worker.mark_stale(pid, "audio")
    return {"ok": True}


@app.post("/api/projects/{pid}/audio/undo")
def audio_undo(pid: str):
    _get(pid)
    if not audio_stage.undo_sentence(pid):
        raise HTTPException(400, "مفيش نسخة قديمة نرجعلها")
    worker.mark_stale(pid, "audio")
    return {"ok": True}


@app.post("/api/projects/{pid}/audio/review")
def audio_review(pid: str):
    _get(pid)
    worker.enqueue(pid, "audio_review")
    return {"ok": True}


@app.post("/api/projects/{pid}/resume")
def resume(pid: str):
    p = _get(pid)
    stage = next((s for s, v in p["stages"].items() if v.get("status") in ("waiting_limit", "needs_credits", "failed")), None)
    if not stage:
        raise HTTPException(400, "مفيش حاجة واقفة")
    worker.enqueue(pid, stage, approved_credits=True)
    return {"ok": True}


@app.get("/api/projects/{pid}/player-data")
def player_data(pid: str):
    p = _get(pid)
    d = store.project_dir(pid)
    plan = store.read_json(d / "scenes" / "plan.json")
    if not plan:
        raise HTTPException(404, "مفيش مشاهد لسه")
    words = store.read_json(d / "words.json") if (d / "audio" / "voice.mp3").exists() else None
    if not words:
        words = audio_stage.estimated_words(pid)
    has_audio = (d / "audio" / "voice.mp3").exists() and words.get("source") in ("elevenlabs", "user")
    script = store.read_json(d / "script.json") or {"sentences": []}
    return {"plan": plan, "words": words, "settings": p["settings"], "script": script["sentences"],
            "audio": f"/files/{pid}/audio/voice.mp3?v={int((d / 'audio' / 'voice.mp3').stat().st_mtime)}" if has_audio else None}


@app.get("/files/{pid}/{path:path}")
def files(pid: str, path: str, download: int = 0):
    d = store.project_dir(pid).resolve()
    f = (d / path).resolve()
    if not f.is_relative_to(d) or not f.is_file():
        raise HTTPException(404)
    p = store.load(pid) or {}
    name = f"{(p.get('title') or pid)}.mp4" if download else None
    return FileResponse(f, filename=name) if name else FileResponse(f)


@app.exception_handler(Exception)
def _err(request: Request, exc: Exception):
    return JSONResponse({"detail": str(exc)[:300]}, status_code=500)
