"""اختبار نسخ المراحل في المونتاج (من غير ميديا: المراحل نفسها بتتبدل بدوال سريعة، ومنطق النسخ/الحالة هو الحقيقي):
- إعادة S2 بتعلّم S3 و S4 "قديمة" (stale) من غير ما تمسحهم.
- الرجوع لنسخة قديمة بيرجّع JSON بنفس البايتات بالظبط.
- التصدير (S4) مقفول قبل الموافقة على S3.
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
        # كل تشغيل بيطلع بيانات مختلفة (زي إعادة حقيقية بتوقيتات مختلفة)
        data = {"s1": 1, "aspect": "9:16", "segments": [{"id": "g1", "source": "s1", "start": 0.1 * n, "end": 5.0}], "run": n, "t": time.time()}
        if key == "s4_export":
            data.update(file="exports/fake.mp4", probe={"duration": 4.9}, expected_duration=4.9)
        (ctx["vd"] / "preview.mp4").write_bytes(b"fake")
        return data, [f"{key} run {n}"]
    return run


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

    def run(k):
        stages.start(mid, k, sync=True)
        r = state.load(mid)["stages"][k]
        if r["job"] != "idle":
            fails.append(f"{k} failed: {r['error']}")

    run("s1_analyze"); run("s2_cut"); run("s3_audio")
    # التصدير قبل الموافقة: لازم يترفض
    try:
        stages.start(mid, "s4_export", sync=True)
        fails.append("S4 ran before approval")
    except stages.Blocked as e:
        print(f"S4 before approval → refused: {e}")
    stages.approve(mid, "s3_audio")
    run("s4_export")
    before = {k: st(k) for k in stages.BASIC}
    v1_bytes = (stages.vdir(mid, "s2_cut", 1) / "stage.json").read_bytes()

    # إعادة S2 ← S3 و S4 قديمة
    run("s2_cut")
    after_redo = {k: st(k) for k in stages.BASIC}
    if after_redo["s2_cut"] != "ready" or after_redo["s3_audio"] != "stale" or after_redo["s4_export"] != "stale":
        fails.append(f"after S2 redo expected s3/s4 stale, got {after_redo}")
    if not (stages.vdir(mid, "s3_audio", 1) / "stage.json").exists() or not (stages.vdir(mid, "s4_export", 1) / "stage.json").exists():
        fails.append("stale stages were deleted")
    v2_bytes = (stages.vdir(mid, "s2_cut", 2) / "stage.json").read_bytes()
    if v2_bytes == v1_bytes:
        fails.append("redo produced identical JSON (test not meaningful)")
    # الموافقة على S3 وهي قديمة: مرفوضة، والتصدير لسه مقفول
    try:
        stages.approve(mid, "s3_audio"); fails.append("approved a stale stage")
    except stages.Blocked:
        pass
    try:
        stages.check_can_run(state.load(mid), "s4_export"); fails.append("S4 allowed while S3 is stale")
    except stages.Blocked:
        pass

    # الرجوع لـ v1 ← نفس البايتات بالظبط
    stages.revert(mid, "s2_cut", 1)
    m = state.load(mid)
    cur = m["stages"]["s2_cut"]["current"]
    cur_bytes = (stages.vdir(mid, "s2_cut", cur) / "stage.json").read_bytes()
    byte_equal = cur == 1 and cur_bytes == v1_bytes
    if not byte_equal:
        fails.append("revert did not restore byte-equal JSON")
    after_revert = {k: st(k) for k in stages.BASIC}
    # S3 v1 كانت مبنية على S2 v1، فبعد الرجوع بقت سليمة تاني (مش قديمة)
    if after_revert["s3_audio"] == "stale":
        fails.append(f"after revert S3 (built on S2 v1) should be valid again, got {after_revert}")
    # تبديل الوضع ما بيمسحش نسخ
    stages.set_mode(mid, "advanced"); stages.set_mode(mid, "basic")
    if len(state.load(mid)["stages"]["s2_cut"]["versions"]) != 2:
        fails.append("mode switch changed saved versions")

    print(f"before redo: {before}")
    print(f"after S2 redo: {after_redo}")
    print(f"S2 v1 JSON: {len(v1_bytes)} bytes · after revert current=v{cur}, byte-equal: {byte_equal}")
    print(f"after revert: {after_revert}")
    print("PASS" if not fails else "FAIL:\n  " + "\n  ".join(fails))
    return 1 if fails else 0


if __name__ == "__main__":
    sys.exit(main())
