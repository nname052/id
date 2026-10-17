# جرد مكتبات الـ 3D: كل ملف (شخصية، حاجة، قطعة مكان، HDRI، حركة) بمقاسه الحقيقي بالمتر (متقاس من الصندوق المحيط)
# ورخصته، وبيطلّع قايمة الحاجات اللي مقاسها برّه المعقول لنوعها.
# التشغيل (السيرفر شغّال على 8000):  .venv/bin/python assets/tools/inventory.py
import json, re, sys
from pathlib import Path
from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[2]
A3 = ROOT / "assets" / "3d"
PROCEDURAL_PROPS = ["book"]
EXT = {".glb", ".gltf", ".fbx", ".obj", ".hdr", ".exr"}

# ---------- الرخص (من ملف الرخصة جنب الحاجة لو موجود، أو من المصدر الموثّق في سكريبتات التنزيل) ----------
KENNEY = {"car-kit", "city-kit-commercial", "city-kit-roads", "city-kit-suburban", "food-kit", "furniture-kit", "holiday-kit", "mini-characters", "nature-kit"}
def license_for(rel: Path):
    lib = rel.parts[0] if len(rel.parts) > 1 else rel.name
    local = next((p for p in (A3 / lib).glob("*") if p.is_file() and re.match(r"licen[cs]e", p.name, re.I)), None) if (A3 / lib).is_dir() else None
    ev_local = f"local file assets/3d/{lib}/{local.name}" if local else None
    if lib in KENNEY:
        return dict(license="CC0 1.0 (Kenney)", license_clear=True, source=f"kenney.nl/assets/{lib}",
                    license_evidence="source documented in assets/fetch_assets.py (KENNEY_3D) and assets/README.md")
    if lib.startswith("kaykit-"):
        return dict(license="CC0 1.0 (KayKit, Kay Lousberg)", license_clear=bool(local), source="github.com/KayKit-Game-Assets",
                    license_evidence=ev_local or "missing")
    if lib in ("ual1", "ual2"):
        return dict(license="CC0 1.0 (Quaternius Universal Animation Library)", license_clear=bool(local), source="quaternius.com",
                    license_evidence=ev_local or "missing", notes="pack files must not be redistributed (videos are fine)")
    if lib == "hdri":
        return dict(license="CC0 1.0 (Poly Haven)", license_clear=True, source="polyhaven.com",
                    license_evidence="source documented in assets/fetch_assets.py (dl.polyhaven.org) and assets/README.md")
    if lib == "rocketbox":
        return dict(license="MIT (Microsoft Rocketbox)", license_clear=True, source="github.com/microsoft/Microsoft-Rocketbox",
                    license_evidence="source documented in assets/tools/fetch_rocketbox.py")
    if lib == "mixamo":
        return dict(license="Adobe Mixamo terms (royalty-free use in projects; files not redistributable)", license_clear=True,
                    source="mixamo.com (downloaded with the user's account)", license_evidence="assets/README.md (Mixamo section)",
                    notes="not in git")
    if rel.name == "RobotExpressive.glb":
        return dict(license="CC0 1.0 (Tomás Laulhé, three.js examples)", license_clear=True,
                    source="github.com/mrdoob/three.js examples/models/gltf/RobotExpressive",
                    license_evidence="source URL in assets/fetch_assets.py (ROBOT_URL); license per assets/README.md")
    return dict(license="unknown", license_clear=False, source="unknown", license_evidence="none found")

# ---------- النوع ----------
ENV_WORDS = "wall|floor|road|street|building|house|tile|roof|door|doorway|window|fence|stair|ground|terrain|path|bridge|sidewalk|crossing|intersection|corner|block|tower|skyscraper|store|shop|planter|hedge|tree|rock|stone|cliff|grass|bush|flower|stump|tent|campfire|statue|streetlight"
def kind_for(rel: Path, meas: dict):
    lib = rel.parts[0] if len(rel.parts) > 1 else ""
    n = rel.stem.lower()
    if rel.suffix.lower() in (".hdr", ".exr"): return "hdri"
    if lib == "mixamo" and rel.parts[1] == "anims": return "motion_clip"
    if lib in ("rocketbox", "kaykit-adventurers", "ual1", "ual2") or (lib == "mixamo") or rel.name == "RobotExpressive.glb": return "character"
    if lib == "mini-characters": return "character" if n.startswith("character") else "prop"
    if lib in ("city-kit-roads", "city-kit-suburban", "city-kit-commercial", "nature-kit", "kaykit-city"): return "environment"
    if tokens(rel.stem) & set(ENV_WORDS.split("|")): return "environment"
    return "prop"

