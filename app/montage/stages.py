"""مراحل المونتاج الأوتوماتيك: زرار «اعمل المونتاج» بيشغّل كل المراحل ورا بعض ويطلّع معاينة كاملة للفيديو النهائي.
المراجعة مرحلة بمرحلة فاضلة زي ما هي (طبقة تحكّم بعد المعاينة): كل مرحلة ليها نسخ، وإعادة، ورجوع، وتعديل بالكلام (diff ← تطبيق).

S1 التحليل ← S2 القصّ والإيقاع ← S3 الصورة ← S4 الترجمة ← S5 الموشن جرافيك ← S6 الصوت ← S7 المعاينة الكاملة.

- كل مرحلة بتكتب نسخة جديدة في work/stages/<stage>/vN/ (stage.json + صور/فيديو) وعمرها ما بتتكتب عليها تاني.
- كل نسخة فاكرة اتعملت من أنهي نسخة من المرحلة اللي قبلها (input) ومن أنهي حاجات في طلبك (brief).
  لو حاجة منهم اتغيّرت، المرحلة بتبقى «قديمة» (stale) من غير ما تتمسح.
- تعديل مرحلة (بالكلام/يدوي) ← نسخة جديدة منها بس، وبعدين المراحل اللي بعدها بس بتتعاد لوحدها، والمعاينة الكاملة بتتبني تاني.
- التصدير مقفول لحد ما توافق على آخر معاينة كاملة (S7).
"""

import collections
import json
import os
import shutil
import subprocess
import threading
import time
import traceback
from pathlib import Path

import numpy as np

from ..store import write_json
from . import brief as briefs
from . import cuts, director, graphics, look, media, motion, speech, state, vision
from . import export as exporter

PIPE = ["s1_analyze", "s2_cut", "s3_look", "s4_subs", "s5_graphics", "s6_audio", "s7_preview"]
LABELS = {"s1_analyze": "التحليل", "s2_cut": "القصّ والإيقاع", "s3_look": "الصورة والألوان", "s4_subs": "الترجمة",
          "s5_graphics": "الموشن جرافيك", "s6_audio": "الصوت", "s7_preview": "المعاينة الكاملة"}
HINTS = {"s1_analyze": "الكلام والسكتات واللقطات وقياس الصورة", "s2_cut": "القصّ في السكتات، الهوا الميت، والانتقالات",
         "s3_look": "تصحيح اللون والإضاءة والحدة حسب القياس", "s4_subs": "سطور على توقيت الكلام في المنطقة الآمنة تحت",
         "s5_graphics": "كروت للأرقام والمصطلحات والفكرة الأساسية", "s6_audio": "تنضيف، crossfade، وعلو −14 LUFS",
         "s7_preview": "الفيديو كامل بكل حاجة، قبل التصدير"}
S1_SCHEMA = 2
DEFAULTS = {
    "s1_analyze": {"language": "ar", "scene_detector": "adaptive", "adaptive_threshold": 3.0, "min_pause": 0.35, "silence_db": "auto"},
    "s2_cut": {"aspect": "9:16", "dead_air": 0.7, "breath_out": 0.22, "breath_in": 0.14, "transitions": "auto", "dissolve_frames": 0, "audio_xfade_ms": 60},
    "s3_look": {"look": "natural", "brightness": 0, "saturation": 0, "sharpen": None, "denoise": None},
    "s4_subs": {"max_chars": 30, "min_dur": 1.2, "max_dur": 5.0, "size": "medium", "color": "white", "panel": True, "pos": "bottom", "fixes": {}, "style": "player"},
    "s5_graphics": {"graphics": "on", "mood": "clean", "density": "normal", "removed": [], "kinds": {"visual": True, "annotate": True, "photo": True, "counter": True},
                    "accent": "#7ee2b8", "size": 1.0, "max_photos": 2, "badge": "glass"},
    "s6_audio": {"target_lufs": -14.0, "true_peak": -1.5, "music": "auto", "music_gain_db": -16.0, "duck": True, "denoise": "auto", "sfx": "on", "sfx_volume": 1.0},
    "s7_preview": {"crf": 18, "preset": "medium"},
}
PACE = {"fast": {"dead_air": 0.5, "breath_out": 0.16, "breath_in": 0.10}, "normal": {"dead_air": 0.7, "breath_out": 0.22, "breath_in": 0.14},
        "calm": {"dead_air": 1.0, "breath_out": 0.32, "breath_in": 0.20}}
_locks: dict[str, threading.Lock] = {}
_active: set[tuple[str, str]] = set()   # (mid, key) للشغل اللي شغال فعلًا في العملية دي
_auto: set[str] = set()                 # مونتاجات التشغيل الكامل شغال فيها دلوقتي


class Blocked(Exception):
    """العملية مش مسموحة دلوقتي (مرحلة قبلها ناقصة/قديمة، شغل جاري، أو التصدير من غير موافقة)."""


# ---------- الطلب (brief) ----------
def brief_of(m: dict) -> dict:
    return briefs.parse((m.get("brief") or {}).get("text", ""))


def brief_params(key: str, b: dict) -> dict:
    if key == "s1_analyze":
        return {"language": b["language"]}
    if key == "s2_cut":
        return {"aspect": b["aspect"], **PACE[b["pace"]], "transitions": "hard" if b["pace"] == "fast" else "auto"}
    if key == "s3_look":
        return {"look": b["look"]}
    if key == "s4_subs":
        return {"size": b["sub_size"], "color": b["sub_color"], "panel": b["sub_panel"], "pos": b["sub_pos"]}
    if key == "s5_graphics":
        return {"graphics": b["graphics"], "mood": b["mood"], "density": b["density"], "focus": b["focus"], "pace": b["pace"]}
    if key == "s6_audio":
        return {"duck_release": 500 if b["pace"] == "calm" else 250 if b["pace"] == "fast" else 350}
    if key == "s7_preview":
        return {"aspect": b["aspect"]}
    return {}


# ---------- الحالة ----------
def prev_of(key: str) -> str | None:
    i = PIPE.index(key)
    return PIPE[i - 1] if i else None


def record(m: dict, key: str) -> dict:
    return m.setdefault("stages", {}).setdefault(key, {"versions": [], "current": None, "approved": None, "job": "idle", "error": None})


def vdir(mid: str, key: str, n: int) -> Path:
    return state.mdir(mid) / "work" / "stages" / key / f"v{n}"


def read_stage(mid: str, key: str, n: int) -> dict:
    return json.loads((vdir(mid, key, n) / "stage.json").read_text(encoding="utf-8"))


def _ver(r: dict, n: int | None) -> dict:
    return next((v for v in r["versions"] if v["n"] == n), {})


def why_stale(m: dict, key: str) -> str | None:
    r = (m.get("stages") or {}).get(key) or {}
    cur = _ver(r, r.get("current"))
    if key == "s1_analyze":
        if cur.get("sources") != [s["id"] for s in m["sources"]]:
            return "اترفع ملف جديد بعد التحليل"
        if cur.get("schema", 1) < S1_SCHEMA:
            return "تحليل قديم (من قبل المحرر الجديد)"
    p = prev_of(key)
    if p:
        if status(m, p) in ("empty", "stale"):
            return f"«{LABELS[p]}» لسه ما اتعملتش أو قديمة"
        if cur.get("input") != {"stage": p, "version": record(m, p)["current"]}:
            return f"«{LABELS[p]}» اتغيّرت بعد النسخة دي"
    if cur.get("brief") is not None and cur["brief"] != briefs.used(brief_of(m), key):
        return "طلبك للفيديو اتغيّر في حاجة بتخص المرحلة دي"
    return None


def status(m: dict, key: str) -> str:
    """empty | stale | ready | approved."""
    r = (m.get("stages") or {}).get(key)
    if not r or r.get("current") is None:
        return "empty"
    if why_stale(m, key):
        return "stale"
    return "approved" if r.get("approved") == r["current"] else "ready"


def fix_orphans(m: dict) -> dict:
    """مرحلة متعلّمة "شغالة" ومفيش شغل وراها (السيرفر اتقفل في النص) ← فشلت، علشان تتعاد."""
    bad = [k for k, r in (m.get("stages") or {}).items() if r.get("job") == "running" and (m["id"], k) not in _active]
    auto_bad = (m.get("auto") or {}).get("running") and m["id"] not in _auto
    if not bad and not auto_bad:
        return m

    def upd(mm):
        for k in bad:
            if (mm["id"], k) not in _active:
                record(mm, k).update(job="failed", error="الشغل اتقطع (السيرفر اتقفل في النص). دوس «اعمل المونتاج» تاني.")
        if auto_bad and mm["id"] not in _auto:
            mm["auto"].update(running=False, error="الشغل اتقطع (السيرفر اتقفل في النص)")
    return state.update(m["id"], upd)


def _url(mid, key, n, name):
    return f"/montage-files/{mid}/stages/{key}/v{n}/{name}"


def view(m: dict) -> dict:
    """اللي الصفحة محتاجاه: المراحل بحالتها ونسخها، الطلب، المعاينة الكاملة، وسطور الترجمة للمحرر."""
    m = fix_orphans(m)
    out, docs = [], {}
    for key in PIPE:
        r = (m.get("stages") or {}).get(key) or {"versions": [], "current": None, "approved": None, "job": "idle", "error": None}
        cur = None
        if r.get("current") is not None:
            try:
                cur = read_stage(m["id"], key, r["current"])
            except (OSError, ValueError):
                cur = None
        docs[key] = cur
        p = prev_of(key)
        out.append({"key": key, "label": LABELS[key], "hint": HINTS[key], "status": status(m, key), "why_stale": why_stale(m, key) if cur else None,
                    "job": r.get("job", "idle"), "error": r.get("error"), "current": r.get("current"), "approved": r.get("approved"),
                    "versions": r["versions"], "can_run": p is None or status(m, p) in ("ready", "approved"),
                    "params": (cur or {}).get("params") or DEFAULTS[key], "report": (cur or {}).get("report") or [],
                    "summary": (cur or {}).get("summary"), "seconds": (cur or {}).get("seconds"), "brief_used": (cur or {}).get("brief"),
                    "stills": [{"label": s["label"], "url": _url(m["id"], key, r["current"], s["file"])} for s in (cur or {}).get("stills") or []]})
    s7, prev = out[-1], docs.get("s7_preview")
    final = None
    if prev and (vdir(m["id"], "s7_preview", s7["current"]) / "preview.mp4").exists():
        pv = vdir(m["id"], "s7_preview", s7["current"])
        poster = next((n for n in ("f_start.jpg", "f_mid.jpg") if (pv / n).exists()), None)   # صورة غلاف (الفيديو كان بيبان أسود لحد ما تدوس تشغيل)
        final = {"url": _url(m["id"], "s7_preview", s7["current"], "preview.mp4") + f"?v={s7['current']}", "version": s7["current"],
                 "poster": _url(m["id"], "s7_preview", s7["current"], poster) + f"?v={s7['current']}" if poster else None,
                 "status": s7["status"], "summary": s7["summary"], "aspect": (prev.get("data") or {}).get("aspect", "9:16")}
    cues = []
    if docs.get("s4_subs"):
        cues = [{k: c.get(k) for k in ("id", "start", "end", "text", "edited", "p_mean")} for c in docs["s4_subs"]["data"].get("cues", [])]
    b = m.get("brief") or {}
    return {"stages": out, "auto": m.get("auto") or {}, "brief": {"text": b.get("text", ""), "saved": b.get("saved"), "parsed": briefs.describe(brief_of(m))},
            "final": final, "export": m.get("export"), "export_ready": s7["status"] == "approved", "cues": cues, "busy": _busy(m)}


# ---------- التشغيل ----------
def _busy(m: dict) -> bool:
    return m["id"] in _auto or any(r.get("job") == "running" for r in (m.get("stages") or {}).values())


def check_can_run(m: dict, key: str) -> None:
    if key not in PIPE:
        raise Blocked("مرحلة مش معروفة")
    if _busy(m):
        raise Blocked("فيه شغل شغال دلوقتي، استنى لما يخلص")
    p = prev_of(key)
    if p and status(m, p) not in ("ready", "approved"):
        raise Blocked(f"شغّل/حدّث «{LABELS[p]}» الأول")
    if any(s.get("analysis_status") == "running" for s in m["sources"]):
        raise Blocked("لسه بنقرا الملفات، استنى ثواني")


def start(mid: str, key: str, params: dict | None = None, origin: str | None = None, note: str | None = None, data_override: dict | None = None,
          base_input: dict | None = None, sync: bool = False, cascade: bool = False) -> None:
    """بيشغّل المرحلة (أو يعيدها) ← نسخة جديدة. cascade = بعدها المراحل اللي بعدها بتتعاد لوحدها لحد المعاينة الكاملة."""
    m = fix_orphans(state.load(mid))
    if data_override is None:
        check_can_run(m, key)
    elif _busy(m):
        raise Blocked("فيه شغل شغال دلوقتي، استنى لما يخلص")
    _active.add((mid, key))
    if cascade:
        _auto.add(mid)
    state.update(mid, lambda mm: record(mm, key).update(job="running", error=None))
    args = (mid, key, params, origin, note, data_override, base_input, cascade)
    if sync:
        _job(*args)
    else:
        threading.Thread(target=_job, args=args, daemon=True).start()


def _job(mid, key, params, origin, note, data_override, base_input, cascade=False):
    try:
        ok = _run_job(mid, key, params, origin, note, data_override, base_input)
    finally:
        _active.discard((mid, key))
    if cascade:
        try:
            if ok:
                _auto_loop(mid, PIPE[PIPE.index(key) + 1:], origin_note=f"بعد تعديل «{LABELS[key]}»")
        finally:
            _auto.discard(mid)


