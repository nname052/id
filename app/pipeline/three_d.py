"""كتالوج الـ 3D اللي عندنا (شخصيات Mixamo + حركاتها + أماكن مبنية من كيتات Kenney و KayKit).
المشغّل (player3d.js) بيبني نفس الأماكن دي بنفس الأسماء."""

# الاسم ← (المسار جوه assets/3d/mixamo، الطول بالمتر، وصف بالعربي)
CHARACTERS = {
    "Aj": ("Aj_Idle", 1.75, "شاب عشريني، تيشيرت وجينز"),
    "Ty": ("characters/Ty", 1.7, "شاب كاجوال بشعر كيرلي"),
    "Big_Vegas": ("characters/Big_Vegas", 1.75, "راجل تخين كرتوني بدقن، كوميدي"),
    "Timmy": ("characters/Timmy", 1.25, "طفل كرتوني"),
    "Doozy": ("characters/Doozy", 1.3, "شخصية كرتونية غريبة مضحكة"),
    "Claire": ("characters/Claire", 1.68, "بنت شعرها أشقر، كاجوال"),
    "Amy": ("characters/Amy", 1.62, "بنت شعرها بني، كاجوال"),
    "Kaya": ("characters/Kaya", 1.65, "بنت رياضية"),
    "Megan": ("characters/Megan", 1.68, "بنت موظفة، لبس شغل"),
    "Kate": ("characters/Kate", 1.68, "ست شيك"),
    "Jody": ("characters/Jody", 1.66, "بنت كاجوال"),
    "Sporty_Granny": ("characters/Sporty_Granny", 1.6, "ست كبيرة رياضية، كوميدية"),
}
NORMAL_MAPS_OFF = {"Doozy"}

ANIMS = {
    "idle": "واقف عادي", "happy_idle": "واقف مبسوط", "sad_idle": "واقف زعلان", "bored": "زهقان", "looking_around": "بيبص حواليه",
    "talking": "بيتكلم بإيديه", "asking_question": "بيسأل", "pointing": "بيشاور قدامه", "hands_forward": "بيمد إيديه",
    "thinking": "بيفكر", "shrug": "مش عارف", "nod_yes": "بيهز راسه آه", "shake_no": "بيهز راسه لأ", "shake_no_annoyed": "لأ متضايق",
    "shake_no_thoughtful": "لأ وهو بيفكر", "surprised": "متفاجئ", "excited": "متحمس", "happy_gesture": "مبسوط بإيديه",
    "cheering": "بيشجّع", "victory": "فرحة انتصار", "clapping": "بيسقّف", "laughing": "بيضحك", "crying": "بيعيط",
    "defeated": "مهزوم/محبط", "relieved_sigh": "ارتاح", "angry_gesture": "متعصب", "angry_point": "بيشاور بعصبية", "yelling": "بيزعق",
    "waving": "بيسلّم", "waving_both": "بيسلّم بالإيدين", "phone_call": "بيكلم في الموبايل", "texting": "بيكتب على الموبايل",
    "typing": "بيكتب على كيبورد", "drinking": "بيشرب", "walking": "ماشي", "walk_female": "ماشية",
    "dancing_hiphop": "بيرقص", "dancing_silly": "رقص هزار", "sitting_idle": "قاعد", "sitting_talking": "قاعد بيتكلم",
    "sitting_laughing": "قاعد بيضحك", "sitting_floor": "قاعد على الأرض", "stand_to_sit": "بيقعد", "sit_to_stand": "بيقوم",
}
# الحركات دي محتاجة كرسي (بنحطه أوتوماتيك في المكان)
SITTING = {"sitting_idle", "sitting_talking", "sitting_laughing", "stand_to_sit", "typing"}

SETS = {
    "room": "أوضة نوم (سرير، مكتب صغير، لمبة، نبات)",
    "living": "صالة (كنبة، تليفزيون، سجادة، ترابيزة)",
    "office": "مكتب شغل (مكتب، كمبيوتر، كرسي، رفوف كتب)",
    "kitchen": "مطبخ (دواليب، تلاجة، بوتاجاز، ترابيزة)",
    "street": "شارع مدينة (عماير، رصيف، عربيات، عمود نور)",
    "park": "جنينة (شجر، دكة، صخور، ورد)",
    "studio": "استوديو فاضي بخلفية لون الفيديو (تركيز كامل على الشخصية)",
}
CAMERAS = {
    "push_in": "الكاميرا بتقرّب ببطء (توتر/تركيز)", "pull_out": "بتبعد وتكشف المكان", "orbit": "بتلف حوالين الشخصية",
    "low_angle": "من تحت (قوة/بطولة)", "high_angle": "من فوق (ضعف/وحدة)", "close_up": "قريبة على الوش والصدر",
    "tracking": "ماشية جنب الشخصية", "dutch": "مايلة (قلق/فوضى)", "static_wide": "ثابتة واسعة (هدوء)",
}
LOOKS = {"anime": "أنيمي/كرتون: تظليل مسطح وخطوط حوالين الأشكال", "soft": "إضاءة ناعمة واقعية زي أفلام الأنيميشن"}


def catalog() -> str:
    """وصف الكتالوج للبرومبت."""
    ch = "، ".join(f"{k} ({v[2]})" for k, v in CHARACTERS.items())
    an = "، ".join(f"{k} ({v})" for k, v in ANIMS.items())
    st = "، ".join(f"{k} ({v})" for k, v in SETS.items())
    cam = "، ".join(f"{k} ({v})" for k, v in CAMERAS.items())
    lk = "، ".join(f"{k} ({v})" for k, v in LOOKS.items())
    return (f"- الشخصيات 3D: {ch}\n- الحركات: {an}\n- الأماكن: {st}\n- حركات الكاميرا: {cam}\n- الشكل: {lk}\n"
            "- مفيش حركة شفايف ولا تعبيرات وش: الشخصية بتمثّل بجسمها، والراوي بيحكي.")
