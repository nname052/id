"""مراحل المونتاج: كل مرحلة بتكتب نسخة جديدة في work/stages/<stage>/vN/ (stage.json + preview.mp4) وعمرها ما بتتكتب عليها تاني.

- الأساسي (4 مراحل): S1 تحليل ← S2 قصّ وترتيب ← S3 صوت ← S4 تصدير.
- المتقدم (7): S1 ← S2a اختيار اللقطات ← S2b قصّ حسب السياق ← S2c إيقاع ← S2d ترجمة ← S3 ← S4.
- كل نسخة فاكرة اتعملت من أنهي نسخة من المرحلة اللي قبلها (input). لو المرحلة اللي قبلها اتغيرت (إعادة/رجوع/تعديل)،
  المراحل اللي بعدها بتتعلّم "قديمة" (stale) من غير ما تتمسح، ومش بتتعاد غير لما تطلب.
- التصدير (S4) مقفول لحد ما توافق على آخر معاينة (S3).
- الحالة في montage.json: mode، و stages[key] = {versions, current, approved, job, error}.
"""

import json
import os
import threading
import time
import traceback
from pathlib import Path

import numpy as np

from ..store import write_json
from . import cuts, media, speech, state, subs
from . import export as exporter

BASIC = ["s1_analyze", "s2_cut", "s3_audio", "s4_export"]
ADVANCED = ["s1_analyze", "s2a_select", "s2b_cuts", "s2c_rhythm", "s2d_subs", "s3_audio", "s4_export"]
LABELS = {"s1_analyze": "S1 · التحليل", "s2_cut": "S2 · القصّ والترتيب", "s2a_select": "S2a · اختيار اللقطات", "s2b_cuts": "S2b · القصّ حسب السياق",
          "s2c_rhythm": "S2c · الإيقاع", "s2d_subs": "S2d · الترجمة", "s3_audio": "S3 · الصوت", "s4_export": "S4 · التصدير"}
DEFAULTS = {
    "s1_analyze": {"language": "ar", "scene_detector": "adaptive", "adaptive_threshold": 3.0, "min_pause": 0.35, "silence_db": -35},
    "s2_cut": {"aspect": "9:16", "max_pause": 0.7},
    "s2a_select": {"aspect": "9:16", "min_shot": 0.5, "black_luma": 18},
    "s2b_cuts": {"max_pause": 0.7},
    "s2c_rhythm": {},
    "s2d_subs": {"max_chars": 32, "max_dur": 2.8},
    "s3_audio": {"target_lufs": -14.0, "true_peak": -1.5, "music": "auto", "music_gain_db": -16.0, "duck": True},
    "s4_export": {},
}
PREVIEW = {"scale": 0.5, "crf": 30, "preset": "veryfast"}
_locks: dict[str, threading.Lock] = {}
_active: set[tuple[str, str]] = set()   # (mid, key) للشغل اللي شغال فعلًا في العملية دي


class Blocked(Exception):
    """العملية مش مسموحة دلوقتي (مرحلة قبلها ناقصة/قديمة، أو التصدير من غير موافقة)."""


# ---------- الحالة ----------
def pipeline(m: dict) -> list[str]:
    return ADVANCED if m.get("mode") == "advanced" else BASIC


def prev_of(m: dict, key: str) -> str | None:
    p = pipeline(m)
    i = p.index(key)
    return p[i - 1] if i else None


def record(m: dict, key: str) -> dict:
    return m.setdefault("stages", {}).setdefault(key, {"versions": [], "current": None, "approved": None, "job": "idle", "error": None})


def vdir(mid: str, key: str, n: int) -> Path:
    return state.mdir(mid) / "work" / "stages" / key / f"v{n}"


def read_stage(mid: str, key: str, n: int) -> dict:
    return json.loads((vdir(mid, key, n) / "stage.json").read_text(encoding="utf-8"))


def _ver(r: dict, n: int | None) -> dict:
    return next((v for v in r["versions"] if v["n"] == n), {})


def status(m: dict, key: str) -> str:
    """empty | stale | ready | approved (بغض النظر عن لو فيه شغل جاري)."""
    r = (m.get("stages") or {}).get(key)
    if not r or r.get("current") is None:
        return "empty"
    cur = _ver(r, r["current"])
    if key == "s1_analyze" and cur.get("sources") != [s["id"] for s in m["sources"]]:
        return "stale"   # اترفع ملف جديد بعد التحليل
    p = prev_of(m, key) if key in pipeline(m) else None
    if p:
        pr = (m.get("stages") or {}).get(p) or {}
        if status(m, p) in ("empty", "stale") or cur.get("input") != {"stage": p, "version": pr.get("current")}:
            return "stale"
    return "approved" if r.get("approved") == r["current"] else "ready"