def run_all(mid: str, sync: bool = False, force: bool = False) -> list[str]:
    """زرار «اعمل المونتاج»: كل مرحلة فاضية أو قديمة (وكل اللي بعدها) بتتعمل بالترتيب لحد المعاينة الكاملة."""
    m = fix_orphans(state.load(mid))
    if _busy(m):
        raise Blocked("فيه شغل شغال دلوقتي، استنى لما يخلص")
    if any(s.get("analysis_status") == "running" for s in m["sources"]):
        raise Blocked("لسه بنقرا الملفات، استنى ثواني")
    todo, dirty = [], force
    for k in PIPE:
        dirty = dirty or status(m, k) in ("empty", "stale")
        if dirty:
            todo.append(k)
    if not todo:
        return []
    _auto.add(mid)

    def go():
        try:
            _auto_loop(mid, todo, fresh=True)
        finally:
            _auto.discard(mid)
    if sync:
        go()
    else:
        threading.Thread(target=go, daemon=True).start()
    return todo


def _auto_loop(mid: str, keys: list[str], origin_note: str | None = None, fresh: bool = False) -> None:
    t0 = time.time()
    state.update(mid, lambda mm: mm.update(auto={"running": True, "todo": keys, "stage": keys[0] if keys else None, "started": t0,
                                                 "finished": None, "error": None, "note": origin_note}))
    err, paused = None, None
    for k in keys:
        # خطة المراجعة: الترجمة الأول، والمونتاج بيقف لحد ما توافق عليها (أو تصلّحها). بعد الموافقة بيكمّل لوحده من النقطة الثابتة دي
        if k in AFTER_REVIEW and status(state.load(mid), REVIEW_GATE) != "approved":
            paused = f"راجع «{LABELS[REVIEW_GATE]}» ووافق عليها (أو صلّح أي كلمة)، وبعدها المونتاج بيكمّل لوحده"
            break
        # الترجمة اتعادت بسبب تعديل قبلها (قصّ/صورة) والكلام المتوافق عليه زي ما هو (نفس التصحيحات): الموافقة بتفضل
        mk = state.load(mid)
        rk = record(mk, k)
        inherit = k == REVIEW_GATE and rk.get("approved") is not None and status(mk, k) in ("approved", "stale")
        old_fixes = (read_stage(mid, k, rk["approved"]).get("user_params") or {}).get("fixes") if inherit else None
        state.update(mid, lambda mm: (mm["auto"].update(stage=k), record(mm, k).update(job="running", error=None)))
        _active.add((mid, k))
        try:
            ok = _run_job(mid, k, None, "auto", origin_note, None, None)
        finally:
            _active.discard((mid, k))
        if ok and inherit:
            cur = record(state.load(mid), k)["current"]
            if (read_stage(mid, k, cur).get("user_params") or {}).get("fixes") == old_fixes:
                state.update(mid, lambda mm: record(mm, k).update(approved=record(mm, k)["current"]))
        if not ok:
            err = f"«{LABELS[k]}» فشلت: " + (record(state.load(mid), k).get("error") or "")
            break
    state.update(mid, lambda mm: mm["auto"].update(running=False, stage=None, finished=time.time(), seconds=round(time.time() - t0, 1), error=err, paused=paused))


def _run_job(mid, key, params, origin, note, data_override, base_input) -> bool:
    lock = _locks.setdefault(mid, threading.Lock())
    with lock:
        t0 = time.time()
        try:
            m = state.load(mid)
            r = record(m, key)
            n = max([v["n"] for v in r["versions"]] or [0]) + 1
            vd = vdir(mid, key, n)
            if vd.exists():
                shutil.rmtree(vd)   # بقايا محاولة فشلت قبل كده (عمرها ما اتسجلت كنسخة)
            vd.mkdir(parents=True)
            p = prev_of(key)
            inp_ref = base_input if base_input is not None else ({"stage": p, "version": record(m, p)["current"]} if p else None)
            inp = read_stage(mid, p, inp_ref["version"]) if inp_ref else None
            base = read_stage(mid, key, r["current"]) if r.get("current") else None
            b = brief_of(m)
            user = {**((base or {}).get("user_params") or {}), **(params or {})}   # اللي إنت غيّرته بنفسك (بالكلام) بيكسب على الطلب
            prm = {**DEFAULTS[key], **brief_params(key, b), **user}
            ctx = {"m": m, "mid": mid, "d": state.mdir(mid), "key": key, "params": prm, "inp": inp, "vd": vd, "brief": b}
            if data_override is not None:
                data, report = data_override, (data_override.pop("_report", None) or [f"تعديل: {note or ''}"])
                data, extra, stills = FINALIZE[key](ctx, data) if key in FINALIZE else (data, [], [])
                report += extra
            else:
                data, report, stills = RUN[key](ctx)
            summary = summarize(key, data)
            doc = {"stage": key, "version": n, "origin": origin or ("run" if not r["versions"] else "redo"), "note": note,
                   "created": time.time(), "input": inp_ref, "brief": briefs.used(b, key), "params": prm, "user_params": user,
                   "data": data, "report": report, "summary": summary, "stills": stills, "seconds": round(time.time() - t0, 2)}
            if key == "s1_analyze":
                doc["sources"] = [s["id"] for s in m["sources"]]
                doc["schema"] = S1_SCHEMA
            write_json(vd / "stage.json", doc)

            def upd(mm):
                rr = record(mm, key)
                meta = {"n": n, "origin": doc["origin"], "created": doc["created"], "input": inp_ref, "note": note, "summary": summary, "brief": doc["brief"]}
                if key == "s1_analyze":
                    meta.update(sources=doc["sources"], schema=S1_SCHEMA)
                rr["versions"].append(meta)
                rr.update(current=n, approved=None, job="idle", error=None)
            state.update(mid, upd)
            return True
        except Exception as e:  # noqa: BLE001
            traceback.print_exc()
            state.update(mid, lambda mm: record(mm, key).update(job="failed", error=str(e)[:500]))
            return False


def studio_apply(mid: str, key: str, params: dict, note: str = "", sync: bool = False) -> None:
    """تعديل يدوي من «استوديو المونتاج» ← نسخة جديدة من المرحلة، والمراحل اللي بعدها بتتحدّث لوحدها.
    لو الترجمة كانت متوافق عليها والتعديل في الشكل بس (من غير تصحيح كلام)، الموافقة بتفضل والباقي بيكمّل."""
    m = fix_orphans(state.load(mid))
    check_can_run(m, key)
    keep_approval = key == REVIEW_GATE and status(m, key) == "approved" and "fixes" not in params

    def go():
        ok = _run_job(mid, key, params, "manual", note or "تعديل من الاستوديو", None, None)
        if not ok:
            return
        if keep_approval:
            state.update(mid, lambda mm: record(mm, key).update(approved=record(mm, key)["current"]))
        rest = PIPE[PIPE.index(key) + 1:]
        if rest:
            _auto.add(mid)
            try:
                _auto_loop(mid, rest, origin_note=f"بعد تعديل «{LABELS[key]}» من الاستوديو")
            finally:
                _auto.discard(mid)
    _active.add((mid, key))
    state.update(mid, lambda mm: record(mm, key).update(job="running", error=None))

    def run():
        try:
            go()
        finally:
            _active.discard((mid, key))
    run() if sync else threading.Thread(target=run, daemon=True).start()


# إعدادات الجرافيك الافتراضية (بتتعدّل من الاستوديو): أنواع مسموحة، والكثافة، ولون التأكيد، والحجم، والصور، والمؤثرات
GRAPHICS_DEFAULTS = {"kinds": {"visual": True, "annotate": True, "photo": True, "counter": True}, "density": "normal", "accent": "#7ee2b8",
                     "size": 1.0, "max_photos": 2, "badge": "glass", "sfx": "on", "sfx_volume": 1.0}


REVIEW_GATE = "s4_subs"                                       # المراجعة الثابتة: الترجمة
AFTER_REVIEW = ("s5_graphics", "s6_audio", "s7_preview")     # المراحل اللي ما بتشتغلش لوحدها قبل الموافقة على الترجمة


def approve(mid: str, key: str, sync: bool = False) -> dict:
    m = state.load(mid)
    st = status(m, key)
    if st in ("empty", "stale"):
        raise Blocked("مفيش نسخة حديثة توافق عليها" if st == "empty" else "النسخة دي قديمة: دوس «اعمل المونتاج» علشان تتحدّث الأول")
    m = state.update(mid, lambda mm: record(mm, key).update(approved=record(mm, key)["current"]))
    if key == REVIEW_GATE and not _busy(m):   # وافقت على الترجمة: الباقي بيكمّل لوحده من هنا
        todo = [k for k in AFTER_REVIEW if status(m, k) in ("empty", "stale")] or []
        if todo:
            _auto.add(mid)
            go = lambda: (_auto_loop(mid, todo, origin_note="بعد موافقتك على الترجمة"), _auto.discard(mid))  # noqa: E731
            go() if sync else threading.Thread(target=go, daemon=True).start()
    return m


def revert(mid: str, key: str, n: int) -> dict:
    m = state.load(mid)
    r = record(m, key)
    if _busy(m):
        raise Blocked("فيه شغل شغال دلوقتي، استنى لما يخلص")
    if not any(v["n"] == n for v in r["versions"]):
        raise Blocked(f"مفيش نسخة v{n}")
    return state.update(mid, lambda mm: record(mm, key).update(current=n, approved=None))


def export(mid: str) -> dict:
    """بعد الموافقة على آخر معاينة كاملة بس: نفس الملف بيتحط في exports/ (من غير رندر تاني)."""
    m = state.load(mid)
    if status(m, "s7_preview") != "approved":
        raise Blocked("التصدير مقفول: لازم تتفرج على المعاينة الكاملة وتوافق عليها الأول")
    n = record(m, "s7_preview")["current"]
    doc = read_stage(mid, "s7_preview", n)
    src = vdir(mid, "s7_preview", n) / "preview.mp4"
    out = state.mdir(mid) / "exports" / f"montage_{time.strftime('%Y%m%d_%H%M%S')}_{doc['data']['aspect'].replace(':', 'x')}.mp4"
    out.parent.mkdir(parents=True, exist_ok=True)
    try:
        os.link(src, out)
    except OSError:
        shutil.copyfile(src, out)
    exp = {"status": "done", "file": f"exports/{out.name}", "probe": doc["data"]["probe"], "from": {"stage": "s7_preview", "version": n}, "finished": time.time()}
    state.update(mid, lambda mm: mm.update(export=exp))
    return exp


# ---------- أدوات ----------
def sources_map(ctx, data: dict | None = None) -> dict:
    """الملفات. لو فيه نسخة متلوّنة من مرحلة الصورة (data.look.graded) الفيديو الأساسي بيتقري منها (مقاسها مقاس الإخراج وفريماتها ثابتة)."""
    out = {s["id"]: {"path": ctx["d"] / s["work"], **s["probe"]} for s in ctx["m"]["sources"]}
    g = ((data or {}).get("look") or {}).get("graded")
    if g:
        mv = next((s for s in ctx["m"]["sources"] if s["probe"]["has_video"]), None)
        W, H = exporter.size(data["aspect"])
        if mv:
            out[mv["id"]] = {**out[mv["id"]], "path": ctx["d"] / g, "width": W, "height": H, "fps": data["fps"], "fps_method": "same", "graded": True}
    return out


_env_cache: dict = {}


def env_of(path: Path):
    k = (str(path), path.stat().st_mtime)
    if k not in _env_cache:
        _env_cache[k] = speech.envelope(path)
    return _env_cache[k]


def chain_doc(ctx, key: str) -> dict:
    """نسخة مرحلة قبل دي في نفس السلسلة (بنمشي ورا على input)."""
    doc = ctx["inp"]
    while doc and doc["stage"] != key:
        ref = doc.get("input")
        doc = read_stage(ctx["mid"], ref["stage"], ref["version"]) if ref else None
    if doc is None:
        raise ValueError(f"مفيش «{LABELS[key]}» في السلسلة دي")
    return doc


def s1_of(ctx) -> dict:
    return chain_doc(ctx, "s1_analyze")["data"]


def words_by_source(s1: dict, fixes: dict | None = None) -> dict:
    """كلمات كل ملف، بعد تصحيحاتك (fixes: {"s1:12": "مبسوط"}؛ "" = الكلمة اندمجت في اللي قبلها)."""
    out = {}
    for sid, v in s1["sources"].items():
        ws = [dict(w, src_i=i, orig=w["word"]) for i, w in enumerate(v.get("words") or [])]
        for w in ws:
            f = (fixes or {}).get(f"{sid}:{w['src_i']}")
            if isinstance(f, dict):   # التصحيح فاكر الكلمة الأصلية: بيتطبق بس لو لسه هي نفس الكلمة (لو التفريغ اتعاد واتغيّر الترقيم، ما يقعش على كلمة غلط)
                f = f["to"] if cuts.norm(f.get("from", "")) == cuts.norm(w["word"]) else None
            if f is not None:
                w["word"], w["p"], w["fixed"] = f, 1.0, True
        keep = []
        for w in ws:
            if w.get("fixed") and not w["word"].strip():
                if keep:
                    keep[-1]["end"] = w["end"]
                continue
            keep.append(w)
        out[sid] = keep
    return out


def role(m: dict, s1: dict, sid: str) -> str:
    src = next(s for s in m["sources"] if s["id"] == sid)
    return src.get("role") or s1["sources"][sid].get("role_auto", "main")


def main_video(ctx, s1: dict) -> dict:
    vids = [s for s in ctx["m"]["sources"] if s["probe"]["has_video"] and role(ctx["m"], s1, s["id"]) != "music"]
    if not vids:
        raise ValueError("مفيش فيديو (الملفات كلها صوت)")
    return vids[0]


