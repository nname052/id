"""قسم المونتاج (الخطوة 1): رفع فيديوهاتك ← تحليل (FFmpeg + PySceneDetect) ← قصّ وترتيب ← تصدير MP4.

منفصل عن خط توليد الفيديوهات: صفحاته ومساراته وحالته هنا بس، ومش بيستخدم الـ worker ولا مشاريع التوليد.
المشترك بس: شكل الصفحات (base.html) ودوال حفظ JSON.
"""

import shutil
import threading
import time

from fastapi import APIRouter, File, HTTPException, Request, UploadFile
from fastapi.responses import FileResponse
from fastapi.templating import Jinja2Templates
from pydantic import BaseModel

from ..config import APP
from ..store import write_json
from . import export as exporter
from . import media, state

router = APIRouter()
pages = Jinja2Templates(directory=APP / "web" / "templates")
pages.env.globals["v"] = int(time.time())


# ---------- الشغل في الخلفية (thread لكل مهمة، من غير طابور التوليد) ----------
def _bg(fn, *a):
    threading.Thread(target=fn, args=a, daemon=True).start()


def _analyze(mid: str, sid: str) -> None:
    d = state.mdir(mid)
    m = state.load(mid)
    src = next(s for s in m["sources"] if s["id"] == sid)
    work = d / src["work"]
    t0 = time.time()
    try:
        info = media.probe(work)
        res = {"probe": info, "loudness": media.loudness(work) if info["has_audio"] else None}
        if info["has_video"]:
            res["scenes"] = media.scenes(work, info["duration"])
            cuts = media.ffmpeg_scene_cuts(work)
            res["ffmpeg_check"] = {"scene_count": len(cuts) + 1, "cuts": cuts, "filter": "select='gt(scene,0.3)'"}
        else:
            res["scenes"] = [{"index": 1, "start": 0.0, "end": info["duration"]}]
        res["seconds"] = round(time.time() - t0, 2)
        write_json(d / "work" / f"{sid}.analysis.json", res)  # التحليل جنب نسخة الشغل
        state.update(mid, lambda mm: next(s for s in mm["sources"] if s["id"] == sid).update(analysis=res, analysis_status="done", analysis_error=None))
    except Exception as e:  # noqa: BLE001
        state.update(mid, lambda mm: next(s for s in mm["sources"] if s["id"] == sid).update(analysis_status="failed", analysis_error=str(e)[:300]))


def _export(mid: str) -> None:
    d = state.mdir(mid)
    m = state.load(mid)
    edit = m.get("edit") or {}
    t0 = time.time()
    try:
        sources = {s["id"]: {"path": d / s["work"], **s["probe"]} for s in m["sources"]}
        out = exporter.render(edit.get("segments", []), sources, edit.get("aspect", "9:16"), d / "exports")
        info = media.probe(out)
        expected = round(sum(float(s["end"]) - float(s["start"]) for s in edit["segments"]), 3)
        state.update(mid, lambda mm: mm.update(export={"status": "done", "file": f"exports/{out.name}", "probe": info, "expected_duration": expected,
                                                         "seconds": round(time.time() - t0, 2), "finished": time.time()}))
    except Exception as e:  # noqa: BLE001
        state.update(mid, lambda mm: mm.update(export={"status": "failed", "error": str(e)[:500], "finished": time.time()}))


# ---------- الرفع ----------
def _add_source(mid: str, upload: UploadFile, creating: bool) -> dict:
    ext = "." + (upload.filename or "").rsplit(".", 1)[-1].lower() if "." in (upload.filename or "") else ""
    if ext not in state.ALLOWED:
        if creating:
            state.delete(mid)
        raise HTTPException(400, "النوع ده مش مقبول. ارفع فيديو mp4 أو mov، أو صوت m4a.")
    d = state.mdir(mid)
    m = state.load(mid) or {"sources": []}
    sid = f"s{len(m['sources']) + 1}"
    orig = d / "original" / f"{sid}_{state.safe_name(upload.filename)}"
    orig.parent.mkdir(parents=True, exist_ok=True)
    with open(orig, "wb") as f:
        shutil.copyfileobj(upload.file, f, length=1 << 20)
    try:
        info = media.probe(orig)  # ffprobe بيقرا بس
    except media.BadMedia as e:
        orig.unlink(missing_ok=True)
        if creating:
            state.delete(mid)
        raise HTTPException(400, str(e)) from e
    work = d / "work" / f"{sid}{ext}"
    work.parent.mkdir(parents=True, exist_ok=True)
    shutil.copyfile(orig, work)  # كل الشغل على النسخة دي، والأصل ما بيتلمسش
    src = {"id": sid, "name": upload.filename, "kind": state.ALLOWED[ext], "original": str(orig.relative_to(d)), "work": str(work.relative_to(d)),
           "original_sha256": state.sha256(orig), "size": orig.stat().st_size, "probe": info, "analysis_status": "running", "added": time.time()}
    return src


