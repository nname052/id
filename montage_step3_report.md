# Montage, Step 3: full automatic editor + site redesign

Commit: `2d6cbb4` (branch `autovideo-motion-v2`). Free tools only: FFmpeg 9, PySceneDetect, faster-whisper medium on CPU, OpenCV, and Chromium for text rendering. No paid APIs, no GPU, no ElevenLabs credits. `grasp.js`, `rig.js`, the motion/scene code and the "New video" pipeline logic were not changed; on the project page only the UI changed (C3/C6).

**Main test file:** your real phone recording `IMG_2240.mov`.
- iPhone, 1080×1920, 34.54 s, nominally 60 fps (average 59.728 = variable), speech at −42.2 LUFS.
- Copied into montage `2026-10-18_fbf355`.
- The original upload in `2026-10-17_55d1d8` was only read.

**Second file:** `test_recording_16x9.mp4` (21 s, 16:9, three different shots), in montage `2026-10-18_ac7e1f`.

## What changed in short
- **One button: «اعمل المونتاج».** It runs 7 stages in a row and produces the finished video as a full preview:
  - Analysis → cut & pacing → picture → subtitles → motion graphics → audio → full preview.
  - Stage-by-stage review stays as the control layer: versions, redo, revert, natural-language edits with a diff, and «طبّق».
  - After a change, only the edited stage and the ones after it rebuild.
  - Export stays locked until the full preview is approved.
- **The brief (طلبك للفيديو).** You write it once; it covers pace, card look, subtitle size/color/position, colors, focus words, aspect ratio and language.
  - Each stage stores which parts of the brief it used.
  - Changing the brief marks only the affected stages as stale.
- **New modules:** `look.py` (picture), `graphics.py` (cards + subtitle rendering), `brief.py`.
- **Rewritten:** `stages.py`, `export.py` (dissolves with handles, audio crossfades, animated cards), and `nl.py` (rules for the new stages, plus subtitle-line fixes).
- **Real bug found and fixed:** the silence threshold was fixed at −35 dB. On your recording, speech itself sits around −49 dB, so quiet words counted as "silence" and cuts could land on speech.
  - The threshold now follows each recording: between its noise floor and its speech level (here −56.5 dB).
  - The old Step 2 run on this file had this problem.