def fix_orphans(m: dict) -> dict:
    """مرحلة متعلّمة "شغالة" ومفيش شغل وراها (السيرفر اتقفل في النص) ← فشلت، علشان تتعاد."""
    bad = [k for k, r in (m.get("stages") or {}).items() if r.get("job") == "running" and (m["id"], k) not in _active]
    if not bad:
        return m

    def upd(mm):
        for k in bad:
            if (mm["id"], k) not in _active:
                record(mm, k).update(job="failed", error="الشغل اتقطع (السيرفر اتقفل في النص). أعد المرحلة.")
    return state.update(m["id"], upd)


def view(m: dict) -> dict:
    """اللي الصفحة محتاجاه: المراحل بالترتيب بحالتها ونسخها."""
    m = fix_orphans(m)
    out = []
    for key in pipeline(m):
        r = (m.get("stages") or {}).get(key) or {"versions": [], "current": None, "approved": None, "job": "idle", "error": None}
        st = status(m, key)
        cur = None
        if r.get("current") is not None:
            try:
                cur = read_stage(m["id"], key, r["current"])
            except (OSError, ValueError):
                cur = None
        p = prev_of(m, key)
        can_run = p is None or status(m, p) in ("ready", "approved")
        if key == "s4_export":
            can_run = status(m, "s3_audio") == "approved"
        out.append({"key": key, "label": LABELS[key], "status": st, "job": r.get("job", "idle"), "error": r.get("error"),
                    "current": r.get("current"), "approved": r.get("approved"), "versions": r["versions"], "can_run": can_run,
                    "params": (cur or {}).get("params") or DEFAULTS[key], "report": (cur or {}).get("report") or [],
                    "summary": (cur or {}).get("summary"), "seconds": (cur or {}).get("seconds"),
                    "preview": f"/montage-files/{m['id']}/stages/{key}/v{r['current']}/preview.mp4" if cur and (vdir(m["id"], key, r["current"]) / "preview.mp4").exists() else None})
    return {"mode": m.get("mode", "basic"), "stages": out}


# ---------- التشغيل ----------
def check_can_run(m: dict, key: str) -> None:
    if key not in pipeline(m):
        raise Blocked("المرحلة دي مش في الوضع الحالي")
    r = (m.get("stages") or {}).get(key) or {}
    if r.get("job") == "running":
        raise Blocked("المرحلة دي شغالة دلوقتي")
    if key == "s4_export":
        if status(m, "s3_audio") != "approved":
            raise Blocked("التصدير مقفول: لازم توافق على آخر معاينة (S3 · الصوت) الأول")
        return
    p = prev_of(m, key)
    if p and status(m, p) not in ("ready", "approved"):
        raise Blocked(f"شغّل/حدّث «{LABELS[p]}» الأول")
    if any(s.get("analysis_status") == "running" for s in m["sources"]):
        raise Blocked("لسه بنقرا الملفات، استنى ثواني")


def start(mid: str, key: str, params: dict | None = None, origin: str | None = None, note: str | None = None, data_override: dict | None = None,
          base_input: dict | None = None, sync: bool = False) -> None:
    """بيشغّل المرحلة (أو يعيدها) في الخلفية ← نسخة جديدة. data_override = تعديل جاهز (من الكلام/يدوي): بنبني معاينته بس."""
    m = fix_orphans(state.load(mid))
    if data_override is None:
        check_can_run(m, key)
    elif (m.get("stages") or {}).get(key, {}).get("job") == "running":
        raise Blocked("المرحلة دي شغالة دلوقتي")
    _active.add((mid, key))
    state.update(mid, lambda mm: record(mm, key).update(job="running", error=None))
    args = (mid, key, params, origin, note, data_override, base_input)
    if sync:
        _job(*args)
    else:
        threading.Thread(target=_job, args=args, daemon=True).start()


def _job(mid, key, params, origin, note, data_override, base_input):
    try:
        _run_job(mid, key, params, origin, note, data_override, base_input)
    finally:
        _active.discard((mid, key))


