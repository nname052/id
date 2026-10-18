"""قسم المونتاج: رفع فيديوهاتك ← «اعمل المونتاج» (كل المراحل أوتوماتيك لحد معاينة كاملة) ← مراجعة/تعديل مرحلة بمرحلة ← موافقة ← تصدير.

منفصل عن خط توليد الفيديوهات: صفحاته ومساراته وحالته هنا بس، ومش بيستخدم الـ worker ولا مشاريع التوليد.
المشترك بس: شكل الصفحات (base.html) ودوال حفظ JSON.
"""

import secrets
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
from . import media, nl, stages, state

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
    """التصدير مقفول لحد ما توافق على آخر معاينة كاملة (S7)، وبعدها بياخد نفس الملف من غير رندر تاني."""
    _need(mid)
    try:
        return stages.export(mid)
    except stages.Blocked as e:
        raise HTTPException(409, str(e)) from e


# ---------- المراحل ----------
def _need(mid: str) -> dict:
    try:
        m = state.load(mid)
    except ValueError:
        m = None
    if not m:
        raise HTTPException(404)
    return m


def _key(m: dict, key: str) -> str:
    if key not in stages.PIPE:
        raise HTTPException(404, "مرحلة مش معروفة")
    return key


class RunBody(BaseModel):
    params: dict | None = None


class RevertBody(BaseModel):
    version: int


class TextBody(BaseModel):
    text: str


class ApplyBody(BaseModel):
    proposal: str


class RoleBody(BaseModel):
    role: str


class ManualBody(BaseModel):
    segments: list[Segment]
    aspect: str | None = None


class BriefBody(BaseModel):
    text: str


@router.put("/api/montage/{mid}/brief")
def set_brief(mid: str, body: BriefBody):
    """طلبك للفيديو كله: بيتحفظ مرة، وكل مرحلة بتاخد منه اللي يخصها."""
    _need(mid)
    state.update(mid, lambda mm: mm.update(brief={"text": body.text.strip()[:2000], "saved": time.time()}))
    return stages.view(state.load(mid))


@router.post("/api/montage/{mid}/auto")
def run_auto(mid: str):
    """زرار «اعمل المونتاج»: كل المراحل الفاضية/القديمة ورا بعض لحد المعاينة الكاملة."""
    _need(mid)
    try:
        todo = stages.run_all(mid)
    except stages.Blocked as e:
        raise HTTPException(409, str(e)) from e
    return {"todo": todo, **stages.view(state.load(mid))}


@router.get("/api/montage/{mid}/stages")
def get_stages(mid: str):
    return stages.view(_need(mid))


@router.put("/api/montage/{mid}/sources/{sid}/role")
def set_role(mid: str, sid: str, body: RoleBody):
    m = _need(mid)
    if body.role not in ("main", "music", "auto") or not any(s["id"] == sid for s in m["sources"]):
        raise HTTPException(400, "الدور لازم يبقى main أو music أو auto")
    state.update(mid, lambda mm: next(s for s in mm["sources"] if s["id"] == sid).update(role=None if body.role == "auto" else body.role))
    return {"ok": True}


@router.post("/api/montage/{mid}/stages/{key}/run")
def run_stage(mid: str, key: str, body: RunBody | None = None):
    m = _need(mid)
    try:
        stages.start(mid, _key(m, key), (body.params if body else None))
    except stages.Blocked as e:
        raise HTTPException(409, str(e)) from e
    return {"ok": True}


@router.post("/api/montage/{mid}/stages/{key}/approve")
def approve_stage(mid: str, key: str):
    m = _need(mid)
    try:
        stages.approve(mid, _key(m, key))
    except stages.Blocked as e:
        raise HTTPException(409, str(e)) from e
    return stages.view(state.load(mid))


@router.post("/api/montage/{mid}/stages/{key}/revert")
def revert_stage(mid: str, key: str, body: RevertBody):
    m = _need(mid)
    try:
        stages.revert(mid, _key(m, key), body.version)
    except stages.Blocked as e:
        raise HTTPException(409, str(e)) from e
    return stages.view(state.load(mid))


