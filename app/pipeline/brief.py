"""مرحلة الرؤية الإخراجية: Claude بيكتب إزاي الفيديو هيتعمل (الأسلوب، الشخصيات، الكاميرا، كل مشهد)،
من طلب الإخراج اللي كتبته (لو فيه) أو من دماغه، وبيستنى موافقتك قبل ما يخطط المشاهد."""

from .. import history, prefs, store
from . import three_d
from .common import ask, prompt

STYLES = ["whiteboard", "motion2d", "cinematic2d", "3d", "anime3d"]
# كل نوع فيديو ليه أساليبه وقواعده (نوع الفيديو اختيار صاحبه، مش اقتراح)
TYPE_STYLES = {"whiteboard": ["whiteboard"], "regular": ["motion2d", "cinematic2d"], "3d": ["3d", "anime3d"]}
TYPE_RULES = {
    "whiteboard": """نوع الفيديو: **سبورة بيضاء** (whiteboard explainer). إيد ماسكة قلم بترسم وتكتب على سبورة بيضا وبتشرح خطوة خطوة.
  - كل جزء من الكلام = حاجة بتترسم قدامنا: رسمة خطوط، أو أيقونة، أو كلمة مكتوبة بخط اليد، أو سهم بيوصّل فكرتين، أو رقم كبير، أو خط تحت كلمة.
  - الرسم بيتراكم على السبورة في المشهد الواحد (2–4 عناصر)، وبعدين السبورة بتتمسح أو الكاميرا بتتحرك لمكان فاضي.
  - الألوان: أسود للخطوط، ولون أو اتنين بس للتأكيد (زي أحمر وأزرق القلم).
  - `characters`: لو فيه شخص في الحكاية بيترسم كرسمة خطوط (من الرسومات)، مش 3D.""",
    "regular": """نوع الفيديو: **فيديو عادي** (موشن جرافيك 2D زي فيديوهات "مدمن الموبايل"): رسومات فلات، أيقونات، كلام متحرك، أرقام، شخصيات كرتون 2D.
  - `motion2d`: موشن جرافيك شيك بأشكال مشاهد متنوعة.  `cinematic2d`: نفس الكلام بس فيه شخصية كرتون 2D بطلة بتمثّل الحكاية.
  - ممنوع 3D.""",
    "3d": """نوع الفيديو: **3D**: شخصيات 3D في أماكن حقيقية، والحركة لازم **تمثّل القصة** (مش وقفة ثابتة متكررة).
  - `3d` (الأساس): شخصيات **واقعية ومهندمة** (بدل، قمصان، بالطو دكتور، جلابية وشماغ، طرحة) في أماكن حقيقية بإضاءة ناعمة، وإخراج رزين وهادي زي فيلم.
  - `anime3d`: شكل أنيمي/كرتون، **بس لو صاحب الفيديو طلب كده صراحةً**.
  - الشخصية بتعمل الحاجات بجد لما الكلام بيقولها (بتفتح التلاجة، بتقعد على اللابتوب، بتشرب قهوتها، بتبص من الشباك)، ووشها بيعبّر (ابتسامة، قلق، تفكير، جدية).
  - إنت المخرج بالكامل: الحركة حرة (مش متسجلة)، فاكتب في كل beat التمثيل بهدوء مع الكلام (الإيد على الدقن وبتفكر، بتفتح التلاجة،
    بتشرح بإيدها…) وتعبير الوش، والتصوير (حجم اللقطة، الزاوية، حركة كاميرا بطيئة، وقطع قليل ليه سبب).
  - لو الشخصية **بتتكلم** في المشهد (الجملة على لسانها، مش راوي)، قول كده في الـ beat، والشخصية لازم تكون من اللي بيتكلموا: {speakers}.
  - **صوت الفيديو {voice}**: الشخصية اللي بتتكلم بالصوت ده لازم تكون {voice} (غير كده الشخصية بتمثّل بس والراوي بيحكي).
  - **ممنوع الشخصيات دي** (اتستخدمت في آخر الفيديوهات): {banned}.""",
}


def schema(vtype: str) -> dict:
    s = {**SCHEMA, "properties": {**SCHEMA["properties"], "style": {"type": "string", "enum": TYPE_STYLES.get(vtype, STYLES)}}}
    return s


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
    vtype = proj["settings"].get("video_type", "regular")
    vg = proj["settings"].get("voice_gender", "")
    voice = {"male": "راجل", "female": "ست"}.get(vg, "غير محدد")
    speakers = [c for c in three_d.SPEAKERS if not vg or three_d.GENDER[c] == vg]
    rules = TYPE_RULES[vtype].replace("{voice}", voice).replace("{speakers}", "، ".join(speakers)).replace(
        "{banned}", "، ".join(history.recent_characters(skip_pid=pid)) or "(مفيش)")
    system = prompt("brief", catalog=three_d.catalog_for(vtype), recent=history.summary(skip_pid=pid) or "(مفيش)",
                    sentences=sentences, styles=" | ".join(TYPE_STYLES[vtype]), type_rules=rules)
    direction = (proj.get("direction") or "").strip()
    user = (f"طلب الإخراج من صاحب الفيديو (التزم بيه): {direction}" if direction
            else "صاحب الفيديو ما كتبش طلب إخراج: اقترح إنت أحسن رؤية للفكرة دي.")
    user += "\n\n" + prefs.context_block(proj["prompt"])
    old = store.read_json(d / "brief.json")
    if instruction and old:
        user += f"\n\nالرؤية الحالية:\n{old}\n\nالمطلوب تعديله: {instruction}"
    data = ask(pid, "brief", system, user, schema(vtype))
    store.write_json(d / "brief.json", data)


def as_text(b: dict) -> str:
    """الرؤية كنص للبرومبتات اللي بعدها."""
    beats = "\n".join(f"  - جمل {x['sentence_ids']}: {x['idea']}" for x in b["beats"])
    return (f"الفكرة: {b['concept']}\nالأسلوب: {b['style']}\nالشكل: {b['look']}\nالشخصيات: {b['characters']}\n"
            f"الكاميرا: {b['camera']}\nالمشاهد:\n{beats}")
