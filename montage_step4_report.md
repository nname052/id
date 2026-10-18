# Montage, Step 4: professional visual editor (word-by-word subtitles, motion graphics, compositing modes, transitions, lighting)

**Status: open — not accepted by the user.** Branch `autovideo-motion-v2`. The audio pipeline (S6), `grasp.js`, `rig.js`, the motion/scene code and the generation pipeline were not changed. Free tools only. Downloads you approved: faster-whisper large-v3 (≈3 GB) and two MediaPipe models (face, segmentation). The turbo model was also downloaded and tested, then not used.

**Test file:** your phone recording `IMG_2240.mov`, a copy in montage `2026-10-18_020e49`.
- Final full preview: `videos/_montage/2026-10-18_020e49/work/stages/s7_preview/v13/preview.mp4`.
- It is **26.83 s**, the whole edit; your 34.5 s recording yields 26.8 s after dead air is removed.

**Evidence images** are in `docs/montage_step4/`, each frame labelled with its timestamp.

## Engineering notes (root cause → candidates → fix → why)

| Problem | Root cause (tested) | Other candidates considered | Fix | Why this fix |
|---|---|---|---|---|
| Transcription mistakes («موصوط»، «المكمل») | medium model too weak for Egyptian dialect | dialect prompt; turbo model; per-chunk transcription | **large-v3**, no prompt. Confidence 0.74 → **0.84**, and «مبسوط/المجمل/كويسة/منطقي» come out right. | turbo wrote «مقصود» and translated to formal Arabic with a prompt; the prompt made large-v3 worse («جداً/المكمل»); per-chunk transcription was garbled and took 158 s |
| Words shown seconds early (e.g. «التفاعل» 9.86–12.70 while the speech starts at 12.00) | large-v3 stretches a word's **start** back over the silence before it | level-based pauses missing; vad_filter in whisper; DP length fit | **Silero VAD** finds the speech chunks; each word goes to the chunk containing its whisper **end time**; the first word of a chunk starts at the chunk's sound onset (**14 words** corrected) | the end-time rule matched the per-chunk evidence in every case checked; vad_filter didn't fix timing and hurt the text; DP put «التفاعل» on the wrong side |
| Pauses missing in a very quiet recording | speech (−50.7 dB) and room noise / breathing (−54.6 dB) have nearly the same level | lower threshold; longer min duration | pauses = level pauses ∪ **VAD gaps** | VAD separates speech by shape, not loudness |
| A cut landing in speech at the end of the file | whisper stopped transcribing while speech continued («انه شخص…») | — | last unit with no silence after it = cut-off sentence → dropped; any cut inside VAD speech is pulled back to the last real silence or extended to the end of the sound | cuts must sit only at sentence ends or real silences |
| Face dark (Y 72) and too warm (0.392); bright wall | one grade for the whole frame: lifting the face would burn the wall | stronger gamma on the frame; more WB | **subject-only relight via the person mask**: gamma 1.75 on the speaker, a gentle 6% skin cool, wall toned down ×0.88; frame-wide only WB + gamma 1.08 + a mild S-curve | the face reaches the comfortable range without clipping the wall or the white jacket |
| Halo around the jacket (seen by eye) | soft mask edge carried the subject lift onto the wall | — | sharper mask, shrunk 1 px into the body, narrow feather (0.4% of width), temporal smoothing | halo gone in the close-up |
| Meter showed «many friends» while he said «ما عنديش أصحاب كتير» (seen by eye) | ASR dropped «ما», and negation was checked only on the word right before «كتير» | — | negation searched across the whole phrase, including the ش suffix («عنديش، مبحبش»); the meter label is the subject noun | the meaning now reads «اصحاب · قليل ١٥٪» |
| Card «حاجة كويسة يكون» (seen by eye) | the card phrase crossed a 4 s pause into the next sentence | — | card text limited to its own clause (stops at a pause ≥ 0.3 s or punctuation) | |
| Subtitle panel full-width with one visible word (seen by eye) | hidden words kept their layout space | dim upcoming words (rejected: words would show before they are spoken) | the panel grows with each word, anchored at the line start (right edge); earlier words never move | |
| Graphic running past the end of the video (found while extracting frames) | duration not clamped | — | clamped to the video end; skipped if under 1.5 s remains (logged) | |
| Render failure with hard cut + dissolve | concat changed the timebase before xfade | — | `settb=1/fps` after every segment and concat | |