# ---------- المدى المعقول لكل نوع (متر): (نمط الاسم، البُعد، أقل، أكتر). البُعد: h = الارتفاع، len = أطول بُعد أفقي، max = أطول بُعد ----------
RANGES = [  # كلمات كاملة من اسم الملف (مش أجزاء: vegetable ما تتحسبش table، و bush ما تتحسبش bus)
    ("debris wreck part wheel tire", "max", 0.05, 3.0, "vehicle part"),
    ("crate box rack dishrack basket sack barrel pallet", "max", 0.15, 2.5, "container/rack"),
    ("crop crops sprout stage", "h", 0.05, 2.5, "crop plant"),
    ("mug cup glass teacup", "h", 0.06, 0.2, "cup/mug"),
    ("bottle wine soda can carton", "h", 0.1, 0.4, "bottle/can"),
    ("plate bowl dish", "max", 0.08, 0.4, "plate/bowl"),
    ("pizza cake pie", "max", 0.15, 0.5, "pizza/cake"),
    ("apple banana orange lemon tomato egg carrot pear peach cherry grape strawberry onion potato avocado corn donut cookie muffin cupcake burger sandwich taco croissant bread sushi maki fries hotdog icecream popsicle chocolate cheese fish meat steak sausage pepper eggplant broccoli cabbage lettuce pumpkin watermelon melon pineapple coconut skewer", "max", 0.02, 0.45, "food item"),
    ("chair armchair seat", "h", 0.65, 1.2, "chair"),
    ("stool", "h", 0.35, 0.9, "stool"),
    ("desk", "h", 0.6, 0.85, "desk"),
    ("table", "h", 0.35, 1.15, "table"),
    ("bed", "len", 1.8, 2.4, "bed"),
    ("sofa couch lounge", "len", 1.2, 2.8, "sofa"),
    ("bookcase shelf cabinet wardrobe closet dresser drawer", "h", 0.3, 2.4, "storage furniture"),
    ("fridge refrigerator", "h", 1.4, 2.1, "fridge"),
    ("oven stove washer dryer dishwasher", "h", 0.8, 1.0, "kitchen appliance"),
    ("television tv monitor screen", "max", 0.3, 1.8, "screen"),
    ("laptop computer keyboard", "max", 0.2, 0.6, "computer"),
    ("phone smartphone", "max", 0.1, 0.22, "phone"),
    ("book", "max", 0.12, 0.4, "book"),
    ("lamp", "h", 0.2, 2.0, "lamp"),
    ("door doorway", "h", 1.9, 2.6, "door"),
    ("wall", "h", 2.2, 4.5, "wall piece"),
    ("toilet", "h", 0.35, 0.85, "toilet"),
    ("bathtub tub", "len", 1.2, 1.9, "bathtub"),
    ("plant pot vase", "h", 0.1, 2.2, "plant/vase"),
    ("wheelchair", "h", 0.8, 1.2, "wheelchair"),
    ("cane crutch", "h", 0.8, 1.6, "walking aid"),
    ("glasses sunglasses", "max", 0.11, 0.17, "glasses"),
    ("truck bus firetruck garbage", "len", 5.0, 13.0, "large vehicle"),
    ("sedan suv van taxi police ambulance hatchback car race sports delivery", "len", 3.2, 6.5, "car"),
    ("tree pine palm oak birch", "h", 1.5, 35.0, "tree"),
    ("building skyscraper tower watertower", "h", 4.0, 300.0, "building"),
    ("house", "h", 3.0, 15.0, "house"),
]
def tokens(stem):
    t = re.sub(r"([a-z])([A-Z])", r"\1 \2", stem)
    return {w.lower().rstrip("s") if len(w) > 3 else w.lower() for w in re.split(r"[^A-Za-z]+", t) if w}
GENERIC = {"prop": ("max", 0.02, 3.0, "generic prop"), "environment": ("max", 0.2, 80.0, "generic environment piece")}

def dims(size):
    x, y, z = size
    return {"h": y, "len": max(x, z), "max": max(x, y, z)}