@router.post("/api/montage")
def create(file: UploadFile = File(...)):
    mid = state.new_id()
    state.mdir(mid).mkdir(parents=True, exist_ok=True)
    src = _add_source(mid, file, creating=True)
    state.save({"id": mid, "title": src["name"], "created": time.time(), "sources": [src], "edit": {"segments": [], "aspect": "9:16"}, "export": None})
    _bg(_analyze, mid, src["id"])
    return {"id": mid, "source": src}


@router.post("/api/montage/{mid}/sources")
def add_source(mid: str, file: UploadFile = File(...)):
    if not state.load(mid):
        raise HTTPException(404)
    src = _add_source(mid, file, creating=False)
    state.update(mid, lambda m: m["sources"].append(src))
    _bg(_analyze, mid, src["id"])
    return {"source": src}


@router.get("/api/montage")
def list_montages():
    return [{"id": m["id"], "title": m["title"], "created": m["created"], "sources": len(m["sources"]),
             "export": (m.get("export") or {}).get("status")} for m in state.list_all()]


@router.get("/api/montage/{mid}")
def get_montage(mid: str):
    m = state.load(mid)
    if not m:
        raise HTTPException(404)
    return m


@router.delete("/api/montage/{mid}")
def delete_montage(mid: str):
    state.delete(mid)
    return {"ok": True}


@router.post("/api/montage/{mid}/sources/{sid}/analyze")
def reanalyze(mid: str, sid: str):
    m = state.load(mid)
    if not m or not any(s["id"] == sid for s in m["sources"]):
        raise HTTPException(404)
    state.update(mid, lambda mm: next(s for s in mm["sources"] if s["id"] == sid).update(analysis_status="running"))
    _bg(_analyze, mid, sid)
    return {"ok": True}


# ---------- التعديل (قصّ وترتيب) ----------
class Segment(BaseModel):
    source: str
    start: float
    end: float


class EditBody(BaseModel):
    segments: list[Segment]
    aspect: str = "9:16"


@router.put("/api/montage/{mid}/edit")
def save_edit(mid: str, body: EditBody):
    m = state.load(mid)
    if not m:
        raise HTTPException(404)
    if body.aspect not in exporter.SIZES:
        raise HTTPException(400, "المقاس لازم يبقى 9:16 أو 16:9")
    dur = {s["id"]: s["probe"]["duration"] for s in m["sources"]}
    segs = []
    for s in body.segments:
        if s.source not in dur:
            raise HTTPException(400, f"مصدر مش موجود: {s.source}")
        a, b = max(0.0, s.start), min(dur[s.source], s.end)
        if b - a < 0.05:
            raise HTTPException(400, f"جزء من {s.source} مدته صفر أو أقل من 0.05 ثانية ({s.start}–{s.end})")
        segs.append({"source": s.source, "start": round(a, 3), "end": round(b, 3)})
    edit = {"segments": segs, "aspect": body.aspect, "total": round(sum(x["end"] - x["start"] for x in segs), 3), "saved": time.time()}
    write_json(state.mdir(mid) / "edit.json", edit)
    state.update(mid, lambda mm: mm.update(edit=edit))
    return edit


# ---------- التصدير ----------
@router.post("/api/montage/{mid}/export")
def start_export(mid: str):
    m = state.load(mid)
    if not m:
        raise HTTPException(404)
    if not (m.get("edit") or {}).get("segments"):
        raise HTTPException(400, "اختار أجزاء واحفظ التعديل الأول")
    if (m.get("export") or {}).get("status") == "running":
        raise HTTPException(409, "فيه تصدير شغال دلوقتي")
    state.update(mid, lambda mm: mm.update(export={"status": "running", "started": time.time()}))
    _bg(_export, mid)
    return {"ok": True}


@router.get("/api/montage/{mid}/verify")
def verify_originals(mid: str):
    """بيتأكد إن الملفات الأصلية زي ما اترفعت بالظبط (نفس البصمة)."""
    m = state.load(mid)
    if not m:
        raise HTTPException(404)
    d = state.mdir(mid)
    return [{"source": s["id"], "name": s["name"], "stored_sha256": s["original_sha256"], "now_sha256": state.sha256(d / s["original"]),
             "identical": state.sha256(d / s["original"]) == s["original_sha256"]} for s in m["sources"]]


@router.get("/montage-files/{mid}/exports/{name}")
def export_file(mid: str, name: str):
    p = state.mdir(mid) / "exports" / name
    if "/" in name or ".." in name or not p.is_file():
        raise HTTPException(404)
    return FileResponse(p, media_type="video/mp4", filename=name)


# ---------- الصفحات ----------
@router.get("/montage")
def page_list(request: Request):
    return pages.TemplateResponse(request, "montage_list.html", {})


@router.get("/montage/{mid}")
def page_edit(request: Request, mid: str):
    if not state.load(mid):
        raise HTTPException(404)
    return pages.TemplateResponse(request, "montage.html", {"mid": mid})