def out_to_src(segments: list[dict], t: float) -> tuple[str, float]:
    """وقت في الإخراج ← (الملف، الوقت فيه)."""
    acc = 0.0
    for s in segments:
        d = s["end"] - s["start"]
        if t < acc + d or s is segments[-1]:
            return s["source"], min(s["end"] - 0.01, s["start"] + max(0.0, t - acc))
        acc += d
    return segments[0]["source"], segments[0]["start"]


def summarize(key: str, data: dict) -> dict:
    """ملخص قصير لكل نسخة (بيظهر في قايمة النسخ)."""
    out = {}
    if key == "s2_cut" and "cut_report" in data:
        cr = data["cut_report"]
        out.update(segments=len(data["segments"]), total=data.get("total"), cuts=cr["cuts"], inside_word=cr["inside_word"], by_kind=cr["by_kind"],
                   dissolves=sum(t["kind"] == "dissolve" for t in data.get("transitions", [])), hard=sum(t["kind"] == "hard" for t in data.get("transitions", [])))
    if key == "s3_look" and "look" in data:
        out.update(look=data["look"]["name"], filters=len(data["look"]["steps"]))
    if key == "s4_subs" and "subs_check" in data:
        out.update(cues=len(data["cues"]), inside=data["subs_check"]["inside_bottom_zone"], edited=sum(bool(c.get("edited")) for c in data["cues"]))
    if key == "s5_graphics" and "cards_check" in data:
        out.update(cards=len(data["cards"]), ideas=len(data["ideas"]), overlaps=data["cards_check"]["overlaps"])
    if key == "s6_audio" and "audio" in data:
        out.update(lufs=(data["audio"].get("after") or {}).get("integrated_lufs"), target=data["audio"]["target_lufs"], crossfades=data["audio"].get("crossfades"))
    if key == "s7_preview":
        out.update(duration=(data.get("probe") or {}).get("duration"), fps=data.get("fps"), frames=data.get("frames"))
    return out


def _still(ctx, segments: list[dict], t_out: float, name: str, label: str, look_vf: str = "", overlays: list[dict] | None = None,
           crop: tuple | None = None, aspect: str = "9:16", crop_x: float = 0.5, data: dict | None = None) -> dict:
    """صورة من الإخراج في وقت معيّن (من المصدر + الإطار + الفلاتر + اللي فوقه) للتقرير، من غير رندر الفيديو كله."""
    srcs = sources_map(ctx, data)
    sid, ts = out_to_src(segments, t_out)
    src = srcs[sid]
    if src.get("graded"):
        look_vf = ""
    W, H = exporter.size(aspect)
    args = ["ffmpeg", "-v", "error", "-y", "-ss", f"{ts:.3f}", "-i", str(src["path"])]
    ch = [f"[0:v]{exporter.fit_chain(src, W, H, crop_x)},setsar=1" + (f",{look_vf}" if look_vf else "") + "[b0]"]
    cur = "b0"
    for k, o in enumerate(overlays or []):
        args += ["-i", str(o["png"])]
        ch.append(f"[{cur}][{k + 1}:v]overlay=x={o['x']}:y={o['y']}[o{k}]")
        cur = f"o{k}"
    tail = f"crop=iw*{crop[2] - crop[0]:.4f}:ih*{crop[3] - crop[1]:.4f}:iw*{crop[0]:.4f}:ih*{crop[1]:.4f}," if crop else ""
    ch.append(f"[{cur}]{tail}scale={720 if crop else 540}:-2[out]")
    out = ctx["vd"] / name
    exporter._run(args + ["-filter_complex", ";".join(ch), "-map", "[out]", "-frames:v", "1", "-q:v", "3", str(out)], "صورة")
    return {"file": name, "label": label}


# ---------- S1: التحليل ----------
def _scenes(path: Path, duration: float, prm: dict) -> list[dict]:
    if prm.get("scene_detector") == "content":
        return media.scenes(path, duration)
    from scenedetect import AdaptiveDetector, detect
    found = detect(str(path), AdaptiveDetector(adaptive_threshold=float(prm.get("adaptive_threshold", 3.0))), show_progress=False)
    if not found:
        return [{"index": 1, "start": 0.0, "end": round(duration, 3)}]
    return [{"index": i + 1, "start": round(float(s.get_seconds()), 3), "end": round(float(e.get_seconds()), 3)} for i, (s, e) in enumerate(found)]


def run_s1(ctx):
    prm, out, report, warns = ctx["params"], {"sources": {}}, [], []
    for s in ctx["m"]["sources"]:
        path, pr = ctx["d"] / s["work"], s["probe"]
        dur = pr["duration"]
        info = {"probe": pr, "loudness": media.loudness(path) if pr["has_audio"] else None}
        info["scenes"] = _scenes(path, dur, prm) if pr["has_video"] else [{"index": 1, "start": 0.0, "end": dur}]
        scene_cuts = [x["start"] for x in info["scenes"][1:]]
        line = f"{s['id']} ({s['name']}): {dur:.2f} ث"
        if pr["has_video"]:
            info["fps_plan"] = look.fps_plan(pr, look.r_frame_rate(path))
            info["video"] = look.measure(look.frames(path, [round(dur * (k + 0.5) / 8, 2) for k in range(8)]))
            v = info["video"]
            line += (f" · {pr['width']}×{pr['height']} · {len(info['scenes'])} لقطة · فريمات: {info['fps_plan']['why']}"
                     f" · إضاءة {v['brightness']:.0f} · تباين {v['contrast']:.0f} · حدة {v['sharpness']:.0f} · دوشة {v['noise']:.2f}")
        if pr["has_audio"]:
            sil = speech.silence_threshold(env_of(path))
            thr = sil["threshold_db"] if prm["silence_db"] == "auto" else float(prm["silence_db"])
            P_level = speech.pauses(path, dur, thr)
            V = speech.vad(path, dur)
            P = speech.merge_pauses(P_level, V["gaps"])   # سكتات بالعلو + سكتات بالـ VAD (الكلام الواطي جدًا)
            info.update(pauses=P, pauses_level=P_level, vad_speech=V["speech"], silence=sil, silence_db=thr)
            t, err = None, None
            try:
                t = speech.transcribe(path, prm["language"])
            except Exception as e:  # noqa: BLE001
                err = str(e)[:200]
            if t and t["words"] and t["mean_prob"] >= speech.MIN_CONF:
                aligned, info["alignment"] = cuts.align_to_vad(t["words"], V["speech"])
                words = cuts.refine_words(aligned, P)
                units = cuts.build_units(words, t["segments"], P, scene_cuts, dur, s["id"], prm["min_pause"])
                info.update(speech_mode="words", words=words, units=units, fallback_reason=None)
            else:
                why = f"التفريغ فشل ({err})" if err else ("مفيش كلام اتفهم" if not (t and t["words"]) else f"ثقة التفريغ قليلة ({t['mean_prob']:.2f} < {speech.MIN_CONF})")
                units = cuts.units_from_pauses(speech.speech_from_pauses(P, dur), s["id"])
                info.update(speech_mode="pauses", words=[], units=units, fallback_reason=why)
            info["transcript"] = {k: v for k, v in (t or {}).items() if k not in ("words",)} if t else None
            info["noise_floor_db"] = speech.noise_floor(path, P)
            wps = len(info["words"]) / max(dur, 0.1)
            info["role_auto"] = "music" if (not pr["has_video"] and (info["speech_mode"] == "pauses" or wps < 0.6)) else "main"
            L = info["loudness"] or {}
            line += f" · {len(info['words'])} كلمة" + (f" (ثقة {t['mean_prob']:.2f}، {t['seconds']} ث)" if t else "")
            line += (f" · {len(units)} جملة · {len(P)} سكتة ({len(P_level)} بالعلو، حد {thr} dB · {len(V['gaps'])} بالـ VAD) · "
                     f"{(info.get('alignment') or {}).get('moved', 0)} كلمة توقيتها اتصلّح على فترات الكلام (VAD)"
                     f" · علو {L.get('integrated_lufs')} LUFS · أرضية الدوشة {info['noise_floor_db']} dB")
            if info["fallback_reason"]:
                warns.append(f"⚠ {s['id']}: {info['fallback_reason']}، فاتقسم الكلام بالسكتات بدل الكلمات")
        else:
            info.update(speech_mode="none", words=[], pauses=[], fallback_reason=None, role_auto="main",
                        units=[{"id": f"{s['id']}u{k + 1}", "source": s["id"], "start": x["start"], "end": x["end"], "first": None, "last": None, "text": "",
                                "n_words": 0, "p_mean": None, "end_kind": "scene", "start_kind": "scene" if k else "source_start",
                                "silence_before": True, "silence_after": True} for k, x in enumerate(info["scenes"])])
            line += " · مفيهوش صوت (التقسيم باللقطات)"
        line += f" · دور الملف: {'مزيكا' if info['role_auto'] == 'music' else 'أساسي'}"
        report.append(line)
        out["sources"][s["id"]] = info
    return out, report + warns, []


# ---------- S2: القصّ والإيقاع ----------
def _main_sources(ctx, s1):
    return [s for s in ctx["m"]["sources"] if role(ctx["m"], s1, s["id"]) != "music"]


def _quantize(segs: list[dict], fps: int) -> None:
    """مدة كل جزء = عدد فريمات صحيح (علشان الصورة والصوت يفضلوا متزامنين بالظبط بعد كل قصّة)."""
    for s in segs:
        n = max(1, int(round((s["end"] - s["start"]) * fps)))
        s["end"] = round(s["start"] + n / fps, 4)
        s["frames"] = n


def finalize_s2(ctx, data: dict):
    s1, prm = s1_of(ctx), ctx["params"]
    _quantize(data["segments"], data["fps"])
    for s in data["segments"]:
        s.setdefault("cut_in", {"t": s["start"], "kind": "manual"}); s.setdefault("cut_out", {"t": s["end"], "kind": "manual"})
        s["cut_in"]["t"], s["cut_out"]["t"] = s["start"], s["end"]
        s["speed"] = 1.0
    data["total"] = round(sum(s["end"] - s["start"] for s in data["segments"]), 4)
    envs = {sid: env_of(ctx["d"] / next(x for x in ctx["m"]["sources"] if x["id"] == sid)["work"])
            for sid in {s["source"] for s in data["segments"]} if s1["sources"][sid]["probe"]["has_audio"]}
    thr = min([v.get("silence_db", -35) for v in s1["sources"].values() if v.get("silence_db") is not None] or [-35])
    _pull_to_silence(data["segments"], s1)
    _quantize(data["segments"], data["fps"])
    for g in data["segments"]:
        g["cut_in"]["t"], g["cut_out"]["t"] = g["start"], g["end"]
    data["total"] = round(sum(x["end"] - x["start"] for x in data["segments"]), 4)
    data["cut_report"] = cuts.cut_report(data["segments"], words_by_source(s1), envs, thr)
    vs = {sid: v.get("vad_speech") or [] for sid, v in s1["sources"].items()}
    for c in data["cut_report"]["list"]:   # القصّة جوه كلام حسب الـ VAD؟ (أدق من مستوى الصوت في تسجيل واطي)
        seg = next(x for x in data["segments"] if x["id"] == c["segment"])
        c["in_speech"] = any(sp["start"] + 0.02 < c["t"] < sp["end"] - 0.02 for sp in vs.get(seg["source"], []))
    data["cut_report"]["in_speech"] = sum(c["in_speech"] for c in data["cut_report"]["list"])
    scene_cuts = {sid: [x["start"] for x in v["scenes"][1:]] for sid, v in s1["sources"].items()}
    hard = prm.get("transitions") == "hard"
    srcs = sources_map(ctx)
    mot = []
    for a, b in zip(data["segments"], data["segments"][1:]):   # الحركة قبل/بعد كل قصّة (لقطع على الحركة)
        if srcs[a["source"]]["has_video"] and srcs[b["source"]]["has_video"]:
            mot.append(look.motion_match(srcs[a["source"]]["path"], a["end"], srcs[b["source"]]["path"], b["start"]))
        else:
            mot.append({})
    data["transitions"] = cuts.plan_transitions(data["segments"], scene_cuts, "fast" if hard else "normal", data["fps"],
                                                int(prm.get("dissolve_frames") or 0) or None, int(prm.get("audio_xfade_ms", 60)), mot,
                                                style=prm.get("transitions") if prm.get("transitions") in ("hard", "simple") else "auto")
    if hard and ctx["brief"]["pace"] != "fast":
        for t in data["transitions"]:
            if t["kind"] == "hard" and "لقطة" not in t["reason"]:
                t["reason"] = "طلبك: قطع صريح (jump cut)"
    n_over = cuts.apply_overrides(data["transitions"], prm.get("tr_overrides") or {}, data["fps"])   # اختيارك من الاستوديو
    tr, cr = data["transitions"], data["cut_report"]
    levels = [c["level_db"] for c in cr["list"] if c["level_db"] is not None]
    df = next((t["frames"] for t in tr if t["frames"]), int(prm.get("dissolve_frames") or 0) or (12 if data["fps"] >= 50 else 10))
    lines = [f"{len(data['segments'])} جزء · المدة {data['total']:.2f} ث · {data['fps']} فريم/ث ثابت",
             f"{cr['cuts']} قصّة · جوه كلمة: {cr['inside_word']} · جوه كلام (VAD): {cr.get('in_speech', 0)} · أعلى صوت عند قصّة: {max(levels) if levels else '—'} dB",
             "الانتقالات: " + " · ".join(f"{TR_NAMES.get(k, k)} {v}" for k, v in collections.Counter(t["kind"] for t in tr).items())
             + f" · crossfade صوت {prm.get('audio_xfade_ms', 60)} مللي في كل قصّة ({len(tr)})"]
    lines += [f"قصّة {t['index']} ({t['t']:.2f} ث): {t['kind']} ← {t['reason']}" for t in tr]
    return data, lines, []


