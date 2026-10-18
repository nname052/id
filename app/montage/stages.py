"""مراحل المونتاج الأوتوماتيك: زرار «اعمل المونتاج» بيشغّل كل المراحل ورا بعض ويطلّع معاينة كاملة للفيديو النهائي.
المراجعة مرحلة بمرحلة فاضلة زي ما هي (طبقة تحكّم بعد المعاينة): كل مرحلة ليها نسخ، وإعادة، ورجوع، وتعديل بالكلام (diff ← تطبيق).

S1 التحليل ← S2 القصّ والإيقاع ← S3 الصورة ← S4 الترجمة ← S5 الموشن جرافيك ← S6 الصوت ← S7 المعاينة الكاملة.

- كل مرحلة بتكتب نسخة جديدة في work/stages/<stage>/vN/ (stage.json + صور/فيديو) وعمرها ما بتتكتب عليها تاني.
- كل نسخة فاكرة اتعملت من أنهي نسخة من المرحلة اللي قبلها (input) ومن أنهي حاجات في طلبك (brief).
  لو حاجة منهم اتغيّرت، المرحلة بتبقى «قديمة» (stale) من غير ما تتمسح.
- تعديل مرحلة (بالكلام/يدوي) ← نسخة جديدة منها بس، وبعدين المراحل اللي بعدها بس بتتعاد لوحدها، والمعاينة الكاملة بتتبني تاني.
- التصدير مقفول لحد ما توافق على آخر معاينة كاملة (S7).
"""

import json
import os
import shutil
import threading
import time
import traceback
from pathlib import Path

import numpy as np

