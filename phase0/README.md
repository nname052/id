# المرحلة 0: تجارب التحقق (خطوة بخطوة)

الهدف: نجرّب 3 حاجات على جهازك قبل ما نبني التطبيق:

1. **Claude:** هل `claude -p` بيشتغل باشتراكك، وبيرجّع JSON منظم، وبيشوف الصور؟
2. **ElevenLabs:** هل موديل `eleven_v3` بيدّي توقيت كل كلمة، والـ tag (زي `[whispers]`) شغال؟
3. **الريندر:** الفيديو المرجعي بيتصدّر بسرعة قد إيه على جهازك (8GB)؟

- **الوقت:** حوالي 15–20 دقيقة أول مرة (أغلبها تثبيت)، وبعد كده 3–5 دقايق.
- **الاستهلاك:**
  - **ElevenLabs:** حوالي 100–200 credit.
  - **Claude:** حوالي 9 طلبات صغيرة من اشتراكك.

> **قبل ما تبدأ:** كل سطر جوه مربع رمادي هو أمر.
> - انسخه كله، والصقه في التيرمينال (`Cmd+V`)، واضغط `Enter`.
> - استنّى لحد ما يخلص، قبل ما تكتب الأمر اللي بعده.

---

## الخطوة 1: افتح التيرمينال

1. اضغط `Cmd + Space`.
2. اكتب `Terminal` واضغط `Enter`.
3. هتظهر نافذة فيها سطر بينتهي بـ `%`، وده المكان اللي هتلصق فيه الأوامر.

---

## الخطوة 2: ثبّت الأدوات (Homebrew، و git، و ffmpeg، و uv)

### 2.1 Homebrew (مدير البرامج)

جرّب الأول لو موجود:

```bash
brew --version
```

- لو طلع رقم نسخة، **اتخطّى لـ 2.2**.
- لو طلع `command not found`، ثبّته بالأمر ده:

```bash
/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
```

**أثناء التثبيت:**
- هيطلب **كلمة سر الماك**. اكتبها واضغط `Enter`، ومش هتظهر وإنت بتكتب، وده طبيعي.
- لو سألك `Press RETURN to continue`، اضغط `Enter`.

**بعد التثبيت (مهم):** شغّل السطرين دول علشان التيرمينال يعرف مكان Homebrew:

```bash
echo 'eval "$(/opt/homebrew/bin/brew shellenv)"' >> ~/.zprofile
eval "$(/opt/homebrew/bin/brew shellenv)"
```

### 2.2 باقي الأدوات

```bash
brew install git ffmpeg uv gh
```

**اتأكد إنها اتثبتت:**

```bash
git --version && ffmpeg -version | head -1 && uv --version
```

لازم يطلع 3 أسطر، وكل سطر فيه رقم نسخة.

---

## الخطوة 3: ثبّت Claude Code وسجّل دخول باشتراك Pro

```bash
curl -fsSL https://claude.ai/install.sh | bash
```

**بعد ما يخلص:**
1. **اقفل التيرمينال وافتحه تاني** (`Cmd+Q`، وبعدين الخطوة 1).
2. اكتب:

```bash
claude
```

3. اختار تسجيل الدخول بحساب Claude (**Claude account / subscription**)، **مش** API key.
4. المتصفح هيفتح: سجّل دخول ووافق.
5. لما ترجع للتيرمينال وتلاقي خانة كتابة، اكتب `/exit` واضغط `Enter`.

**اتأكد:**

```bash
claude --version
```

> ⚠️ لو عندك متغير اسمه `ANTHROPIC_API_KEY` في التيرمينال، Claude هيستخدمه بدل الاشتراك.
> التجربة بتشيله تلقائيًا، فمش محتاج تعمل حاجة.

---

## الخطوة 4: نزّل المشروع

**1. سجّل دخول GitHub** (لأن الريبو private):

```bash
gh auth login
```

اختار الإجابات دي بالأسهم و `Enter`:
- `GitHub.com`
- `HTTPS`
- `Yes`
- `Login with a web browser`

انسخ الكود اللي هيظهر، والصقه في المتصفح.

**2. نزّل المشروع وادخل فولدره:**

```bash
cd ~
gh repo clone nname052/id tiktok-motion
cd tiktok-motion
git checkout claude/festive-bohr-xry4vg
```

**مهم:** من دلوقتي، كل أمر لازم يتشغّل **جوه** فولدر المشروع. لو قفلت التيرمينال وفتحته تاني، ارجع للفولدر بالأمر ده:

```bash
cd ~/tiktok-motion
```

---

## الخطوة 5: حط الخطوط والفيديو المرجعي

افتح فولدر المشروع في Finder:

```bash
open .
```

**1. الخطوط:** حط ملفات الخطوط (`.ttf` أو `.woff2`) جوه فولدر `fonts/`:
- Reem Kufi
- IBM Plex Sans Arabic

