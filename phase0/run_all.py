"""يشغّل كل تجارب المرحلة 0 ويحفظ النتايج في phase0_results.md.

التشغيل: ./phase0/run_all.sh   (أو: uv run python -m phase0.run_all)
"""

import argparse
import datetime
import platform
import time
import traceback
from importlib import metadata

from . import test_claude, test_elevenlabs, test_render
from .common import REPORT_PATH, Report, run, say

TESTS = {
    "claude": test_claude.run_tests,
    "elevenlabs": test_elevenlabs.run_tests,
    "render": test_render.run_tests,
}


def first_line(cmd: list[str]) -> str:
    code, out, err = run(cmd, timeout=30)
    text = (out or err).strip().splitlines()
    return text[0] if code == 0 and text else "مش موجود"


def system_info(rep: Report) -> None:
    rep.h("معلومات الجهاز")
    rep.kv("macOS", platform.mac_ver()[0] or platform.platform())
    rep.kv("المعالج", first_line(["sysctl", "-n", "machdep.cpu.brand_string"]))
    mem = first_line(["sysctl", "-n", "hw.memsize"])
    rep.kv("الرام", f"{int(mem) / 2**30:.0f} GB" if mem.isdigit() else mem)
    rep.kv("Python", platform.python_version())
    rep.kv("ffmpeg", first_line(["ffmpeg", "-version"]))
    rep.kv("claude", first_line(["claude", "--version"]))
    try:
        rep.kv("playwright", metadata.version("playwright"))
    except metadata.PackageNotFoundError:
        rep.kv("playwright", "مش متسطّب")


def main() -> None:
    parser = argparse.ArgumentParser(description="تجارب المرحلة 0")
    parser.add_argument("--only", choices=list(TESTS), action="append", help="شغّل تجربة واحدة بس (ممكن تتكرر)")
    parser.add_argument("--no-questions", action="store_true", help="من غير أسئلة السمع في تجربة ElevenLabs")
    parser.add_argument("--reference", help="مسار ملف HTML المرجعي (الافتراضي: أول ملف في reference/)")
    parser.add_argument("--render-fn", default="renderAt", help="اسم دالة الرسم في الفيديو المرجعي")
    args = parser.parse_args()

    rep = Report()
    rep.line(f"# نتايج المرحلة 0\n\nالتاريخ: {datetime.datetime.now():%Y-%m-%d %H:%M}")
    rep.line("> الملف ده مفيهوش مفاتيح ولا كلمات سر. ابعته زي ما هو.")
    system_info(rep)
    rep.save()

    for name, fn in TESTS.items():
        if args.only and name not in args.only:
            continue
        t0 = time.time()
        try:
            fn(rep, args)
        except KeyboardInterrupt:
            rep.check(f"{name}: اتوقفت", None, "Ctrl+C")
            rep.save()
            raise
        except Exception as e:  # نكمّل باقي التجارب حتى لو واحدة فشلت
            rep.check(f"{name}: خطأ غير متوقع", False, str(e)[:200])
            rep.code(traceback.format_exc(), "text")
        rep.kv(f"مدة تجربة {name}", f"{time.time() - t0:.0f} ثانية")
        rep.save()

    rep.h("الملخص")
    marks = {True: "✅", False: "❌"}
    rep.table(["", "البند", "التفاصيل"], [[marks.get(p, "⚠️"), n, d.replace("|", "/")] for n, p, d in rep.summary])
    rep.save()
    say(f"\n✅ خلصنا. النتايج في:\n   {REPORT_PATH}\n")


if __name__ == "__main__":
    main()