from ..store import write_json
from . import brief as briefs
from . import cuts, graphics, look, media, speech, state
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
    "s4_subs": {"max_chars": 30, "min_dur": 1.2, "max_dur": 5.0, "size": "medium", "color": "white", "panel": True, "pos": "bottom", "fixes": {}},
    "s5_graphics": {"graphics": "on", "mood": "clean", "density": "normal", "removed": []},
    "s6_audio": {"target_lufs": -14.0, "true_peak": -1.5, "music": "auto", "music_gain_db": -16.0, "duck": True, "denoise": "auto"},
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
        final = {"url": _url(m["id"], "s7_preview", s7["current"], "preview.mp4") + f"?v={s7['current']}", "version": s7["current"],
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
    err = None
    for k in keys:
        state.update(mid, lambda mm: (mm["auto"].update(stage=k), record(mm, k).update(job="running", error=None)))
        _active.add((mid, k))
        try:
            ok = _run_job(mid, k, None, "auto", origin_note, None, None)
        finally:
            _active.discard((mid, k))
        if not ok:
            err = f"«{LABELS[k]}» فشلت: " + (record(state.load(mid), k).get("error") or "")
            break
    state.update(mid, lambda mm: mm["auto"].update(running=False, stage=None, finished=time.time(), seconds=round(time.time() - t0, 1), error=err))


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


def approve(mid: str, key: str) -> dict:
    m = state.load(mid)
    st = status(m, key)
    if st in ("empty", "stale"):
        raise Blocked("مفيش نسخة حديثة توافق عليها" if st == "empty" else "النسخة دي قديمة: دوس «اعمل المونتاج» علشان تتحدّث الأول")
    return state.update(mid, lambda mm: record(mm, key).update(approved=record(mm, key)["current"]))


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
def sources_map(ctx) -> dict:
    return {s["id"]: {"path": ctx["d"] / s["work"], **s["probe"]} for s in ctx["m"]["sources"]}


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
        ws = [dict(w, src_i=i) for i, w in enumerate(v.get("words") or [])]
        for w in ws:
            f = (fixes or {}).get(f"{sid}:{w['src_i']}")
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
           crop: tuple | None = None, aspect: str = "9:16", crop_x: float = 0.5) -> dict:
    """صورة من الإخراج في وقت معيّن (من المصدر + الإطار + الفلاتر + اللي فوقه) للتقرير، من غير رندر الفيديو كله."""
    srcs = sources_map(ctx)
    sid, ts = out_to_src(segments, t_out)
    src = srcs[sid]
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
            P = speech.pauses(path, dur, thr)
            info.update(pauses=P, silence=sil, silence_db=thr)
            t, err = None, None
            try:
                t = speech.transcribe(path, prm["language"])
            except Exception as e:  # noqa: BLE001
                err = str(e)[:200]
            if t and t["words"] and t["mean_prob"] >= speech.MIN_CONF:
                words = cuts.refine_words(t["words"], P)
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
            line += (f" · {len(units)} جملة · {len(P)} سكتة (حد السكوت {thr} dB: الدوشة {sil['noise_db']}، الكلام {sil['speech_db']})"
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
    data["cut_report"] = cuts.cut_report(data["segments"], words_by_source(s1), envs, thr)
    scene_cuts = {sid: [x["start"] for x in v["scenes"][1:]] for sid, v in s1["sources"].items()}
    hard = prm.get("transitions") == "hard"
    data["transitions"] = cuts.plan_transitions(data["segments"], scene_cuts, "fast" if hard else "normal", data["fps"],
                                                int(prm.get("dissolve_frames") or 0) or None, int(prm.get("audio_xfade_ms", 60)))
    if hard and ctx["brief"]["pace"] != "fast":
        for t in data["transitions"]:
            if t["kind"] == "hard" and "لقطة" not in t["reason"]:
                t["reason"] = "طلبك: قطع صريح (jump cut)"
    tr, cr = data["transitions"], data["cut_report"]
    levels = [c["level_db"] for c in cr["list"] if c["level_db"] is not None]
    df = next((t["frames"] for t in tr if t["frames"]), int(prm.get("dissolve_frames") or 0) or (12 if data["fps"] >= 50 else 10))
    lines = [f"{len(data['segments'])} جزء · المدة {data['total']:.2f} ث · {data['fps']} فريم/ث ثابت",
             f"{cr['cuts']} قصّة · جوه كلمة: {cr['inside_word']} · أعلى صوت عند قصّة: {max(levels) if levels else '—'} dB (حد السكوت {thr} dB) · فوق الحد: {cr['above_silence']}",
             f"الانتقالات: {sum(t['kind'] == 'dissolve' for t in tr)} مزج ({df} فريم = {df / data['fps']:.2f} ث) · {sum(t['kind'] == 'hard' for t in tr)} قطع صريح"
             f" · crossfade صوت {prm.get('audio_xfade_ms', 60)} مللي في كل قصّة ({len(tr)})"]
    return data, lines, []


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
def _sample_times(segments: list[dict], n: int = 8) -> list[float]:
    total = sum(s["end"] - s["start"] for s in segments)
    return [round(total * (k + 0.5) / n, 3) for k in range(n)]


def run_s3(ctx):
    inp, prm = ctx["inp"]["data"], ctx["params"]
    s1, srcs = s1_of(ctx), sources_map(ctx)
    W, H = exporter.size(inp["aspect"])
    mv = main_video(ctx, s1)
    pts = [ts for sid, ts in (out_to_src(inp["segments"], t) for t in _sample_times(inp["segments"])) if sid == mv["id"]]
    fit = exporter.fit_chain(srcs[mv["id"]], W, H)
    before = look.measure(look.frames(srcs[mv["id"]]["path"], pts, fit))
    strength = {k: prm.get(k) for k in ("brightness", "saturation", "sharpen", "denoise")}
    tries = []
    for soften in (1.0, 0.6, 0.3, 0.0):   # لو التصحيح حرق الفاتح أو طفّى الغامق: نفس التصحيح أخف، لحد ما يبقى آمن
        pl = look.plan(before, prm.get("look", "natural"), strength, soften)
        after = look.measure(look.frames(srcs[mv["id"]]["path"], pts, ",".join(x for x in [fit, pl["vf"]] if x)))
        chk = look.check(before, after)
        tries.append({"soften": soften, "clipped_pct": after["clipped_pct"], "crushed_pct": after["crushed_pct"], "ok": chk["no_new_clipping"] and chk["no_new_crush"]})
        if tries[-1]["ok"]:
            break
    if len(tries) > 1:
        pl["why"].append("التصحيح الكامل كان هيحرق/يطفّي: " + " ← ".join(f"قوة {t['soften']:.0%}: محروق {t['clipped_pct']:.2f}% مطفي {t['crushed_pct']:.2f}%" for t in tries))
    data = {**inp, "look": {"name": pl["look"], "vf": pl["vf"], "steps": pl["steps"], "why": pl["why"], "before": before, "after": after, "check": chk,
                            "crop_x": 0.5, "measured_on": len(pts), "tries": tries}}
    mid_t = _sample_times(inp["segments"], 3)[1]
    stills = [_still(ctx, inp["segments"], mid_t, "before.jpg", "قبل", aspect=inp["aspect"]),
              _still(ctx, inp["segments"], mid_t, "after.jpg", "بعد", pl["vf"], aspect=inp["aspect"])]
    f = lambda k, d=1: f"{before[k]:.{d}f} ← {after[k]:.{d}f}"  # noqa: E731
    report = [f"اتقاس على {len(pts)} فريم من الإخراج نفسه (بعد القصّ والإطار)",
              f"الإضاءة {f('brightness')} · التباين {f('contrast')} · الحدة {f('sharpness')} · الدوشة {f('noise', 2)}",
              f"إضاءة محروقة (≥250): {before['clipped_pct']:.2f}% ← {after['clipped_pct']:.2f}% · ضلمة مطفية (≤5): {before['crushed_pct']:.2f}% ← {after['crushed_pct']:.2f}%"
              + (" ✓" if chk["no_new_clipping"] and chk["no_new_crush"] else " ⚠"),
              f"ميل اللون: {before.get('cast_size', 0):.1%} ← {after.get('cast_size', 0):.1%}"] + [f"• {w}" for w in pl["why"]]
    return data, report, stills


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


def _finish_s4(ctx, data):
    prm = ctx["params"]
    W, H = exporter.size(data["aspect"])
    style = {"size": prm["size"], "color": prm["color"], "panel": prm["panel"], "pos": prm["pos"]}
    r = graphics.render(data["cues"], [], data["aspect"], W, H, ctx["vd"] / "subs", style, "clean", graphics.CARD_ZONES[data["aspect"]]["top"])
    subs = [{**o, "png": str(Path(o["png"]).relative_to(ctx["d"]))} for o in r["subs"]]
    durs = [c["end"] - c["start"] for c in data["cues"]]
    safe = cuts.SAFE[data["aspect"]]
    sc = {"cues": len(subs), "inside_bottom_zone": sum(o["inside_bottom_zone"] for o in subs), "min_dur": round(min(durs), 3) if durs else None,
          "max_dur": round(max(durs), 3) if durs else None, "under_min": sum(d < float(prm["min_dur"]) - 0.01 for d in durs),
          "over_max": sum(d > float(prm["max_dur"]) + 0.01 for d in durs), "font_px": r["sub_font_px"], "font_pct_height": round(r["sub_font_px"] / H * 100, 2),
          "zone": safe, "forced_breaks": data["cues"][0].get("forced_breaks", 0) if data["cues"] else 0, "max_lines": max([o["lines"] for o in subs] or [0])}
    data.update(subs=subs, sub_style=style, subs_check=sc)
    report = [f"{sc['cues']} سطر · جوه المنطقة الآمنة تحت: {sc['inside_bottom_zone']}/{sc['cues']} (من {safe['top']:.0%} لـ {safe['bottom']:.0%} من الارتفاع)",
              f"مدة السطر على الشاشة: من {sc['min_dur']} لـ {sc['max_dur']} ث (المسموح {prm['min_dur']}–{prm['max_dur']}) · أقل: {sc['under_min']} · أكتر: {sc['over_max']}",
              f"الخط {sc['font_px']}px = {sc['font_pct_height']}% من ارتفاع الفريم · {'بخلفية غامقة' if prm['panel'] else 'بحد غامق'} · "
              f"السطور بتقف عند السكتات (اتقسم {sc['forced_breaks']} سطر طويل عند أكبر سكتة جواه)",
              f"أكتر سطر: {sc['max_lines']} سطور على الشاشة · سطور صحّحتها بإيدك: {sum(bool(c.get('edited')) for c in data['cues'])}"]
    stills = []
    if data["cues"]:
        c = max(data["cues"], key=lambda x: len(x["text"]))
        o = next(x for x in r["subs"] if x["id"] == c["id"])
        t = (c["start"] + c["end"]) / 2
        stills.append(_still(ctx, data["segments"], t, "sub_frame.jpg", "سطر ترجمة في الفريم", data["look"]["vf"], [o], aspect=data["aspect"]))
        stills.append(_still(ctx, data["segments"], t, "sub_close.jpg", "كلوز أب على الترجمة", data["look"]["vf"], [o],
                             crop=(0.0, max(0.0, o["y"] / H - 0.05), 1.0, min(1.0, (o["y"] + o["h"]) / H + 0.05)), aspect=data["aspect"]))
    return data, report, stills


# ---------- S5: الموشن جرافيك ----------
def run_s5(ctx):
    inp, prm = ctx["inp"]["data"], ctx["params"]
    s1, srcs = s1_of(ctx), sources_map(ctx)
    W, H = exporter.size(inp["aspect"])
    b = {"graphics": prm["graphics"], "density": prm["density"], "focus": prm.get("focus") or [], "pace": prm.get("pace", "normal")}
    removed = {cuts.norm(x) for x in prm.get("removed") or []}
    cues = inp["cues"]
    cards, its = graphics.plan(inp["segments"], cues, b, removed)
    mv = main_video(ctx, s1)
    fit = exporter.fit_chain(srcs[mv["id"]], W, H)
    fr = look.frames(srcs[mv["id"]]["path"], [out_to_src(inp["segments"], t)[1] for t in _sample_times(inp["segments"], 6)], fit, width=540)
    zone_name, scores = graphics.choose_zone(inp["aspect"], fr)
    zone = graphics.CARD_ZONES[inp["aspect"]][zone_name]
    busy_skip = scores[zone_name] > graphics.BUSY_MAX and not prm.get("force_cards")
    if busy_skip:   # الصورة نفسها مليانة كتابة/تفاصيل في كل مناطق الكروت: كارت فوقها هيبان زحمة ويغطي حاجة مهمة
        for it in its:
            if it["card"]:
                it["card"], it["why"] = None, f"الصورة نفسها مليانة تفاصيل/كتابة في مناطق الكروت (أهداها {scores[zone_name]} > {graphics.BUSY_MAX}): قول «رجّع الكروت» لو عايزها"
        cards = []
    r = graphics.render([], cards, inp["aspect"], W, H, ctx["vd"] / "cards", inp["sub_style"], prm["mood"], zone)
    subs_abs = [{**o, "png": str(ctx["d"] / o["png"])} for o in inp["subs"]]
    rise = round(graphics.RISE * H)
    overlaps = sum(1 for s in subs_abs for k in r["cards"] if s["start"] < k["end"] and k["start"] < s["end"] and graphics.rects_overlap(s, {**k, "h": k["h"] + rise}))
    at_once = 1 + any(c["start"] < a["end"] for a, c in zip(cards, cards[1:])) if cards else 0
    maps = [graphics.maps_to_speech(c, cues) for c in cards]
    for c, o in zip(cards, r["cards"]):
        c.update(png=str(Path(o["png"]).relative_to(ctx["d"])), x=o["x"], y=o["y"], w=o["w"], h=o["h"])
    cc = {"overlaps": overlaps, "at_once_max": at_once, "maps_to_speech": sum(maps), "cards": len(cards), "ideas": len(its),
          "ideas_with_card": sum(bool(i["card"]) for i in its)}
    data = {**{k: v for k, v in inp.items() if k not in ("cards", "ideas", "cards_check", "card_zone", "mood")}, "cards": cards, "ideas": its,
            "card_zone": {"name": zone_name, **zone, "busyness": scores}, "mood": prm["mood"], "cards_check": cc}
    zname = {"top": "فوق", "middle": "النص", "lower_third": "التلت التحتاني"}[zone_name]
    report = [f"{len(cards)} كارت لـ {len(its)} فكرة · أفكار ليها كارت: {cc['ideas_with_card']}/{cc['ideas']} · مربوط بجملة اتقالت: {cc['maps_to_speech']}/{len(cards)}",
              f"تداخل مع الترجمة: {overlaps} · أكتر عدد كروت على الشاشة مع بعض: {at_once}",
              f"منطقة الكروت: {zname} ({zone['top']:.0%}–{zone['bottom']:.0%} من الارتفاع)، لأنها الأهدى في الصورة (تفاصيل + حركة: "
              + "، ".join(f"{k} {v}" for k, v in scores.items()) + ")",
              f"الستايل: خط Alexandria · ألوان «{prm['mood']}» · دخول طلوع + ظهور {graphics.ENTER} ث · خروج اختفاء {graphics.EXIT} ث"]
    report += [f"{c['id']} ({ {'number': 'رقم', 'term': 'مصطلح', 'claim': 'فكرة'}[c['kind']]}) {c['start']:.2f}–{c['end']:.2f}: «{c['title']}»"
               + (f" — {c['label']}" if c["label"] else "") + f" ← من «{c['source_text']}»" for c in cards]
    report += [f"فكرة {i['id']} من غير كارت: {i['why']} («{i['text'][:40]}»)" for i in its if not i["card"]]
    stills = []
    if cards:
        c = cards[0]
        o = next(x for x in r["cards"] if x["id"] == c["id"])
        t = c["start"] + 1.0
        subs_now = [s for s in subs_abs if s["start"] <= t < s["end"]]
        stills.append(_still(ctx, inp["segments"], t, "card_frame.jpg", "كارت في الفريم (مع الترجمة)", inp["look"]["vf"], [o] + subs_now, aspect=inp["aspect"]))
        stills.append(_still(ctx, inp["segments"], t, "card_close.jpg", "كلوز أب على الكارت", inp["look"]["vf"], [o],
                             crop=(0.0, max(0.0, o["y"] / H - 0.03), 1.0, min(1.0, (o["y"] + o["h"]) / H + 0.03)), aspect=inp["aspect"]))
    return data, report, stills


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
             "crossfade_ms": [t["audio_ms"] for t in inp["transitions"]], "cut_jumps": jumps}
    report = [f"علو الصوت: المصدر {L0} LUFS ← بعد {norm['after']['integrated_lufs']} LUFS (الهدف {prm['target_lufs']}) · Peak {norm['after']['true_peak_dbtp']} dBTP",
              f"crossfade {', '.join(sorted({str(x) for x in audio['crossfade_ms']})) or '—'} مللي في كل قصّة ({audio['crossfades']} قصّة) · أكبر نطّة علو حوالين قصّة: "
              f"{max([j['jump_db'] for j in jumps] or [0]):.1f} dB",
              f"تنضيف: {' ← '.join(clean)} · كسب قبل التنضيف +{pre:.1f} dB",
              f"الدوشة في السكتات اللي فضلت: المصدر {nf_kept} dB · لو علّينا الصوت لـ {norm['after']['integrated_lufs']} LUFS من غير تنضيف كانت هتبقى "
              f"{round(nf_kept + float(prm['target_lufs']) - L0, 1)} dB ← بعد التنضيف {after_nf} dB"]
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
    subs = [{**o, "png": str(ctx["d"] / o["png"])} for o in d.get("subs", [])]
    cards = [{**c, "png": str(ctx["d"] / c["png"])} for c in d.get("cards", [])]
    out = vd / "preview.mp4"
    t0 = time.time()
    rv = exporter.render_video(d["segments"], d["transitions"], srcs, d["aspect"], out, fps=d["fps"], fps_method=d["fps_plan"]["method"],
                               look_vf=d["look"]["vf"], crop_x=d["look"].get("crop_x", 0.5), audio_file=audio, subs=subs, cards=cards,
                               card_rise=graphics.RISE, enter=graphics.ENTER, exit_=graphics.EXIT, crf=int(prm["crf"]), preset=prm["preset"])
    render_s = round(time.time() - t0, 1)
    info = media.probe(out)
    L = media.loudness(out) or {}
    fc = look.frame_check(out, [t["t"] for t in d["transitions"]])
    fc["source_static"] = look.source_dupes(d["segments"], srcs, d["fps"], d["fps_plan"]["method"])   # فريمات ثابتة أصلًا في المصدر (مش من المونتاج)
    data = {"aspect": d["aspect"], "fps": d["fps"], "frames": rv["frames"], "probe": info, "loudness": L, "expected_duration": d["total"],
            "frame_check": fc, "render_seconds": render_s, "from": {"stage": "s6_audio", "version": inp["version"]}}
    total = info["duration"]
    stills = [_frame(out, 0.4, vd / "f_start.jpg", "البداية"), _frame(out, total / 2, vd / "f_mid.jpg", "النص"), _frame(out, total - 0.4, vd / "f_end.jpg", "الآخر")]
    if d.get("cues"):
        c = max(d["cues"], key=lambda x: len(x["text"]))
        o = next(x for x in d["subs"] if x["id"] == c["id"])
        stills.append(_frame(out, (c["start"] + c["end"]) / 2, vd / "close_sub.jpg", "كلوز أب: ترجمة", (0, max(0, o["y"] / H - 0.06), 1, min(1, (o["y"] + o["h"]) / H + 0.06))))
    if d.get("cards"):
        c = d["cards"][0]
        stills.append(_frame(out, c["start"] + 1.0, vd / "close_card.jpg", "كلوز أب: كارت", (0, max(0, c["y"] / H - 0.04), 1, min(1, (c["y"] + c["h"]) / H + 0.06))))
    report = [f"{info['width']}×{info['height']} · {info['duration']:.2f} ث (المتوقع {d['total']:.2f}) · {d['fps']} فريم/ث ثابت ({rv['frames']} فريم) · رندر {render_s} ث",
              f"علو الصوت في الملف: {L.get('integrated_lufs')} LUFS · Peak {L.get('true_peak_dbtp')} dBTP",
              f"فحص الفريمات: {fc['frames']} فريم · متكررة في الفيديو كله: {fc['dupes_total']} (منهم ثابتة أصلًا في المصدر: {fc['source_static']}) · متكررة عند القصّات (±3 فريم): {fc['dupes_at_cuts']} · "
              f"المعدل ثابت ({fc['avg_fps']} = {fc['r_fps']}): {'✓' if fc['constant'] else '✗'}",
              f"{len(d.get('subs', []))} سطر ترجمة · {len(d.get('cards', []))} كارت · {sum(t['kind'] == 'dissolve' for t in d['transitions'])} مزج · فلاتر: {d['look']['vf'] or 'من غير'}",
              "المعاينة دي هي الملف النهائي نفسه: لو وافقت، التصدير بياخدها زي ما هي"]
    return data, report, stills


def _frame(video: Path, t: float, out: Path, label: str, crop=None) -> dict:
    graphics.still(video, max(0.0, t), out, crop, width=720 if crop else 540)
    return {"file": out.name, "label": label}


RUN = {"s1_analyze": run_s1, "s2_cut": run_s2, "s3_look": run_s3, "s4_subs": run_s4, "s5_graphics": run_s5, "s6_audio": run_s6, "s7_preview": run_s7}
FINALIZE = {"s2_cut": finalize_s2, "s4_subs": _finish_s4}