**2. الفيديو المرجعي:**
- حط ملف الـ HTML (وأي ملفات معاه) جوه فولدر `reference/`.
- لو الفيديو بيستخدم الخطوط، لازم مسارها في الـ CSS يبقى نسبي، زي:
  `url("../fonts/ReemKufi-Regular.ttf")`

> لو الملف بيستخدم اسم دالة غير `renderAt`، قولّي اسمها، أو استخدم `--render-fn` (شوف "تشغيل تجربة واحدة" تحت).

---

## الخطوة 6: حط مفتاح ElevenLabs

**1. اعمل نسخة من ملف المثال:**

```bash
cp .env.example .env
open -e .env
```

الملف هيفتح في TextEdit.

**2. هات المفتاح من موقع ElevenLabs:**
- **elevenlabs.io** ← **Developers** ← **API Keys** ← **Create API Key**.
- لو طلب صلاحيات، فعّل:
  - **Text to Speech**
  - **Voices** (Read)
  - **User** (Read)
  - **Forced Alignment**

**3. حط المفتاح في الملف:**
- الصقه بعد `ELEVENLABS_API_KEY=` من غير مسافات ولا علامات تنصيص.
- **مثال:** `ELEVENLABS_API_KEY=sk_abc123...`

**4. (اختياري) اختار صوت معيّن:**
- حط الـ Voice ID بعد `ELEVENLABS_VOICE_ID=`.
- بتلاقيه في **My Voices** ← الصوت ← **Copy ID**.
- لو سبته فاضي، التجربة هتاخد أول صوت من أصواتك.

**5. احفظ واقفل:** `Cmd+S`، وبعدين `Cmd+W`.

> الملف `.env` **مش بيترفع على GitHub**، والمفتاح **مش بيظهر في ملف النتايج**.

---

## الخطوة 7: شغّل التجارب (أمر واحد)

```bash
./phase0/run_all.sh
```

**اللي هيحصل بالترتيب:**

1. **تثبيت المكتبات و Chromium:** أول مرة بس، حوالي دقيقتين.
2. **تجربة Claude:** حوالي دقيقة.
3. **تجربة ElevenLabs:**
   - في الآخر **الصوت هيشتغل**.
   - هيسألك 3 أسئلة: جاوب بـ `y` (أيوه) أو `n` (لأ) واضغط `Enter`.
   - عايز تسمعه تاني؟ اكتب `r`.
4. **تجربة الريندر:** حوالي دقيقة. هتسمع صوت مروحة الماك، وده طبيعي.

> **علشان الرام 8GB:** اقفل التطبيقات التقيلة (Chrome، و Photoshop…) وقت التجربة، علشان أرقام السرعة تطلع دقيقة.

**لو ظهر `permission denied`:**

```bash
chmod +x phase0/run_all.sh
./phase0/run_all.sh
```

---

## الخطوة 8: ابعتلي النتايج

النتايج كلها في ملف واحد: **`phase0_results.md`**.

```bash
open -R phase0_results.md
```

1. الأمر ده هيفتح Finder ومحدد عليه الملف.
2. اسحبه هنا في الشات.

الملف مفيهوش أي مفاتيح.

**ملفات إضافية** (مش لازم تبعتها، بس ممكن تفتحها):

| الملف | فيه إيه |
|---|---|
| `phase0/out/elevenlabs/*.mp3` | الصوت |
| `phase0/out/render/reference_10s.mp4` | الفيديو التجريبي. اتأكد إن شكله زي الأصل |

---

## تشغيل تجربة واحدة بس

```bash
./phase0/run_all.sh --only claude
./phase0/run_all.sh --only elevenlabs
./phase0/run_all.sh --only render
./phase0/run_all.sh --only render --render-fn drawFrame         # لو اسم الدالة مختلف
./phase0/run_all.sh --only render --reference reference/my.html # لو فيه أكتر من ملف HTML
```

---

## مشاكل متوقعة وحلها

| الرسالة | الحل |
|---|---|
| `zsh: command not found: brew` | ارجع لـ **الخطوة 2.1** وشغّل السطرين بتوع "بعد التثبيت" |
| `command not found: claude` | اقفل التيرمينال وافتحه تاني، ولو لسه: ارجع لـ **الخطوة 3** |
| `مش مسجّل دخول؟` في تجربة Claude | شغّل `claude`، واكتب `/login`، وبعدين `/exit` |
| `HTTP 401` في ElevenLabs | المفتاح غلط أو ناقص صلاحيات (**الخطوة 6**) |
| `الدالة renderAt(t) موجودة ❌` | التقرير هيكتب "أسماء قريبة". شغّل بـ `--render-fn` والاسم الصح |
| `خط … محمّل ❌` | اتأكد إن ملفات الخطوط في `fonts/` وإن المسار في الـ HTML صح |
| `No such file or directory: ./phase0/run_all.sh` | إنت مش جوه فولدر المشروع. شغّل `cd ~/tiktok-motion` |
| أي حاجة تانية | ابعتلي `phase0_results.md` وآخر 20 سطر من التيرمينال |
