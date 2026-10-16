"""مرحلة الرؤية الإخراجية: Claude بيكتب إزاي الفيديو هيتعمل (الأسلوب، الشخصيات، الكاميرا، كل مشهد)،
من طلب الإخراج اللي كتبته (لو فيه) أو من دماغه، وبيستنى موافقتك قبل ما يخطط المشاهد."""

from .. import history, prefs, store
from . import three_d
from .common import ask, prompt

STYLES = ["motion2d", "cinematic2d", "3d", "anime3d", "mixed"]
SCHEMA = {"type": "object", "properties": {
    "concept": {"type": "string"},
    "style": {"type": "string", "enum": STYLES},
    "look": {"type": "string"},
    "characters": {"type": "string"},
    "camera": {"type": "string"},
    "beats": {"type": "array", "minItems": 1, "items": {"type": "object", "properties": {
        "sentence_ids": {"type": "array", "items": {"type": "integer"}, "minItems": 1},
        "idea": {"type": "string"}}, "required": ["sentence_ids", "idea"], "additionalProperties": False}},
    "different": {"type": "string"}},
    "required": ["concept", "style", "look", "characters", "camera", "beats", "different"], "additionalProperties": False}


def run(pid: str, instruction: str | None = None) -> None:
    d = store.project_dir(pid)
    proj = store.load(pid)
    script = store.read_json(d / "script.json")
    sentences = "\n".join(f"{s['id']}: {s['text']}" for s in script["sentences"])
    system = prompt("brief", catalog=three_d.catalog(), recent=history.summary(skip_pid=pid) or "(مفيش)", sentences=sentences)
    direction = (proj.get("direction") or "").strip()
    user = (f"طلب الإخراج من صاحب الفيديو (التزم بيه): {direction}" if direction
            else "صاحب الفيديو ما كتبش طلب إخراج: اقترح إنت أحسن رؤية للفكرة دي.")
    user += "\n\n" + prefs.context_block(proj["prompt"])
    old = store.read_json(d / "brief.json")
    if instruction and old:
        user += f"\n\nالرؤية الحالية:\n{old}\n\nالمطلوب تعديله: {instruction}"
    data = ask(pid, "brief", system, user, SCHEMA)
    store.write_json(d / "brief.json", data)


def as_text(b: dict) -> str:
    """الرؤية كنص للبرومبتات اللي بعدها."""
    beats = "\n".join(f"  - جمل {x['sentence_ids']}: {x['idea']}" for x in b["beats"])
    return (f"الفكرة: {b['concept']}\nالأسلوب: {b['style']}\nالشكل: {b['look']}\nالشخصيات: {b['characters']}\n"
            f"الكاميرا: {b['camera']}\nالمشاهد:\n{beats}")