def scale_issue(entry, corrected=False):
    sc = entry.get("scale_corrected") if corrected else entry["scale"]
    if entry["type"] not in ("prop", "environment") or not sc or not sc.get("size_m"):
        return None
    tk = tokens(Path(entry["path"]).stem)
    d = dims(sc["size_m"])
    for words, dim, lo, hi, label in RANGES:
        if tk & {w.rstrip("s") if len(w) > 3 else w for w in words.split()}:
            break
    else:
        dim, lo, hi, label = GENERIC[entry["type"]]
    v = d[dim]
    if lo <= v <= hi:
        return None
    return {"name": entry["name"], "path": entry["path"], "type": entry["type"], "category": label, "dimension": dim,
            "measured_m": round(v, 4), "plausible_m": [lo, hi], "factor_to_mid": round(((lo * hi) ** 0.5) / v, 3) if v > 0 else None}

# ---------- تصحيح المقاس لكل مكتبة ----------
# المعامل = الوسيط (median) لـ (المقاس الحقيقي ÷ المتقاس) على حاجات مرجعية من نفس المكتبة. مش تخمين لكل حاجة.
# القياسات: h = الارتفاع الكلي، len = أطول بُعد أفقي، seat = ارتفاع أكبر سطح أفقي في النص (قعدة كرسي/كنبة)،
# top = ارتفاع أكبر سطح أفقي في النص العالي (سطح ترابيزة/مكتب/رخامة)
REFS = {
    "furniture-kit": [("desk", "top", 0.75, "desk top"), ("table", "top", 0.75, "table top"), ("chair", "seat", 0.45, "chair seat"),
                      ("chairDesk", "seat", 0.45, "chair seat"), ("loungeSofa", "h", 0.85, "sofa height"), ("wall", "h", 2.7, "wall height (2.4-3.0)"),
                      ("kitchenCabinet", "top", 0.9, "kitchen counter")],
    "kaykit-furniture": [("chair_A", "seat", 0.45, "chair seat"), ("table_medium", "top", 0.75, "table top"), ("couch", "h", 0.85, "sofa height"),
                         ("book_single", "h", 0.22, "book height")],
    "kaykit-restaurant": [("chair_A", "seat", 0.45, "chair seat"), ("kitchentable_A", "top", 0.75, "table top"),
                          ("kitchencounter_straight_A", "top", 0.9, "kitchen counter"), ("door_A", "h", 2.05, "door"), ("wall", "h", 2.7, "wall height (2.4-3.0)")],
    "kaykit-city": [("car_sedan", "h", 1.45, "car height"), ("car_hatchback", "h", 1.45, "car height"), ("car_stationwagon", "h", 1.45, "car height"),
                    ("bench", "h", 0.45, "backless bench seat")],
    "food-kit": [("mug", "h", 0.10, "mug"), ("cup", "h", 0.10, "mug/cup"), ("glass", "h", 0.12, "drinking glass (typical)"),
                 ("bottle-ketchup", "h", 0.20, "ketchup bottle (typical)")],
    "car-kit": [("sedan", "h", 1.45, "car height"), ("police", "h", 1.55, "car height incl. light bar"), ("taxi", "h", 1.6, "car height incl. roof sign"),
                ("suv", "h", 1.70, "SUV height (typical)")],
    "city-kit-suburban": [("fence", "h", 1.1, "garden fence (typical)"), ("fence-1x2", "h", 1.1, "garden fence (typical)"), ("fence-2x2", "h", 1.1, "garden fence (typical)")],
    "city-kit-commercial": [("detail-parasol-a", "h", 2.3, "patio parasol (typical)"), ("detail-parasol-b", "h", 2.3, "patio parasol (typical)")],
    "city-kit-roads": [("construction-cone", "h", 0.7, "traffic cone (typical)"), ("road-sign-stop", "h", 2.2, "stop sign post (typical)"),
                       ("light-square", "h", 6.0, "street light (typical)"), ("light-curved", "h", 6.0, "street light (typical)")],
    "nature-kit": [("canoe", "len", 4.6, "canoe length (typical)"), ("bed", "len", 1.9, "camp bed length (typical)"), ("fence_simple", "h", 1.1, "fence (typical)"),
                   ("tent_smallClosed", "h", 1.2, "2-person tent (typical)"), ("sign", "h", 1.2, "trail sign (typical)")],
    "holiday-kit": [("cabin-door-rotate", "h", 2.05, "door"), ("cabin-wall", "h", 2.4, "wall height (2.4-3.0, low end for a cabin)"),
                    ("bench", "h", 0.85, "bench with backrest (typical)")],
    "mini-characters": [("wheelchair", "h", 0.9, "wheelchair (typical)"), ("wheelchair-deluxe", "h", 0.9, "wheelchair (typical)"),
                        ("aid-cane", "h", 0.9, "walking cane (typical)"), ("aid-crutch", "h", 1.3, "crutch (typical)"), ("aid-glasses", "len", 0.14, "glasses width (typical)")],
}
HUMAN = (1.6, 1.9, 1.75)  # مكتبات الشخصيات: لو الوسيط جوه مدى الكبار يفضل 1.0، غير كده بيتظبط على 1.75م

