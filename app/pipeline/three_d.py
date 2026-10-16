"""كتالوج الـ 3D اللي عندنا (شخصيات Mixamo + حركاتها + أماكن مبنية من كيتات Kenney و KayKit).
المشغّل (player3d.js) بيبني نفس الأماكن دي بنفس الأسماء."""

# الاسم ← (المسار جوه assets/3d/mixamo، الطول بالمتر، وصف بالعربي)
CHARACTERS = {  # (اتأكدنا من شكلهم بصورة لكل الشخصيات: app/player/tools/lineup.html)
    "Aj": ("Aj_Idle", 1.75, "شاب بكاب أحمر ونضارة وهودي رمادي، كرتون"),
    "Ty": ("characters/Ty", 1.7, "ولد أشقر بجاكيت أحمر وكوفية، كرتون"),
    "Big_Vegas": ("characters/Big_Vegas", 1.75, "راجل ضخم بقميص أبيض مفتوح وشعر زي إلفيس، كرتون كوميدي"),
    "Timmy": ("characters/Timmy", 1.25, "طفل بكاب أحمر وهودي أخضر، كرتون"),
    "Doozy": ("characters/Doozy", 1.3, "مخلوق أزرق بودان كبيرة (زي العفريت)، كرتون كوميدي"),
    "Claire": ("characters/Claire", 1.68, "ست بشعر أسود وفستان أحمر، كرتون"),
    "Amy": ("characters/Amy", 1.62, "بنت بشعر لبني وتيشيرت بمبي، شكل أنيمي"),
    "Kaya": ("characters/Kaya", 1.72, "راجل بدقن وبرنيطة قش وقميص مقلّم، كرتون"),
    "Megan": ("characters/Megan", 1.68, "ست بتيشيرت أبيض، واقعية"),
    "Kate": ("characters/Kate", 1.68, "ست بشعر قصير أشقر وقميص أزرق، واقعية"),
    "Jody": ("characters/Jody", 1.66, "ست بجاكيت رياضي بمبي، واقعية"),
    "Sporty_Granny": ("characters/Sporty_Granny", 1.6, "جدة ببكَر في شعرها ونضارة وترينج أزرق، كرتون كوميدي"),
}
# شخصيات واقعية محترمة (Microsoft Rocketbox، رخصة MIT): وشهم فيه أشكال بق للحروف وتعبيرات (ابتسامة، تكشيرة، حواجب، رمش)
RBX = {
    "Business_Male_01": ("بدلة سودا وكرافتة حمرا، شاب ثلاثيني"), "Business_Male_02": ("بدلة كحلي وكرافتة، شاب ثلاثيني"),
    "Business_Male_03": ("بدلة سودا وكرافتة فاتحة، راجل أربعيني"), "Business_Male_04": ("صديري وقميص، راجل خمسيني أصلع"),
    "Business_Male_05": ("بدلة سودا وقميص بنفسجي، أسمر"), "Business_Female_01": ("بدلة سودا، ست سمرا"),
    "Business_Female_02": ("جاكيت أحمر غامق ونضارة، ست شقرا"), "Business_Female_03": ("تايير بيج، ست بشعر غامق"),
    "Business_Female_04": ("بدلة سودا، ست بشعر بني"), "Medical_Male_01": ("دكتور بالبالطو الأبيض"), "Medical_Female_01": ("دكتورة بلبس طبي أبيض"),
    "Male_Adult_03": ("راجل كبير شيك ببليزر"), "Male_Adult_08": ("شاب بقميص أزرق فاتح"), "Male_Adult_14": ("راجل بقميص رمادي وبنطلون كاكي"),
    "Male_Adult_19": ("راجل بجلابية بيضا وشماغ أحمر"), "Male_Adult_21": ("راجل بجلابية بيضا وغترة بيضا"),
    "Female_Adult_02": ("ست ببلوزة بيضا وجيبة"), "Female_Adult_06": ("ست محجبة بطرحة بيضا"), "Female_Adult_09": ("ست بكارديجان رمادي"),
    "Female_Adult_14": ("ست ببليزر بيج"),
}
for _n, _d in RBX.items():
    CHARACTERS[_n] = ("rbx", 1.67 if "Female" in _n else 1.8, _d + "، واقعي")
# الشخصيات الواقعية ما ينفعش تتحط مع الكرتون في نفس الفيديو
REALISTIC = {"Megan", "Kate", "Jody", *RBX}
CARTOON = [c for c in CHARACTERS if c not in REALISTIC]
NORMAL_MAPS_OFF = {"Doozy"}
GENDER = {**{n: ("female" if "Female" in n else "male") for n in RBX}, "Aj": "male", "Ty": "male", "Big_Vegas": "male", "Timmy": "male", "Doozy": "male", "Claire": "female", "Amy": "female",
          "Kaya": "male", "Megan": "female", "Kate": "female", "Jody": "female", "Sporty_Granny": "female"}
# الشخصيات اللي فيها بق منفصل (نقدر نحرّكه مع الصوت). الباقي البق جزء من الوش: بيمثّلوا من غير كلام (الراوي بيحكي)
SPEAKERS = ["Aj", "Big_Vegas", "Claire", "Kaya", "Sporty_Granny", *RBX]

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
    "cafe": "كافيه (ترابيزات مدورة، كراسي، بار، أكل)",
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


