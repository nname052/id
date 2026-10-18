"""اختبار قواعد المحرر الأوتوماتيك (من غير ميديا):
- الانتقالات: نفس اللقطة ← قطع عادي، لحظة تأكيد («بس»/«تانيًا»/رقم) ← زووم على الوش للجزء ده بس، لقطة مختلفة ← قطع صريح، crossfade صوت 60 مللي،
  والمزج القديم (style=simple) 10 فريم (12 على 60).
- الترجمة: كل سطر بين 1.2 و 5 ث، بيقف عند سكتة ومش بكلمة معلّقة، ومنطقتها تحت ومنفصلة عن منطقة الكروت.
- الكروت: كل كارت مربوط بكلام اتقال، كارت واحد بس في نفس الوقت.
- الطلب (brief) والتعديل بالكلام للمراحل الجديدة.
الاستخدام: .venv/bin/python tests/montage_edit_rules.py
"""

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from app.montage import brief, cuts, graphics, nl  # noqa: E402


def W(word, a, b, p=0.95):
    return {"word": word, "start": a, "end": b, "p": p}


WORDS = [W("النهارده", 0.40, 0.95), W("هنتكلم", 0.95, 1.40), W("عن", 1.40, 1.55), W("التركيز.", 1.55, 2.20),
         W("أول", 2.80, 3.05), W("حاجة", 3.05, 3.40), W("اقفل", 3.40, 3.80), W("الموبايل", 3.80, 4.40),
         W("وبعدين", 5.10, 5.50), W("اشتغل", 5.50, 5.90), W("ساعة", 5.90, 6.30), W("كاملة،", 6.30, 6.90),
         W("ومن", 7.30, 7.50), W("غير", 7.50, 7.70), W("ما", 7.70, 7.80), W("تبص", 7.80, 8.10), W("لأي", 8.10, 8.40), W("حاجة", 8.40, 8.80), W("تانية.", 8.80, 9.40),
         W("ده", 10.10, 10.30), W("بيوفّر", 10.30, 10.80), W("تلاتين", 10.80, 11.30), W("دقيقة", 11.30, 11.80), W("كل", 11.80, 12.00), W("يوم.", 12.00, 12.50)]
for i, w in enumerate(WORDS):
    w["src_i"] = i


