"""ينزّل مكتبات الرسومات المجانية في assets/، ويعمل assets/catalog.json علشان Claude يختار منها.

التشغيل: uv run python assets/fetch_assets.py          (محتاج node و npm)
       uv run python assets/fetch_assets.py --skip-emoji   (من غير الإيموجي المتحرك، حوالي 45MB)

الملفات المتنزلة مش بتترفع على git (شوف .gitignore). أي حد ينزّل المشروع يشغّل الأمر ده مرة.
"""

import argparse
import json
import shutil
import subprocess
import sys
import tarfile
import tempfile
import urllib.request
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

ASSETS = Path(__file__).resolve().parent

# نسخ ثابتة علشان النتيجة تبقى هي هي كل مرة
NPM = {
    "lottie-web": "5.13.0",
    "@dicebear/core": "9.4.3",
    "@dicebear/open-peeps": "9.4.2",
    "undraw-svg": "2.0.0",
    "lucide-static": "1.56.0",
    "@tabler/icons": "3.49.0",
}
EMOJI_API = "https://googlefonts.github.io/noto-emoji-animation/data/api.json"
EMOJI_URL = "https://fonts.gstatic.com/s/e/notoemoji/latest/{cp}/lottie.json"


def say(text: str) -> None:
    print(text, flush=True)


def npm_unpack(name: str, version: str, dest: Path) -> Path:
    """npm pack بينزّل الـ tarball بس من غير ما يشغّل أي سكريبتات تثبيت."""
    dest.mkdir(parents=True, exist_ok=True)
    out = subprocess.run(["npm", "pack", "--silent", f"{name}@{version}"], cwd=dest, capture_output=True, text=True, check=True)
    tgz = dest / out.stdout.strip().splitlines()[-1]
    target = dest / "node_modules" / name
    target.mkdir(parents=True, exist_ok=True)
    with tarfile.open(tgz) as tar:
        for m in tar.getmembers():
            if m.isfile() and m.name.startswith("package/"):
                m.name = m.name[len("package/"):]
                tar.extract(m, target, filter="data")
    return target


def fresh(path: Path) -> Path:
    shutil.rmtree(path, ignore_errors=True)
    path.mkdir(parents=True)
    return path