def _pull_to_silence(segments: list[dict], s1: dict) -> None:
    """أي قصّة وقعت جوه كلام (VAD) — زي آخر الملف لما الكلام بيكمّل بعد آخر كلمة whisper سمعها — بترجع لأقرب سكتة حقيقية جوه الجزء."""
    for g in segments:
        vs = s1["sources"].get(g["source"], {}).get("vad_speech") or []
        gaps = [p for p in s1["sources"].get(g["source"], {}).get("pauses") or [] if p["end"] - p["start"] >= 0.2]
        if not vs:
            continue
        inside = lambda t: any(sp["start"] + 0.02 < t < sp["end"] - 0.02 for sp in vs)  # noqa: E731
        if g["cut_out"]["kind"] not in ("source_end",) and inside(g["end"]):
            back = [p for p in gaps if p["end"] <= g["end"] + 0.05 and p["start"] > g["start"] + 0.8]
            ch_ = next((sp for sp in vs if sp["start"] < g["end"] < sp["end"]), None)
            nxt = min([x["start"] for x in segments if x["source"] == g["source"] and x["start"] > g["end"]] or [1e9])
            if ch_ and ch_["end"] - g["end"] <= 1.2 and ch_["end"] + 0.1 < nxt:   # الصوت بيخلص قريب: نكمّل لآخره بدل ما نقطعه
                g["end"] = round(ch_["end"] + 0.1, 4)
                g["cut_out"] = {**g["cut_out"], "t": g["end"], "kind": "pause", "pulled": "اتمدّت لآخر الصوت (كان لسه بيتكلم)"}
            elif back:
                p = back[-1]
                g["end"] = round(p["start"] + min(0.15, (p["end"] - p["start"]) / 2), 4)
                g["cut_out"] = {**g["cut_out"], "t": g["end"], "kind": "pause", "pulled": "رجعت لآخر سكتة حقيقية (الكلام كان مكمّل)"}
        if g["cut_in"]["kind"] not in ("source_start",) and inside(g["start"]):
            fwd = [p for p in gaps if p["start"] >= g["start"] - 0.05 and p["end"] < g["end"] - 0.8]
            if fwd:
                p = fwd[0]
                g["start"] = round(p["end"] - min(0.1, (p["end"] - p["start"]) / 2), 4)
                g["cut_in"] = {**g["cut_in"], "t": g["start"], "kind": "pause", "pulled": "اتقدمت لأقرب سكتة حقيقية"}


def run_s2(ctx):
    s1, prm = s1_of(ctx), ctx["params"]
    segs, units_out = [], {}
    for s in _main_sources(ctx, s1):
        info = s1["sources"][s["id"]]
        units = [dict(u) for u in info["units"]]
        cuts.choose(units, s["probe"]["duration"])
        env = env_of(ctx["d"] / s["work"]) if s["probe"]["has_audio"] else None
        segs += cuts.plan_segments(units, info["words"], env, s["probe"]["duration"], float(prm["dead_air"]), float(prm["breath_out"]), float(prm["breath_in"]))
        units_out[s["id"]] = [{k: u[k] for k in ("id", "start", "end", "text", "keep", "reason", "start_kind", "end_kind")} for u in units]
    if not segs:
        raise ValueError("مفيش كلام/لقطات تنفع تتقص (كل حاجة اتشالت)")
    for k, g in enumerate(segs):
        g["id"] = f"g{k + 1}"
    mv = main_video(ctx, s1)
    fps_plan = s1["sources"][mv["id"]]["fps_plan"]
    data = {"s1": chain_doc(ctx, "s1_analyze")["version"], "aspect": prm["aspect"], "fps": fps_plan["out"], "fps_plan": fps_plan, "segments": segs,
            "units": units_out, "dead_air": {"threshold": prm["dead_air"], "breath_out": prm["breath_out"], "breath_in": prm["breath_in"]}}
    data, lines, stills = finalize_s2(ctx, data)
    src_total = sum(s["probe"]["duration"] for s in _main_sources(ctx, s1))
    lines.insert(1, f"الهوا الميت: أي سكتة أطول من {prm['dead_air']} ث بين جملتين بتتقص، ويفضل نفَس {prm['breath_out']} ث بعد الكلام و {prm['breath_in']} ث قبله."
                    f" السكتات الأقصر (نفَس طبيعي) بتفضل زي ما هي · {src_total:.1f} ← {data['total']:.1f} ث")
    lines.append(f"الفريمات: {fps_plan['why']}")
    for sid, us in units_out.items():
        dropped = [u for u in us if not u["keep"]]
        if dropped:
            lines.append(f"{sid}: اتشال {len(dropped)} من {len(us)}: " + " | ".join(f"«{u['text'][:40] or f'{u['start']:.1f}–{u['end']:.1f}'}» ({u['reason']})" for u in dropped))
    return data, lines, stills


# ---------- S3: الصورة ----------
TR_NAMES = {**cuts.TRANSITION_KINDS, "whip_r": "سحبة (عكس)", "match": "قطع على الحركة"}


def _sample_times(segments: list[dict], n: int = 8) -> list[float]:
    total = sum(s["end"] - s["start"] for s in segments)
    return [round(total * (k + 0.5) / n, 3) for k in range(n)]


