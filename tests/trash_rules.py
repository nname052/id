"""اختبار سلة المحذوفات (app/trash.py) على فولدرات مؤقتة:
- الحذف بينقل الفولدر للسلة (مش بيمسحه)، والرجوع بيرجّعه بنفس البايتات بالظبط (SHA-256).
- الرجوع بيرفض لو فيه حاجة بنفس الرقم في المكان الأصلي (ما بيكتبش فوقها).
- «امسح نهائي» بيمسح عنصر واحد، واللي عدّى عليه 7 أيام بيتمسح لوحده.
الاستخدام: .venv/bin/python tests/trash_rules.py
"""

import hashlib
import sys
import tempfile
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from app import trash  # noqa: E402
from app.store import read_json, write_json  # noqa: E402


def sha(p: Path) -> str:
    return hashlib.sha256(p.read_bytes()).hexdigest()


def main() -> int:
    fails = []
    with tempfile.TemporaryDirectory() as tmp:
        root = Path(tmp)
        trash.TRASH = root / "_trash"
        trash.KINDS = {"video": root, "montage": root / "_montage"}
        m = root / "_montage" / "2026-01-01_aaaaaa"
        (m / "original").mkdir(parents=True)
        (m / "original" / "s1.mov").write_bytes(b"x" * 5000 + b"end")
        write_json(m / "montage.json", {"id": m.name, "title": "تجربة"})
        before = sha(m / "original" / "s1.mov")

        meta = trash.move("montage", m.name, "تجربة")
        if m.exists() or not meta or len(trash.items()) != 1:
            fails.append("delete should move the folder to trash")
        trash.restore(meta["tid"])
        if not m.exists() or sha(m / "original" / "s1.mov") != before or trash.items():
            fails.append("restore should bring back identical bytes and empty the trash")

        meta = trash.move("montage", m.name, "تجربة")
        (m).mkdir(parents=True)            # حاجة جديدة بنفس الرقم
        try:
            trash.restore(meta["tid"]); fails.append("restore over an existing folder should be refused")
        except FileExistsError:
            pass
        m.rmdir()

        trash.purge(meta["tid"])
        if trash.items():
            fails.append("purge should delete one item permanently")

        v = root / "2026-01-02_bbbbbb"; v.mkdir(); (v / "project.json").write_text("{}")
        old = trash.move("video", v.name, "قديم")
        mm = read_json(trash.TRASH / old["tid"] / "meta.json"); mm["expires_at"] = time.time() - 1
        write_json(trash.TRASH / old["tid"] / "meta.json", mm)
        new_v = root / "2026-01-03_cccccc"; new_v.mkdir()
        fresh = trash.move("video", new_v.name, "جديد")
        gone = trash.purge_expired()
        left = [x["tid"] for x in trash.items()]
        if gone != [old["tid"]] or left != [fresh["tid"]]:
            fails.append(f"expiry: gone={gone} left={left}")
        if trash.KEEP_DAYS != 7:
            fails.append("keep days should be 7")
    print("PASS" if not fails else "FAIL:\n  " + "\n  ".join(fails))
    return 1 if fails else 0


if __name__ == "__main__":
    sys.exit(main())
