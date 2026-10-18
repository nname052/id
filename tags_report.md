# Script & audio-tag rules: tags that match the sentence, scripts that drive the visuals

**Status: open — not accepted by the user.** Commit `7500d62` (branch `autovideo-motion-v2`).

- **Credits:** no ElevenLabs credits spent (no audio generated).
- **Not changed:** `grasp.js`/`rig.js`, motion/scene code, the montage editor, audio mixing/loudness, and the site layout. The only UI change is one help sentence on the voice-prep step.
- **Nothing deleted:** no existing video or montage was deleted, and the old projects' `tts.json` files were not modified. The after-audit is a dry run written to `docs/tag_audit/`.

## Root cause
- **Where tags are chosen:** `app/prompts/tts_prep.md`, section «### 1) tags الإحساس» (the only tag prompt the code loads; `tts_tags.md` and `tts_prep_egyptian/msa/white.md` are not used by any code).
- **Rules responsible:**
  1. «في المتوسط tag في كل جملة، وأحيانًا اتنين»: a quota, so every sentence got a tag whether or not it carried an emotion.
  2. The opening line asked for «همس، وضحكة، وتنهيدة… في أماكنها الصح» without saying when, so whispers and laughs were sprinkled as "colour".
  3. «ومسموح tags وصفية زيها» plus a list including [matter-of-fact] [emphatic] [playfully] [softly] [questioning]: an open list, so tags outside ElevenLabs' documented ones appeared.
  4. **Code:** `tts_prep.enforce()` kept any `[...]` token, so nothing checked the tag against the sentence or the topic.
- **Candidates considered:**

  | Candidate | Why not |
  |---|---|
  | Remove bad lines by hand | Doesn't fix the next video. |
  | Only rewrite the prompt | A prompt alone is advisory: the re-audit showed the model still labelled «حتى لو مش مريحة» a joke. |
  | Keyword matching of emotions | Meaning isn't reliably detectable from keywords, except explicit laugh/secret cues. |

- **Chosen fix:** the **writer** marks each sentence's beat (and the topic's tone) when writing the script. **Code** then enforces:
  - a fixed allowed list;
  - beat → allowed tags;
  - serious topic → no laugh, whisper, sarcasm, mischief, or tag on questions;
  - laugh/whisper only if the writer marked a joke/secret or the sentence has an explicit cue;
  - evidence words must come from the sentence itself;
  - at most 1 non-speech sound per scene;
  - at most 2 pauses per video.

  **Why it beats the alternatives:** the writer knows the intent, and the code makes the rule hold even when the model drifts. Every kept or removed tag is logged with its reason in `tts.json → tags.log`.

## Fix (rule level)
- **`app/pipeline/tags.py` (new):**
  - `ALLOWED`: 20 tags, all named on ElevenLabs' official v3 prompting page (checked 2026-10-18; the engine itself accepts free-form tags, so this list is our own fixed subset).
  - `BEATS` maps each of 14 beats to its allowed tags; `none` = no tag.
  - `validate()`: removes unknown tags, off-beat tags, tone-banned tags, a second non-speech sound in a scene, and extra pauses; downgrades a beat to `none` when its evidence isn't in the sentence, or when a joke/secret has no writer mark and no explicit cue.
- **Script stage (`script.py`, `prompts/script.md`):** the script returns `tone` and `scenes[{visual, draw, sentences[{text, beat}]}]`.
  - `visual` ∈ whiteboard_drawing / character / graphic / chart.
  - `draw` = a concrete thing to draw.
  - `check_scenes()` flags any scene that would be an **empty whiteboard**: nothing concrete to draw, vague words only, or a chart with no number/comparison in the text.
  - Flagged scenes are rewritten once by `prompts/script_visual_fix.md`, then re-checked.
  - `script.json` keeps the flat `sentences` list (with `beat` and `scene`), so other stages are unaffected.
- **Voice-prep stage (`tts_prep.py`, `prompts/tts_prep.md`):** the model returns `beat` + `evidence` (words from the sentence) + tags. The writer's beat wins when present, and the result goes through `validate()`.
- **Manual edits** (`edits.tts_lines`): your own choice of emotion is kept, but an unknown tag is rejected with the allowed list (checked in the app: HTTP 400 for `[playfully]`).
- **Rule documented in the prompt with its reason:** `tts_prep.md` «### 1) … **ليه القاعدة دي**» and `script.md` «## المشاهد … **ليه**» / «## نبرة كل جملة … **ليه**».

## Step 1 + 5: audit of 3 existing scripts (checked by reading: yes; by ear: no, for the user to confirm)
- **Scripts audited:**
  - `2026-10-17_ca06a4` «ليه محدش فاهم الـ INTJ؟»;
  - `2026-10-14_928e48` «بكرة عمره ما بييجي»;
  - `2026-10-16_5585c8` «موبايلك بيسرقك بهدوء».

| | Tags | Match the sentence | **Do not match** | Unknown (not in the list) | Scenes with >1 non-speech tag |
|---|---|---|---|---|---|
| **Before** (current `tts.json`) | 37 | 28 | **9** (all in INTJ) | **6** | 0 |
| **After** (new rules, dry run) | 17 | 17 | **0** | **0** | 0 |

