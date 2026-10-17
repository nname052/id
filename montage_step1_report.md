# Montage, Step 1: skeleton (upload, analysis, trim/reorder, export)

Branch: `autovideo-motion-v2`. No subtitles, effects, filters, transitions or upscaling. No paid APIs, no GPU, no ElevenLabs credits.

## What was built
- **Separate module:** `app/montage/` (`__init__.py` routes and background jobs, `media.py`, `state.py`, `export.py`), pages `montage_list.html` and `montage.html`, a "المونتاج" link in the top bar. Its state lives in `videos/_montage/<id>/` and it does not use the generation worker, projects or settings. Shared pieces: the page shell (`base.html`) and the JSON helpers in `store.py`.
- **Storage per montage:**
  - `original/`: the upload exactly as received, never modified, with a stored sha256;
  - `work/`: working copies, plus `<source>.analysis.json` next to each;
  - `edit.json`: the segment list;
  - `exports/`: a new file per export.
- **Upload:** mp4, mov (video) and m4a (audio). Validated with ffprobe (readable, at least one stream, duration > 0, phone rotation handled). Shows duration, resolution, fps and audio presence. Bad or unsupported files are rejected with a clear message and leave nothing behind.
- **Analysis:**
  - ffprobe: duration, resolution, fps;
  - FFmpeg `loudnorm`: integrated LUFS, true peak, LRA;
  - PySceneDetect `ContentDetector`: scene start/end times;
  - cross-check: FFmpeg's own `select='gt(scene,0.3)'` scene count.
- **Edit:** add scenes, change start/end, reorder (↑ ↓), remove (✕). Saved as `(source, start, end)` segments plus the aspect ratio.
- **Export:**
  - re-encoded for frame-accurate cuts: H.264 (CRF 20) + AAC 192k, 30 fps, `+faststart`;
  - 9:16 → 1080×1920, with a center crop when the source is wider;
  - 16:9 → 1920×1080, centered with side bars when the source is narrower;
  - audio-only segments become black video; segments without audio get silence.
- **Dependency:** `scenedetect[opencv-headless]` 0.7.2 (BSD, free), added with `uv add`.

## Test files (scratchpad, outside the repo)
- `test_recording_16x9.mp4`: a real file made from three videos this app rendered, with their real voice. 1920×1080, 30 fps, 21.0 s, AAC.
- `voice_note.m4a`: 10 s of real voice (AAC).
- `broken.mp4`: a text file with an `.mp4` name. `notes.txt`: an unsupported type.

## Acceptance
| Item | Result | Numbers |
|---|---|---|
| Upload: real file accepted, invalid file rejected | **PASS** | `test_recording_16x9.mp4` accepted: **21.000 s, 1920×1080**, 30 fps, audio present. `broken.mp4` → HTTP 400 "الملف ده مش بيتقري (ffprobe رفضه)…". `notes.txt` → HTTP 400 "النوع ده مش مقبول…". The rejected uploads left no folder. `voice_note.m4a` accepted as audio-only (10.0 s). |
| Analysis matches FFmpeg; loudness reported | **PASS** | Duration: analysis **21.000 s** = ffprobe on the original **21.000000 s**. Scenes: PySceneDetect **2** (cut at 14.0 s) = FFmpeg scene filter **2** (cut at 14.0 s). Loudness: **−17.24 LUFS**, true peak **−0.78 dBTP**, LRA 4.7 LU (m4a: −16.36 LUFS, −1.70 dBTP). Analysis took 1.82 s. |
| 3-segment edit with one reorder and one removal: total duration within 0.1 s | **PASS** | Built in the UI: 4 segments, removed the audio segment, moved the last segment up. Final `[s1 1.0–6.5, s1 8.0–12.0, s1 14.0–21.0]`. Expected **16.500 s**, exported **16.500 s** (difference 0.000 s). Order checked against the source by PSNR: 45.7 / 49.8 / 46.6 dB on the right spots vs 9.5 dB on a wrong spot (control). |
| Export: playable MP4 in the chosen ratio; 3 frames | **PASS** | 9:16 export: **1080×1920**, H.264 + AAC 48 kHz stereo, 30 fps, 16.500 s. A full decode gives 0 errors. Start (0.2 s), middle (8.25 s) and end (16.3 s) frames checked: correct content, center crop, no bars. Export took 3.67 s. A 16:9 export of the same edit gives **1920×1080**, 16.5 s. |
| Source file checksum identical before and after | **PASS** | `test_recording_16x9.mp4` sha256 `9f75d625…f51f` before and after (`shasum -c`: OK). `voice_note.m4a` `89c682c5…219d` OK. The stored copies in `original/` are identical (app `/verify`: identical = true for both). |
| Generation pipeline and the 5 old 3D scenes: zero console errors | **PASS** | `/new`, `/library`, `/style`, `/settings`, a project page, `/montage`, `/montage/<id>`: 0 console errors, 0 failed requests. Fridge, Rocketbox, scene, body, look: 0 errors. No file changed in `app/player/`, `app/pipeline/`, `worker.py`, `new.html` or `project.html`. |

## Not verified, and why
- **A full generation run (script → voice → render) was not executed.** It would spend Claude and ElevenLabs credits and overwrite an existing project's output. No generation code was changed, and its pages render with zero errors.
- **The test file is not a camera recording.** It was assembled from the app's own rendered videos (real content and voice). The join at 7 s, between two dark videos, was **not detected** as a cut by PySceneDetect or by FFmpeg at their default thresholds. Both agree, but both miss it; a real recording should be tried next.
- **mov upload** was not tested with a real `.mov` file. The same ffprobe path is used, and the extension is allowed.

## Time
- Processing: upload and validation are instant; the analysis took 1.82 s for 21 s of video; exports took 3.67 s (9:16) and about 3 s (16:9).
