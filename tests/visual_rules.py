"""اختبار ربط السكريبت بالصور (من غير AI ولا ملفات): مشاهد الكاتب بتتبعت لمرحلة المشاهد، والمشهد بيتقاس عمل نوع الصورة المطلوب ولا لأ،
والسبورة اللي كلام بس بتتملي برسمة الكاتب.
الاستخدام: .venv/bin/python tests/visual_rules.py"""

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from app.pipeline import scenes  # noqa: E402


def main() -> int:
    fails = []
    script = {"sentences": [{"id": 0, "text": "قطتك بتوقّع الكوباية."}, {"id": 1, "text": "ده مش صدفة."}, {"id": 2, "text": "كل يوم ٣ مرات."}],
              "scenes": [{"index": 0, "visual": "character", "draw": "قطة بتزق كوباية", "draw_en": ["cat", "cup", "push"], "sentence_ids": [0, 1]},
                         {"index": 1, "visual": "chart", "draw": "رقم ٣ وساعة", "draw_en": ["clock", "three"], "sentence_ids": [2]}]}
    blk = scenes.writer_block(script, "whiteboard")
    if "قطة بتزق كوباية" not in blk or "number" not in blk:
        fails.append(f"writer block: {blk}")
    plan = [{"id": "s01", "layout": "board", "sentence_ids": [0, 1], "visuals": [], "board": [{"kind": "text", "text": "مش صدفة", "color": "ink", "cue_word": "مش"}]},
            {"id": "s02", "layout": "board", "sentence_ids": [2], "visuals": [], "board": [{"kind": "number", "value": "3", "color": "accent", "cue_word": "٣"},
                                                                                        {"kind": "circle", "target": 0, "color": "accent", "cue_word": "مرات"}]}]
    ws = scenes.writer_scenes(script)
    if [scenes.follows_writer(sc, ws[sc["sentence_ids"][0]], "whiteboard") for sc in plan] != [False, True]:
        fails.append("follows_writer")
    scenes.resolve_visual = lambda v, *a, **k: {"kind": "illustration", "asset": "x.svg", "search": v["search"]}   # من غير مكتبات
    rep = scenes.fill_empty_boards(plan, script, "test", set(), set(), "t")
    if rep["empty_before"] != ["s01"] or rep["filled"] != ["s01"] or rep["empty_after"]:
        fails.append(f"fill: {rep}")
    if plan[0]["board"][0]["kind"] != "illustration" or plan[0]["board"][0]["search"] != ["cat", "cup", "push"]:
        fails.append(f"injected: {plan[0]['board'][0]}")
    if plan[1]["board"][1]["target"] != 0:
        fails.append("untouched board changed")
    if scenes.follows_writer(plan[0], ws[0], "whiteboard") is not True:
        fails.append("after fill the scene should follow the writer")
    b = scenes.drawing_first([{"kind": "text", "text": "اتعلمت"}, {"kind": "illustration", "search": ["man"]}, {"kind": "arrow", "from": 0, "to": 1}])
    if [x["kind"] for x in b] != ["illustration", "text", "arrow"] or (b[2]["from"], b[2]["to"]) != (1, 0):
        fails.append(f"drawing_first: {b}")
    print(f"fill: {rep}")
    print("PASS" if not fails else "FAIL:\n  " + "\n  ".join(fails))
    return 1 if fails else 0


if __name__ == "__main__":
    sys.exit(main())
