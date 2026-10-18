"""قواعد tags الإحساس (ElevenLabs v3) — الكود هو الحَكَم، مش البرومبت لوحده.

ليه: قبل كده البرومبت كان بيطلب «tag في كل جملة في المتوسط» وقايمة مفتوحة («ومسموح tags وصفية زيها»)، والكود كان بيسيب أي [tag].
النتيجة (اتقاست على 3 سكريبتات قديمة): 9 من 38 tag مالهاش علاقة بمعنى الجملة (همس على جملة عادية، ضحكة من غير نكتة)، و 6 tags مش في
قايمة ElevenLabs الموثّقة. القاعدة دلوقتي:
1) كل جملة ليها «نبرة» (beat) واحدة من قايمة ثابتة، بيحددها كاتب السكريبت (أو مخرج الأداء لو السكريبت قديم)، ومعاها الكلمات اللي في الجملة
   نفسها وبتثبت النبرة دي (evidence). جملة عادية = none = من غير tag.
2) كل tag مسموح بس لو في قايمة النبرة بتاعة جملته (الضحكة للنكتة بس، والهمس للسر بس، والتنهيدة للتعب/الحزن…).
3) موضوع جد (tone=serious): ممنوع ضحك وهمس وسخرية ومكر خالص.
4) صوت مش كلام (ضحكة/تنهيدة/زفرة/شهقة): واحد بالكتير في المشهد، إلا لو الجملة نبرتها dramatic.
5) أي tag مش في القايمة الموثّقة بيتشال. الوقفات ([short pause]/[long pause]) مرتين بالكتير في الفيديو، وقبل كشف/تشويق بس.
"""

import re

from .common import TAG, tokens

# من صفحة ElevenLabs الرسمية (Eleven v3 prompting، اتراجعت 2026-10-18): tags اتذكرت فيها بالاسم بس
ALLOWED = {"curious", "excited", "surprised", "amazed", "thoughtful", "calm", "serious", "warmly", "happy", "sad", "frustrated",
           "sarcastic", "mischievously", "whispers", "laughs", "chuckles", "sighs", "exhales", "short pause", "long pause"}
NON_SPEECH = {"laughs", "chuckles", "sighs", "exhales"}           # أصوات حقيقية بتتنطق (مش طريقة كلام)
PAUSES = {"short pause", "long pause"}
SERIOUS_BANNED = {"laughs", "chuckles", "whispers", "sarcastic", "mischievously"}
# في الموضوع الجد السؤال من غير tag ("?" لوحدها بتدّي نغمة السؤال): [curious] على «ناحية منه نازلة؟» في فيديو عن الجلطة طلع فضول/لعب في موقف طوارئ
SERIOUS_BEATS = {"question": set()}
# النبرة ← الـ tags اللي تنفع معاها (أي tag تاني على الجملة دي بيتشال)
BEATS = {
    "none": set(),                                                    # جملة معلومة/سرد عادي: من غير tag
    "hook": {"curious", "serious", "excited", "surprised", "short pause"},
    "question": {"curious"},                                          # سؤال حقيقي
    "surprise": {"surprised", "amazed", "short pause"},               # معلومة صادمة/غير متوقعة
    "joke": {"laughs", "chuckles", "mischievously", "sarcastic"},     # نكتة واضحة أو موقف بيضحّك
    "secret": {"whispers"},                                           # سر/كلام بيني وبينك
    "sad": {"sad", "sighs"},
    "tired": {"sighs", "exhales", "frustrated"},                      # تعب/زهق/إحباط
    "relief": {"exhales", "calm"},
    "warning": {"serious"},                                           # تحذير/تنبيه جد
    "reflective": {"thoughtful", "calm"},                             # حكمة/استنتاج بيتقال بهدوء
    "excited": {"excited", "happy"},                                  # حماس حقيقي في الكلام
    "warm": {"warmly"},                                               # طمأنة/قفلة دافية
    "dramatic": {"serious", "surprised", "sighs", "short pause", "long pause"},   # لحظة درامية (مسموح فيها أكتر من صوت)
}
BEAT_HELP = {
    "none": "سرد/معلومة عادية", "hook": "الهوك (أول جملة)", "question": "سؤال حقيقي بيتسأل", "surprise": "معلومة صادمة أو غير متوقعة",
    "joke": "نكتة واضحة أو موقف بيضحّك فعلًا", "secret": "سر أو كلام بيني وبينك", "sad": "حزن", "tired": "تعب أو زهق أو إحباط",
    "relief": "ارتياح", "warning": "تحذير أو تنبيه جد", "reflective": "حكمة أو استنتاج هادي", "excited": "حماس حقيقي",
    "warm": "طمأنة أو قفلة دافية", "dramatic": "لحظة درامية مقصودة (نادرة)",
}


# نكتة/سر مستنتجين (من غير ما الكاتب يعلّم عليهم) لازم يبقى في الجملة نفسها علامة واضحة، وإلا بيترجعوا none.
# ليه: في المراجعة، مخرج الأداء علّم «حتى لو مش مريحة» كنكتة وحط [chuckles]، والجملة مش نكتة. الفكاهة مش بتتحسب بكلمات، فالقاعدة الآمنة:
# الضحكة والهمس بس لو الكاتب قاصدهم، أو الكلام نفسه فيه ضحكة/سر صريح.
JOKE_CUES = ("ههه", "هههه", "بهزر", "بنهزر", "هزار", "نكتة", "نكته", "بضحك", "ضحكت", "يضحك", "مسخرة", "lol", "haha", "kidding")
SECRET_CUES = ("سر", "بيني وبينك", "بيننا", "محدش يعرف", "ماحدش يعرف", "ما تقولش", "متقولش", "ما تقوليش", "في السر", "secret", "between us")


