# Montage, Step 2: staged, reviewable automatic editor

Branch: `autovideo-motion-v2`. Built on the Step 1 skeleton (`a8b9b5c`); upload, analysis, the manual editor and the SHA-256 check are kept. Free tools only: FFmpeg, PySceneDetect, faster-whisper 1.2.1 (CPU, int8). No paid APIs, no GPU, no ElevenLabs credits. `grasp.js`, `rig.js`, the motion/scene code and the "New video" pipeline were not changed.

## What was built
- **Modes:** BASIC (default, 4 stages) or ADVANCED (7 stages), saved per montage. Switching mode keeps every saved version.
- **Versioned stages:** every stage writes `work/stages/<stage>/vN/stage.json` plus `preview.mp4`. A version is written once and never rewritten.
  - Each version records which version of the previous stage it was built from. If that previous stage changes (redo, revert or edit), later stages show as **stale** without being deleted, and they rerun only when asked.
  - A job interrupted by a server restart is marked as failed, so it can be redone instead of staying "running" forever.
- **BASIC stages:**
  - **S1 Analyze:** probe, loudness, scene cuts, faster-whisper word timestamps, and pauses from FFmpeg `silencedetect`.
    - Scene cuts use PySceneDetect's AdaptiveDetector, because ContentDetector missed the 7.0 s join.
    - Whisper stretches words over the silence after them, so word edges are refined with the measured pauses.
    - If transcription fails or mean confidence is below 0.5, speech is split by pauses, and the report says so.
  - **S2 Cut and arrange:** speech is split into sentences at sentence ends or pauses. Segments are chosen by context: cut-off sentences, a half-word at a shot start, fillers and retakes (only the last take is kept) are dropped. Cuts go at the quietest point inside the silence around a sentence. Output: an edit list (source, start, end, order).
  - **S3 Audio:** two-pass `loudnorm` to the target (default −14 LUFS, true peak −1.5 dBTP). If an audio-only file has the "music" role (automatic or chosen), the music is ducked under the speech with `sidechaincompress`.
  - **S4 Export:** full-resolution MP4 in 9:16 or 16:9. It runs only when S3's latest version is approved, through both the new endpoint and the old `/export`.
- **ADVANCED stages:**
  - **S2a Select shots:** drops shots that are too short, or black with no speech.
  - **S2b Context cuts:** the S2 logic, limited to the kept shots.
  - **S2c Rhythm:** each segment gets an importance score. Important ideas get a longer breath after them at ×1.0. Less important ones get a shorter tail and ×1.05–1.1 speed. Cuts stay inside the same silence.
  - **S2d Subtitles:** lines timed on the output timeline (mapped through the cuts and speed), breaking at pauses, ≤ 32 characters and ≤ 2.8 s.
    - Lines are drawn as transparent images in Chromium, because this FFmpeg has no `drawtext` or `libass`. Arabic shaping is correct.
    - They are placed inside a safe area (9:16: 6–84 % width, above 72 % height) with a plain default style. No styling was done.
- **Previews:** every stage has a 540×960 (or 960×540) preview playable in the page. S4's preview is the final export itself.
- **Review controls per stage:**
  - Approve, Redo, and Revert to any version;
  - a natural-language box: the instruction becomes a structured change to the stage JSON, shown as a diff (field / before / after), and applied only after "طبّق". Applying creates version N+1.
  - Unclear instructions get one short question back.
  - The rules are deterministic Arabic/English rules, with no AI or paid API. Supported instructions:
    - trim N seconds from the start or end;
    - make part K (or everything) slower or faster;
    - remove part K;
    - swap or move parts;
    - change the aspect ratio;
    - remove or restore shot K;
    - make subtitle lines shorter or longer;
    - make the overall loudness or the music louder or quieter;
    - remove or restore the music;
    - turn ducking on or off;
    - set a LUFS target;
    - change the speech language or the scene-cut sensitivity.