def _run_job(mid, key, params, origin, note, data_override, base_input):
    lock = _locks.setdefault(mid, threading.Lock())
    with lock:
        t0 = time.time()
        try:
            m = state.load(mid)
            r = record(m, key)
            n = max([v["n"] for v in r["versions"]] or [0]) + 1
            vd = vdir(mid, key, n)
            vd.mkdir(parents=True, exist_ok=True)
            p = prev_of(m, key)
            inp_ref = base_input if base_input is not None else ({"stage": p, "version": record(m, p)["current"]} if p else None)
            inp = read_stage(mid, p, inp_ref["version"]) if inp_ref else None
            base = read_stage(mid, key, r["current"]) if r.get("current") else None
            prm = {**DEFAULTS[key], **((base or {}).get("params") or {}), **(params or {})}
            ctx = {"m": m, "mid": mid, "d": state.mdir(mid), "key": key, "params": prm, "inp": inp, "vd": vd}
            if data_override is not None:
                data, report = data_override, (data_override.pop("_report", None) or [f"تعديل: {note or ''}"])
                data = finalize(ctx, data)
                build_preview(ctx, data)
            else:
                data, report = RUN[key](ctx)
            summary = summarize(key, data)
            doc = {"stage": key, "version": n, "origin": origin or ("run" if not r["versions"] else "redo"), "note": note,
                   "created": time.time(), "input": inp_ref, "params": prm, "data": data, "report": report, "summary": summary,
                   "preview": "preview.mp4" if (vd / "preview.mp4").exists() else None, "seconds": round(time.time() - t0, 2)}
            if key == "s1_analyze":
                doc["sources"] = [s["id"] for s in m["sources"]]
            write_json(vd / "stage.json", doc)

            def upd(mm):
                rr = record(mm, key)
                meta = {"n": n, "origin": doc["origin"], "created": doc["created"], "input": inp_ref, "note": note, "summary": summary}
                if key == "s1_analyze":
                    meta["sources"] = doc["sources"]
                rr["versions"].append(meta)
                rr.update(current=n, approved=None, job="idle", error=None)
                if key == "s4_export":
                    mm["export"] = {"status": "done", "file": data["file"], "probe": data["probe"], "expected_duration": data["expected_duration"],
                                    "seconds": doc["seconds"], "finished": time.time(), "stage_version": n}
            state.update(mid, upd)
        except Exception as e:  # noqa: BLE001
            traceback.print_exc()
            state.update(mid, lambda mm: record(mm, key).update(job="failed", error=str(e)[:500]))


def approve(mid: str, key: str) -> dict:
    m = state.load(mid)
    st = status(m, key)
    if st in ("empty", "stale"):
        raise Blocked("مفيش نسخة حديثة توافق عليها" if st == "empty" else "النسخة دي قديمة (المرحلة اللي قبلها اتغيرت): أعدها الأول")
    return state.update(mid, lambda mm: record(mm, key).update(approved=record(mm, key)["current"]))


def revert(mid: str, key: str, n: int) -> dict:
    m = state.load(mid)
    r = record(m, key)
    if r.get("job") == "running":
        raise Blocked("المرحلة دي شغالة دلوقتي")
    if not any(v["n"] == n for v in r["versions"]):
        raise Blocked(f"مفيش نسخة v{n}")
    return state.update(mid, lambda mm: record(mm, key).update(current=n, approved=None))


def set_mode(mid: str, mode: str) -> dict:
    if mode not in ("basic", "advanced"):
        raise Blocked("الوضع لازم يبقى basic أو advanced")
    return state.update(mid, lambda mm: mm.update(mode=mode))   # النسخ المتسجّلة بتفضل زي ما هي


# ---------- أدوات ----------
def sources_map(ctx) -> dict:
    return {s["id"]: {"path": ctx["d"] / s["work"], **s["probe"]} for s in ctx["m"]["sources"]}


_env_cache: dict = {}


def env_of(path: Path):
    k = (str(path), path.stat().st_mtime)
    if k not in _env_cache:
        _env_cache[k] = speech.envelope(path)
    return _env_cache[k]


def s1_of(ctx) -> dict:
    """تحليل S1 اللي السلسلة دي مبنية عليه."""
    n = (ctx["inp"] or {}).get("data", {}).get("s1") if ctx["key"] != "s1_analyze" else None
    if n is None and ctx["inp"] and ctx["inp"]["stage"] == "s1_analyze":
        n = ctx["inp"]["version"]
    return read_stage(ctx["mid"], "s1_analyze", n)["data"]