## Part A: subtitles
| Item | Result | Seen by eye | Measured | Numbers |
|---|---|---|---|---|
| A1 word-level timing | **PASS** (1 word just over) | yes (`closeup_subtitle_word_by_word.jpg`: 10.98 → 11.68 → 12.22 → 12.40 s, one word added each time) | yes | **On the final video:** first change in the subtitle area vs the word's timestamp, 54 words: median **0 ms**, **53/54 < 100 ms**, max **103 ms** (1 word; frame = 16.7 ms). **Word timestamp vs actual sound onset** (12 words after a pause, the only ones measurable acoustically): median −7 ms, **11/12 < 100 ms**, max 162 ms (first word «انا» at 0.16 s). |
| A2 presentation | **PASS** | yes | yes | 71 px font (3.7% of height, "large" from your brief), subtle dark panel, line height 1.38, at most 2 lines. 12/12 lines inside the bottom zone (62–80%). **Over the face: 0 lines.** If a face drops into the subtitle zone, the line moves within the bottom area (not needed here). |
| A3 breaks at pauses | **PASS** | yes | yes | Lines break at pauses/commas, never after a dangling word, and never between words that belong together. 1.20–3.38 s per line. |

## Part B: motion graphics
| Item | Result | Seen | Measured | Numbers |
|---|---|---|---|---|
| B1 style fits the content | **PASS (rules)** | yes | — | Templates: counter, comparison bars, meter, timeline, lower-third, icon + typed keyword. All rendered and checked by eye. On your file: «مبسوط بشخصيتي» → keyword + smile; «ما عنديش أصحاب كتير…» → **meter "اصحاب · قليل ١٥٪"** (a negated quantity); «حاجة كويسة» → keyword + thumbs-up. The reason for every choice is in the S5 report. |
| B2 placement | **PASS** | yes (`overlay_before_after.jpg`) | yes | Free-space search over the union of the person mask and face boxes for the whole graphic window, excluding the subtitle band and the TikTok button column. **Face overlaps 0, subtitle overlaps 0.** If there's no space → inset, otherwise skipped and logged (unit-tested). |
| B3 timing | **PASS** | yes | yes | Each graphic starts on its first spoken word: **0 ms** offset (≤ 150 ms required). Readable duration 2.6–4.5 s. Graphics are clamped to the video end; the 4th idea was skipped because only 0.7 s remained. |
| B4 no static text | **PASS** | yes | unit test | Every graphic has motion (icon pop, word-by-word typing, growing underline, filling meter, counting number, drawing line) plus a slow drifting background. A plain sentence is rejected (tested). |
| B5 tied to speech | **PASS** | — | yes | **3/3** graphics: every word shown was actually spoken in that idea. |

## Part C: compositing modes
| Mode | Result | Seen | Rule / reason (logged) |
|---|---|---|---|
| Overlay | **PASS** | yes | short idea → free space at the top (6–19.5% of height), above the head |
| Explainer | **PASS** | yes (`explainer_before_during_after.jpg`: 5.49 speaker → 5.94 dissolving → 8.29 graphic → 11.13 dissolving back → 11.69 speaker) | long explanation (8.6 s) with a quantity |
| Split | **PASS (forced to test)** | yes (`modes_inset_split_demo.jpg`, 20.50 / 21.50 s) | rule: comparison → split. Speaker in the top half, graphic content at 50–60%, above the subtitles. |
| Inset | **PASS (forced to test)** | yes (same image, 1.80 / 2.60 s) | rule: no free space → speaker shrinks into a box at the top centre |
| No separable speaker | **PASS** | — | explainer and inset disabled (unit-tested; the 16:9 test file has no face) |

- **How split and inset were tested:** the spoken edit «اعرض الجرافيك 1 inset» works through diff → apply (version v7). I then forced split + inset in v9 and checked them by eye.
- **The final version uses the rules only:** 2 overlays + 1 explainer.

## Part D: transitions
| Item | Result | Seen | Measured | Numbers |
|---|---|---|---|---|
| D1 by meaning | **PASS** | yes (`transitions_hard_and_dissolve.jpg`) | yes | 9 cuts: **8 dissolves of 12 frames (0.20 s at 60 fps)**, because the speech simply continues after dead air was removed. **1 hard cut at 16.17 s**, because the next part starts with «بس» (a turn in the idea). Motion-matched cut: 0 (no continuous movement detected). Each reason is logged. |
| D2 frames at transitions | **PASS** | yes | yes | Frame difference ±6 frames around each cut, picture area only: dissolves max 0.66–1.05 (1.5–2.4× the median 0.41), hard cut 1.66 (3.8×). **0 repeated frames at cuts.** |

- **A rule I tried and removed:** "no shared words = sharp change" marked every cut as hard on the real recording.

## Part E: lighting and picture
| Item | Result | Seen | Measured | Numbers |
|---|---|---|---|---|
| E1 exposure + WB, per shot, on the face | **PASS** | yes (`light_before_after.jpg`) | yes | **Face brightness 72 → 128** (comfortable 118–168). Frame colour cast **29.3% → 6.2%** (yellow tungsten wall → neutral). Clipped 0.00% → 0.00%, crushed 0.07% → 0.00%. |
| E2 skin-aware natural grade | **PASS** | yes | yes | Skin warmth (R−B)/(R+G+B) **0.392 → 0.127** (natural 0.10–0.20). Mild S-curve. No stylized look unless asked. |
| E3 subject isolation | **PASS (tone, not blur)** | yes (`mask_quality.jpg`) | yes | **Mask quality by eye:** head, face, hair and body clean; a slightly smeared edge on the moving right arm. Mask = 39% of the frame on average, 2,072 frames. The wall is plain (few edges), so it was **toned down ×0.88**, not blurred: blur only applies when the background is busy. |
| E4 sharpen/denoise only when needed | **PASS** | — | yes | Sharpness 49.8 < 60 → unsharp 0.3; noise 0.65 < 1.6 → no denoise. |
| E5 frame rate | **PASS** | — | yes | Source VFR (avg 59.728, nominal 60) → **constant 60 fps** using blending, not duplication. 1,610 frames, r = avg = 60.0. |

