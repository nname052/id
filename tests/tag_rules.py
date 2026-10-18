"""اختبار قواعد tags الإحساس (من غير AI ولا صوت):
- tag مش في قايمة ElevenLabs الموثّقة ← بيتشال.
- tag مش على نبرة الجملة (ضحكة على معلومة، همس على جملة عادية) ← بيتشال.
- موضوع جد: مفيش ضحك ولا همس، والسؤال من غير tag.
- نكتة/سر مستنتجين من غير علامة صريحة ← none؛ وعلامة الكاتب بتتحسب.
- صوت مش كلام واحد بالكتير في المشهد (إلا dramatic)، والدليل لازم من الجملة.
- مشهد صورته هتبقى سبورة فاضية بيتعلّم عليه.
الاستخدام: .venv/bin/python tests/tag_rules.py
"""

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from app.pipeline import script as script_stage  # noqa: E402
from app.pipeline import tags  # noqa: E402


def L(i, text, tts, beat="none", ev="", writer=False):
    return {"id": i, "display": text, "tts": tts, "beat": beat, "evidence": ev, "writer_beat": writer}


def main() -> int:
    fails = []
    lines = [
        L(0, "فيه ناس قاعدة ساكتة في القعدة.", "[whispers] فيه ناس قاعدة ساكتة في القعدة.", "none"),            # همس على جملة عادية
        L(1, "ده واحد من ستاشر نمط.", "[matter-of-fact] ده واحد من ستاشر نمط.", "none"),                      # مش موثّق
        L(2, "وبيحب كل حاجة تكون مترتبة.", "[chuckles] وبيحب كل حاجة تكون مترتبة.", "joke", "مترتبة"),          # نكتة مستنتجة من غير علامة
        L(3, "بيني وبينك، محدش بيعمل كده.", "[whispers] بيني وبينك، محدش بيعمل كده.", "secret", "بيني وبينك"),  # سر بعلامة صريحة
        L(4, "تاني سبب: إنت شخصيًا.", "تاني سبب: [chuckles] إنت شخصيًا.", "joke", "إنت شخصيًا", True),          # نكتة الكاتب
        L(5, "وكمان بتعمل كده كل يوم.", "[laughs] وكمان بتعمل كده كل يوم.", "joke", "كل يوم", True),           # صوت تاني في نفس المشهد
        L(6, "حوالي اتنين في المية بس.", "[surprised] حوالي اتنين في المية بس.", "surprise", "اتنين في المية"),
        L(7, "الحل بسيط.", "[sighs] الحل بسيط.", "reflective", "كلام مش في الجملة"),                          # دليل مش من الجملة
        L(8, "وكمان هي اتعلمت حاجة أهم.", "[whispers] وكمان هي اتعلمت حاجة أهم.", "secret", "حاجة أهم", True),   # تشويق مش سر (حتى لو الكاتب علّمه)
    ]
    out, rep = tags.validate(lines, "light", {4: 1, 5: 1})
    got = {o["id"]: tags.tags_of(o["tts"]) for o in out}
    want = {0: [], 1: [], 2: [], 3: ["whispers"], 4: ["chuckles"], 5: [], 6: ["surprised"], 7: [], 8: []}
    for k, v in want.items():
        if got[k] != v:
            fails.append(f"line {k}: got {got[k]}, want {v}")
    if any(t not in tags.ALLOWED for o in out for t in tags.tags_of(o["tts"])):
        fails.append("unknown tag survived")
    # موضوع جد
    ser = [L(0, "ناحية منه نازلة؟", "[curious] ناحية منه نازلة?", "question", "نازلة"),
           L(1, "بيني وبينك، الدكتور اتأخر.", "[whispers] بيني وبينك، الدكتور اتأخر.", "secret", "بيني وبينك", True),
           L(2, "ماتستناش لما تروح.", "[serious] ماتستناش لما تروح.", "warning", "ماتستناش")]
    out2, _ = tags.validate(ser, "serious", {})
    g2 = [tags.tags_of(o["tts"]) for o in out2]
    if g2 != [[], [], ["serious"]]:
        fails.append(f"serious topic: {g2}")
    # المشاهد: سبورة فاضية
    scenes = [{"visual": "whiteboard_drawing", "draw": "فكرة", "sentences": [{"text": "الموضوع مهم.", "beat": "none"}]},
              {"visual": "chart", "draw": "رسم بياني", "sentences": [{"text": "ده بيأثر عليك.", "beat": "none"}]},
              {"visual": "character", "draw": "راجل كبير وناحية من وشه نازلة", "sentences": [{"text": "بص على وشه.", "beat": "none"}]},
              {"visual": "chart", "draw": "ساعة جنبها عداد", "sentences": [{"text": "كل دقيقة بيخسر ٢ مليون خلية.", "beat": "none"}]}]
    flagged = [f["index"] for f in script_stage.check_scenes(scenes)]
    if flagged != [0, 1]:
        fails.append(f"empty boards flagged {flagged}, want [0, 1]")
    print(f"light: {got}\nserious: {g2}\nempty boards: {flagged}\nstats: {rep['stats']}")
    print("PASS" if not fails else "FAIL:\n  " + "\n  ".join(fails))
    return 1 if fails else 0


if __name__ == "__main__":
    sys.exit(main())