@router.get("/api/montage/{mid}/stages/{key}/v/{n}")
def stage_json(mid: str, key: str, n: int):
    """stage.json زي ما اتكتب بالظبط (bytes)."""
    m = _need(mid)
    p = stages.vdir(mid, _key(m, key), n) / "stage.json"
    if not p.is_file():
        raise HTTPException(404)
    return FileResponse(p, media_type="application/json")


@router.post("/api/montage/{mid}/stages/{key}/propose")
def propose_edit(mid: str, key: str, body: TextBody):
    """الكلام ← تغيير في JSON المرحلة + diff (من غير ما يتطبق)، أو سؤال لو مش واضح."""
    m = _need(mid)
    r = (m.get("stages") or {}).get(_key(m, key)) or {}
    if r.get("current") is None:
        raise HTTPException(409, "شغّل المرحلة الأول")
    doc = stages.read_stage(mid, key, r["current"])
    s1n = doc["data"].get("s1") if key != "s1_analyze" else None
    wbs = stages.words_by_source(stages.read_stage(mid, "s1_analyze", s1n)["data"]) if s1n else {}
    res = nl.propose(key, doc, body.text.strip(), wbs)
    if "question" in res:
        return {"question": res["question"]}
    pid = secrets.token_hex(4)
    prop = {"id": pid, "stage": key, "base_version": r["current"], "text": body.text.strip(), "kind": res["kind"], "diff": res["diff"],
            "notes": res["notes"], "new_data": res["new_data"], "new_params": res["new_params"], "user_params": res["user_params"], "created": time.time()}
    state.update(mid, lambda mm: mm.setdefault("proposals", {}).update({pid: prop}))
    return {"proposal": pid, "kind": res["kind"], "diff": res["diff"], "notes": res["notes"], "base_version": r["current"]}


@router.post("/api/montage/{mid}/stages/{key}/apply")
def apply_edit(mid: str, key: str, body: ApplyBody):
    """التطبيق بعد التأكيد بس ← نسخة جديدة N+1 للمرحلة."""
    m = _need(mid)
    prop = (m.get("proposals") or {}).get(body.proposal)
    if not prop or prop["stage"] != _key(m, key):
        raise HTTPException(404, "الاقتراح ده مش موجود")
    r = (m.get("stages") or {}).get(key) or {}
    if r.get("current") != prop["base_version"]:
        raise HTTPException(409, "النسخة الحالية اتغيرت بعد الاقتراح: اطلبه تاني")
    if r.get("job") == "running":
        raise HTTPException(409, "المرحلة دي شغالة دلوقتي")
    base = stages.read_stage(mid, key, prop["base_version"])
    try:
        # نسخة جديدة من المرحلة دي بس، وبعدين اللي بعدها بيتعاد لوحده لحد المعاينة الكاملة (cascade)
        if prop["kind"] == "params":   # تغيير إعدادات ← نعيد المرحلة بيها
            stages.start(mid, key, prop["user_params"], origin="edit", note=prop["text"], cascade=True)
        else:                          # تغيير في البيانات نفسها ← نسخة جديدة بنفس المدخل
            data = {**prop["new_data"], "_report": [f"تعديل بالكلام: «{prop['text']}»"] + prop["notes"] +
                    [f"{x['path']}: {x['from']} ← {x['to']}" for x in prop["diff"]]}
            stages.start(mid, key, prop["user_params"], origin="edit", note=prop["text"], data_override=data, base_input=base["input"], cascade=True)
    except stages.Blocked as e:
        raise HTTPException(409, str(e)) from e
    state.update(mid, lambda mm: (mm.get("proposals") or {}).pop(body.proposal, None))
    return {"ok": True, "new_version": max(v["n"] for v in r["versions"]) + 1}