## Part F: pacing and cuts
- **Cut points:** 20 cut points, **0 inside a word, 0 inside speech (VAD)**.
- **Dead air:** gaps over **0.7 s** are removed; 0.22 s of breath is kept after speech and 0.14 s before it. 34.5 → 26.83 s.
- **Frame-accurate joins:** 0 repeated frames in the video; the picture-area difference stays smooth at every cut.
- **Inside the explainer:** 265 static frames are graphic holds, counted separately.

## Verification summary
- **Frames:**
  - start / middle / end: `clip_start_middle_end.jpg` (0.40 / 13.40 / 26.40 s);
  - subtitle close-up: 10.98–12.40 s;
  - graphic close-up: `closeup_graphic.jpg` (1.68 s).
- **Measurements:**

  | Check | Result |
  |---|---|
  | Subtitle lag | 53/54 words < 100 ms |
  | Graphic start | 0 ms after its first word |
  | Transition frame difference | as in D2 |
  | Frame rate | 60 fps, constant |
  | Repeated frames at cuts | 0 |
  | **Face overlap (graphics + subtitles)** | **0** |

- **LUFS:** −13.88, TP −1.44. The audio pipeline is unchanged; the value moved only because the cuts changed.
- **SHA-256:** `IMG_2240.mov` 794b5d679a23… unchanged (the original upload and both copies).
- **Pages:** 41 page views (montage, generation pages, settings, library, the five old 3D scenes) × desktop/phone × light/dark → **0 console errors, 0 overlaps**.
- **Full run time (CPU):** about **5.3 min**:

  | Stage | Time |
  |---|---|
  | S1 | 46.6 s (large-v3 38 s) |
  | S2 | 4.5 s |
  | S3 | 141 s (mask + graded copy) |
  | S4 | 7 s |
  | S5 | 74 s (Chromium frames) |
  | S6 | 3 s |
  | S7 | 42 s |

- **Tests:** `tests/montage_cut_points.py`, `montage_edit_rules.py`, `montage_versions.py`, and the new `montage_motion_rules.py` (style choice, negation, clause-bounded keywords, plain-text rejection, placement avoiding speaker and subtitles, VAD alignment): **all PASS**.

## Licenses
| Item | License |
|---|---|
| FFmpeg 9 (system build) | LGPL/GPL |
| faster-whisper; Whisper large-v3 weights (OpenAI, via Systran conversion); Silero VAD (bundled in faster-whisper) | MIT |
| MediaPipe 1.1.1 + BlazeFace short-range + Selfie segmenter models (Google) | Apache 2.0 |
| opencv-python / opencv-contrib (MediaPipe dependency) | Apache 2.0 |
| PySceneDetect | BSD-3 |
| Playwright | Apache 2.0 |
| Chromium | BSD |
| numpy | BSD |
| Lucide icons (`assets/icons/lucide`) | ISC |
| Alexandria, IBM Plex Sans Arabic fonts | OFL 1.1 |

Models live in `data/models` and the HF cache, not in git; `python -m app.montage.vision` fetches the MediaPipe models.

## Not verified / known limits
- **The speed of large-v3:** 38 s for a 35 s recording; a 5-minute recording would take ~5–6 min for transcription alone.
- **Word timing inside a continuous chunk** follows whisper. Only words right after a pause can be checked against the actual sound.
- **Card wording is rule-based**, from the spoken words. A meter title like «اصحاب» is short; a human editor might write «عدد الأصحاب».
- **Split/inset in the final edit:** they were verified by forcing them, not triggered by the rules, because this recording has no comparison and always has free space above the head.
- **Motion-matched cuts:** never triggered on this static talking head, so they're only unit-logic-checked.
- **Mask:** a slight smear on the moving arm edge; never tested with busy backgrounds (where blur would be used).
- **Lag measurements:** the on-screen lag uses pixel change in the subtitle area. The acoustic lag only covers words after a pause.

## What only you can judge
- The overall feel, and whether it looks like a professional editor's work.
- Whether the brighter, cleaner face looks natural or "processed".
- Whether 12-frame dissolves on every same-shot cut feel smooth or soft.
- Whether the word-by-word subtitles read comfortably.
- Whether the cards and the explainer feel useful.
- Anything about audio: I can't listen, and audio was out of scope for this run.