- **Before, did not match (sentence → tag):**
  - «وهي قاعدة ساكتة في القعدة» [whispers]: not a secret.
  - «دول غالبًا نمطهم آي إن تي جيه» [mischievously]: a reveal, not mischief.
  - «وكل حرف ليه معنى» [playfully].
  - «بيشحن طاقته لوحده» [softly].
  - «بيشوف الصورة الكبيرة قبل التفاصيل» [thoughtful]: a generic mood on a plain fact.
  - «وبيحب كل حاجة تكون مترتبة» [chuckles]: no joke.
  - «الناس تفتكره متكبر، أو بارد» [sarcastic].
  - «ولو سألته رأيه،» [thoughtful].
  - «حتى لو مش مريحة» [laughs softly]: not a joke.
- **Before, unknown:** [matter-of-fact], [playfully], [softly], [confident], [emphatic], [laughs softly].
- **After, all 17 tags fit their sentence when read.** Examples:
  - **Hooks:** [curious] on «فيه ناس بتخطط لخمس سنين قدام…», [serious] on «اللحظة المناسبة اللي مستنيها؟», [surprised] on «الموبيل بيسرق تركيزك… وهو مقفول كمان».
  - **Reveals:** [short pause] before «آي إن تي جيه» and «عمرها ما هتيجي».
  - **Statistic:** [surprised] on «حوالي اتنين في المية بس من الناس».
  - **Warning:** [serious] on «وخلّي بالك، الاختبار ده مش علم دقيق».
  - **Reassurance:** [warmly] on «مش محتاج خطة كاملة دلوقتي».
  - **Questions:** [curious] on real questions.
  - Every other sentence: no tag.
  - The audit files are in `docs/tag_audit/*.json`.

## Step 6: two new topics, made in the running app (checked by reading: yes; by ear: no)
**Projects:**
- **Serious:** `2026-10-18_052f5c`, «علامات الجلطة الدماغية وإزاي تتصرف في أول دقايق», whiteboard, 35 s.
- **Light:** `2026-10-18_5aeefa`, «ليه القطط بتوقّع الحاجات من على الترابيزة…», whiteboard, 35 s.

Both are stopped at the voice-prep review; no audio, scenes or render were run.

**Screenshots:** `docs/tag_audit/app_tts_serious_stroke.png`, `docs/tag_audit/app_tts_light_cats.png`.

| Item | Result | Read | Numbers |
|---|---|---|---|
| Serious: no laugh/whisper | **PASS** | yes | Tone `serious`. 14 sentences, **4 tags**: [serious] on the hook and two warnings, [thoughtful] on the closing question. **0 laugh, 0 whisper**, and 0 [curious] (it first put [curious] on «ناحية منه نازلة؟»; that didn't fit a stroke emergency, so the **rule** now bans tags on questions in serious topics, and I regenerated). |
| Light: tags only at real beats, ≤ 1 non-speech per scene | **PASS** | yes | Tone `light`. 13 sentences, 7 scenes, **8 tags**: [curious] (hook, final question), [short pause] before «ده مش صدفة», [chuckles] on «ومش انتقام كمان» (scene 1) and on «…يساوي إنت جاي جري عليها» (scene 4), [mischievously] on «إنت شخصيًا» and «وشيل الكوبايات من على الطرف», [warmly] on «هي بتنادي عليك». All jokes were marked by the writer. **Max non-speech per scene: 1.** 5 sentences without a tag. |
| Zero unknown tags | **PASS** | yes | 0 in both new scripts, 0 in the 3 re-audits. A manual edit with an unknown tag is rejected in the app. |
| Visual type per scene / no empty whiteboard | **PASS** | yes | Serious: 8 scenes (chart, character, whiteboard_drawing, character, graphic, whiteboard_drawing, graphic, character). Light: 7 scenes (character, whiteboard_drawing, character, whiteboard_drawing, whiteboard_drawing, graphic, character). Each has a concrete `draw`, e.g. «راجل كبير وناحية من وشه نازلة», «كف قطة بيزق قلم على حافة الترابيزة», «موبايل بيتصل بعربية إسعاف». **1 scene flagged per script** (a "chart" with no number in the text) → rewritten automatically → **0 flagged after**. |
| Rule documented with its reason | **PASS** | yes | `prompts/tts_prep.md`, `prompts/script.md`, `prompts/script_visual_fix.md`, and the header of `app/pipeline/tags.py` |

## Tests
`tests/tag_rules.py` (new) checks:
- unknown and off-beat tags are removed;
- a whisper on a plain sentence is removed;
- an inferred joke without a cue is removed;
- the writer's joke is kept;
- a second laugh in the same scene is removed;
- evidence must come from the sentence;
- a serious topic gets no laugh/whisper and no tag on a question;
- empty-board scenes are flagged.

**PASS.** The montage tests also still PASS.

## Not done / limits
- **Visuals:** the visual stage doesn't use the script's `visual`/`draw` yet (a visual run was out of scope). The script now carries it, and the next visual run should read it.
- **The "matches the sentence" verdicts are my reading.** The code guarantees the structural rules (allowed list, beat, tone, one sound per scene), but deciding whether a sentence is really a joke still relies on the writer's beat.
- **Old projects:** their `tts.json` was not regenerated (to avoid touching existing videos). They get the new rules the next time their voice prep is redone.
- **Unused prompt files:** `tts_tags.md`, `tts_prep_egyptian.md`, `tts_prep_msa.md`, `tts_prep_white.md` aren't loaded by any code and still contain the old wording. I left them untouched and am flagging them for you.

## What only you can judge
Whether the delivery sounds natural **by ear**: that a [chuckles] actually sounds like a light laugh at the joke, that [serious]/[warmly] land right, and whether fewer tags make the voice flatter or more natural. No audio was generated in this run.
