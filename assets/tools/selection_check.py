# فحص الاختيار: المقاس المصحَّح لكل حاجة في المواضيع التلاتة مقارنة بالمرجع الحقيقي (±15%).
# بيقرا assets_manifest.json (بعد inventory.py) وبيطبع جدول Markdown.  التشغيل: .venv/bin/python assets/tools/selection_check.py
import json, sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).parent))
import inventory as I

ROOT = Path(__file__).resolve().parents[2]
TOL = 0.15
# (موضوع، دور، مكتبة، اسم، نوع القياس، المرجع بالمتر، وصف المرجع). المراجع من طلب المستخدم، والباقي قيم معروفة مكتوب جنبها (typical)
SELECTION = [
    ("1 serious", "prop", "furniture-kit", "desk", "top", 0.75, "table/desk top ~0.75 m"),
    ("1 serious", "prop", "furniture-kit", "chairDesk", "seat", 0.45, "chair seat ~0.45 m"),
    ("1 serious", "prop", "food-kit", "cup", "h", 0.10, "mug ~0.10 m"),
    ("1 serious", "env", "furniture-kit", "wall", "h", 2.7, "wall 2.4-3.0 m"),
    ("1 serious", "env", "furniture-kit", "wallWindow", "h", 2.7, "wall 2.4-3.0 m"),
    ("2 light", "prop", "food-kit", "cup", "h", 0.10, "mug ~0.10 m"),
    ("2 light", "prop", "furniture-kit", "kitchenCoffeeMachine", "h", 0.35, "drip coffee machine ~0.35 m (typical)"),
    ("2 light", "prop", "food-kit", "apple", "h", 0.08, "apple ~0.08 m (typical)"),
    ("2 light", "env", "furniture-kit", "kitchenBar", "top", 0.9, "kitchen counter ~0.9 m"),
    ("2 light", "env", "furniture-kit", "kitchenSink", "top", 0.9, "kitchen counter ~0.9 m"),
    ("2 light", "env", "furniture-kit", "wallWindow", "h", 2.7, "wall 2.4-3.0 m"),
    ("3 neutral", "prop", "kaykit-furniture", "couch", "h", 0.85, "sofa ~0.85 m tall"),
    ("3 neutral", "prop", "kaykit-furniture", "lamp_standing", "h", 1.6, "floor lamp ~1.6 m (typical)"),
    ("3 neutral", "prop", "food-kit", "cup-tea", "h", 0.10, "mug ~0.10 m"),
    ("3 neutral", "env", "kaykit-restaurant", "wall", "h", 2.7, "wall 2.4-3.0 m"),
]
# اتشالوا من الاختيار لأنهم برّه ±15% حتى بعد التصحيح (مرسومين بمقاس مختلف عن باقي مكتبتهم)
REJECTED = [
    ("1 serious", "furniture-kit", "laptop", "h", 0.24, "open laptop ~0.24 m (typical)"),
    ("1 serious", "food-kit", "cup-coffee", "h", 0.10, "mug ~0.10 m"),
    ("2 light", "food-kit", "croissant", "len", 0.14, "croissant ~0.14 m long (typical)"),
    ("2 light", "kaykit-restaurant", "kitchencounter_straight_A_backsplash", "top", 0.9, "kitchen counter ~0.9 m"),
    ("3 neutral", "kaykit-furniture", "book_single", "h", 0.22, "book ~0.22 m tall"),
    ("3 neutral", "furniture-kit", "books", "len", 0.22, "book ~0.22 m tall"),
]

def measure(by, lib, name, kind):
    e = by[(lib, name)]; f = e["scale_factor"]["value"]
    raw = I.surf_height(e, kind) if kind in ("seat", "top") else I.dims(e["scale"]["size_m"])[kind]
    return raw, f, raw * f

def rows(by, items, with_role=True):
    out = []
    for it in items:
        topic, role, lib, name, kind, ref, label = it if with_role else (it[0], "rejected", *it[1:])
        raw, f, cor = measure(by, lib, name, kind)
        d = (cor - ref) / ref
        out.append(dict(topic=topic, role=role, asset=f"{lib}/{name}", kind=kind, raw=round(raw, 3), factor=f, corrected=round(cor, 3), ref=ref, label=label,
                        dev=round(d * 100), ok=abs(d) <= TOL))
    return out

def main():
    m = json.loads((ROOT / "assets_manifest.json").read_text())
    by = {(e["library"], e["name"]): e for e in m["assets"]}
    sel, rej = rows(by, SELECTION), rows(by, REJECTED, with_role=False)
    print("| Topic | Role | Asset | Measure | Raw (m) | Factor | Corrected (m) | Reference | Deviation | Result |")
    print("|---|---|---|---|---|---|---|---|---|---|")
    for r in sel + rej:
        res = ("PASS" if r["ok"] else "FAIL") if r["role"] != "rejected" else ("rejected (FAIL)" if not r["ok"] else "rejected")
        print(f"| {r['topic']} | {r['role']} | `{r['asset']}` | {r['kind']} | {r['raw']} | ×{r['factor']} | {r['corrected']} | {r['ref']} ({r['label']}) | {r['dev']:+d}% | {res} |")
    props = [r for r in sel if r["role"] == "prop"]
    print(f"\nselected props within ±15%: {sum(r['ok'] for r in props)}/{len(props)}; selected environment pieces within ±15%: {sum(r['ok'] for r in sel if r['role'] == 'env')}/{sum(r['role'] == 'env' for r in sel)}")
    return all(r["ok"] for r in props)

if __name__ == "__main__":
    sys.exit(0 if main() else 1)
