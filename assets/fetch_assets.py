"""ينزّل مكتبات الرسومات المجانية في assets/، ويعمل assets/catalog.json علشان Claude يختار منها.

التشغيل: uv run python assets/fetch_assets.py          (محتاج node و npm)
       uv run python assets/fetch_assets.py --skip-emoji   (من غير الإيموجي المتحرك، حوالي 45MB)

الملفات المتنزلة مش بتترفع على git (شوف .gitignore). أي حد ينزّل المشروع يشغّل الأمر ده مرة.
"""

import argparse
import re
import time
import json
import shutil
import subprocess
import sys
import tarfile
import tempfile
import urllib.request
import zipfile
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
    "gsap": "3.15.0",
    "pixi.js": "8.22.0",
    "pixi-filters": "6.1.5",
    "three": "0.186.1",
    "@rive-app/canvas-advanced": "2.44.2",
}
# حزم Kenney (CC0): رابط التنزيل بيتجاب من صفحة الحزمة نفسها، علشان الرابط فيه رقم بيتغيّر مع كل تحديث
KENNEY_2D = ["toon-characters", "modular-characters", "shape-characters", "animal-pack"]
KENNEY_3D = ["furniture-kit", "mini-characters"]
# شخصيات 3D بنسب طبيعية وحركات جاهزة (كلها CC0)
MODELS_3D = {
    # مانيكان بنسب جسم طبيعية + 45 حركة (Quaternius Universal Animation Library)
    "ual1": "https://opengameart.org/sites/default/files/universal_animation_librarystandard.zip",
    # الجزء التاني: باركور، وقتال، وزراعة، وصيد، ومشية زومبي
    "ual2": "https://opengameart.org/sites/default/files/universal_animation_library_2standard.zip",
    # KayKit: فارس، وبربري، وساحر، ولص، فيهم 75 حركة
    "kaykit-adventurers": "https://codeload.github.com/KayKit-Game-Assets/KayKit-Character-Pack-Adventures-1.0/zip/refs/heads/main",
    # KayKit: أثاث أوض بنفس الستايل
    "kaykit-furniture": "https://codeload.github.com/KayKit-Game-Assets/KayKit-Furniture-Bits-1.0/zip/refs/heads/main",
}
ROBOT_URL = "https://raw.githubusercontent.com/mrdoob/three.js/dev/examples/models/gltf/RobotExpressive/RobotExpressive.glb"
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


def download(url: str, dest: Path, tries: int = 4) -> Path:
    """تنزيل بإعادة محاولة: المواقع ساعات بتقطع الاتصال في النص."""
    for attempt in range(1, tries + 1):
        try:
            req = urllib.request.Request(url, headers={"User-Agent": "tiktok-motion-assets"})
            with urllib.request.urlopen(req, timeout=120) as r, open(dest, "wb") as f:
                shutil.copyfileobj(r, f)
            return dest
        except Exception as e:
            if attempt == tries:
                raise
            say(f"   ⚠️ {Path(url).name}: {e}، محاولة {attempt + 1}…")
            time.sleep(3 * attempt)
    return dest


