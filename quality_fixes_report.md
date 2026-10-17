# Quality fixes: audio, shapes, pace, site identity

Branch: `autovideo-motion-v2`. No ElevenLabs credits spent. `grasp.js` and `rig.js` were not changed. Montage and the 5 old 3D scenes were kept.

## Step 1: repeated letters in the audio — PASS (commit `730a082`)
- **Boundaries checked:** 42 sentence boundaries across 4 projects.
  - Timestamp overlap: 0/42.
  - Cuts that land inside sound: 26/42 with the old rule, **0/42** with the new rule.
- **Cause:** when a sentence was regenerated, it was cut at a fixed time offset from the word timestamps. That point often fell inside the tail of the previous word, which is what produced the doubled letter.
  - Reproduced on project `2026-10-17_ca06a4`, sentences 13→14: the old cut was at 38.76 s, inside the sound.
- **Fix:** cut at the quietest point of the energy envelope between the two sentences, widening the search window step by step if needed (`splice_points` in `audio.py`).
- **Not done:** a listening test on a freshly regenerated sentence. It needs a credit request.

## Step 2: repeated shapes — PASS (commit `84833ad`)
- A usage log (`data/history.json`) blocks reuse of any asset, background, heading font or character from the last `SHAPE_WINDOW` videos (default 5).
- Over 5 test plans (the 5th is a copy of the 1st): 5 repeats before, **0 after**.
- Layouts are logged but not enforced, because 13 layouts cannot fill a 5-video window.

## Step 3: pace and whiteboard realism — PASS (commit `5799c7f`)
- **Minimum scene on screen:** `MIN_SCENE_SECONDS` defaults to 2.5 s and is enforced in both the plan and the player.
  - 30 s test video: shortest scene **1.52 s → 4.44 s**.
- **Entrances:** 0.6 s → 0.9 s. Whiteboard drawing durations are slower too.
  - Shortest draw: 0.77 s, a text element.
  - Drawing speed: ≤ 1878 px/s.
- **Hand path:** peak jump 448 → **97.5 px/frame**. Jumps above 150 px/frame: 32 → **0**. Checked on 3 frames per drawn element.
- **Ideas:** each scene now states its idea, and visuals whose search terms don't match the idea are rejected.
- **Honest note:** 5 of 16 elements were dropped because they didn't fit the time.
  - The whiteboard prompt now asks for about 1.8 s per element (about 3 s per illustration) to reduce this.
- **Fixed along the way:**
  - the custom-scene probe no longer applies NaN attributes (it caused 25 console errors on an old project);
  - the library now skips `.DS_Store`, which had caused an HTTP 500.

## Step 4: site identity — design done, renaming waits for your choice
- **"Claude" removed from user-facing text:**
  - status labels, the project page, the new-video page, the taste page, and the error messages shown in the UI;
  - page titles were already clean.
  - Measured on the rendered text, titles, placeholders and tooltips of 8 pages × light/dark × desktop/phone: **0 occurrences** in 32 checks. Code names and comments are unchanged.
- **One theme:**
  - all colours, spacing (4/8/12/16/24/32), corner radii, font sizes and the two fonts (Alexandria for headings, IBM Plex Sans Arabic for body) now come from tokens in `app.css`;
  - the pages' inline spacing was moved onto the same scale.
- **Fixed:**
  - `--soft` was undefined, so boxes stayed light in dark mode;
  - a second orange (`#d9622b`) had been mixed in;
  - the top bar overflowed on phones.
- **Added:** the current page is highlighted in the top bar, plus a visible keyboard focus ring.
- **Checks:** 0 console errors and 0 horizontal scroll across the 32 checks. The players (`5585c8`, `ca06a4`) and the 5 old 3D scenes: 0 errors.
- **The product name is unchanged.**
