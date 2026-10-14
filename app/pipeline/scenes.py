"""المرحلة 2: خطة المشاهد. Claude بيختار نوع العنصر وكلمات البحث والحركة، والبحث في المكتبات بيحصل هنا من غير AI."""

from .. import store
from . import assets
from .common import ask, prompt

KINDS = ["illustration", "icon", "emoji", "number", "text"]
SCHEMA = {
    "type": "object",
    "properties": {
        "palette": {"type": "string", "enum": ["warm", "cool", "night", "fresh", "bold"]},
        "scenes": {"type": "array", "minItems": 1, "maxItems": 20, "items": {
            "type": "object",
            "properties": {
                "sentence_ids": {"type": "array", "items": {"type": "integer"}, "minItems": 1},
                "kind": {"type": "string", "enum": KINDS},
                "search": {"type": "array", "items": {"type": "string"}},
                "emoji_name": {"type": "string"},
                "number_value": {"type": "string"},
                "headline": {"type": "string"},
                "cue_word": {"type": "string"},
                "enter": {"type": "string", "enum": ["rise", "pop", "draw", "fade", "slide"]},
                "idle": {"type": "string", "enum": ["float", "pulse", "wobble", "none"]},
            },
            "required": ["sentence_ids", "kind", "search", "headline", "cue_word", "enter", "idle"],
            "additionalProperties": False,
        }},
    },
    "required": ["palette", "scenes"],
    "additionalProperties": False,
}

PALETTES = {  # خلفية، كلام، لون مميز، لون تاني
    "warm": {"bg": "#fef6e4", "ink": "#001858", "accent": "#f582ae", "accent2": "#8bd3dd"},
    "cool": {"bg": "#eef4ff", "ink": "#0b1d51", "accent": "#3d7bfd", "accent2": "#7ee0c3"},
    "night": {"bg": "#16161a", "ink": "#fffffe", "accent": "#ff8906", "accent2": "#7f5af0"},
    "fresh": {"bg": "#f2fbf3", "ink": "#123524", "accent": "#2fb36d", "accent2": "#ffd166"},
    "bold": {"bg": "#fff3e6", "ink": "#1b1b1f", "accent": "#ff4d2e", "accent2": "#ffb800"},
}


def resolve(sc: dict, used: set) -> dict:
    """بيختار الملف من المكتبات. لو النوع المطلوب ما لقاش حاجة، بينزل للنوع اللي بعده."""
    terms = sc.get("search") or [sc["headline"]]
    order = {"illustration": ["illustration", "icon", "emoji"], "icon": ["icon", "illustration"],
             "emoji": ["emoji", "icon"]}.get(sc["kind"], [])
    for kind in order:
        q = [sc["emoji_name"]] if kind == "emoji" and sc.get("emoji_name") else terms
        hit = assets.search(kind, q, used)
        if hit:
            used.add(hit["file"])
            enter = sc["enter"] if kind == "icon" or sc["enter"] != "draw" else "rise"
            return {**sc, "kind": kind, "enter": enter, "asset": hit["file"], "asset_name": hit["name"],
                    "license": hit.get("license"), "fetched": hit.get("fetched", False)}
    if sc["kind"] in ("number", "text"):
        return sc
    return {**sc, "kind": "text", "enter": "pop"}  # مفيش صورة مناسبة: كلمة كبيرة بدل حاجة مش في مكانها


def run(pid: str, instruction: str | None = None) -> None:
    d = store.project_dir(pid)
    script = store.read_json(d / "script.json")
    n = len(script["sentences"])
    sentences = "\n".join(f"{s['id']}: {s['text']}" for s in script["sentences"])
    system = prompt("scene_plan", sentences=sentences, min_scenes=max(2, n // 2), max_scenes=n)
    user = "اعمل خطة المشاهد."
    old = store.read_json(d / "scenes" / "plan.json")
    if instruction and old:
        user += f"\n\nالخطة الحالية:\n{old['raw']}\n\nالمطلوب تعديله: {instruction}"
    data = ask(pid, "scenes", system, user, SCHEMA)
    used: set = set()
    scenes = [resolve(sc, used) | {"id": f"s{i + 1:02d}"} for i, sc in enumerate(data["scenes"])]
    plan = {"palette_name": data["palette"], "palette": PALETTES[data["palette"]], "scenes": scenes,
            "credits": assets.credits_for([s.get("asset") for s in scenes if s.get("asset")]),
            "raw": [{k: v for k, v in sc.items() if k in ("sentence_ids", "kind", "search", "headline")} for sc in data["scenes"]]}
    store.write_json(d / "scenes" / "plan.json", plan)