def kenney_zip(slug: str, dest: Path) -> Path:
    page = urllib.request.urlopen(f"https://kenney.nl/assets/{slug}", timeout=60).read().decode("utf-8", "replace")
    m = re.search(r"https://kenney\.nl/media/[^\"']+\.zip", page)
    if not m:
        raise RuntimeError(f"مش لاقي رابط تنزيل {slug}")
    return download(m.group(0), dest)


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

        # 1ب. مكتبات الحركة المتقدمة (كلها بتشتغل من غير build)
        gsap = vendor / "gsap"
        gsap.mkdir()
        for f in ("gsap", "MotionPathPlugin", "MorphSVGPlugin", "DrawSVGPlugin", "CustomEase", "SplitText"):
            shutil.copy2(pkgs["gsap"] / f"dist/{f}.min.js", gsap / f"{f}.min.js")
        shutil.copy2(pkgs["pixi.js"] / "dist/pixi.min.js", vendor / "pixi.min.js")
        shutil.copy2(pkgs["pixi-filters"] / "dist/pixi-filters.js", vendor / "pixi-filters.js")
        three = vendor / "three"
        three.mkdir()
        for f in ("three.module.js", "three.core.js"):
            shutil.copy2(pkgs["three"] / "build" / f, three / f)
        shutil.copytree(pkgs["three"] / "examples/jsm", three / "addons")
        rive = vendor / "rive"
        rive.mkdir()
        for f in ("canvas_advanced.mjs", "rive.wasm", "rive_fallback.wasm"):
            shutil.copy2(pkgs["@rive-app/canvas-advanced"] / f, rive / f)
        catalog["engines"] = {
            "gsap": {"dir": "vendor/gsap/", "usage": "timeline({paused:true}) + seek(t). فيه MotionPath و MorphSVG و DrawSVG", "license": "GSAP Standard no-charge license"},
            "pixi": {"files": ["vendor/pixi.min.js", "vendor/pixi-filters.js"], "usage": "إضاءة ومؤثرات (Godray, Glow, Bloom). الريندر يدوي في renderAt من غير ticker", "license": "MIT"},
            "three": {"dir": "vendor/three/", "usage": "importmap: three → vendor/three/three.module.js، three/addons/ → vendor/three/addons/. AnimationMixer.setTime(t)", "license": "MIT"},
            "rive": {"dir": "vendor/rive/", "usage": "canvas_advanced.mjs + rive.wasm. animation.advance لوقت محدد من 0", "license": "MIT (الملفات .riv كل واحد ليه رخصته)"},
        }

        # 1ج. موديلات 3D: أثاث، وشخصيات صغيرة، وشخصيات بنسب طبيعية فيها هيكل عظمي وحركات
        models = fresh(ASSETS / "3d")
        for slug in KENNEY_3D:
            say(f"⏳ Kenney {slug}")
            with zipfile.ZipFile(kenney_zip(slug, tmp / f"{slug}.zip")) as z:
                for m in z.namelist():
                    if m.lower().endswith(".glb") or ("/Textures/" in m and m.endswith(".png")):
                        out = models / slug / ("Textures" if "/Textures/" in m else "") / Path(m).name
                        out.parent.mkdir(parents=True, exist_ok=True)
                        out.write_bytes(z.read(m))
        for name, url in MODELS_3D.items():
            say(f"⏳ {name}")
            with zipfile.ZipFile(download(url, tmp / f"{name}.zip")) as z:
                for m in z.namelist():
                    keep = ((m.endswith(".glb") and ("/Godot/" in m or "/Unreal-Godot/" in m)) or m.endswith("AL_Standard.fbx")) if name.startswith("ual") else \
                           ("/Characters/gltf/" in m and m.endswith((".glb", ".png"))) if name == "kaykit-adventurers" else \
                           ("/gltf/" in m.lower() and m.lower().endswith((".gltf", ".glb", ".bin", ".png")))
                    if keep or m.endswith("License.txt") or m.endswith("LICENSE.txt"):
                        out = models / name / Path(m).name
                        out.parent.mkdir(parents=True, exist_ok=True)
                        out.write_bytes(z.read(m))
        download(ROBOT_URL, models / "RobotExpressive.glb")
        catalog["models3d"] = {
            "license": "CC0 (Kenney، KayKit، Quaternius). حزم Quaternius: ممنوع إعادة توزيع الملفات نفسها، والفيديوهات مسموحة",
            "furniture": {"kenney": sorted(p.name for p in (models / "furniture-kit").glob("*.glb")),
                          "kaykit": sorted(p.name for p in (models / "kaykit-furniture").glob("*.gltf"))},
            "characters": {
                "mannequin (ual1/ual2)": "نسب طبيعية، 45 + حركات الجزء التاني في نفس الملف (AnimationLibrary_Godot_Standard.glb)",
                "kaykit-adventurers": sorted(p.name for p in (models / "kaykit-adventurers").glob("*.glb")),
                "kenney mini": sorted(p.name for p in (models / "mini-characters").glob("character-*.glb")),
                "robot": "RobotExpressive.glb (Idle, Walking, Running, Dance, ThumbsUp, Wave, Yes, No…)",
            },
        }
        say("✅ 3D: " + ", ".join(f"{d.name} ({sum(1 for _ in d.iterdir())})" for d in sorted(models.iterdir()) if d.is_dir()))

        # 1د. شخصيات وأشكال 2D من Kenney (متقسمة أجزاء + وضعيات جاهزة)
        art2d = fresh(ASSETS / "2d")
        for slug in KENNEY_2D:
            say(f"⏳ Kenney {slug}")
            with zipfile.ZipFile(kenney_zip(slug, tmp / f"{slug}.zip")) as z:
                for m in z.namelist():
                    if m.endswith("/") or m.lower().endswith((".url", ".swf")) or "Spritesheet" in m or Path(m).name in ("Preview.png", "Sample.png"):
                        continue
                    out = art2d / slug / m
                    out.parent.mkdir(parents=True, exist_ok=True)
                    out.write_bytes(z.read(m))
        toon = art2d / "toon-characters"
        catalog["characters2d"] = {
            "license": "CC0 (Kenney)",
            "toon": {c.name: {"parts": sorted(p.stem for p in (c / "PNG/Parts").glob("*.png")),
                              "poses": sorted(p.stem.split("_")[-1] for p in (c / "PNG/Poses").glob("*.png"))}
                     for c in sorted(toon.iterdir()) if (c / "PNG/Parts").exists()},
            "dirs": {slug: f"2d/{slug}/" for slug in KENNEY_2D},
        }
        say(f"✅ 2D: {len(catalog['characters2d']['toon'])} شخصية toon + modular + shape + animals")

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
