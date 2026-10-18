"""اختبار نسخ المراحل في المونتاج (من غير ميديا: المراحل نفسها بتتبدل بدوال سريعة، ومنطق النسخ/الحالة/الطلب هو الحقيقي):
- زرار «اعمل المونتاج» بيعمل الـ 7 مراحل لحد المعاينة الكاملة.
- التصدير مقفول قبل الموافقة على المعاينة الكاملة.
- تعديل مرحلة واحدة (cascade) ← نسخة جديدة منها بس، واللي بعدها بيتعاد، واللي قبلها ما بيتلمسش.
- إعادة S2 بتعلّم اللي بعدها "قديمة" من غير ما تمسحهم، والرجوع لنسخة قديمة بيرجّع JSON بنفس البايتات بالظبط.
- تغيير الطلب (brief) بيعلّم المرحلة اللي بتستخدم الحاجة دي بس "قديمة".
الاستخدام: .venv/bin/python tests/montage_versions.py
"""

import sys
import tempfile
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from app.montage import stages, state  # noqa: E402


def fake(key):
    def run(ctx):
        n = len(state.load(ctx["mid"])["stages"].get(key, {}).get("versions", [])) + 1
        data = {"aspect": "9:16", "segments": [{"id": "g1", "source": "s1", "start": 0.1 * n, "end": 5.0}], "run": n, "t": time.time(),
                "params_seen": ctx["params"]}
        if key == "s7_preview":
            (ctx["vd"] / "preview.mp4").write_bytes(b"fake")
            data.update(probe={"duration": 4.9}, fps=30, frames=147)
        return data, [f"{key} run {n}"], []
    return run


def versions(mid):
    m = state.load(mid)
    return {k: len((m["stages"].get(k) or {}).get("versions", [])) for k in stages.PIPE}