- **Whisper:** it now gets a general Egyptian-dialect hint (none of the video's own words).
  - Mean confidence on your file went from 0.69 to 0.74, and it now punctuates (used for line and sentence breaks).
  - Words like «كتير / كويسة» now come out right.

## Acceptance

| Item | Result | Numbers |
|---|---|---|
| One click → full preview, end to end | **PASS** | From the UI: brief «إيقاع طبيعي، كروت فخمة دهبي، ترجمة كبيرة، ألوان طبيعية» → one click → all 7 stages with no manual stage work → **89.7 s** total (S1 32.3, S2 0.0, S3 3.5, S4 2.1, S5 1.4, S6 2.9, S7 47.5). Output **1080×1920, 28.13 s, 60 fps**. 16:9 file: 36.2 s. |
| Cuts: 0 inside a word; crossfade; dead-air threshold stated | **PASS** | Phone file: 3 cuts, **0 inside a word**, all at sentence ends, levels −72 / −60 / −63 dB (silence threshold −56.5). **Dead-air threshold 0.7 s**: longer silences are cut, leaving 0.22 s of breath after speech and 0.14 s before; shorter pauses stay. 34.5 → 28.1 s. Every cut has a **60 ms** audio crossfade. A same-shot jump cut gets a **12-frame dissolve at 60 fps (0.20 s)**; a shot change gets a hard cut (16:9 file: 2 hard cuts, 6 cuts, 0 inside a word). |
| Subtitles: inside the bottom safe area; 1.2–5 s on screen | **PASS** | **12/12** lines inside the bottom zone (62–80% of height for 9:16; TikTok captions and buttons stay clear). On-screen time **1.20–4.12 s** (0 under, 0 over). Font = 3.7% of frame height ("large" from the brief), dark panel behind. At most 2 lines. Lines break at pauses, commas and sentence ends, never after a dangling word, and never split a word from what completes it («التفاعل \| بتاعي» was fixed). 16:9 file: 8/8, 1.2–2.99 s. |
| Motion graphics: ≥1 card per key idea, 0 overlap with subtitles, each card tied to speech | **PARTIAL** | One style: Alexandria, one color palette per brief, one entrance (rise + fade 0.35 s, fade out 0.25 s). One card on screen at a time. Cards sit in a different zone from subtitles (top, 9–27%), picked as the calmest area of the frame (0.015 vs 0.079). **0 overlaps** with subtitles. **Every card maps to spoken words: 3/3**, and the test rejects a card with no matching sentence. **But:** on the first automatic run only **1/3** ideas got a card, because whisper wasn't confident about the words (e.g. «موصوط» instead of «مبسوط»). After correcting 4 lines in «نص الترجمة», **3/3**. |
| Filters: brightness/contrast/sharpness before → after; no blown highlights | **PASS** | Phone file: brightness **163.5 → 176.8**, contrast (Y std) **36.7 → 42.7**, sharpness (Laplacian) **18.8 → 50.0**, noise 0.47 → 0.66, color cast **29.2% → 11.2%** (yellow tungsten wall → near neutral, skin kept warm). Clipped ≥250: 0.00% → **0.13%**; crushed ≤5: 0.07% → 0.45% (both within limits). Denoise **not** applied (noise 0.47 < 1.6, decided by measurement). No stylized filter. On the 16:9 file the full correction would have clipped 3.31%, so the stage softened it by itself to 30% (0.33%). Images: `docs/montage_step3/look_before.jpg` vs `look_after.jpg`. |
| Frame rate: stated and constant; no duplicate frames at cuts | **PASS** | Source is VFR (59.728 avg, nominal 60) → constant **60 fps**; missing frames are filled by blending (`minterpolate=mi_mode=blend`), not duplicated. Output r_frame_rate = avg = 60.0. **0 duplicate frames** in 1,688, **0 near the cut**. Picture-change around the cut (±6 frames) max 0.83 vs median 0.46 (1.8×); a hard cut there would jump 3.31 (7×). 16:9 file: 30 fps kept; the source itself has 260 static frames (still graphics), the output 82: the edit introduced none. |
| Audio: −14 LUFS ±1; crossfade at every cut | **PASS** | File: **−14.06 LUFS**, TP −1.46 dBTP (16:9: −14.06). 60 ms crossfade on 1/1 and 2/2 cuts. Cleanup: high-pass 80 Hz, FFT denoise, a gentle gate (−10 dB in pauses), light compression, then two-pass loudnorm. Noise in kept pauses: gain alone would leave −41.3 dB → after cleanup **−49.3 dB**. |
| Brief stored and used by all stages | **PASS** | Stored in `montage.json`. Each of the 7 stage files records what it used (e.g. S4 `sub_size=large`, S5 `mood=elegant`, S2 `pace/aspect`, S7 `aspect`). Test: changing the brief to «ترجمة كبيرة» made only S4 → S7 stale; S1–S3 stayed fresh. |
| Export blocked until full-preview approval | **PASS** | Before approval: **409** «التصدير مقفول…». Approved from the UI → export went through (same file, no re-render). After the next change, a new preview → **409** again until re-approved. |
| Revision: one change → new version of one stage; later stages rebuild; preview refreshes | **PASS** | From the UI: 4 subtitle lines fixed → diff shown → «طبّق» → **S4 v2 only**; S5/S6/S7 rebuilt automatically (v2), S1–S3 stayed v1. Spoken edit «شيل الكارت 2» → diff `params.removed` → apply → **S5 v5**, S6/S7 rebuilt, export locked again. Unit test: versions before/after exactly {s4,s5,s6,s7}+1. |
| Website: no overlapping elements, desktop + phone; ElevenLabs settings card redesigned | **PASS** | Automated check of 9 pages × desktop/phone × light/dark (36 views) + the old 3D scenes: **0 overlaps**, 0 horizontal scroll, 0 "Claude". The settings page uses the same endpoints and logic: balance fetched only on «تحديث», threshold saved via `/api/settings`. Screenshots: `docs/montage_step3/`. |
| Source SHA-256 unchanged | **PASS** | `IMG_2240.mov` 794b5d67… (original upload and both copies), `test_recording_16x9.mp4` 9f75d625…; `/verify` = identical. |
| Old 3D scenes + generation pipeline: 0 console errors | **PASS** | fridge, Rocketbox, scene, body, look: **0 errors**. `/new`, `/library`, `/style`, 2 project pages: **0 errors**. |

## By part

### A: the automatic editor
- **A1 One click.** Done; see the acceptance row above.
- **A2 Cuts and pacing.**
  - Cuts land only at sentence ends or real silences, using the per-recording silence threshold.
  - Segment lengths are exact frame counts, so picture and sound stay locked after every cut.
  - Dissolves and crossfades use "handles" (extra frames/samples from either side of the cut), so the total duration doesn't change.
  - Speed is never changed (the old ×1.05–1.1 rhythm stage was removed), so nothing looks fast-forwarded.
- **A3 Subtitles.** Bottom zone; 1.2–5 s; synced to word timings; font sized relative to frame height; dark panel; at most 2 lines, with the line length tied to the font size.
- **A4 Cards.**
  - Card types:
    - number (spoken numbers, e.g. «تلاتين دقيقة» → ٣٠, unit-tested);
    - term (your brief's focus words, or English words in the speech);
    - topic of a long sentence;
    - the idea of a short phrase (2–7 words with meaning).
  - A card's text is always the spoken words themselves, never a rewrite.
  - If the frame is already full of text or detail (like the 16:9 test file), cards are skipped with a stated reason; «رجّع الكروت» forces them back.
- **A5 Filters.** Partial white balance (70%), gentle levels, gamma only when the image is too dark or bright, sharpening and denoise only when measured as needed, and an automatic back-off if anything clips. Stylized looks (warm, cool, cinematic, black & white) only on request.
- **A6 Frames.** As in the acceptance row: VFR → constant rate with blending; duplicates checked across each cut.
- **A7 Audio.** As in the acceptance row. Music ducking is unchanged from Step 2.
- **Preview clip and frames (main file):**
  - The full preview is **28.13 s**: the whole video after cuts, since your 34.5 s recording becomes 28 s.
  - File: `videos/_montage/2026-10-18_fbf355/work/stages/s7_preview/v5/preview.mp4` (not in git).
  - Frames: `preview_start.jpg`, `preview_middle.jpg`, `preview_end.jpg`.
  - Close-ups: `closeup_subtitle.jpg`, `closeup_card.jpg`, `card_in_frame.jpg`.
  - All in `docs/montage_step3/`.

### B: review and revision
- Each stage card in the side column has:
  - its report and images;
  - the version list, with revert;
  - «أعد المرحلة دي»;
  - a natural-language box that shows a diff before «طبّق».
- Supported edits by stage:
  - **Cut:** «القصّات أهدى/أسرع», «من غير مزج / مزج أطول», remove/trim/swap/move parts.
  - **Picture:** «أفتح/أغمق», looks, sharpness, saturation.
  - **Subtitles:** position higher/lower, size, color, background, line length.
  - **Cards:** «شيل الكارت N», fewer/more, palette, «من غير كروت / رجّع الكروت».
  - **Audio:** loudness, music, ducking, «شيل الدوشة أكتر».
  - Anything unclear gets one question back.
- **Subtitle text editor (inline):** fixing a line creates word-level fixes. They survive later re-cuts, and the cards are rebuilt from the corrected text.
- **Speed:** asking for a part "slower/faster" gets a question back, because playback speed is no longer changed.

### C: website
- **One layout system:** page header, a single grid, the same card/button/spacing/type scale everywhere, labelled icon buttons («✎ تغيير العنوان», «🗑 حذف», «＋ جملة», «▶ اسمع»).
- **Upload:** a drop zone (drag or click) with an upload progress bar. After upload it shows type, size, duration, resolution, fps and a thumbnail. The montage list is a grid of cards with thumbnails.
- **Word / scene / title editing on the project page:** the browser `prompt()` pop-ups were replaced with inline editors, with labelled fields, under the sentence or scene. A dropdown suggests the words of that sentence.
- **Settings:**
  - A card with the key status badge, remaining credits (with a usage meter), next reset date, and plan.
  - A separate «حد الصرف قبل الصوت» card with a clear label, unit and save button.
  - A read-only «حد المفتاح نفسه» card explaining where that limit is changed (elevenlabs.io → Developers → API Keys → Credit limit).
- **Montage editor:**
  - The video preview is large and centered with the approval/export bar under it.
  - The stage list is in a column beside it (stacked on phone).
  - Brief, subtitle editor and files are grouped in labelled cards.

### D: the brief
- One field at the top of the montage page. It is parsed into settings with fixed rules, shown as tags under the field, saved, and used by every stage (as above).

## Not verified, and why
- **By ear: nothing was judged by listening.** I can't hear the output. These were checked by measurement only, and could sound different:
  - the 60 ms crossfade;
  - artifacts from the FFT denoise and the gate (possible "pumping" in pauses);
  - the compressor;
  - the speech clarity after +22 dB of gain on a very quiet recording.
- **Cards are rule-based, not real understanding.** No AI/LLM was used (free-tools-only rule). Cards depend on the transcript: on your file, whisper medium still mishears some phrases («بطوع», «هيش نحسل ايش»), so the card for that idea needs you to fix the text first.
  - A bigger whisper model (large-v3, ~3 GB download, slower on CPU) would probably transcribe better. I didn't download it without your approval.
- **Faces:** this OpenCV build (5.0) has no bundled face detector, and YuNet needs a model download.
  - Exposure is corrected for the whole frame, not the face specifically.
  - The card zone is chosen as the calmest area, not "away from the face" (it worked here: cards sit above the head).
- **Only one jump cut** in your file (the only silence longer than 0.7 s was 4 s), so the dissolve was verified on one real cut. The hard cuts were verified on the 16:9 file.
- **The 16:9 test file already has burned-in captions and titles.** Our subtitles still sit on top of the old captions there. Cards were skipped automatically on that file.
- **Real music:** `music/` is still empty; ducking was not re-tested in this step.
- **The "30-second preview":** the result is 28.13 s, because that's all your recording yields after cuts. No longer file was tried.
- **Visual quality judged by frames and measurements, not by watching playback.** I did not watch the whole preview the way you will.

## Files
- **New:** `app/montage/brief.py`, `look.py`, `graphics.py`; `tests/montage_edit_rules.py`; screenshots and frames in `docs/montage_step3/`.
- **Rewritten:** `app/montage/stages.py`, `export.py`, `nl.py`; `montage.html`, `montage_list.html`, `settings.html`.
- **Changed:**
  - `app/montage/cuts.py` (transitions, subtitle cues, adaptive padding);
  - `speech.py` (dialect hint, adaptive silence threshold, noise floor, cut-jump measurement);
  - `__init__.py` (brief, auto run, export gate, subtitle fixes, stage images, thumbnails);
  - `app.css`;
  - `project.html` and `library.html` (UI only).
- **Tests (all PASS):** `tests/montage_cut_points.py`, `tests/montage_versions.py` (rewritten for 7 stages, brief and cascade), `tests/montage_edit_rules.py` (new).
- **Montages left for you:**
  - `2026-10-18_fbf355`: the main one. Its latest preview (v5, after removing card 2) is waiting for your approval.
  - `2026-10-18_64e625`: development runs.
  - `2026-10-18_ac7e1f`: the 16:9 file.
  - You can delete any of them.