def surf_height(e, kind):
    s = e["scale"]; H = s["size_m"][1]; sf = s.get("surfaces") or []
    if kind == "seat": c = [x for x in sf if 0.2 * H <= x[0] <= 0.75 * H]
    else: c = [x for x in sf if x[0] >= 0.5 * H]
    return max(c, key=lambda x: x[1])[0] if c else None

def library_factors(out):
    import statistics
    by = {}
    for e in out: by.setdefault(e["library"], []).append(e)
    res = {}
    for lib, items in by.items():
        if lib in REFS:
            ev = []
            for name, kind, real, label in REFS[lib]:
                e = next((x for x in items if x["name"] == name), None)
                if not e or "size_m" not in e["scale"]: continue
                d = dims(e["scale"]["size_m"])
                meas = surf_height(e, kind) if kind in ("seat", "top") else d[kind]
                if not meas: continue
                ev.append({"asset": name, "measure": kind, "label": label, "measured_m": round(meas, 4), "reference_m": real, "ratio": round(real / meas, 3)})
            if ev:
                v = round(statistics.median(x["ratio"] for x in ev), 3)
                spread = round(max(x["ratio"] for x in ev) / min(x["ratio"] for x in ev), 2)
                res[lib] = {"value": v, "reason": f"median of real/measured over {len(ev)} reference items in this library (spread {spread}x)", "evidence": ev}
            continue
        hs = [x["scale"]["size_m"][1] for x in items if x["type"] == "character" and "size_m" in x["scale"]]
        if hs:
            med = statistics.median(hs)
            v = 1.0 if HUMAN[0] <= med <= HUMAN[1] else round(HUMAN[2] / med, 3)
            res[lib] = {"value": v, "reason": (f"character median height {med:.2f} m is inside the adult range {HUMAN[0]}-{HUMAN[1]} m: no correction" if v == 1.0
                        else f"character median height {med:.2f} m (stylized); scaled to a {HUMAN[2]} m adult"),
                        "evidence": [{"measure": "h", "median_character_height_m": round(med, 4), "min_m": round(min(hs), 4), "max_m": round(max(hs), 4), "count": len(hs)}]}
        elif lib == "procedural":
            res[lib] = {"value": 1.0, "reason": "built in code at real-world size (see real_size_m / size_deviation_pct per item)", "evidence": [
                {"asset": x["name"], "measure": "bbox", "measured_m": x["scale"]["size_m"], "reference_m": x["real_size_m"], "deviation_pct": x["size_deviation_pct"]} for x in items]}
        elif lib == "hdri":
            res[lib] = {"value": 1.0, "reason": "HDRI images have no spatial size", "evidence": []}
    return res

def remaining_reason(x):
    lo, hi = x["plausible_m"]; v = x["measured_m"]; r = v / lo if v < lo else v / hi
    if x["category"].startswith("generic"):
        return "no category reference for this name; generic range only (review by eye)"
    if r > 2.5 or r < 0.4:
        return f"{'larger' if r > 1 else 'smaller'} than the kit's reference set by {r:.1f}x: stylized item or the file name category does not fit this object"
    return f"stylized proportion: the kit draws this item {'larger' if r > 1 else 'smaller'} than its reference set ({r:.2f}x off range)"