def words_by_source(s1: dict) -> dict:
    return {sid: v.get("words") or [] for sid, v in s1["sources"].items()}


def role(m: dict, s1: dict, sid: str) -> str:
    src = next(s for s in m["sources"] if s["id"] == sid)
    return src.get("role") or s1["sources"][sid].get("role_auto", "main")


def _seg_total(segs):
    return round(sum((float(s["end"]) - float(s["start"])) / float(s.get("speed") or 1.0) for s in segs), 3)


def finalize(ctx, data: dict) -> dict:
    """بعد أي تغيير في الأجزاء: المدة الكلية + تقرير القصّات (هل فيه قصّة جوه كلمة؟)."""
    if "segments" in data:
        s1 = s1_of(ctx)
        for s in data["segments"]:
            s.setdefault("cut_in", {"t": s["start"], "kind": "manual"}); s.setdefault("cut_out", {"t": s["end"], "kind": "manual"})
            s["cut_in"]["t"], s["cut_out"]["t"] = s["start"], s["end"]
        data["total"] = _seg_total(data["segments"])
        envs = {sid: env_of(ctx["d"] / next(x for x in ctx["m"]["sources"] if x["id"] == sid)["work"])
                for sid in {s["source"] for s in data["segments"]} if s1["sources"][sid]["probe"]["has_audio"]}
        data["cut_report"] = cuts.cut_report(data["segments"], words_by_source(s1), envs)
    return data


def summarize(key: str, data: dict) -> dict:
    out = {}
    if "segments" in data:
        out.update(segments=len(data["segments"]), total=data.get("total"))
    if "cut_report" in data:
        cr = data["cut_report"]
        out.update(cuts=cr["cuts"], inside_word=cr["inside_word"], by_kind=cr["by_kind"])
    if "shots" in data:
        out.update(shots=len(data["shots"]), kept_shots=sum(s["keep"] for s in data["shots"]))
    if "cues" in data:
        out.update(cues=len(data["cues"]))
    if "audio" in data:
        out.update(lufs=(data["audio"].get("after") or {}).get("integrated_lufs"), target=data["audio"]["target_lufs"], music=data["audio"].get("music"))
    if key == "s4_export":
        out.update(file=data.get("file"), duration=(data.get("probe") or {}).get("duration"))
    return out


# ---------- المعاينات ----------
def build_preview(ctx, data: dict) -> None:
    key, vd = ctx["key"], ctx["vd"]
    out = vd / "preview.mp4"
    srcs = sources_map(ctx)
    if key == "s1_analyze":
        vids = [s for s in ctx["m"]["sources"] if s["probe"]["has_video"]] or ctx["m"]["sources"]
        segs = [{"source": s["id"], "start": 0.0, "end": s["probe"]["duration"]} for s in vids]
        v0 = vids[0]["probe"]
        aspect = "16:9" if (v0.get("width") or 16) >= (v0.get("height") or 9) else "9:16"
        exporter.render(segs, srcs, aspect, vd, out_path=out, **PREVIEW)
        return
    if key == "s2a_select":
        segs = [{"source": s["source"], "start": s["start"], "end": s["end"]} for s in data["shots"] if s["keep"]]
        exporter.render(segs, srcs, data["aspect"], vd, out_path=out, **PREVIEW)
        return
    overlays = None
    if data.get("cues"):
        W, H = exporter.size(data["aspect"], PREVIEW["scale"])
        ovs = subs.render_cues(data["cues"], data["aspect"], W, H, vd / "subs_preview")
        data["subs_check"] = {"cues": len(ovs), "inside_safe_area": sum(o["inside_safe_area"] for o in ovs), "frame": [W, H]}
        overlays = ovs
    audio = None
    if data.get("audio"):
        audio = vdir(ctx["mid"], "s3_audio", data["audio"]["version"]) / data["audio"]["file"] if data["audio"].get("version") else vd / data["audio"]["file"]
    exporter.render(data["segments"], srcs, data["aspect"], vd, out_path=out, audio_file=audio, overlays=overlays, **PREVIEW)


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
        info["scene_detector"] = prm.get("scene_detector")
        line = f"{s['id']} ({s['name']}): {dur:.2f} ث"
        if pr["has_video"]:
            line += f" · {len(info['scenes'])} لقطة" + (f" (قطع عند {', '.join(f'{c:.2f}' for c in scene_cuts)})" if scene_cuts else "")
        if pr["has_audio"]:
            P = speech.pauses(path, dur, prm["silence_db"])
            info["pauses"] = P
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
            info["speech_segments"] = [{"start": u["start"], "end": u["end"], "text": u["text"]} for u in units]
            wps = len(info["words"]) / max(dur, 0.1)
            info["role_auto"] = "music" if (not pr["has_video"] and (info["speech_mode"] == "pauses" or wps < 0.6)) else "main"
            L = info["loudness"] or {}
            line += f" · {len(info['words'])} كلمة" + (f" (ثقة {t['mean_prob']:.2f}، {t['engine']}، {t['seconds']} ث)" if t else "")
            line += f" · {len(units)} جملة/مقطع كلام · {len(P)} سكتة · علو {L.get('integrated_lufs')} LUFS"
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
    build_preview(ctx, out)
    return out, report + warns