- **Manual editor:** the old manual editor (scenes, start/end, reorder) is now in a collapsible section. Saving creates a new version of the cut stage.
- **New files:**
  - `app/montage/speech.py`, `cuts.py` (pure functions), `stages.py`, `nl.py`, `subs.py`;
  - `export.py` extended (speed, low-resolution previews, an external audio track, overlays) while keeping the old call;
  - tests `tests/montage_cut_points.py` and `tests/montage_versions.py`.

## Acceptance
| Item | Result | Numbers |
|---|---|---|
| Mode toggle: BASIC 4 stages, ADVANCED 7 | **PASS** | The API and the page show 4 (`s1, s2, s3, s4`) and 7 (`s1, s2a, s2b, s2c, s2d, s3, s4`). Switching back to BASIC kept every version; S3/S4 then showed as stale, because they had been built on S2d. |
| Real test file (21.0 s, 1920×1080), BASIC end to end, a preview per stage | **PASS** | Montage `2026-10-17_6fdfe2`, all 4 stages with a preview. Stage times: **S1 25.1 s** (whisper medium 23.2 s of that), **S2 0.95 s**, **S3 2.25 s**, **S4 3.83 s**. Result: 3 segments, **12.89 s**. Export **1080×1920, 12.90 s**, −14.2 LUFS. 3 frames checked: correct center crop. |
| Cut points: 0 inside a word; sentence ends vs pauses | **PASS** | Real file: **6 cuts, 0 inside a word**: **5 at sentence ends, 1 at a pause**. Every cut is at −65 dB or quieter (speech is about −20 dB). Dropped by context: «اللي سبقوك مكانوش أشتر مني» and «ناس موبايلهم قنبهم» (sentences cut off at the file's joins), and «توقّر» (half a word at the start of a shot). Unit test: 6 cuts, 0 inside a word, 4 sentence ends + 2 pauses. The filler, retake, cut-off sentence and half-word cases are all dropped as expected: **PASS**. |
| Export blocked until preview approval | **PASS** | Before approval, S4 → **409** "التصدير مقفول…", and the old `/export` → **409** too. After approving S3, the export ran. With S3 stale, S4 → 409 again, and approving a stale S3 is refused. |
| Redo/revert: S2 redo marks S3 and S4 stale; revert is byte-equal | **PASS** | Real data: S2 redo (v4) → S3 **stale**, S4 **stale**. Revert to v3 → the JSON is **byte-equal** (6243 bytes, same SHA-256). S3/S4 became valid again, because they were built on v3. Unit test: byte-equal (526 bytes), stale versions not deleted, mode switch keeps versions: **PASS**. |
| Natural-language edit: diff → applied only after confirmation → version N+1 | **PASS** | «شيل أول ثانيتين» on S2 v1 → diff `segments[g1].start: 0.51 → 3.345` (moved to the nearest silence so it doesn't cut into speech). Before "طبّق": still v1. After: **v3** (v2 was a flawed attempt, fixed below), with 0 cuts inside a word. «وطّي المزيكا شوية» on S3 → diff `music_gain_db: −16 → −19` → v2. Unclear instructions got one question: «خلّي الجزء أبطأ» → "أبطّأ أنهي جزء؟…", «شيل أول ثواني» → "أشيل كام ثانية من الأول؟", «خليه أحلى» → "تقصد إيه بالظبط؟…". |
| Source file SHA-256 unchanged | **PASS** | `test_recording_16x9.mp4`: `9f75d625…f51f` before and after, and the app's `/verify` says identical = true. The synthetic music file is unchanged too. |
| Old 3D scenes, generation pipeline, Montage skeleton: zero console errors | **PASS** | 10 pages (`/new`, `/library`, `/style`, `/settings`, 2 project pages, `/montage`, the Step 1 montage, a BASIC montage, an ADVANCED montage) × light/dark × desktop/phone = **40 page views: 0 errors**, no horizontal scroll, no "Claude" text. Players `5585c8` and `ca06a4`: 0. Fridge, Rocketbox, scene, body, look: 0. |
| ADVANCED: S2a→S2d ran on the test file | **PASS** | **S2a** (1.27 s): 3 shots, all kept (each has speech). **S2b** (0.56 s): 3 segments, 6 cuts, 0 inside a word. **S2c** (0.57 s): importance 0.81 / 0.56 / 0.46 → speeds ×1.0 / ×1.05 / ×1.05; durations 4.10→4.23, 5.46→5.21, 3.33→3.10; total 12.89 → **12.54 s**; 0 cuts inside a word. **S2d** (2.6 s): **9 lines, 9/9 inside the safe area**. **S3**: −16.81 → **−14.0 LUFS**. **S4**: 1080×1920, 12.57 s (12.54 expected), −14.01 LUFS, subtitles burned in (3 frames checked). |

### Additional checks
- **Ducking:** tested with a synthetic music file (`music/` is empty), see the limitations below.
  - The music was classified as "music" automatically.
  - At −16 dB it drops **17.3 dB** under speech.
  - Final mix: −14.21 LUFS.
- **Fallback:** transcription was forced to fail, and then forced to a confidence of 0.20.
  - The text was split by pauses, and the report says why.
  - The resulting cuts: 7 cuts, all in silence (−64 dB or quieter).

## Bugs found and fixed during verification
- An edit cut moved to "word end + 3 ms" landed at the start of the next word when two words have no gap between them. The first attempt showed **1 cut inside a word**. Edit cuts now move to the nearest real silence (≥ 0.12 s).
- A stage could stay "running" forever if the server restarted mid-job. It is now marked failed with a clear message, and it can be redone.
- Subtitle lines joined the end of one sentence with the start of the next. Lines now break at pauses.
- Whisper returns numpy numbers that broke the JSON. They are now cast at the source.

## Time
- Processing the 21 s file:
  - BASIC: about 33 s in total, most of it whisper.
  - ADVANCED, S2a to S4: about 13 s.
- Whisper medium runs at about 0.7–1.1× real time on this CPU, which means a 5-minute recording needs about 4–6 minutes for S1.

## Known limitations
- **faster-whisper on Egyptian Arabic** (measured against the known script of the 3 videos in the test file, 34 reference words):
  - **medium: WER 14.7 %**, word-start error median 0.10 s (90th percentile 0.22 s), mean confidence 0.87;
  - **small: WER 55.9 %**, and it dropped most of the second clip, which is why medium is the default (`MONTAGE_WHISPER_MODEL`);
  - part of the medium error comes from words cut in half at the test file's own joins;
  - whisper's word ends spill into the silence after them, so all 6 real cuts fall inside whisper's **raw** word spans. They are outside the **refined** spans, and the audio level at every cut is −65 dB or quieter. The refinement depends on `silencedetect` (−35 dB), so a noisy recording may refine less well.
- **"By context" means rules, not understanding of meaning.** Cut-off sentences, half-words, fillers and retakes are detected. A sentence that is complete but meaningless out of context is not: «اللي بيقولك:» was kept, even though what it introduced was cut off in the source.
- **Natural-language edits** cover only the listed instructions. Anything else gets a question, not a guess.
- **Pause fallback:** when it is used, context selection is weaker, because there are no words to judge (4 segments instead of 3 on the test file).
- **Subtitle line breaks:** they follow pauses and length only. With no punctuation from whisper, a line can still end mid-phrase («فاكر» alone).
- **Subtitles on the test file:** they overlap the captions already burned into it. That comes from the test file, not from a real recording.
- **Rhythm importance** is a heuristic: the hook, numbers, questions, word density and length.

## Not verified, and why
- **Real music:** `music/` is empty, and nothing new was downloaded. Ducking was measured on a synthetic tone chord only.
- **A real phone or camera recording:** the test file is still the one assembled from the app's own videos. A `.mov` from a phone has still not been tried.
- **16:9 export through the stages:** the code path is the same as Step 1, where it was verified, but this run used 9:16.
- **Long files (minutes):** only the 21 s file was run. Whisper time scales with length.
- **Listening:** the outputs were checked by measurement (levels at cuts, LUFS) and by frames, not by ear.

## Files left for you to look at
- Test montages `2026-10-17_6fdfe2` (the main BASIC/ADVANCED run) and `2026-10-17_a0db3d` (the ducking test).
- They are in `videos/_montage/` (not in git). You can delete them from the Montage page.