def main():
    files = sorted(p for p in A3.rglob("*") if p.is_file() and p.suffix.lower() in EXT)
    out = []
    with sync_playwright() as pw:
        b = pw.chromium.launch(args=["--use-gl=angle", "--enable-unsafe-swiftshader"])
        pg = b.new_page()
        pg.goto("http://127.0.0.1:8000/player/tools/inventory.html")
        pg.wait_for_function("window.invReady")
        for i, f in enumerate(files):
            rel = f.relative_to(A3)
            meas = pg.evaluate("(u) => window.measure(u)", "/assets/3d/" + rel.as_posix())
            if i % 100 == 0:
                print(f"{i}/{len(files)} {rel}", flush=True)
                pg.reload(); pg.wait_for_function("window.invReady")  # ذاكرة نضيفة كل 100 ملف
            scale = {k: meas[k] for k in ("size_m", "basis", "unit_to_m", "pixels", "kind", "surfaces") if k in meas}
            if "size_m" in scale:
                s = scale["size_m"]; scale["height_m"] = s[1]; scale["max_dim_m"] = max(s)
            e = {"name": rel.stem, "type": None, "library": rel.parts[0] if len(rel.parts) > 1 else "(root)", "path": "assets/3d/" + rel.as_posix(),
                 "format": rel.suffix.lower()[1:], "scale": scale}
            e["type"] = kind_for(rel, meas)
            e.update(license_for(rel))
            e["license_file_local"] = e["license_evidence"].startswith("local file")
            if meas.get("clips"):
                e["clips"] = {"count": len(meas["clips"]), "items": meas["clips"]}
            if meas.get("bones"): e["bones"] = meas["bones"]
            if meas.get("error"): e["error"] = meas["error"]
            out.append(e)
        # الحاجات المرسومة بالكود (app/player/procedural_props.js): مقاسها متقاس من الموديل المتبني، ومتقارن بالمقاس الحقيقي (±10%)
        for name in PROCEDURAL_PROPS:
            meas = pg.evaluate("(n) => window.measureProcedural(n)", name)
            sz = meas["size_m"]; real = meas["real_m"]
            dev = [round((a - r) / r * 100, 1) for a, r in zip(sz, real)]
            out.append({"name": f"{name}_procedural", "type": "prop", "library": "procedural", "path": f"app/player/procedural_props.js#{name}", "format": "js",
                        "procedural": True, "scale": {"size_m": sz, "basis": meas["basis"], "unit_to_m": 1, "height_m": sz[1], "max_dim_m": max(sz),
                        **({"surfaces": meas["surfaces"]} if "surfaces" in meas else {})},
                        "real_size_m": real, "real_size_label": meas["label"], "size_deviation_pct": dev, "size_within_10pct": all(abs(d) <= 10 for d in dev),
                        "license": "project code (procedural, own work)", "license_clear": True, "source": "this repository",
                        "license_evidence": "generated in code: app/player/procedural_props.js", "license_file_local": True})
        b.close()
    issues_raw = [x for x in (scale_issue(e) for e in out) if x]
    factors = library_factors(out)
    for e in out:
        f = factors.get(e["library"]) or {"value": 1.0, "reason": "no reference items; left at measured size", "evidence": []}
        e["scale_factor"] = {"value": f["value"], "library": e["library"], "reason": f["reason"]}
        if "size_m" in e["scale"]:
            cs = [round(v * f["value"], 4) for v in e["scale"]["size_m"]]
            e["scale_corrected"] = {"size_m": cs, "height_m": cs[1], "max_dim_m": max(cs)}
        else:
            e["scale_corrected"] = {k: e["scale"][k] for k in e["scale"] if k != "surfaces"}
    issues = [x for x in (scale_issue(e, corrected=True) for e in out) if x]
    for x in issues: x["reason"] = remaining_reason(x)
    manifest = {"generated_by": "assets/tools/inventory.py", "library_factors": factors, "scale_check_raw": issues_raw, "scale_basis": "bounding box measured by three.js loaders (glTF in meters; FBX cm x UnitScaleFactor); characters in bind pose; animation-only files use the skeleton box; HDRIs have no spatial size (pixel size recorded)",
                "counts": {}, "assets": out, "scale_check": issues}
    c = manifest["counts"]
    c["total"] = len(out)
    for e in out: c[e["type"]] = c.get(e["type"], 0) + 1
    c["license_unclear_flagged"] = sum(1 for e in out if not e["license_clear"])
    c["excluded_from_selection"] = c["license_unclear_flagged"]
    c["no_local_license_file"] = sum(1 for e in out if not e["license_file_local"])
    c["measure_errors"] = sum(1 for e in out if e.get("error"))
    c["scale_outliers_raw"] = len(issues_raw)
    c["scale_outliers_corrected"] = len(issues)
    (ROOT / "assets_manifest.json").write_text(json.dumps(manifest, ensure_ascii=False, indent=1))
    print(json.dumps(c, indent=1))

if __name__ == "__main__":
    main()