def run_s3(ctx):
    """الصورة والرؤية: الوش والشخص (MediaPipe) ← تصحيح لكل لقطة على البشرة والوش ← الخلفية ورا المتكلم بالقناع (لو بتفيد)
    ← نسخة شغل متلوّنة (graded.mp4) الرندر بيقرا منها."""
    inp, prm, vd = ctx["inp"]["data"], ctx["params"], ctx["vd"]
    s1, srcs = s1_of(ctx), sources_map(ctx)
    W, H = exporter.size(inp["aspect"])
    mv = main_video(ctx, s1)
    src = srcs[mv["id"]]
    fit = exporter.fit_chain(src, W, H)
    fp = s1["sources"][mv["id"]]["fps_plan"]
    conv = f"minterpolate=fps={inp['fps']}:mi_mode=blend" if fp["method"].startswith("minterpolate") else f"fps={inp['fps']}"
    t0 = time.time()
    samples = vision.track_stream(src["path"], 5, fit) if vision.available() else []
    vision.save_samples(samples, vd / "vision.npz")
    with_face = sum(bool(x["faces"]) for x in samples)
    speaker = bool(samples) and with_face >= 0.5 * len(samples)
    t_vision = round(time.time() - t0, 1)
    strength = {k: prm.get(k) for k in ("brightness", "saturation", "sharpen", "denoise", *look.MANUAL_KEYS)}
    scenes = s1["sources"][mv["id"]]["scenes"]
    shots, report, stills, fs_main = [], [], [], None
    for k, sc in enumerate(scenes):
        a, b = sc["start"], sc["end"]
        times = [round(a + (b - a) * (q + 0.5) / 6, 3) for q in range(6)]
        fr = look.frames(src["path"], times, fit, width=540)
        near = [min(samples, key=lambda x: abs(x["t"] - t)) for t in times] if samples else []
        faces = [x["faces"] for x in near] if near else [[] for _ in fr]
        masks = [x["mask"] for x in near] if near else None
        before = look.measure(fr)
        fs = look.face_stats(fr, faces, masks)
        if fs and (fs_main is None or b - a > fs_main[1]):
            fs_main = (fs, b - a)
        tries = []
        for soften in (1.0, 0.6, 0.3, 0.0):   # لو التصحيح حرق/طفّى أو خضّر الصورة أو برّد البشرة: نفس التصحيح أخف
            pl = look.plan_natural(before, fs, prm.get("look", "natural"), strength, soften)
            fr_after = look.frames(src["path"], times, ",".join(x for x in [fit, pl["vf"]] if x), width=540)
            after = look.measure(fr_after)
            chk = look.natural_check(before, after, fs, look.face_stats(fr_after, faces) if fs else None)
            tries.append({"soften": soften, "clipped_pct": after["clipped_pct"], "crushed_pct": after["crushed_pct"], "tint_delta": chk["tint_delta"],
                          "skin_warm_delta": chk["skin_warm_delta"], "ok": chk["ok"]})
            if chk["ok"]:
                break
        # إعداداتك اليدوية والفلتر (من الاستوديو) بعد التصحيح الطبيعي، من غير ما الفحص الأوتوماتيك يلغيهم: ده اختيارك إنت
        manual = look.studio_vf({**{k: prm.get(k) for k in look.MANUAL_KEYS}, "filter": prm.get("look") if prm.get("look") in look.FILTER_PRESETS else None})
        if manual:
            pl = {**pl, "vf": ",".join(x for x in [pl["vf"], manual] if x), "why": pl["why"] + [f"إعداداتك من الاستوديو: {manual}"]}
            after = look.measure(look.frames(src["path"], times, ",".join(x for x in [fit, pl["vf"]] if x), width=540))
            chk = {**chk, **look.check(before, after)}
        fs_after = look.face_stats(look.frames(src["path"], times, ",".join(x for x in [fit, pl["vf"]] if x), width=540), faces) if fs else None
        shots.append({"index": k + 1, "start": a, "end": b, "vf": pl["vf"], "why": pl["why"], "before": before, "after": after, "check": chk,
                      "face_before": fs, "face_after": fs_after, "tries": tries, "wb_strength": pl.get("wb_strength")})
    # فصل المتكلم عن الخلفية (العزل) مقفول افتراضيًا: كان بيخلّي المتكلم «مقصوص ومحطوط» على الحيطة. بيشتغل بس لو طلبته
    bg = look.bg_plan(fs_main[0] if fs_main else None, None) if speaker and prm.get("background") == "on" else \
        {"vf": "", "why": "الخلفية زي ما هي (فصل المتكلم عن الخلفية مقفول إلا لو طلبته)"}
    main_shot = max(shots, key=lambda x: x["end"] - x["start"]) if shots else None
    fg = look.fg_plan(main_shot["face_after"] if main_shot else None) if speaker and prm.get("relight") == "on" else \
        {"vf": "", "why": "من غير إضاءة على المتكلم لوحده (بتعمل شكل مقصوص؛ بتشتغل بس لو طلبتها)"}
    mask_info = None
    if (bg["vf"] or fg["vf"]) and vision.available():
        mask_info = vision.mask_video(src["path"], vd / "mask.mp4", inp["fps"], conv, fit, W, H)
    t1 = time.time()
    exporter.grade_source(src, vd / "graded.mp4", fps=inp["fps"], fps_method=fp["method"], aspect=inp["aspect"],
                          shots=[{"start": x["start"], "end": x["end"], "vf": x["vf"]} for x in shots], mask=vd / "mask.mp4" if mask_info else None, bg_vf=bg["vf"] or "null",
                          fg_vf=fg["vf"])
    t_grade = round(time.time() - t1, 1)
    # قبل/بعد على الملف المتلوّن نفسه (نفس الأوقات في الإخراج)
    pts = [ts for sid, ts in (out_to_src(inp["segments"], t) for t in _sample_times(inp["segments"])) if sid == mv["id"]]
    gb = look.measure(look.frames(src["path"], pts, fit, width=540))
    ga = look.measure(look.frames(vd / "graded.mp4", pts, "", width=540))
    gchk = look.check(gb, ga)
    for sh in shots:   # الوش بعد كل حاجة (على النسخة المتلوّنة نفسها)
        times = [round(sh["start"] + (sh["end"] - sh["start"]) * (q + 0.5) / 6, 3) for q in range(6)]
        near = [min(samples, key=lambda x: abs(x["t"] - t)) for t in times] if samples else []
        sh["face_final"] = look.face_stats(look.frames(vd / "graded.mp4", times, "", width=540), [x["faces"] for x in near]) if near else None
    for k, sh in enumerate(shots[:4]):
        t = (sh["start"] + sh["end"]) / 2
        stills.append(_pair(src["path"], vd / "graded.mp4", t, fit, vd / f"pair_{k + 1}.jpg", f"لقطة {k + 1}: قبل | بعد ({t:.1f} ث في الملف)"))
    if mask_info:
        stills.append(_mask_still(src["path"], vd / "mask.mp4", pts[len(pts) // 2], fit, inp["fps"], vd / "mask_check.jpg"))
    data = {**inp, "look": {"name": prm.get("look", "natural"), "vf": "", "steps": [], "why": [], "before": gb, "after": ga, "check": gchk,
                            "graded": str((vd / "graded.mp4").relative_to(ctx["d"])), "vision": str((vd / "vision.npz").relative_to(ctx["d"])),
                            "speaker": speaker, "shots": shots, "bg": bg, "fg": fg, "mask": mask_info, "crop_x": 0.5, "measured_on": len(pts)}}
    f = lambda k, d=1: f"{gb[k]:.{d}f} ← {ga[k]:.{d}f}"  # noqa: E731
    report += [f"الرؤية: {len(samples)} عينة (5 في الثانية) في {t_vision} ث · وش في {with_face}/{len(samples)} · متكلم يتفصل: {'أيوه' if speaker else 'لأ'}",
               f"الكادر كله (على {len(pts)} فريم من الإخراج): الإضاءة {f('brightness')} · التباين {f('contrast')} · الحدة {f('sharpness')} · الدوشة {f('noise', 2)} · ميل اللون {gb.get('cast_size', 0):.1%} ← {ga.get('cast_size', 0):.1%}",
               f"إضاءة محروقة: {gb['clipped_pct']:.2f}% ← {ga['clipped_pct']:.2f}% · ضلمة مطفية: {gb['crushed_pct']:.2f}% ← {ga['crushed_pct']:.2f}%" + (" ✓" if gchk["no_new_clipping"] and gchk["no_new_crush"] else " ⚠")]
    for sh in shots:
        fb, fa = sh["face_before"], sh.get("face_final") or sh["face_after"]
        report.append(f"لقطة {sh['index']} ({sh['start']:.1f}–{sh['end']:.1f} ث): " + (f"الوش: إضاءة {fb['y']:.0f} ← {fa['y']:.0f}، دفا البشرة {fb['warm']:.3f} ← {fa['warm']:.3f}" if fb and fa else "مفيش وش")
                      + " · " + " · ".join(sh["why"]) + (" · خفّفنا التصحيح: " + " ← ".join(f"{t['soften']:.0%}" for t in sh["tries"]) if len(sh["tries"]) > 1 else ""))
    report.append(f"المتكلم: {fg['why']}")
    report.append(f"الخلفية: {bg['why']}" + (f" · القناع: {mask_info['frames']} فريم، الشخص {mask_info['coverage_mean']:.0%} من الكادر في المتوسط" if mask_info else ""))
    report.append(f"نسخة الشغل المتلوّنة: {t_grade} ث")
    return data, report, stills


def _pair(src: Path, graded: Path, t: float, fit: str, out: Path, label: str) -> dict:
    exporter._run(["ffmpeg", "-v", "error", "-y", "-ss", f"{t:.3f}", "-i", str(src), "-ss", f"{t:.3f}", "-i", str(graded), "-filter_complex",
                   f"[0:v]{fit},scale=405:-2[a];[1:v]scale=405:-2[b];[a][b]hstack[o]", "-map", "[o]", "-frames:v", "1", "-q:v", "3", str(out)], "صورة")
    return {"file": out.name, "label": label}


def _mask_still(src: Path, mask: Path, t: float, fit: str, fps: int, out: Path) -> dict:
    """القناع فوق الصورة (أحمر = المتكلم) علشان جودته تتشاف بالعين."""
    import cv2
    f = look.frames(src, [t], fit, width=540)[0]
    raw = subprocess.run(["ffmpeg", "-v", "error", "-ss", f"{t:.3f}", "-i", str(mask), "-frames:v", "1", "-vf", "scale=540:960,format=gray", "-f", "rawvideo", "-"],
                         capture_output=True).stdout
    m = np.frombuffer(raw, np.uint8).reshape(960, 540).astype(np.float32)[: f.shape[0], : f.shape[1]] / 255 * 0.5
    red = np.zeros_like(f, dtype=np.float32); red[..., 0] = 255
    comp = (f.astype(np.float32) * (1 - m[..., None]) + red * m[..., None]).astype(np.uint8)
    cv2.imwrite(str(out), cv2.cvtColor(comp, cv2.COLOR_RGB2BGR))
    return {"file": out.name, "label": "جودة القناع (أحمر = المتكلم)"}


# ---------- S4: الترجمة ----------
def run_s4(ctx):
    inp, prm = ctx["inp"]["data"], ctx["params"]
    s1 = s1_of(ctx)
    fixes = prm.get("fixes") or {}
    W, H = exporter.size(inp["aspect"])
    cpl = graphics.chars_per_line(inp["aspect"], W, H, prm["size"])   # السطر على قد عرض المنطقة بالخط ده، والكلام سطرين بالكتير
    cues = cuts.subtitle_cues(inp["segments"], words_by_source(s1, fixes), min(int(prm["max_chars"]), cpl), float(prm["min_dur"]), float(prm["max_dur"]))
    for c in cues:   # السطر اللي فيه كلمة صحّحتها بإيدك
        c["edited"] = any(f"{w['source']}:{w['src_i']}" in fixes for w in c["words"])
    return _finish_s4(ctx, {**{k: v for k, v in inp.items() if k not in ("cues", "subs", "subs_check", "sub_style")}, "cues": cues})


def _samples(ctx, data) -> list[dict]:
    v = (data.get("look") or {}).get("vision")
    return vision.load_samples(ctx["d"] / v) if v and (ctx["d"] / v).exists() else []


def _faces_during(samples, segments, a: float, b: float) -> list[list[float]]:
    """كل صناديق الوش في فترة من الإخراج (بنحوّلها لوقت الملف)."""
    out = []
    for t in np.linspace(a, b, max(2, int((b - a) * 5) + 1)):
        _, ts = out_to_src(segments, float(t))
        out += vision.faces_at(samples, ts)
    return out


def _hits_face(faces, rect) -> bool:
    return any(f[0] < rect["right"] and rect["left"] < f[2] and f[1] < rect["bottom"] and rect["top"] < f[3] for f in faces)


def _finish_s4(ctx, data):
    prm = ctx["params"]
    W, H = exporter.size(data["aspect"])
    style = {"size": prm["size"], "color": prm["color"], "panel": prm["panel"], "pos": prm["pos"]}
    safe = cuts.SAFE[data["aspect"]]
    samples = _samples(ctx, data)
    fs_px = graphics.sub_font_px(data["aspect"], H, prm["size"])
    cpl = graphics.chars_per_line(data["aspect"], W, H, prm["size"])
    base_bottom = safe["bottom"] + cuts.SUB_POS.get(prm["pos"], 0)
    moved = []
    for c in data["cues"]:   # الترجمة عمرها ما تغطي الوش: لو الوش نازل لمكانها، تنزل/تطلع جوه منطقة تحت
        lines = 1 + (len(c["text"]) > cpl)
        h = (lines * 1.38 + 0.44) * fs_px / H
        faces = _faces_during(samples, data["segments"], c["start"], c["end"]) if samples else []
        c.pop("pos_bottom", None)
        for bot in (base_bottom, base_bottom + 0.05, base_bottom - 0.06, 0.88):
            r = {"left": safe["left"], "right": safe["right"], "top": bot - h, "bottom": bot}
            if not _hits_face(faces, r):
                if bot != base_bottom:
                    c["pos_bottom"] = round(bot, 3)
                    moved.append(c["id"])
                break
    if (prm.get("caption") or {}).get("engine") == 2:   # المحرّك الموحّد (نفس المعاينة الحية في الاستوديو)
        r = graphics.render_engine(data["cues"], data["aspect"], W, H, ctx["vd"] / "subs", prm["caption"], data["total"])
        r["style"]["label"] = prm["caption"].get("label")
    elif prm.get("caption"):   # ستايل من «استوديو المونتاج» (جاهز + تعديلات صاحب الفيديو)
        r = graphics.render_styled(data["cues"], data["aspect"], W, H, ctx["vd"] / "subs", prm["caption"])
    elif prm.get("style", "player") == "player":   # زي فيديوهات التطبيق (الافتراضي): الجملة تحت بخط متوسط، واللي اتقال منوّر
        r = graphics.render_karaoke(data["cues"], data["aspect"], W, H, ctx["vd"] / "subs", style)
    elif prm.get("style") == "bold":   # ستايل التيك توك: 1–3 كلمات كبيرة
        r = graphics.render_bold(data["cues"], data["aspect"], W, H, ctx["vd"] / "subs", style,
                                 faces_for=(lambda a, b: _faces_during(samples, data["segments"], a, b)) if samples else None)
    else:                                     # الستايل القديم: سطر في صندوق
        r = graphics.render(data["cues"], [], data["aspect"], W, H, ctx["vd"] / "subs", style, "clean", graphics.CARD_ZONES[data["aspect"]]["top"], word_states=True)
    track = _subs_track(r["subs"], data["total"], W, H, ctx["vd"] / "subs")
    subs = [{**{k: v for k, v in o.items() if k != "states"}, "png": str(Path(o["png"]).relative_to(ctx["d"])), "words": len(o["states"])} for o in r["subs"]]
    durs = [c["end"] - c["start"] for c in data["cues"]]
    face_hits = sum(_hits_face(_faces_during(samples, data["segments"], o["start"], o["end"]),
                               {"left": o["x"] / W, "right": (o["x"] + o["w"]) / W, "top": o["y"] / H, "bottom": (o["y"] + o["h"]) / H}) for o in r["subs"]) if samples else None
    lag = _onset_lag(ctx, data)
    sc = {"cues": len(subs), "inside_bottom_zone": sum(o["inside_bottom_zone"] for o in subs), "min_dur": round(min(durs), 3) if durs else None,
          "max_dur": round(max(durs), 3) if durs else None, "under_min": sum(d < float(prm["min_dur"]) - 0.01 for d in durs),
          "over_max": sum(d > float(prm["max_dur"]) + 0.01 for d in durs), "font_px": r["sub_font_px"], "font_pct_height": round(r["sub_font_px"] / H * 100, 2),
          "zone": safe, "forced_breaks": data["cues"][0].get("forced_breaks", 0) if data["cues"] else 0, "max_lines": max([o["lines"] for o in subs] or [0]),
          "face_overlaps": face_hits, "moved_for_face": moved, "word_states": sum(o["words"] for o in subs), "onset_lag": lag}
    data.update(subs=subs, subs_track=str(track.relative_to(ctx["d"])), sub_style=style, subs_check=sc)
    report = [f"{sc['cues']} سطر · {sc['word_states']} كلمة بتظهر كلمة كلمة مع صوتها · جوه المنطقة الآمنة تحت: {sc['inside_bottom_zone']}/{sc['cues']}",
              f"مدة السطر على الشاشة: من {sc['min_dur']} لـ {sc['max_dur']} ث · أقل من {prm['min_dur']}: {sc['under_min']} · أكتر من {prm['max_dur']}: {sc['over_max']}",
              (f"ستايل الترجمة: «{r['style'].get('label') or r['style'].get('preset') or 'مخصوص'}» · خط {r['style']['font']} · حجم {r['style']['size']} · لون {r['style']['color']} والكلمة الحالية {r['style']['accent']}"
               + (f" · حركة {r['style'].get('anim')} · اترسم {r['frames_drawn']} من {r['frames_total']} فريم" if r.get("frames_drawn") is not None else "")
               if prm.get("caption") else
               f"زي فيديوهات التطبيق: الجملة تحت · الخط {sc['font_px']}px = {sc['font_pct_height']}% من ارتفاع الفريم · اللي اتقال منوّر والكلمة الحالية بلون التأكيد"
               if prm.get("style", "player") == "player" else
               f"ستايل التيك توك: {len(subs)} مجموعة (1–3 كلمات) · الخط {sc['font_px']}px = {sc['font_pct_height']}% من ارتفاع الفريم · الكلمة الحالية منوّرة · دخول بنطّة"
               if prm.get("style") == "bold" else f"الخط {sc['font_px']}px = {sc['font_pct_height']}% من ارتفاع الفريم · خلفية غامقة خفيفة · سطرين بالكتير · السطور بتقف عند السكتات"),
              f"فوق الوش: {face_hits if face_hits is not None else '—'} سطر" + (f" (اتحرك علشان الوش: {', '.join(moved)})" if moved else ""),
              (f"توقيت الكلمة مقابل أول صوتها (كلمات بعد سكتة، {lag['n']} كلمة): الوسيط {lag['median_ms']} مللي · أكبر {lag['max_ms']} مللي · تحت 100 مللي: {lag['under_100']}/{lag['n']}"
               if lag["n"] else "مفيش كلمات بعد سكتة واضحة علشان نقيس التأخير")]
    stills = []
    if data["cues"]:
        c = max(data["cues"], key=lambda x: len(x["text"]))
        o = next(x for x in r["subs"] if x.get("cue", x["id"]) == c["id"])
        t = (c["start"] + c["end"]) / 2
        stills.append(_still(ctx, data["segments"], t, "sub_frame.jpg", f"سطر ترجمة في الفريم ({t:.2f} ث)", overlays=[_state_at(o, t)], aspect=data["aspect"], data=data))
        mid = o["states"][len(o["states"]) // 2] if o["states"] else None
        if mid:
            stills.append(_still(ctx, data["segments"], mid["start"] + 0.02, "sub_close.jpg", f"كلمة كلمة: نص السطر ({mid['start']:.2f} ث)", overlays=[{**o, "png": mid["png"], "x": mid.get("x", o["x"] + int(mid.get("dx", 0))), "y": mid.get("y", o["y"])}],
                                 crop=(0.0, max(0.0, o["y"] / H - 0.05), 1.0, min(1.0, (o["y"] + o["h"]) / H + 0.05)), aspect=data["aspect"], data=data))
    return data, report, stills


def _state_at(o: dict, t: float) -> dict:
    st = [x for x in o.get("states") or [] if x["start"] <= t] or o.get("states") or [{"png": o["png"]}]
    if "x" in st[-1]:
        return {**o, "png": st[-1]["png"], "x": st[-1]["x"], "y": st[-1]["y"]}
    return {**o, "png": st[-1]["png"], "x": o["x"] + int(st[-1].get("dx", 0))}


def _subs_track(subs: list[dict], total: float, W: int, H: int, out_dir: Path) -> Path:
    """كل حالات الترجمة (كلمة كلمة) ← صور بمقاس الفريم كله + ملف ffconcat بالمدد: overlay واحد للترجمة كلها في الرندر."""
    import cv2
    blank = out_dir / "blank.png"
    cv2.imwrite(str(blank), np.zeros((H, W, 4), np.uint8))
    events = []
    for o in subs:
        for k, stt in enumerate(o["states"] or [{"png": o["png"], "start": o["start"], "end": o["end"]}]):
            im = cv2.imread(stt["png"], cv2.IMREAD_UNCHANGED)
            full = np.zeros((H, W, 4), np.uint8)
            h, w = im.shape[:2]
            if "x" in stt:   # ترجمة التيك توك: كل حالة ليها مكانها (النطّة بتغيّر المقاس)
                x, y = max(0, stt["x"]), max(0, stt["y"])
            else:
                x, y = max(0, o["x"] + int(stt.get("dx", 0))), max(0, o["y"])   # الصندوق بيكبر ناحية الشمال، والحافة اليمين ثابتة
            full[y:y + h, x:x + w] = im[: H - y, : W - x]
            fp = out_dir / f"full_{Path(stt['png']).stem}.png"
            cv2.imwrite(str(fp), full)
            events.append((stt["start"], stt["end"], fp))
    events.sort(key=lambda e: e[0])
    lines, t = ["ffconcat version 1.0"], 0.0
    for a, b, fp in events:
        if a > t + 1e-3:
            lines += [f"file '{blank}'", f"duration {a - t:.4f}"]
        lines += [f"file '{fp}'", f"duration {max(0.001, b - max(a, t)):.4f}"]
        t = max(t, b)
    if total > t:
        lines += [f"file '{blank}'", f"duration {total - t:.4f}"]
    lines.append(f"file '{blank}'")
    out = out_dir / "subs.ffconcat"
    out.write_text("\n".join(lines) + "\n", encoding="utf-8")
    return out


def _onset_lag(ctx, data) -> dict:
    """التأخير بين توقيت الكلمة (اللي الترجمة بتظهر عليه) وأول صوتها الحقيقي: لكل كلمة بعدها سكتة ≥ 0.15 ث قبلها
    (هناك بس أول الصوت بيتقاس بثقة)، من منحنى علو الصوت كل 10 مللي."""
    s1 = s1_of(ctx)
    out = []
    for c in data["cues"]:
        for w in c["words"]:
            src = s1["sources"][w["source"]]
            ws = src.get("words") or []
            i = w["src_i"]
            if i >= len(ws) or (i > 0 and ws[i]["start"] - ws[i - 1]["end"] < 0.15):
                continue
            env = env_of(ctx["d"] / next(x for x in ctx["m"]["sources"] if x["id"] == w["source"])["work"])
            thr = (src.get("silence_db") or -45) + 6
            t0 = ws[i]["start"]
            a, b = int(max(0, t0 - 0.3) / speech.HOP), int((t0 + 0.3) / speech.HOP)
            seg = env[a:b]
            above = np.nonzero(seg > thr)[0]
            if not len(above):
                continue
            onset = (a + above[0]) * speech.HOP
            out.append(round((t0 - onset) * 1000))
    if not out:
        return {"n": 0}
    ab = [abs(x) for x in out]
    return {"n": len(out), "median_ms": int(np.median(out)), "max_ms": int(max(ab)), "under_100": sum(x < 100 for x in ab), "all_ms": out}


# ---------- S5: الموشن جرافيك ----------
def _speaker_box(samples, segments, a, b):
    """متوسط صندوق الوش في فترة من الإخراج (نسبة)، أو None."""
    fs = _faces_during(samples, segments, a, b) if samples else []
    if not fs:
        return None
    return [float(np.mean([f[q] for f in fs])) for q in range(4)]


def _gfx_duration(sp: dict, idea: dict) -> float:
    k = sp["kind"]
    words = len((sp.get("title") or "").split()) + len(sp.get("items") or [])
    base = {"keyword": 2.6, "counter": 3.2, "meter": 3.4, "bars": 3.4, "timeline": 1.4 + 0.6 * len(sp.get("items") or []), "lower_third": 3.0, "title": 2.8}[k]
    if sp["mode"] == "explainer":   # الشرح الطويل: طول الشرح نفسه
        return round(min(5.5, max(3.6, idea["end"] - sp["at"] + 0.3)), 3)
    if sp["mode"] in ("split", "inset"):   # وقت القراية + نص ثانية للدخول/الرجوع
        return round(min(4.5, base + 0.15 * words + 0.6), 3)
    return round(min(4.5, base + 0.15 * words), 3)


def run_s5(ctx):
    """الموشن جرافيك: لكل فكرة، النوع من الكلام (motion.choose)، وطريقة العرض بقاعدة، والمكان من قناع الشخص والوش بره منطقة الترجمة."""
    inp, prm, vd = ctx["inp"]["data"], ctx["params"], ctx["vd"]
    W, H = exporter.size(inp["aspect"])
    fps = inp["fps"]
    samples = _samples(ctx, inp)
    speaker = bool((inp.get("look") or {}).get("speaker"))
    removed = {cuts.norm(x) for x in prm.get("removed") or []}
    b = {"graphics": prm["graphics"], "density": prm["density"], "pace": prm.get("pace", "normal"), "modes": prm.get("modes") or {}}
    its = graphics.ideas(inp["segments"], inp["cues"])
    if its:
        its[0]["first"] = True
    specs, log, last_end, last_explainer = [], [], -9.0, -99.0
    subs_rects = [{"left": o["x"] / W, "right": (o["x"] + o["w"]) / W, "top": o["y"] / H, "bottom": (o["y"] + o["h"]) / H, "start": o["start"], "end": o["end"]}
                  for o in inp.get("subs", [])]
    # مخرج الجرافيك: رسمة/أيقونة/إيموجي متحرك على قد الكلام (من المكتبات أو بيترسم)، مربوط بكلمة في سطر. لو فشل: القواعد القديمة
    allowed = [k for k, on in (prm.get("kinds") or {}).items() if on]
    hint = {"few": "جرافيك قليل: واحد كل 6–8 ثواني بالكتير.", "many": "جرافيك أكتر: واحد كل 2–4 ثواني.", "normal": ""}.get(prm.get("density", "normal"), "")
    hint += f" الأنواع المسموحة بس: {', '.join(allowed)}." if allowed and len(allowed) < 4 else ""
    hint += f" الصور الحقيقية {int(prm.get('max_photos', 2))} بالكتير." if int(prm.get("max_photos", 2)) != 2 else ""
    if prm.get("picks") is not None and prm["graphics"] != "off":   # اختيارك لكل مشهد من الاستوديو (بيتراجع بنفس قواعد المخرج)
        ok, bad = director.validate([{k: v for k, v in x.items() if k not in ("cue_i", "at", "cue_end")} for x in prm["picks"]], inp["cues"])
        ok.sort(key=lambda x: x["at"])
        dplan = {"items": ok, "rejected": bad, "topic_en": prm.get("picks_topic", ""), "outline": prm.get("picks_outline")}
    else:
        dplan = director.plan(inp["cues"], ((ctx["m"].get("brief") or {}).get("text", "") + " " + hint).strip()) \
            if prm["graphics"] != "off" and prm.get("director", "on") == "on" and inp.get("cues") else {"items": []}
    if dplan.get("items"):   # إعداداتك من الاستوديو هي الحَكَم: الأنواع المقفولة بتتشال، والصور على قد العدد اللي اخترته
        kinds_on = prm.get("kinds") or {}
        dplan["items"] = [x for x in dplan["items"] if kinds_on.get(x["template"], True)]
        ph = [x for x in dplan["items"] if x["template"] == "photo"]
        for x in ph[int(prm.get("max_photos", 2)):]:
            dplan["items"].remove(x)
        specs, log = _director_specs(dplan, its, inp, prm, samples, speaker, W, H, removed)
        for sp in specs:
            sp["accent"], sp["badge"], sp["scale"] = prm.get("accent", "#7ee2b8"), prm.get("badge", "glass"), float(prm.get("size", 1.0))
    # لو المخرج فشل: من غير جرافيك أحسن من كروت الكلام القديمة (اترفضت: «بتكتب الكلام وهو أصلًا مكتوب»)
    for it in ([] if dplan.get("items") or prm.get("director", "on") == "on" else its):
        entry = {"idea": it["id"], "text": it["text"][:60], "start": it["start"], "end": it["end"]}
        if prm["graphics"] == "off":
            log.append({**entry, "decision": "skip", "why": "الجرافيك مقفول من الطلب"}); continue
        sp = motion.choose(it, speaker, b, {x.get("icon") for x in specs})
        if not sp or "skip" in sp:
            log.append({**entry, "decision": "skip", "why": (sp or {}).get("skip", "مفيش كلام")}); continue
        key = cuts.norm(sp.get("title") or " ".join(x["label"] for x in sp.get("items") or []) or "")
        if key in removed:
            log.append({**entry, "decision": "skip", "why": "إنت شلت الجرافيك ده"}); continue
        sp["start"] = round(sp["at"], 3)
        if sp["start"] < last_end + 0.5:
            log.append({**entry, "decision": "skip", "why": "الجرافيك اللي قبله لسه على الشاشة (واحد بس في نفس الوقت)"}); continue
        if sp["mode"] in ("explainer", "pip") and sp["start"] - last_explainer < 12:
            sp["mode"], sp["mode_why"] = "overlay", "شرح بالشاشة كلها قريب أوي من اللي قبله (أقل من 12 ث): overlay بدله"
        sp["end"] = round(min(sp["start"] + _gfx_duration(sp, it), inp["total"] - 0.05), 3)   # عمره ما يعدّي آخر الفيديو
        if sp["end"] - sp["start"] < 1.5:
            log.append({**entry, "decision": "skip", "why": f"الفيديو بيخلص بعد {sp['end'] - sp['start']:.1f} ث بس: مفيش وقت يتقري"}); continue
        if sp["mode"] == "overlay":
            win = [x for t in np.linspace(sp["start"], sp["end"], 8) for x in vision.window(samples, out_to_src(inp["segments"], float(t))[1], out_to_src(inp["segments"], float(t))[1])]
            occ = vision.occupancy(win)
            rect = motion.place(sp["kind"], occ, inp["aspect"])
            if rect is None:
                if speaker:
                    sp["mode"], sp["mode_why"] = "pip", "مفيش مساحة فاضية كفاية من غير ما يغطي المتكلم: صورتك مصغّرة والشرح في باقي الشاشة"
                    sp["end"] = round(sp["start"] + _gfx_duration(sp, it), 3)
                else:
                    log.append({**entry, "decision": "skip", "why": "مفيش مساحة فاضية ومفيش متكلم يتفصل: اتشال"}); continue
            else:
                sp["rect"] = rect
        if sp["mode"] in ("split", "inset", "pip"):
            fb = _speaker_box(samples, inp["segments"], sp["start"], sp["end"]) or [0.35, 0.3, 0.65, 0.48]
            fcx, fcy, fh = (fb[0] + fb[2]) / 2, (fb[1] + fb[3]) / 2, fb[3] - fb[1]
            if sp["mode"] == "split":   # المتكلم فوق (نص الكادر) والجرافيك تحت فوق الترجمة
                ch_ = H // 2
                cy0 = int(min(max(0, fcy * H - ch_ * 0.48), H - ch_))
                sp["crop"], sp["target"] = [0, cy0, W, ch_], [0, 0, W, ch_]
            elif sp["mode"] == "pip":   # صورتك في دايرة: مربع حوالين الوش (الوش حوالي 45% منه + الكتاف)
                side = int(min(W, H, max(fh * H * 2.3, 0.28 * W))) // 2 * 2
                cx0 = int(min(max(0, fcx * W - side / 2), W - side)); cy0 = int(min(max(0, fcy * H - side * 0.42), H - side))
                sp["pip"] = motion.pip_geom(W, H, inp["aspect"])
                sp["crop"], sp["target"] = [cx0, cy0, side, side], [sp["pip"][0], sp["pip"][1], sp["pip"][2], sp["pip"][2]]
            else:                       # المتكلم صغير فوق في النص، والجرافيك تحته
                side = int(min(W, max(fh * H * 2.6, 0.3 * W)))
                cx0 = int(min(max(0, fcx * W - side / 2), W - side)); cy0 = int(min(max(0, fcy * H - side * 0.45), H - side))
                tw = int(0.46 * W) // 2 * 2
                sp["crop"], sp["target"] = [cx0, cy0, side, side], [(W - tw) // 2, int(0.07 * H), tw, tw]
        sp["style"], sp["enter"] = motion.style_for(len(specs), specs[-1].get("style") if specs else None, sp["kind"])
        if sp["mode"] != "overlay":   # الخلفية الكاملة غامقة: ستايل الكارت الفاتح كان بيخلّي الكلام غامق على غامق
            sp["style"] = "dark"
        specs.append(sp)
        log.append({**entry, "decision": sp["mode"], "kind": sp["kind"], "why": sp["why"], "mode_why": sp["mode_why"], "start": sp["start"], "end": sp["end"]})
        last_end = sp["end"]
        if sp["mode"] in ("explainer", "pip"):
            last_explainer = sp["start"]
    rendered = motion.render(specs, W, H, fps, vd / "gfx", prm["mood"]) if specs else []
    # الفحوصات: الوش، الترجمة، التوقيت، الحركة، الربط بالكلام
    checks = []
    for g, it in ((g, next(i for i in its if i["id"] == g["idea"])) for g in rendered):
        faces = _faces_during(samples, inp["segments"], g["start"], g["end"])
        if g["mode"] == "overlay":
            gr = {"left": g["x"] / W, "right": (g["x"] + g["w"]) / W, "top": g["y"] / H, "bottom": (g["y"] + g["h"]) / H}
            face_hit = _hits_face(faces, gr) and not (g.get("kind") == "annotate" and g.get("annotation") == "circle_me")
            sub_hit = any(r["start"] < g["end"] and g["start"] < r["end"] and graphics.rects_overlap(
                {"x": r["left"], "y": r["top"], "w": r["right"] - r["left"], "h": r["bottom"] - r["top"]},
                {"x": gr["left"], "y": gr["top"], "w": gr["right"] - gr["left"], "h": gr["bottom"] - gr["top"]}) for r in subs_rects)
        else:   # explainer/split/inset: الوش بيتنقل (inset/split) أو بيتخبى بمزج (explainer)؛ الجرافيك بعيد عن منطقة الترجمة
            face_hit, sub_hit = False, False
        # أقرب نطق للكلمة لبداية الجرافيك (الكلمة ممكن تتقال أكتر من مرة في نفس الفكرة: «مبسوط» في 0.13 و 1.95)
        first = min((w for c in it["cues"] for w in c["words"] if w["word"] == g["first_word"]), key=lambda w: abs(w["start"] - g["start"]), default=None)
        lag_ms = round((g["start"] - first["start"]) * 1000) if first else None
        spoken = {cuts.norm(w["word"]) for c in it["cues"] for w in c["words"]}
        shown = [cuts.norm(x) for x in (g.get("title") or "").split()] + [cuts.norm(y) for x in g.get("items") or [] for y in (x["label"] if isinstance(x, dict) else x).split()]
        maps = all(x in spoken for x in shown if x) and bool(shown or g["kind"] in ("counter", "sticker", "clock", "doodle", "annotate", "visual", "photo"))
        checks.append({"id": f"g{len(checks) + 1}", "kind": g["kind"], "mode": g["mode"], "face_overlap": face_hit, "subtitle_overlap": sub_hit,
                       "start_lag_ms": lag_ms, "maps_to_speech": maps, "motion": True})
    for g in rendered:
        g["dir"] = str(Path(g["dir"]).relative_to(ctx["d"]))
        if g.get("mask"):
            g["mask"] = str(Path(g["mask"]).relative_to(ctx["d"]))
    cc = {"graphics": len(rendered), "ideas": len(its), "face_overlaps": sum(c["face_overlap"] for c in checks), "subtitle_overlaps": sum(c["subtitle_overlap"] for c in checks),
          "max_start_lag_ms": max([abs(c["start_lag_ms"]) for c in checks if c["start_lag_ms"] is not None] or [0]), "maps_to_speech": sum(c["maps_to_speech"] for c in checks),
          "modes": {m: sum(g["mode"] == m for g in rendered) for m in ("overlay", "cutaway", "pip", "explainer", "split", "inset")},
          "styles": [g.get("style") for g in rendered]}
    data = {**{k: v for k, v in inp.items() if k not in ("cards", "ideas", "cards_check", "card_zone", "gfx", "gfx_log", "gfx_check")},
            "cards": [], "gfx": rendered, "gfx_log": log, "gfx_check": {**cc, "items": checks}, "mood": prm["mood"],
            "director": {"topic_en": dplan.get("topic_en"), "error": dplan.get("error"), "items": len(dplan.get("items") or []), "outline": dplan.get("outline"),
                         "rejected": [{"cue": r.get("cue"), "template": r.get("template"), "why": r.get("reject")} for r in dplan.get("rejected") or []]}}
    credits = sorted({"Animated emoji by Google (CC BY 4.0)" for g in rendered if g.get("kind") == "sticker"} |
                     {"صورة: " + g["photo_credit"] for g in rendered if g.get("photo_credit")})
    ol = dplan.get("outline") or {}
    understand = ([f"فهم المحتوى: {ol.get('topic', '')} — {ol.get('summary', '')}"] + [f"  قسم {x['from_cue']}→{x['to_cue']}: {x['title']} ({x['purpose']})" for x in ol.get("sections") or []]
                  if ol.get("topic") else []) + ([f"⚠ مخرج الجرافيك فشل ({dplan['error']}): من غير جرافيك"] if dplan.get("error") else [])
    data["credits"] = credits
    report = understand + ([f"⚠ اكتب في وصف الفيديو (شرط الرخصة): {' · '.join(credits)}"] if credits else []) + [f"{len(rendered)} جرافيك لـ {len(its)} فكرة · الأنواع: " + "، ".join(f"{g['kind']}" for g in rendered) + f" · طرق العرض: {cc['modes']}",
              f"فوق الوش: {cc['face_overlaps']} · فوق الترجمة: {cc['subtitle_overlaps']} · أكبر فرق بين بداية الجرافيك وأول كلمة: {cc['max_start_lag_ms']} مللي · مربوط بالكلام: {cc['maps_to_speech']}/{len(rendered)}"]
    for e in log:
        report.append(f"{e['idea']} ({e['start']:.2f}–{e['end']:.2f}) «{e['text'][:40]}»: " + (f"اتشال ← {e['why']}" if e["decision"] == "skip" else
                      f"{e['kind']} · {e['decision']} ← النوع: {e['why']} · العرض: {e['mode_why']} · {e['start']:.2f}–{e['end']:.2f} ث"))
    stills = []
    for k, g in enumerate(rendered[:4]):
        t = g["start"] + min(2.0, (g["end"] - g["start"]) * 0.6)
        stills.append(_gfx_still(ctx, inp, g, t, vd / f"gfx_{k + 1}.jpg"))
    return data, report, stills


def _director_specs(dplan, its, inp, prm, samples, speaker, W, H, removed):
    """خطة المخرج ← مواصفات بالتوقيت والمكان. كله صور وحركة من غير كلام (الكلام في الترجمة):
    إيموجي ورسمة الماركر جنب الوش في الناحية الفاضية، والشخبطة حوالين المتكلم (سهم بيشاور عليه، دايرة حوالين راسه…)، والرقم فوق.
    جرافيك واحد في نفس الوقت (0.4 ث بين كل اتنين)، والناحية بتتبادل علشان ما يبقاش كله في نفس الحتة."""
    specs, log, used = [], [], set()
    items = dplan["items"]
    side_pref = "right"
    for n, it in enumerate(items):
        idea = next((i for i in its if any(abs(c["start"] - inp["cues"][it["cue_i"]]["start"]) < 1e-6 for c in i["cues"])), its[-1] if its else None)
        entry = {"idea": idea["id"] if idea else "-", "text": inp["cues"][it["cue_i"]]["text"][:60], "start": it["at"], "end": it["cue_end"]}
        start = round(it["at"], 3)
        if specs and start < specs[-1]["end"] + 0.4:
            log.append({**entry, "decision": "skip", "why": "الجرافيك اللي قبله لسه على الشاشة (واحد بس في نفس الوقت)"}); continue
        sp = director.to_spec(it, used, (dplan.get("topic_en") or "").split())
        if not sp:
            log.append({**entry, "decision": "skip", "why": f"مفيش شكل على قد «{' '.join(it.get('visual_en') or [])}» ولا اترسم"}); continue
        nxt = items[n + 1]["at"] - 0.4 if n + 1 < len(items) else inp["total"] - 0.05
        end = round(min(start + director.duration(it), max(start + 1.3, nxt), inp["total"] - 0.05), 3)
        if end - start < 1.1:
            log.append({**entry, "decision": "skip", "why": "مفيش وقت كفاية يتشاف"}); continue
        sp.update(start=start, end=end, idea=entry["idea"], mode="overlay", style="marker", enter="pop")
        fb = _speaker_box(samples, inp["segments"], start, end) if samples else None
        kind = sp["kind"]
        if kind == "photo":   # الصورة: لقطة قطع بملو الكادر (B-roll) ~2 ث، مش كارت صغير في ركن (المساحة جنب المتكلم ضيقة)
            sp["end"] = end = round(min(end, start + 2.2), 3)
            sp.update(mode="cutaway", side=side_pref, mode_why="لقطة قطع بملو الكادر (B-roll) وصوتك والترجمة مكمّلين")
            side_pref = "left" if side_pref == "right" else "right"
            specs.append(sp)
            log.append({**entry, "decision": "cutaway", "kind": kind, "why": sp["why"] + f" · الصورة: {sp.get('visual_name') or ''}", "mode_why": sp["mode_why"], "start": start, "end": end})
            continue
        # المكان: المساحة الفاضية بقناع الشخص (الجسم كله + الوش) طول وقت الجرافيك، قريب من ارتفاع الراس، والناحية بتتبادل.
        # ليه: قبل كده كان جنب صندوق الوش بس، فأحيانًا كان بيقع على الشعر/الكتف (ذوق صاحب الفيديو: عمره ما يكون على الوش أو الجسم)
        win = [x for t in np.linspace(start, end, 10) for x in vision.window(samples, out_to_src(inp["segments"], float(t))[1], out_to_src(inp["segments"], float(t))[1])]
        occ = vision.occupancy(win)
        prefer_y = ((fb[1] + fb[3]) / 2) if fb else None
        rect = motion.place(kind if kind in motion.SIZES else "visual", occ, inp["aspect"], prefer_y=prefer_y, prefer_side=side_pref, scale=float(prm.get("size", 1.0)))
        if rect is None:
            log.append({**entry, "decision": "skip", "why": "مفيش مساحة فاضية من غير ما يغطيك"}); continue
        side = "right" if (rect["left"] + rect["right"]) / 2 > 0.5 else "left"
        sp["rect"], sp["side"], sp["mode_why"] = rect, side, f"في المساحة الفاضية ({'يمين' if side == 'right' else 'شمال'}) من غير ما يلمس جسمك · تداخل {rect['overlap']:.1%}"
        if fb:
            sp["face"] = [round((fb[0] - rect["left"]) / (rect["right"] - rect["left"]), 3), round((fb[1] - rect["top"]) / (rect["bottom"] - rect["top"]), 3),
                          round((fb[2] - rect["left"]) / (rect["right"] - rect["left"]), 3), round((fb[3] - rect["top"]) / (rect["bottom"] - rect["top"]), 3)]
        side_pref = "left" if side == "right" else "right"
        specs.append(sp)
        log.append({**entry, "decision": sp["mode"], "kind": kind + (f":{sp.get('annotation')}" if kind == "annotate" else ""),
                    "why": sp["why"] + (f" · الشكل: {sp.get('visual_name') or sp.get('emoji_file') or ''}" + (" (مرسوم)" if sp.get("drawn") else "")),
                    "mode_why": sp["mode_why"], "start": start, "end": end})
    return specs, log


def _gfx_still(ctx, inp, g, t, out) -> dict:
    """فريم من الإخراج فيه الجرافيك (بنفس طريقة العرض) والترجمة، من غير رندر الفيديو كله."""
    fps = inp["fps"]
    W, H = exporter.size(inp["aspect"])
    srcs = sources_map(ctx, inp)
    sid, ts = out_to_src(inp["segments"], t)
    src = srcs[sid]
    fi = min(g["frames"], max(1, int((t - g["start"]) * fps) + 1))
    png = ctx["d"] / g["dir"] / f"f_{fi:05d}.png"
    args = ["ffmpeg", "-v", "error", "-y", "-ss", f"{ts:.3f}", "-i", str(src["path"]), "-i", str(png)]
    ch = [f"[0:v]{exporter.fit_chain(src, W, H)},setsar=1[b]"]
    cur = "b"
    if g["mode"] in ("split", "inset", "pip"):
        cx0, cy0, cw, chh = g["crop"]; tx, ty, tw, th = g["target"]
        if g["mode"] == "pip":
            args += ["-i", str(ctx["d"] / g["mask"]) if not Path(g["mask"]).is_absolute() else g["mask"]]
            ch += [f"[{cur}]split[m][c]", f"[c]crop={cw}:{chh}:{cx0}:{cy0},scale={tw}:{th},format=rgba[sq]", f"[2:v]format=gray,scale={tw}:{th}[mk]",
                   "[sq][mk]alphamerge[s]", f"[m][1:v]overlay={g['x']}:{g['y']}[o1]", f"[o1][s]overlay={tx}:{ty}[o2]"]
        else:
            ch += [f"[{cur}]split[m][c]", f"[c]crop={cw}:{chh}:{cx0}:{cy0},scale={tw}:{th}[s]", f"[m][1:v]overlay={g['x']}:{g['y']}[o1]", f"[o1][s]overlay={tx}:{ty}[o2]"]
        cur = "o2"
    else:
        ch.append(f"[{cur}][1:v]overlay={g['x']}:{g['y']}[o1]"); cur = "o1"
    subs = [o for o in inp.get("subs", []) if o["start"] <= t < o["end"]]
    base_i = 3 if g["mode"] == "pip" else 2
    for k, o in enumerate(subs):
        args += ["-i", str(ctx["d"] / o["png"])]
        ch.append(f"[{cur}][{k + base_i}:v]overlay={o['x']}:{o['y']}[s{k}]"); cur = f"s{k}"
    ch.append(f"[{cur}]scale=540:-2[out]")
    exporter._run(args + ["-filter_complex", ";".join(ch), "-map", "[out]", "-frames:v", "1", "-q:v", "3", str(out)], "صورة جرافيك")
    return {"file": out.name, "label": f"{g['kind']} · {g['mode']} ({t:.2f} ث)"}


# ---------- S6: الصوت ----------
def run_s6(ctx):
    inp, prm, vd = ctx["inp"]["data"], ctx["params"], ctx["vd"]
    s1, srcs = s1_of(ctx), sources_map(ctx)
    music_sid = None
    if prm["music"] == "auto":
        music_sid = next((s["id"] for s in ctx["m"]["sources"] if role(ctx["m"], s1, s["id"]) == "music"), None)
    elif prm["music"] not in (None, "none"):
        music_sid = prm["music"]
    music = {"path": srcs[music_sid]["path"], "gain_db": prm["music_gain_db"]} if music_sid else None
    mains = [s for s in _main_sources(ctx, s1) if s["probe"]["has_audio"]]
    nf = min([s1["sources"][s["id"]].get("noise_floor_db") or -70 for s in mains] or [-70])
    L0 = min([(s1["sources"][s["id"]].get("loudness") or {}).get("integrated_lufs") or -23 for s in mains] or [-23])
    pre = round(max(0.0, min(24.0, -20.0 - L0)), 1)     # الكلام الواطي قوي (موبايل بعيد): نقرّبه لـ −20 قبل التنضيف والضغط
    clean = ["highpass=f=80"]
    dn = prm.get("denoise", "auto")
    if dn == "strong" or (dn == "auto" and nf + pre > -62):
        clean.append(f"afftdn=nr={20 if dn == 'strong' else 14}:nf={max(-80, min(-30, round(nf + pre + 2)))}:tn=1")
    sil = [s1["sources"][s["id"]].get("silence") for s in mains if s1["sources"][s["id"]].get("silence")]
    if sil and prm.get("denoise", "auto") != "off":   # بوابة خفيفة: الدوشة في السكتات بتوطى ~10 dB، والكلام زي ما هو (مش قطع)
        n0, sp0 = min(x["noise_db"] for x in sil) + pre, max(x["speech_db"] for x in sil) + pre
        gate_db = n0 + 0.35 * (sp0 - n0)
        clean.append(f"agate=threshold={10 ** (gate_db / 20):.5f}:ratio=2:range=0.32:attack=8:release=220:knee=4")
    clean.append("acompressor=threshold=-21dB:ratio=2.5:attack=8:release=160:makeup=1")
    raw, stem = vd / "mix_raw.wav", (vd / "music_ducked.wav" if music else None)
    exporter.render_audio(inp["segments"], inp["transitions"], srcs, raw, fps=inp["fps"], cleanup=",".join(clean), music=music,
                          duck=bool(prm["duck"]), music_stem=stem, pre_gain_db=pre, duck_release=int(prm.get("duck_release", 350)))
    # مؤثرات الصوت (whoosh مع السحبة والزووم، flash مع الفلاش، pop خفيف مع دخول الجرافيك): بيعملها التطبيق، وبتتقفل بـ «من غير مؤثرات»
    events = exporter.sfx_events(inp["transitions"], inp.get("gfx", [])) if prm.get("sfx", "on") == "on" else []
    ov = prm.get("sfx_overrides") or {}   # اختيارك لكل مؤثر من الاستوديو: صوت تاني من المكتبة، أو شيله
    for k, e in enumerate(events):
        o = ov.get(str(k)) or {}
        if o.get("off"):
            e["off"] = True
        if o.get("sfx"):
            e["sfx"] = o["sfx"]
        if o.get("file"):
            e["pick"] = o["file"]
    all_events = events   # كلهم (حتى اللي اتشال) علشان الاستوديو يعرضهم بنفس الترتيب
    events = [e for e in events if not e.get("off")]
    for e in events:   # علو المؤثرات من الاستوديو (1 = الافتراضي)
        e["gain"] = e.get("gain", 0.1) * float(prm.get("sfx_volume", 1.0))
    if events:
        exporter.sfx_track(events, inp["total"], vd / "sfx.wav")
        exporter.mix_sfx(raw, vd / "sfx.wav", vd / "mix_sfx.wav")
        raw.unlink(missing_ok=True)
        raw = vd / "mix_sfx.wav"
    norm = exporter.normalize(raw, vd / "audio.wav", float(prm["target_lufs"]), float(prm["true_peak"]))
    raw.unlink(missing_ok=True)
    # الدوشة في نفس السكتات اللي فضلت في الإخراج: المصدر (بنفس الكسب) مقابل بعد التنضيف والعلو
    quiet_src, quiet_out, acc = {}, [], 0.0
    for g in inp["segments"]:
        for p_ in s1["sources"].get(g["source"], {}).get("pauses") or []:
            a, b = max(p_["start"], g["start"]), min(p_["end"], g["end"])
            if b - a >= 0.25:
                quiet_src.setdefault(g["source"], []).append({"start": a, "end": b})
                quiet_out.append({"start": acc + a - g["start"], "end": acc + b - g["start"]})
        acc += g["end"] - g["start"]
    after_nf = speech.noise_floor(vd / "audio.wav", quiet_out)
    src_nf = [speech.noise_floor(srcs[k]["path"], v) for k, v in quiet_src.items()]
    nf_kept = round(min(x for x in src_nf if x is not None), 1) if any(x is not None for x in src_nf) else nf
    jumps = speech.cut_jumps(vd / "audio.wav", [t["t"] for t in inp["transitions"]])
    audio = {"file": "audio.wav", "target_lufs": float(prm["target_lufs"]), "true_peak": float(prm["true_peak"]), "before": norm["before"], "after": norm["after"],
             "source_lufs": L0, "pre_gain_db": pre, "cleanup": clean, "noise_floor_source_db": nf_kept, "noise_floor_if_only_gain_db": round(nf_kept + float(prm["target_lufs"]) - L0, 1), "noise_floor_after_db": after_nf,
             "music": music_sid, "duck": bool(prm["duck"]) if music else None, "crossfades": len(inp["transitions"]),
             "crossfade_ms": [t["audio_ms"] for t in inp["transitions"]], "cut_jumps": jumps, "sfx": all_events}
    report = [f"علو الصوت: المصدر {L0} LUFS ← بعد {norm['after']['integrated_lufs']} LUFS (الهدف {prm['target_lufs']}) · Peak {norm['after']['true_peak_dbtp']} dBTP",
              f"crossfade {', '.join(sorted({str(x) for x in audio['crossfade_ms']})) or '—'} مللي في كل قصّة ({audio['crossfades']} قصّة) · أكبر نطّة علو حوالين قصّة: "
              f"{max([j['jump_db'] for j in jumps] or [0]):.1f} dB",
              f"تنضيف: {' ← '.join(clean)} · كسب قبل التنضيف +{pre:.1f} dB",
              f"الدوشة في السكتات اللي فضلت: المصدر {nf_kept} dB · لو علّينا الصوت لـ {norm['after']['integrated_lufs']} LUFS من غير تنضيف كانت هتبقى "
              f"{round(nf_kept + float(prm['target_lufs']) - L0, 1)} dB ← بعد التنضيف {after_nf} dB"]
    report.append(f"مؤثرات صوت: {len(events)} (" + ", ".join(f"{e['sfx']} {e['t']:.2f}" for e in events) + ")" if events else "من غير مؤثرات صوت")
    if music:
        env = speech.envelope(stem)
        mask = np.zeros(len(env), dtype=bool)
        for c in inp.get("cues", []):
            mask[int(c["start"] / speech.HOP):int(c["end"] / speech.HOP)] = True
        under, free = env[mask], env[~mask]
        if len(under) and len(free):
            audio["duck_db"] = round(float(np.median(free) - np.median(under)), 1)
        report.append(f"مزيكا: {music_sid} على {prm['music_gain_db']} dB" + (f" · بتوطى {audio.get('duck_db')} dB وقت الكلام" if prm["duck"] else " · من غير توطية"))
    else:
        report.append("مفيش تراك مزيكا (ارفع ملف صوت ودوره «مزيكا» لو عايز)")
    return {**{k: v for k, v in inp.items() if k != "audio"}, "audio": audio}, report, []


# ---------- S7: المعاينة الكاملة ----------
def run_s7(ctx):
    inp, prm, vd = ctx["inp"], ctx["params"], ctx["vd"]
    d = inp["data"]
    srcs = sources_map(ctx)
    W, H = exporter.size(d["aspect"])
    audio = vdir(ctx["mid"], "s6_audio", inp["version"]) / d["audio"]["file"]
    srcs = sources_map(ctx, d)
    track = ctx["d"] / d["subs_track"] if d.get("subs_track") else None
    subs = [] if track else [{**o, "png": str(ctx["d"] / o["png"])} for o in d.get("subs", [])]
    cards = [{**c, "png": str(ctx["d"] / c["png"])} for c in d.get("cards", [])]
    gfx = [{**g, "dir": str(ctx["d"] / g["dir"]), **({"mask": str(ctx["d"] / g["mask"])} if g.get("mask") else {})} for g in d.get("gfx", [])]
    out = vd / "preview.mp4"
    framing = _framing(ctx, d)
    t0 = time.time()
    rv = exporter.render_video(d["segments"], d["transitions"], srcs, d["aspect"], out, fps=d["fps"], fps_method=d["fps_plan"]["method"],
                               look_vf=d["look"]["vf"], crop_x=d["look"].get("crop_x", 0.5), audio_file=audio, subs=subs, cards=cards,
                               card_rise=graphics.RISE, enter=graphics.ENTER, exit_=graphics.EXIT, crf=int(prm["crf"]), preset=prm["preset"],
                               gfx=gfx, subs_track=track, framing=framing)
    render_s = round(time.time() - t0, 1)
    info = media.probe(out)
    L = media.loudness(out) or {}
    fc = look.frame_check(out, [t["t"] for t in d["transitions"]], [(g["start"], g["end"]) for g in d.get("gfx", []) if g["mode"] != "overlay"])
    fc["source_static"] = look.source_dupes(d["segments"], srcs, d["fps"], d["fps_plan"]["method"])
    fc["subtitle_lag"] = look.subtitle_lag(out, d.get("cues", []), d.get("subs", []), d["fps"])
    data = {"aspect": d["aspect"], "fps": d["fps"], "frames": rv["frames"], "probe": info, "loudness": L, "expected_duration": d["total"],
            "frame_check": fc, "render_seconds": render_s, "from": {"stage": "s6_audio", "version": inp["version"]}}
    total = info["duration"]
    stills = [_frame(out, 0.4, vd / "f_start.jpg", "البداية"), _frame(out, total / 2, vd / "f_mid.jpg", "النص"), _frame(out, total - 0.4, vd / "f_end.jpg", "الآخر")]
    if d.get("cues"):
        c = max(d["cues"], key=lambda x: len(x["text"]))
        o = next(x for x in d["subs"] if x.get("cue", x["id"]) == c["id"])
        stills.append(_frame(out, (c["start"] + c["end"]) / 2, vd / "close_sub.jpg", "كلوز أب: ترجمة", (0, max(0, o["y"] / H - 0.06), 1, min(1, (o["y"] + o["h"]) / H + 0.06))))
    for k, g in enumerate(d.get("gfx", [])[:3]):   # كل جرافيك: فريم في نص وقته (والـ overlay كلوز أب على مكانه)
        t = g["start"] + min(2.0, (g["end"] - g["start"]) * 0.6)
        crop = (0, max(0, g["y"] / H - 0.03), 1, min(1, (g["y"] + g["h"]) / H + 0.03)) if g["mode"] == "overlay" else None
        stills.append(_frame(out, t, vd / f"gfx_{k + 1}.jpg", f"جرافيك {k + 1}: {g['kind']} · {g['mode']} ({t:.2f} ث)", crop))
    report = [f"{info['width']}×{info['height']} · {info['duration']:.2f} ث (المتوقع {d['total']:.2f}) · {d['fps']} فريم/ث ثابت ({rv['frames']} فريم) · رندر {render_s} ث",
              f"علو الصوت في الملف: {L.get('integrated_lufs')} LUFS · Peak {L.get('true_peak_dbtp')} dBTP",
              f"فحص الفريمات: {fc['frames']} فريم · متكررة في الفيديو: {fc['dupes_total']} (ثابتة أصلًا في المصدر: {fc['source_static']}) · عند القصّات (±3 فريم): {fc['dupes_at_cuts']} · "
              f"فريمات رسم ثابت جوه الجرافيك الكامل: {fc.get('graphic_hold_frames', 0)} · "
              f"المعدل ثابت ({fc['avg_fps']} = {fc['r_fps']}): {'✓' if fc['constant'] else '✗'}",
              f"{len(d.get('subs', []))} سطر ترجمة (كلمة كلمة) · {len(d.get('gfx', []))} جرافيك · الانتقالات: " + " · ".join(f"{k} {v}" for k, v in collections.Counter(t['kind'] for t in d['transitions']).items()) + f" · زووم على {sum(f.get('z', 1) > 1.001 for f in framing)} جزء · "
              f"الصورة: {'نسخة متلوّنة لكل لقطة' if d['look'].get('graded') else (d['look']['vf'] or 'من غير فلاتر')}",
              "المعاينة دي هي الملف النهائي نفسه: لو وافقت، التصدير بياخدها زي ما هي"]
    return data, report, stills


def _framing(ctx, d) -> list[dict]:
    """تأطير كل جزء (jump zoom) من خطة الانتقالات، ومركزه على الوش (من عينات الرؤية في مرحلة الصورة).
    الوش بيتحط فوق النص شوية (تكوين صورة الكلام المعتاد). مفيش زووم وقت جرافيك بيقصّ المتكلم (split/inset/explainer)."""
    zs = cuts.segment_zooms(d["transitions"], len(d["segments"]))
    samples = []
    try:
        if d.get("look", {}).get("vision"):
            samples = vision.load_samples(ctx["d"] / d["look"]["vision"])
    except Exception:
        samples = []
    # مفيش زووم وقت جرافيك بيقصّ المتكلم، أو جرافيك مكانه محسوب على الوش (إيموجي/رسمة/شخبطة جنبه): الزووم بيحرّك الوش من مكانه
    busy = [(g["start"], g["end"]) for g in d.get("gfx", []) if g.get("mode") != "overlay" or g.get("kind") in ("sticker", "doodle", "annotate")]
    out, t = [], 0.0
    for seg, z in zip(d["segments"], zs):
        dur = (seg["end"] - seg["start"]) / float(seg.get("speed") or 1.0)
        a, b = t, t + dur
        t = b
        faces = [f for x in vision.window(samples, seg["start"], seg["end"]) for f in x["faces"][:1]] if samples else []
        if z > 1.001 and (not faces or any(a < e and s0 < b for s0, e in busy)):
            out.append({"z": 1.0, "why": "مفيش وش" if not faces else "فيه جرافيك بيقصّ المتكلم في الوقت ده"})
            continue
        if faces:
            cx = float(np.median([(f[0] + f[2]) / 2 for f in faces]))
            fy = float(np.median([(f[1] + f[3]) / 2 for f in faces]))
            out.append({"z": z, "cx": round(cx, 3), "cy": round(min(0.6, fy + 0.5 / z - 0.38 / z), 3)})
        else:
            out.append({"z": 1.0})
    return out


def _frame(video: Path, t: float, out: Path, label: str, crop=None) -> dict:
    graphics.still(video, max(0.0, t), out, crop, width=720 if crop else 540)
    return {"file": out.name, "label": label}


RUN = {"s1_analyze": run_s1, "s2_cut": run_s2, "s3_look": run_s3, "s4_subs": run_s4, "s5_graphics": run_s5, "s6_audio": run_s6, "s7_preview": run_s7}
FINALIZE = {"s2_cut": finalize_s2, "s4_subs": _finish_s4}