def copy_svgs(src: Path, dst: Path) -> int:
    fresh(dst)
    n = 0
    for f in src.glob("*.svg"):
        shutil.copy2(f, dst / f.name)
        n += 1
    return n


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--skip-emoji", action="store_true")
    args = parser.parse_args()
    if not shutil.which("npm") or not shutil.which("node"):
        sys.exit("❌ محتاج node و npm:  brew install node")

    catalog: dict = {}
    with tempfile.TemporaryDirectory() as tmp:
        tmp = Path(tmp)
        pkgs = {}
        for name, version in NPM.items():
            say(f"⏳ {name}@{version}")
            pkgs[name] = npm_unpack(name, version, tmp)

        # 1. مشغّل Lottie (SVG بس، أخف نسخة)
        vendor = fresh(ASSETS / "vendor")
        shutil.copy2(pkgs["lottie-web"] / "build/player/lottie_svg.min.js", vendor / "lottie_svg.min.js")
        shutil.copy2(pkgs["lottie-web"] / "LICENSE.md", vendor / "LICENSE-lottie-web.md")

        # 2. Open Peeps ← peeps.js
        peeps = fresh(ASSETS / "peeps")
        subprocess.run(["node", str(ASSETS / "tools/build_peeps.mjs"), str(tmp / "node_modules"), str(peeps / "peeps.js")], check=True)
        shutil.copy2(pkgs["@dicebear/open-peeps"] / "LICENSE", peeps / "LICENSE")
        catalog["peeps"] = {
            "file": "peeps/peeps.js",
            "usage": "Peeps.svg({head, face, facialHair, accessories, mask, skin, clothing, headContrast}) ← SVG نص صدر (viewBox 704)",
            "license": "CC0 1.0 (Pablo Stanley)",
        }

        # 3. unDraw
        n = copy_svgs(pkgs["undraw-svg"] / "svgs", ASSETS / "undraw")
        meta = json.loads((pkgs["undraw-svg"] / "illustrations.json").read_text(encoding="utf-8"))
        catalog["undraw"] = {
            "dir": "undraw/",
            "recolor": "اللون المميز في كل رسمة fill=currentColor: حط CSS color على العنصر اللي فيه الرسمة",
            "license": "unDraw license: مجاني تجاري ومن غير ذكر اسم، بس ممنوع تجميعها في مكتبة منافسة",
            "items": list({m["slug"]: {"file": f"{m['slug']}.svg", "title": m["title"], "keywords": m.get("keywords", [])}
                           for m in meta if (ASSETS / "undraw" / f"{m['slug']}.svg").exists()}.values()),
        }
        say(f"✅ unDraw: {n} رسمة")

        # 4. الأيقونات
        icons = ASSETS / "icons"
        n1 = copy_svgs(pkgs["lucide-static"] / "icons", icons / "lucide")
        shutil.copy2(pkgs["lucide-static"] / "LICENSE", icons / "lucide" / "LICENSE")
        n2 = copy_svgs(pkgs["@tabler/icons"] / "icons/outline", icons / "tabler-outline")
        n3 = copy_svgs(pkgs["@tabler/icons"] / "icons/filled", icons / "tabler-filled")
        shutil.copy2(pkgs["@tabler/icons"] / "LICENSE", icons / "tabler-outline" / "LICENSE")
        lucide_tags = json.loads((pkgs["lucide-static"] / "tags.json").read_text(encoding="utf-8"))
        tabler_meta = json.loads((pkgs["@tabler/icons"] / "icons.json").read_text(encoding="utf-8"))
        catalog["icons"] = {
            "lucide": {"dir": "icons/lucide/", "license": "ISC", "style": "خطوط (stroke)، مناسبة لحركة الرسم خط بخط",
                       "items": {f.stem: lucide_tags.get(f.stem, []) for f in sorted((icons / "lucide").glob("*.svg"))}},
            "tabler": {"dirs": ["icons/tabler-outline/", "icons/tabler-filled/"], "license": "MIT",
                       "items": {k: (v.get("tags") or []) for k, v in tabler_meta.items()
                                 if (icons / "tabler-outline" / f"{k}.svg").exists()}},
        }
        say(f"✅ الأيقونات: Lucide {n1}، Tabler {n2} outline + {n3} filled")

    # 5. الإيموجي المتحرك (Lottie)
    if not args.skip_emoji:
        emoji_dir = ASSETS / "emoji"
        emoji_dir.mkdir(exist_ok=True)
        api = json.loads(urllib.request.urlopen(EMOJI_API, timeout=60).read())
        items = api["icons"]

        def get(icon):
            cp = icon["codepoint"]
            path = emoji_dir / f"{cp}.json"
            if not path.exists():
                try:
                    urllib.request.urlretrieve(EMOJI_URL.format(cp=cp), path)
                except Exception:
                    return None
            return {"file": f"emoji/{cp}.json", "codepoint": cp, "tags": icon.get("tags", []), "categories": icon.get("categories", [])}

        say(f"⏳ الإيموجي المتحرك: {len(items)} ملف…")
        with ThreadPoolExecutor(8) as pool:
            got = [x for x in pool.map(get, items) if x]
        catalog["emoji"] = {"license": "CC BY 4.0: لازم تكتب 'Animated emoji by Google' في وصف الفيديو", "player": "vendor/lottie_svg.min.js",
                            "items": got}
        say(f"✅ الإيموجي: {len(got)} من {len(items)}")

    catalog["lottie"] = {"dir": "lottie/", "player": "vendor/lottie_svg.min.js",
                         "note": "حط هنا أي أنيميشن .json من LottieFiles (Lottie Simple License)",
                         "items": sorted(p.name for p in (ASSETS / "lottie").glob("*.json"))}
    (ASSETS / "catalog.json").write_text(json.dumps(catalog, ensure_ascii=False, indent=1), encoding="utf-8")
    say(f"\n✅ خلصنا. الفهرس في {ASSETS / 'catalog.json'}")


if __name__ == "__main__":
    main()