# ---------- S2 / S2b: القصّ ----------
def _main_sources(ctx, s1):
    return [s for s in ctx["m"]["sources"] if role(ctx["m"], s1, s["id"]) != "music"]


def _plan(ctx, s1, shots=None):
    segs, units_out = [], {}
    for s in _main_sources(ctx, s1):
        info = s1["sources"][s["id"]]
        units = [dict(u) for u in info["units"]]
        if shots is not None:   # المتقدم: الكلام اللي في لقطات اتشالت بيتشال
            kept = [x for x in shots if x["source"] == s["id"] and x["keep"]]
            for u in units:
                mid_t = (u["start"] + u["end"]) / 2
                if not any(x["start"] <= mid_t < x["end"] for x in kept):
                    u["pre_drop"] = "في لقطة اتشالت (S2a)"
        cuts.choose(units, s["probe"]["duration"])
        for u in units:
            if u.get("pre_drop"):
                u["keep"], u["reason"] = False, u["pre_drop"]
        env = env_of(ctx["d"] / s["work"]) if s["probe"]["has_audio"] else None
        segs += cuts.plan_segments(units, info["words"], env, s["probe"]["duration"], ctx["params"].get("max_pause", cuts.MAX_PAUSE))
        units_out[s["id"]] = [{k: u[k] for k in ("id", "start", "end", "text", "keep", "reason", "start_kind", "end_kind")} for u in units]
    for k, g in enumerate(segs):
        g["id"] = f"g{k + 1}"
    return segs, units_out


def _cut_report_lines(data, units):
    cr = data["cut_report"]
    kinds = "، ".join(f"{ {'sentence_end': 'نهاية جملة', 'pause': 'سكتة', 'scene_chop': 'قطع لقطة', 'scene': 'لقطة', 'manual': 'يدوي', 'edit': 'تعديل'}.get(k, k)}: {v}"
                      for k, v in cr["by_kind"].items())
    lines = [f"{len(data['segments'])} جزء · المدة {data['total']:.2f} ث · {cr['cuts']} قصّة ({kinds}) · جوه كلمة: {cr['inside_word']}"]
    for sid, us in units.items():
        dropped = [u for u in us if not u["keep"]]
        if dropped:
            lines.append(f"{sid}: اتشال {len(dropped)} من {len(us)}: " + " | ".join(f"«{u['text'][:40] or f'{u['start']:.1f}–{u['end']:.1f}'}» ({u['reason']})" for u in dropped))
    return lines


def run_s2(ctx):
    s1 = s1_of(ctx)
    segs, units = _plan(ctx, s1)
    if not segs:
        raise ValueError("مفيش كلام/لقطات تنفع تتقص (كل حاجة اتشالت)")
    data = finalize(ctx, {"s1": ctx["inp"]["version"], "aspect": ctx["params"]["aspect"], "segments": segs, "units": units})
    build_preview(ctx, data)
    return data, _cut_report_lines(data, units)


def _luma(path: Path, t: float) -> float:
    import subprocess
    raw = subprocess.run(["ffmpeg", "-v", "error", "-ss", f"{t:.3f}", "-i", str(path), "-frames:v", "1", "-vf", "scale=64:36,format=gray", "-f", "rawvideo", "-"],
                         capture_output=True).stdout
    return round(float(np.frombuffer(raw, dtype=np.uint8).mean()), 1) if raw else 0.0