@router.post("/api/montage/{mid}/stages/{key}/manual")
def manual_edit(mid: str, key: str, body: ManualBody):
    """التعديل اليدوي القديم (بداية/نهاية/ترتيب) ← نسخة جديدة من مرحلة القصّ."""
    m = _need(mid)
    if _key(m, key) != "s2_cut":
        raise HTTPException(400, "التعديل اليدوي للأجزاء في مرحلة القصّ بس")
    r = (m.get("stages") or {}).get(key) or {}
    if r.get("current") is None:
        raise HTTPException(409, "شغّل المرحلة الأول")
    base = stages.read_stage(mid, key, r["current"])
    old = {s["id"]: s for s in base["data"]["segments"]}
    dur = {s["id"]: s["probe"]["duration"] for s in m["sources"]}
    segs = []
    for k, s in enumerate(body.segments):
        if s.source not in dur:
            raise HTTPException(400, f"مصدر مش موجود: {s.source}")
        a, b = max(0.0, s.start), min(dur[s.source], s.end)
        if b - a < 0.05:
            raise HTTPException(400, f"جزء مدته أقل من 0.05 ثانية ({s.start}–{s.end})")
        prev = next((o for o in old.values() if o["source"] == s.source and abs(o["start"] - a) < 0.005 and abs(o["end"] - b) < 0.005), None)
        segs.append({**(prev or {"text": "", "speed": 1.0}), "id": (prev or {}).get("id") or f"m{k + 1}", "source": s.source, "start": round(a, 3), "end": round(b, 3)})
    data = {**base["data"], "segments": segs, "aspect": body.aspect or base["data"].get("aspect", "9:16"), "_report": ["تعديل يدوي"]}
    try:
        stages.start(mid, key, None, origin="manual", note="تعديل يدوي", data_override=data, base_input=base["input"], cascade=True)
    except stages.Blocked as e:
        raise HTTPException(409, str(e)) from e
    return {"ok": True}


class FixBody(BaseModel):
    lines: dict[str, str]   # {cue_id: النص الصح}


@router.post("/api/montage/{mid}/subs/propose")
def propose_fixes(mid: str, body: FixBody):
    """تصحيح سطور الترجمة (المحرر): النص الجديد ← تصحيحات كلمات (fixes) + diff، ومن غير ما يتطبق لحد ما توافق."""
    m = _need(mid)
    r = (m.get("stages") or {}).get("s4_subs") or {}
    if r.get("current") is None:
        raise HTTPException(409, "اعمل المونتاج الأول")
    doc = stages.read_stage(mid, "s4_subs", r["current"])
    res = nl.fix_lines(doc, body.lines)
    if "question" in res:
        return {"question": res["question"]}
    pid = secrets.token_hex(4)
    prop = {"id": pid, "stage": "s4_subs", "base_version": r["current"], "text": f"تصحيح {len(res['diff'])} سطر في الترجمة", "kind": "params",
            "diff": res["diff"], "notes": res["notes"], "new_data": None, "new_params": res["new_params"], "user_params": res["user_params"], "created": time.time()}
    state.update(mid, lambda mm: mm.setdefault("proposals", {}).update({pid: prop}))
    return {"proposal": pid, "kind": "params", "diff": res["diff"], "notes": res["notes"], "base_version": r["current"]}


@router.get("/montage-files/{mid}/stages/{key}/v{n}/{name}")
def stage_file(mid: str, key: str, n: int, name: str):
    """معاينة المرحلة وصورها (preview.mp4 / *.jpg / *.png)."""
    m = _need(mid)
    p = stages.vdir(mid, _key(m, key), n) / name
    if "/" in name or ".." in name or not p.is_file() or p.suffix not in (".mp4", ".jpg", ".png"):
        raise HTTPException(404)
    return FileResponse(p, media_type={".mp4": "video/mp4", ".jpg": "image/jpeg", ".png": "image/png"}.get(p.suffix, "video/mp4"))


@router.get("/montage-files/{mid}/thumb.jpg")
def thumb(mid: str):
    """صورة مصغّرة لأول فيديو في المونتاج (لقايمة المونتاجات)."""
    m = _need(mid)
    d = state.mdir(mid)
    out = d / "work" / "thumb.jpg"
    vid = next((s for s in m["sources"] if s["probe"]["has_video"]), None)
    if not vid:
        raise HTTPException(404)
    if not out.exists():
        import subprocess
        t = min(1.0, vid["probe"]["duration"] / 3)
        subprocess.run(["ffmpeg", "-v", "error", "-y", "-ss", f"{t:.2f}", "-i", str(d / vid["work"]), "-frames:v", "1", "-vf", "scale=360:-2", "-q:v", "4", str(out)])
    if not out.exists():
        raise HTTPException(404)
    return FileResponse(out, media_type="image/jpeg")


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