CATALOG_2D = ("- 1,700 رسمة فلات (مواقف وأشخاص)، وآلاف الأيقونات، وإيموجي بلون الفيديو، و 4 شخصيات كرتون 2D بوضعيات "
              "(واقف، بيفكر، بيتكلم، بيشجّع، بيجري، بيمشي، بيقع…).\n- 21 خط عربي، و 12 شكل مشهد (صورة كبيرة، كلام متحرك، رقم بيعد، قايمة، مقارنة، "
              "اقتباس، سؤال…)، ومشاهد مبتكرة بالكود.")
CATALOG_WB = ("- السبورة: آلاف الأيقونات الخطية (بتترسم خط بخط)، و 1,700 رسمة (بتترسم حدودها وبعدين بتتلوّن خفيف)، وكتابة بخط اليد، "
              "وأسهم، وأرقام كبيرة، ودواير وخطوط تحت الكلام، ورسوم بيانية بسيطة (عمود/دايرة).")


def catalog_for(vtype: str) -> str:
    if vtype == "whiteboard":
        return CATALOG_WB
    if vtype == "3d":
        return catalog() + f"\n- الشخصيات اللي بتقدر تتكلم (بقها بيتحرك مع الصوت): {', '.join(SPEAKERS)}. الباقي بيمثّل بجسمه والراوي بيحكي."
    return CATALOG_2D


def catalog() -> str:
    """وصف الكتالوج للبرومبت."""
    real = "، ".join(f"{k} ({v[2]}، {'ذكر' if GENDER[k] == 'male' else 'أنثى'})" for k, v in CHARACTERS.items() if k in RBX)
    toon = "، ".join(f"{k} ({v[2]})" for k, v in CHARACTERS.items() if k not in REALISTIC)
    ch = f"**واقعيين ومهندمين (الأساس لأي فيديو جاد)**: {real}\n  - كرتون (بس لو صاحب الفيديو طلب كرتون/أنيمي/هزار): {toon}"
    an = "، ".join(f"{k} ({v})" for k, v in ANIMS.items())
    st = "، ".join(f"{k} ({v})" for k, v in SETS.items())
    cam = "، ".join(f"{k} ({v})" for k, v in CAMERAS.items())
    lk = "، ".join(f"{k} ({v})" for k, v in LOOKS.items())
    return (f"- الشخصيات 3D: {ch}\n- الأماكن: {st}\n- الشكل: {lk}\n"
            "- الحركة **حرة** (مش حركات متسجلة): إحنا اللي بنحرّك كل عضمة: وضعيات الجسم والدراعين والإيدين والراس، والقعدة والمشي، "
            "ورموز أنيمي فوق الراس (! ? عرق، عصبية، لمعة، فكرة…) وخطوط سرعة وتركيز.\n"
            "- الكاميرا حرة: أي لقطة (من واسعة جدًا لقريبة جدًا ومن ورا الكتف)، وأي زاوية وارتفاع، وحركات (تقريب، لف، كرين، كاميرا محمولة، لفّة سريعة)، وقطع جوه المشهد.\n"
            "- مفيش تعبيرات وش (البق بيتحرك مع الكلام للشخصيات اللي بتتكلم بس).")


# ---------- مفردات الإخراج الحر (نفس اللي في app/player/rig.js و director.js) ----------
ARM_POSES = ['rest', 'hip', 'chin', 'head', 'scratch_head', 'facepalm', 'cover_mouth', 'chest', 'point_forward', 'point_side', 'point_up', 'point_self', 'wave', 'raise', 'fist_pump', 'open_out', 'explain', 'offer', 'stop', 'cross', 'shrug', 'thumbs_up', 'fist_shake', 'phone_ear', 'phone_front', 'hands_together', 'behind_back', 'typing', 'hold_cup', 'reach_up', 'hands_on_knees']
BODY_POSES = ['upright', 'lean_forward', 'lean_back', 'slump', 'proud', 'crouch', 'sit', 'sit_lean', 'sit_slump', 'twist_left', 'twist_right', 'tilt_left', 'tilt_right', 'shrug', 'sneak']
HEAD_POSES = ['camera', 'forward', 'down', 'up', 'left', 'right', 'tilt_left', 'tilt_right', 'down_left', 'down_right', 'away']
MOTIONS = ['none', 'nod', 'shake', 'bounce', 'laugh', 'cry', 'tremble', 'breathe_heavy', 'talk', 'look_around', 'sway', 'wave', 'pump', 'beat', 'type', 'scratch']
EMOTES = ["!", "?", "sweat", "anger", "sparkle", "heart", "idea", "gloom", "zzz", "music"]
FX = ["speedlines", "focus", "flash", "shake"]
SHOT_TYPES = ['extreme_wide', 'wide', 'full', 'medium', 'medium_close', 'close', 'extreme_close', 'over_shoulder']
SHOT_HEIGHTS = ['eye', 'low', 'ground', 'high', 'top']
CAMERA_MOVES = ['static', 'push_in', 'pull_out', 'orbit_left', 'orbit_right', 'crane_up', 'crane_down', 'truck_left', 'truck_right', 'handheld', 'whip_in', 'slow_zoom']
EASES = ["smooth", "snap", "overshoot", "slow"]

ACTIONS = ["open_fridge", "close_fridge", "use_laptop", "open_door", "look_out_window", "drink", "read_book", "hold_phone"]
EXPRESSIONS = ["neutral", "smile", "big_smile", "warm", "serious", "sad", "worried", "surprised", "angry", "thinking", "skeptical", "confident", "curious", "disgusted"]