def run_s2a(ctx):
    s1, prm = s1_of(ctx), ctx["params"]
    shots, report = [], []
    for s in _main_sources(ctx, s1):
        info = s1["sources"][s["id"]]
        if not s["probe"]["has_video"]:
            continue
        for sc in info["scenes"]:
            dur = sc["end"] - sc["start"]
            nw = sum(1 for w in info["words"] if sc["start"] <= (w["start"] + w["end"]) / 2 < sc["end"])
            luma = _luma(ctx["d"] / s["work"], (sc["start"] + sc["end"]) / 2)
            keep, why = True, ("فيها كلام" if nw else "لقطة صورة")
            if dur < prm["min_shot"]:
                keep, why = False, f"قصيرة جدًا ({dur:.2f} ث)"
            elif luma < prm["black_luma"] and nw == 0:
                keep, why = False, "سودة ومفيهاش كلام"
            shots.append({"id": f"sh{len(shots) + 1}", "source": s["id"], "index": sc["index"], "start": sc["start"], "end": sc["end"],
                          "words": nw, "luma": luma, "keep": keep, "reason": why})
    if not shots:
        raise ValueError("مفيش لقطات فيديو (الملفات كلها صوت)")
    data = {"s1": ctx["inp"]["version"], "aspect": prm["aspect"], "shots": shots}
    report.append(f"{len(shots)} لقطة · اتساب {sum(x['keep'] for x in shots)} · اتشال {sum(not x['keep'] for x in shots)}")
    report += [f"{x['id']} ({x['source']} {x['start']:.2f}–{x['end']:.2f}): {'✓' if x['keep'] else '✕'} {x['reason']} · {x['words']} كلمة · إضاءة {x['luma']}" for x in shots]
    build_preview(ctx, data)
    return data, report


def run_s2b(ctx):
    s1 = s1_of(ctx)
    shots = ctx["inp"]["data"]["shots"]
    segs, units = _plan(ctx, s1, shots)
    if not segs:
        raise ValueError("مفيش كلام في اللقطات اللي اتسابت")
    data = finalize(ctx, {"s1": ctx["inp"]["data"]["s1"], "aspect": ctx["inp"]["data"]["aspect"], "shots": shots, "segments": segs, "units": units})
    build_preview(ctx, data)
    return data, _cut_report_lines(data, units)


def run_s2c(ctx):
    inp = ctx["inp"]["data"]
    segs = cuts.rhythm(inp["segments"], {})
    data = finalize(ctx, {**{k: v for k, v in inp.items() if k not in ("segments", "cut_report", "total")}, "segments": segs})
    report = [f"المدة {inp['total']:.2f} ← {data['total']:.2f} ث (المهم بياخد نفَس أطول، والأقل أهمية بيتشد)"]
    report += [f"{s['id']}: أهمية {s['importance']:.2f} · سرعة ×{s['speed']} · {s['rhythm']['duration_before']:.2f} ← {s['rhythm']['duration_after']:.2f} ث · «{s['text'][:40]}»" for s in segs]
    report.append(f"قصّات جوه كلمة بعد الإيقاع: {data['cut_report']['inside_word']}")
    build_preview(ctx, data)
    return data, report


def run_s2d(ctx):
    inp, s1, prm = ctx["inp"]["data"], s1_of(ctx), ctx["params"]
    cues = cuts.subtitle_cues(inp["segments"], words_by_source(s1), int(prm["max_chars"]), float(prm["max_dur"]))
    data = {**{k: v for k, v in inp.items() if k != "cues"}, "cues": cues, "safe_area": cuts.SAFE[inp["aspect"]]}
    build_preview(ctx, data)
    sc = data.get("subs_check") or {}
    report = [f"{len(cues)} سطر ترجمة على توقيت الكلام · جوه المنطقة الآمنة: {sc.get('inside_safe_area')}/{sc.get('cues')}",
              f"المنطقة الآمنة ({inp['aspect']}): من {cuts.SAFE[inp['aspect']]['left']:.0%} لـ {cuts.SAFE[inp['aspect']]['right']:.0%} عرضًا، وتحت لحد {cuts.SAFE[inp['aspect']]['bottom']:.0%}"]
    report += [f"{c['start']:.2f}–{c['end']:.2f}: {c['text']}" for c in cues]
    return data, report