def main() -> int:
    fails = []
    # الانتقالات
    segs = [{"id": "g1", "source": "s1", "start": 0.3, "end": 4.6}, {"id": "g2", "source": "s1", "start": 5.0, "end": 9.6},
            {"id": "g3", "source": "s2", "start": 0.0, "end": 3.0}]
    tr = cuts.plan_transitions(segs, {"s1": []}, "normal", 30)
    fast = cuts.plan_transitions(segs, {"s1": []}, "fast", 30)
    # نفس اللقطة ← قطع عادي بنفس التأطير، لقطة مختلفة ← قطع صريح
    if [t["kind"] for t in tr] != ["hard", "hard"] or cuts.segment_zooms(tr, 3) != [1.0, 1.0, 1.0]:
        fails.append(f"transitions: {[(t['kind'], t.get('zoom_after')) for t in tr]}")
    if any(t["audio_ms"] != 60 for t in tr) or any(t["kind"] != "hard" for t in fast):
        fails.append("audio crossfade on every cut / fast pace = hard cuts")
    # المزج القديم لسه موجود لو اتطلب (style=simple): 10 فريم على 30، و 12 على 60
    simple, simple60 = cuts.plan_transitions(segs, {"s1": []}, "normal", 30, style="simple"), cuts.plan_transitions(segs, {"s1": []}, "normal", 60, style="simple")
    if simple[0]["kind"] != "dissolve" or simple[0]["frames"] != 10 or simple60[0]["frames"] != 12:
        fails.append(f"simple style dissolve: {[(t['kind'], t['frames']) for t in simple]}")
    # زووم التأكيد بس عند «بس/تانيًا/الحقيقة» أو رقم، وبين كل اتنين PUNCH_GAP، ومفيش سحبة/فلاش في نفس اللقطة
    sg = [{"id": f"m{i}", "source": "s1", "start": i * 3.0, "end": i * 3.0 + 2.6, "text": x} for i, x in
          enumerate(["النهارده هتكلم", "وده مهم", "بس الحقيقة إن", "أولا اقفل", "وكمان اشتغل", "تانيا خد بريك", "وبعدين كمل", "لكن خلي بالك"])]
    tm = cuts.plan_transitions(sg, {"s1": []}, "normal", 60)
    kinds = [t["kind"] for t in tm]
    punches = [t for t in tm if t["kind"] == "jumpzoom"]
    zs = cuts.segment_zooms(tm, len(sg))
    if kinds[1] != "jumpzoom" or any(k in ("whip", "whip_r", "zoom", "flash") for k in kinds) or \
            any(b["t"] - a["t"] < cuts.PUNCH_GAP for a, b in zip(punches, punches[1:])) or any(z > 1 and zs[i + 1] > 1 for i, z in enumerate(zs[:-1])):
        fails.append(f"meaning transitions: {kinds} zooms {zs}")

    # الترجمة
    one = [{"id": "g1", "source": "s1", "start": 0.3, "end": 12.7}]
    cues = cuts.subtitle_cues(one, {"s1": WORDS}, 30, 1.2, 5.0)
    durs = [c["end"] - c["start"] for c in cues]
    if not cues or min(durs) < 1.2 - 1e-6 or max(durs) > 5.0 + 1e-6:
        fails.append(f"cue durations out of 1.2–5 s: {durs}")
    for c in cues:
        if cuts.norm(c["words"][-1]["word"]) in cuts.DANGLING and c is not cues[-1]:
            fails.append(f"line ends with a dangling word: {c['text']}")
    for a, b in zip(cues, cues[1:]):
        if b["words"][0]["start"] - a["words"][-1]["end"] < 0.0:
            fails.append("cues overlap")
    for asp in ("9:16", "16:9"):
        z = cuts.SAFE[asp]
        if z["top"] < 0.5:
            fails.append(f"subtitle zone {asp} not in the bottom part: {z}")
        for name, cz in graphics.CARD_ZONES[asp].items():
            if not (cz["bottom"] <= z["top"] or cz["top"] >= z["bottom"]):
                fails.append(f"card zone {asp}/{name} overlaps subtitle zone")

    # الكروت
    cards, ideas = graphics.plan(one, cues, brief.parse(""))
    if not cards or not all(graphics.maps_to_speech(c, cues) for c in cards):
        fails.append(f"cards not mapped to speech: {cards}")
    if any(b["start"] < a["end"] for a, b in zip(cards, cards[1:])):
        fails.append("two cards on screen at once")
    nums = [c for c in cards if c["kind"] == "number"]
    if not nums or nums[0]["title"] != "٣٠":
        fails.append(f"spoken number «تلاتين دقيقة» should give a number card ٣٠: {[(c['kind'], c['title']) for c in cards]}")
    fake = dict(cards[0], source_text="كلام ما اتقالش خالص")
    if graphics.maps_to_speech(fake, cues):
        fails.append("a card with no matching sentence was accepted")
    off, _ = graphics.plan(one, cues, {**brief.parse(""), "graphics": "off"})
    if off:
        fails.append("graphics off still made cards")

    # الطلب
    b = brief.parse("عايزه إيقاع سريع، كروت فخمة، ترجمة كبيرة صفرا، ستايل سينمائي. ركّز على: التركيز")
    want = {"pace": "fast", "mood": "elegant", "sub_size": "large", "sub_color": "yellow", "look": "cinematic"}
    if any(b[k] != v for k, v in want.items()) or b["focus"] != ["التركيز"]:
        fails.append(f"brief parse: {b}")
    if brief.parse("")["look"] != "natural":
        fails.append("default look must be natural (no stylized filter unless chosen)")

    # التعديل بالكلام
    s4 = {"data": {"cues": cues}, "params": {"max_chars": 30, "size": "medium", "color": "white", "panel": True, "pos": "bottom"}, "user_params": {}}
    r = nl.propose("s4_subs", s4, "حط الترجمة أعلى شوية", {})
    if r.get("new_params", {}).get("pos") != "raised":
        fails.append(f"subtitle position edit: {r}")
    s5 = {"data": {"cards": cards}, "params": {"graphics": "on", "mood": "clean", "density": "normal", "removed": []}, "user_params": {}}
    r = nl.propose("s5_graphics", s5, "شيل الكارت 1", {})
    if r.get("user_params", {}).get("removed") != [cards[0]["source_text"]]:
        fails.append(f"remove card edit: {r}")
    cards2, _ = graphics.plan(one, cues, brief.parse(""), {cuts.norm(cards[0]["source_text"])})
    if any(c["source_text"] == cards[0]["source_text"] for c in cards2):
        fails.append("removed card came back")
    s2 = {"data": {"segments": segs, "fps": 30}, "params": {"dead_air": 0.7, "breath_out": 0.22, "breath_in": 0.14, "transitions": "auto"}, "user_params": {}}
    r = nl.propose("s2_cut", s2, "خلّي القصّات أهدى", {})
    if not r.get("new_params") or r["new_params"]["dead_air"] <= 0.7:
        fails.append(f"slower cuts edit: {r}")
    fx = nl.fix_lines({"data": {"cues": [dict(cues[0], words=[dict(w, source="s1") for w in cues[0]["words"]])]}, "params": {"fixes": {}}, "user_params": {}},
                      {cues[0]["id"]: "النهارده هنتكلم عن الهدف"})
    if fx.get("user_params", {}).get("fixes", {}).get("s1:3") != {"from": "التركيز.", "to": "الهدف"}:
        fails.append(f"subtitle line fix: {fx}")

    print(f"transitions: {[(t['kind'], t['frames'], t['audio_ms']) for t in tr]} · meaning: {kinds}")
    print(f"cues: {[(c['text'], round(c['end'] - c['start'], 2)) for c in cues]}")
    print(f"cards: {[(c['kind'], c['title'], c['start'], c['end']) for c in cards]}")
    print("PASS" if not fails else "FAIL:\n  " + "\n  ".join(fails))
    return 1 if fails else 0


if __name__ == "__main__":
    sys.exit(main())
