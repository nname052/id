"""طلبك للفيديو كله (الـ brief): بتكتبه مرة واحدة، وكل مرحلة بتاخد منه اللي يخصها من غير ما تطلبه تاني.

قواعد ثابتة (من غير AI): نفس الكلام ← نفس الإعدادات. اللي مش مكتوب بيفضل على الافتراضي.
كل مرحلة بتسجّل في stage.json الحاجات اللي استخدمتها من الطلب (used)، فلو الطلب اتغيّر في حاجة تخصها بتبقى «قديمة».
"""

import re

DEFAULT = {"pace": "normal", "graphics": "on", "mood": "clean", "density": "normal", "sub_size": "medium", "sub_color": "white",
           "sub_panel": True, "sub_pos": "bottom", "look": "natural", "language": "ar", "aspect": "9:16", "focus": []}
# كل مرحلة بتستخدم أنهي حاجات من الطلب
USES = {"s1_analyze": ["language"], "s2_cut": ["pace", "aspect"], "s3_look": ["look"],
        "s4_subs": ["sub_size", "sub_color", "sub_panel", "sub_pos"], "s5_graphics": ["graphics", "mood", "density", "focus", "pace"],
        "s6_audio": ["pace"], "s7_preview": ["aspect"]}
NAMES = {"pace": {"fast": "إيقاع سريع", "normal": "إيقاع طبيعي", "calm": "إيقاع هادي"},
         "graphics": {"on": "كروت موشن", "off": "من غير كروت"},
         "mood": {"clean": "كروت هادية (غامق وأبيض)", "bold": "كروت جريئة (برتقالي)", "elegant": "كروت فخمة (دهبي)", "fresh": "كروت مبهجة (أزرق)"},
         "density": {"few": "كروت قليلة", "normal": "كارت لكل فكرة", "many": "كروت أكتر"},
         "sub_size": {"small": "ترجمة صغيرة", "medium": "ترجمة متوسطة", "large": "ترجمة كبيرة"},
         "sub_color": {"white": "ترجمة بيضا", "yellow": "ترجمة صفرا"},
         "sub_pos": {"bottom": "الترجمة تحت", "raised": "الترجمة أعلى شوية", "low": "الترجمة تحت خالص"},
         "look": {"natural": "ألوان طبيعية", "warm": "ألوان دافية", "cool": "ألوان باردة", "cinematic": "ستايل سينمائي", "bw": "أبيض وأسود"},
         "language": {"ar": "الكلام عربي", "en": "الكلام إنجليزي", "auto": "اللغة تلقائي"},
         "aspect": {"9:16": "طولي 9:16", "16:9": "عرضي 16:9"}}


def _has(rx: str, t: str) -> bool:
    return re.search(rx, t) is not None


def parse(text: str) -> dict:
    t = " " + (text or "").strip().lower() + " "
    b = dict(DEFAULT, focus=[])
    if _has(r"(سريع|بسرعة|حماس|نشيط|fast|energetic|punchy|snappy)", t):
        b["pace"] = "fast"
    elif _has(r"(هادي|هادئ|براحة|بطيء|بطيئ|calm|slow|relaxed)", t):
        b["pace"] = "calm"
    if _has(r"(من غير (جرافيك|كروت|موشن)|بدون (جرافيك|كروت|موشن)|بلاش (جرافيك|كروت)|no (graphics|cards))", t):
        b["graphics"] = "off"
    if _has(r"(جري|قوي|ملفت|برتقالي|bold|loud|vibrant)", t):
        b["mood"] = "bold"
    elif _has(r"(فخم|راقي|دهبي|ذهبي|elegant|luxury|premium|gold)", t):
        b["mood"] = "elegant"
    elif _has(r"(مبهج|مرح|أزرق|ازرق|fresh|playful|fun)", t):
        b["mood"] = "fresh"
    if _has(r"(كروت (قليلة|أقل|اقل)|جرافيك (قليل|أقل|اقل)|few cards|minimal graphics)", t):
        b["density"] = "few"
    elif _has(r"(كروت (كتير|أكتر|اكتر)|جرافيك (كتير|أكتر|اكتر)|more cards|lots of graphics)", t):
        b["density"] = "many"
    if _has(r"(ترجمة (كبيرة|كبير|أكبر|اكبر)|خط كبير|big subtitles|large subtitles)", t):
        b["sub_size"] = "large"
    elif _has(r"(ترجمة (صغيرة|صغير|أصغر|اصغر)|small subtitles)", t):
        b["sub_size"] = "small"
    if _has(r"(ترجمة|الترجمة|subtitle)[^.،,]*(صفرا|صفراء|أصفر|اصفر|yellow)", t) or _has(r"yellow subtitles", t):
        b["sub_color"] = "yellow"
    if _has(r"(ترجمة (من غير|بدون) خلفية|no (subtitle )?background)", t):
        b["sub_panel"] = False
    if _has(r"(الترجمة (أعلى|اعلى|فوق شوية)|raise (the )?subtitles)", t):
        b["sub_pos"] = "raised"
    if _has(r"(سينمائي|سينما|cinematic|film look)", t):
        b["look"] = "cinematic"
    elif _has(r"(دافي|دافئ|warm)", t):
        b["look"] = "warm"
    elif _has(r"(بارد|cool tone|cold)", t):
        b["look"] = "cool"
    elif _has(r"(أبيض وأسود|ابيض واسود|black and white|b&w|monochrome)", t):
        b["look"] = "bw"
    if _has(r"(الكلام (إنجليزي|انجليزي)|بالإنجليزي|in english|english speech)", t):
        b["language"] = "en"
    if _has(r"(16:9|عرضي|يوتيوب|youtube|landscape|horizontal)", t):
        b["aspect"] = "16:9"
    if m := re.search(r"(ركّز على|ركز على|اظهر|أظهر|focus on|highlight)\s*[:：]?\s*([^.\n،,]+)", t):
        b["focus"] = [w.strip(" «»\"'") for w in re.split(r"\s+(?:و|and)\s+|/", m.group(2)) if w.strip()][:6]
    return b


def used(parsed: dict, key: str) -> dict:
    return {k: parsed.get(k, DEFAULT[k]) for k in USES.get(key, [])}


def describe(parsed: dict) -> list[str]:
    """الإعدادات اللي اتفهمت من الطلب (بالعربي) للعرض جنب خانة الطلب."""
    out = []
    for k in ("pace", "graphics", "mood", "density", "sub_size", "sub_color", "sub_pos", "look", "language", "aspect"):
        if k == "mood" and parsed.get("graphics") == "off":
            continue
        out.append(NAMES[k].get(parsed.get(k, DEFAULT[k]), str(parsed.get(k))))
    if not parsed.get("sub_panel", True):
        out.append("ترجمة من غير خلفية (بحد غامق للوضوح)")
    if parsed.get("focus"):
        out.append("ركّز على: " + "، ".join(parsed["focus"]))
    return out