# ---------- S3: الصوت ----------
def run_s3(ctx):
    inp, prm, vd = ctx["inp"]["data"], ctx["params"], ctx["vd"]
    s1 = s1_of(ctx)
    srcs = sources_map(ctx)
    music_sid = None
    if prm["music"] == "auto":
        music_sid = next((s["id"] for s in ctx["m"]["sources"] if role(ctx["m"], s1, s["id"]) == "music"), None)
    elif prm["music"] not in (None, "none"):
        music_sid = prm["music"]
    music = {"path": srcs[music_sid]["path"], "gain_db": prm["music_gain_db"]} if music_sid else None
    raw, stem = vd / "mix_raw.wav", (vd / "music_ducked.wav" if music else None)
    exporter.render_audio(inp["segments"], srcs, raw, music=music, duck=bool(prm["duck"]), music_stem=stem)
    norm = exporter.normalize(raw, vd / "audio.wav", float(prm["target_lufs"]), float(prm["true_peak"]))
    raw.unlink(missing_ok=True)
    audio = {"file": "audio.wav", "version": None, "target_lufs": float(prm["target_lufs"]), "true_peak": float(prm["true_peak"]),
             "before": norm["before"], "after": norm["after"], "music": music_sid, "duck": bool(prm["duck"]) if music else None}
    report = [f"علو الصوت: {norm['before']['integrated_lufs']} ← {norm['after']['integrated_lufs']} LUFS (الهدف {prm['target_lufs']}) · Peak {norm['after']['true_peak_dbtp']} dBTP"]
    if music:
        # التوطية: علو المزيكا وقت الكلام مقابل وقت السكوت (على توقيت الإخراج)
        spans = [(c["start"], c["end"]) for c in cuts.subtitle_cues(inp["segments"], words_by_source(s1), 10 ** 6, 10 ** 6)]
        env = speech.envelope(stem)
        mask = np.zeros(len(env), dtype=bool)
        for a, b in spans:
            mask[int(a / speech.HOP):int(b / speech.HOP)] = True
        under, free = env[mask], env[~mask]
        if len(under) and len(free):
            audio["duck_db"] = round(float(np.median(free) - np.median(under)), 1)
        report.append(f"مزيكا: {music_sid} على {prm['music_gain_db']} dB" + (f" · بتوطى {audio.get('duck_db')} dB وقت الكلام (sidechain)" if prm["duck"] else " · من غير توطية"))
    else:
        report.append("مفيش تراك مزيكا (ملف صوت دوره مزيكا)، فمفيش توطية")
    data = {**{k: v for k, v in inp.items() if k != "audio"}, "audio": audio}
    build_preview(ctx, data)
    pl = media.loudness(vd / "preview.mp4") or {}
    audio["preview_lufs"] = pl.get("integrated_lufs")
    report.append(f"المعاينة نفسها (AAC): {pl.get('integrated_lufs')} LUFS")
    return data, report


# ---------- S4: التصدير ----------
def run_s4(ctx):
    inp, vd, mid = ctx["inp"], ctx["vd"], ctx["mid"]
    data_in = inp["data"]
    srcs = sources_map(ctx)
    audio = vdir(mid, "s3_audio", inp["version"]) / data_in["audio"]["file"]
    overlays = None
    if data_in.get("cues"):
        W, H = exporter.size(data_in["aspect"])
        overlays = subs.render_cues(data_in["cues"], data_in["aspect"], W, H, vd / "subs")
    exp_dir = ctx["d"] / "exports"
    out = exporter.render(data_in["segments"], srcs, data_in["aspect"], exp_dir, audio_file=audio, overlays=overlays)
    try:
        os.link(out, vd / "preview.mp4")   # نفس الملف (من غير نسخة تانية على الديسك)
    except OSError:
        import shutil
        shutil.copyfile(out, vd / "preview.mp4")
    info = media.probe(out)
    L = media.loudness(out) or {}
    data = {"file": f"exports/{out.name}", "probe": info, "expected_duration": data_in["total"], "loudness": L,
            "from": {"stage": "s3_audio", "version": inp["version"]}, "subtitles": len(overlays or [])}
    report = [f"{info['width']}×{info['height']} · {info['duration']:.2f} ث (المتوقع {data_in['total']:.2f}) · {L.get('integrated_lufs')} LUFS",
              f"الملف: {out.name}"]
    return data, report


RUN = {"s1_analyze": run_s1, "s2_cut": run_s2, "s2a_select": run_s2a, "s2b_cuts": run_s2b, "s2c_rhythm": run_s2c, "s2d_subs": run_s2d,
       "s3_audio": run_s3, "s4_export": run_s4}