def main() -> int:
    fails = []
    state.ROOT = Path(tempfile.mkdtemp())   # فولدر مؤقت: مونتاجاتك الحقيقية ما بتتلمسش
    for k in stages.RUN:
        stages.RUN[k] = fake(k)
    mid = "test_versions"
    state.mdir(mid).mkdir(parents=True)
    state.save({"id": mid, "title": "t", "created": time.time(), "sources": [{"id": "s1", "name": "x.mp4", "probe": {"duration": 5.0, "has_video": True, "has_audio": True}, "work": "work/s1.mp4"}],
                "edit": {"segments": [], "aspect": "9:16"}, "export": None})
    st = lambda k: stages.status(state.load(mid), k)  # noqa: E731

    # 1) ضغطة واحدة ← المراحل لحد الترجمة، وبيقف (خطة المراجعة) لحد ما توافق على الترجمة، وبعدها بيكمّل لوحده لحد المعاينة الكاملة
    todo = stages.run_all(mid, sync=True)
    before_gate = stages.PIPE[:stages.PIPE.index(stages.REVIEW_GATE) + 1]
    if todo != stages.PIPE or any(st(k) != "ready" for k in before_gate) or any(st(k) != "empty" for k in stages.AFTER_REVIEW) \
            or not state.load(mid)["auto"].get("paused"):
        fails.append(f"review gate: todo={todo}, status={ {k: st(k) for k in stages.PIPE} }")
    stages.approve(mid, stages.REVIEW_GATE, sync=True)
    if any(st(k) != "ready" for k in stages.AFTER_REVIEW):
        fails.append(f"after approving subtitles: { {k: st(k) for k in stages.PIPE} }")
    # 2) التصدير قبل الموافقة: مرفوض
    try:
        stages.export(mid); fails.append("export allowed before approval")
    except stages.Blocked as e:
        print(f"export before approval → refused: {e}")
    stages.approve(mid, "s7_preview")
    exp = stages.export(mid)
    if not (state.mdir(mid) / exp["file"]).exists():
        fails.append("export file missing")

    # 3) تعديل مرحلة واحدة (الترجمة) ← نسخة جديدة منها بس + اللي بعدها اتعاد، واللي قبلها زي ما هو
    before = versions(mid)
    stages.start(mid, "s4_subs", {"size": "large"}, origin="edit", note="الترجمة أكبر", sync=True, cascade=True)
    # الترجمة اتعدّلت ← نسخة جديدة محتاجة موافقتك تاني، واللي بعدها بيستنى (خطة المراجعة)، وبعد الموافقة بيكمّل لوحده
    if any(st(k) != "stale" for k in stages.AFTER_REVIEW):
        fails.append(f"edited subtitles should pause later stages until approval: { {k: st(k) for k in stages.PIPE} }")
    stages.approve(mid, stages.REVIEW_GATE, sync=True)
    after = versions(mid)
    changed = [k for k in stages.PIPE if after[k] != before[k]]
    if changed != ["s4_subs", "s5_graphics", "s6_audio", "s7_preview"] or any(after[k] - before[k] != 1 for k in changed):
        fails.append(f"revision: changed {changed} ({before} → {after})")
    doc = stages.read_stage(mid, "s4_subs", state.load(mid)["stages"]["s4_subs"]["current"])
    if doc["params"]["size"] != "large" or doc["user_params"].get("size") != "large":
        fails.append("revision params not applied")
    if any(st(k) not in ("ready", "approved") for k in stages.PIPE):
        fails.append(f"after revision not all fresh: { {k: st(k) for k in stages.PIPE} }")
    if stages.status(state.load(mid), "s7_preview") == "approved":
        fails.append("new preview should need approval again")
    try:
        stages.export(mid); fails.append("export allowed for the new (unapproved) preview")
    except stages.Blocked:
        pass

    # 4) إعادة S2 ← اللي بعدها قديم (من غير مسح)، والرجوع لـ v1 بنفس البايتات
    v1_bytes = (stages.vdir(mid, "s2_cut", 1) / "stage.json").read_bytes()
    stages.start(mid, "s2_cut", sync=True)
    after_redo = {k: st(k) for k in stages.PIPE}
    if after_redo["s2_cut"] != "ready" or any(after_redo[k] != "stale" for k in stages.PIPE[2:]):
        fails.append(f"after S2 redo expected later stages stale, got {after_redo}")
    if not (stages.vdir(mid, "s3_look", 1) / "stage.json").exists():
        fails.append("stale stages were deleted")
    stages.revert(mid, "s2_cut", 1)
    cur = state.load(mid)["stages"]["s2_cut"]["current"]
    byte_equal = cur == 1 and (stages.vdir(mid, "s2_cut", cur) / "stage.json").read_bytes() == v1_bytes
    if not byte_equal:
        fails.append("revert did not restore byte-equal JSON")
    if st("s3_look") == "stale":
        fails.append("after revert S3 (built on S2 v1) should be valid again")

    # 5) الطلب: تغيير حجم الترجمة ← الترجمة (واللي بعدها) قديمة، والقصّ والصورة لأ
    state.update(mid, lambda mm: mm.update(brief={"text": "ترجمة كبيرة", "saved": time.time()}))
    bst = {k: st(k) for k in stages.PIPE}
    if bst["s4_subs"] != "stale" or bst["s2_cut"] == "stale" or bst["s3_look"] == "stale":
        fails.append(f"brief change staleness wrong: {bst}")
    todo2 = stages.run_all(mid, sync=True)
    seen = stages.read_stage(mid, "s4_subs", state.load(mid)["stages"]["s4_subs"]["current"])
    if todo2[0] != "s4_subs" or seen["brief"].get("sub_size") != "large":
        fails.append(f"brief rerun: todo={todo2}, brief used={seen['brief']}")
    if any(stages.read_stage(mid, k, state.load(mid)["stages"][k]["current"]).get("brief") is None for k in stages.PIPE):
        fails.append("some stage did not record the brief it used")

    print(f"one click: {todo}")
    print(f"revision (s4 + cascade): versions {before} → {after}")
    print(f"after S2 redo: {after_redo}")
    print(f"revert S2 → v{cur}, byte-equal: {byte_equal}")
    print(f"brief 'ترجمة كبيرة' → stale: {[k for k, v in bst.items() if v == 'stale']}, rerun: {todo2}")
    print("PASS" if not fails else "FAIL:\n  " + "\n  ".join(fails))
    return 1 if fails else 0


if __name__ == "__main__":
    sys.exit(main())