def cue_ok(beat: str, sentence: str) -> bool:
    t = " " + re.sub(r"[ً-ْـ]", "", sentence) + " "
    cues = JOKE_CUES if beat == "joke" else SECRET_CUES if beat == "secret" else ()
    return any(c in t for c in cues)


def norm_tag(tag: str) -> str:
    return " ".join(tag.strip("[] ").lower().split())


def tags_of(tts: str) -> list[str]:
    return [norm_tag(t) for t in tokens(tts) if TAG.match(t)]


def _words(text: str) -> list[str]:
    return [re.sub(r"[ً-ْـ.,!?،؟؛:…—\-\"'«»()]", "", w) for w in text.split()]


def evidence_ok(evidence: str, sentence: str) -> bool:
    """الدليل لازم يكون كلمات من الجملة نفسها (مش وصف عام)."""
    ev = [w for w in _words(evidence) if w]
    sw = [w for w in _words(sentence) if w]
    # الكلمة موجودة زي ما هي، أو بحرف لازق قبلها (وخلّي ← خلّي، فالحل ← الحل، بالعكس ← العكس)
    return bool(ev) and all(any(x == w or (x.endswith(w) and len(x) - len(w) <= 2) for x in sw) for w in ev)


def validate(lines: list[dict], tone: str, scene_of: dict) -> tuple[list[dict], dict]:
    """lines: [{id, tts, beat, evidence, display}] ← نفس الجمل بعد شيل كل tag مخالف + سجل بكل قرار.
    scene_of: {sentence id: رقم المشهد} علشان حد «صوت واحد في المشهد»."""
    log, stats = [], {"kept": 0, "removed_unknown": 0, "removed_beat": 0, "removed_tone": 0, "removed_scene_limit": 0,
                      "removed_pause_limit": 0, "beats_without_evidence": 0}
    used_non_speech: dict = {}
    pauses = 0
    out = []
    for ln in lines:
        beat = ln.get("beat") if ln.get("beat") in BEATS else "none"
        if beat != "none" and not evidence_ok(ln.get("evidence") or "", ln["display"]):
            log.append({"id": ln["id"], "beat": beat, "action": "beat→none", "why": f"الدليل «{ln.get('evidence')}» مش كلمات من الجملة"})
            stats["beats_without_evidence"] += 1
            beat = "none"
        if beat in ("joke", "secret") and not ln.get("writer_beat") and not cue_ok(beat, ln["display"]):
            log.append({"id": ln["id"], "beat": beat, "action": "beat→none",
                        "why": f"{'نكتة' if beat == 'joke' else 'سر'} مستنتج من غير علامة صريحة في الجملة ومن غير ما الكاتب يعلّم عليه"})
            stats["beats_without_evidence"] += 1
            beat = "none"
        if tone == "serious" and beat in ("joke", "secret"):
            log.append({"id": ln["id"], "beat": beat, "action": "beat→none", "why": "موضوع جد: مفيش نكت ولا أسرار"})
            beat = "none"
        keep_toks = []
        for tok in tokens(ln["tts"]):
            if not TAG.match(tok):
                keep_toks.append(tok)
                continue
            t = norm_tag(tok)
            why = None
            if t not in ALLOWED:
                why, k = "مش في قايمة ElevenLabs الموثّقة", "removed_unknown"
            elif tone == "serious" and t in SERIOUS_BANNED:
                why, k = "موضوع جد: ممنوع ضحك/همس/سخرية", "removed_tone"
            elif t not in (SERIOUS_BEATS.get(beat, BEATS[beat]) if tone == "serious" else BEATS[beat]):
                why, k = f"مش بتاع نبرة الجملة ({beat}: {BEAT_HELP[beat]}{'، في موضوع جد' if tone == 'serious' else ''})", "removed_beat"
            elif t in NON_SPEECH and beat != "dramatic" and used_non_speech.get(scene_of.get(ln["id"], ln["id"])):
                why, k = "فيه صوت مش كلام تاني في نفس المشهد (واحد بالكتير)", "removed_scene_limit"
            elif t in PAUSES and pauses >= 2:
                why, k = "الوقفات مرتين بالكتير في الفيديو", "removed_pause_limit"
            if why:
                stats[k] += 1
                log.append({"id": ln["id"], "tag": t, "beat": beat, "action": "removed", "why": why})
                continue
            if t in NON_SPEECH:
                used_non_speech[scene_of.get(ln["id"], ln["id"])] = True
            if t in PAUSES:
                pauses += 1
            stats["kept"] += 1
            keep_toks.append(f"[{t}]")
            log.append({"id": ln["id"], "tag": t, "beat": beat, "action": "kept", "evidence": ln.get("evidence")})
        while keep_toks and TAG.match(keep_toks[-1]):   # tag في آخر الجملة مالوش لازمة
            keep_toks.pop()
        out.append({**ln, "beat": beat, "tts": " ".join(keep_toks)})
    return out, {"stats": stats, "log": log}
