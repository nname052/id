"""سكيتش "الخمس دقايق المصرية": يولّد صوت كل جملة من ElevenLabs (eleven_v3 + توقيت كل حرف)، ويبني:
- media/lineN.mp3 و media/lineN.json (التوقيت)
- timeline.json: إمتى كل جملة بتبدأ (المشهد بيقراه)
- media/sketch_audio.m4a: الصوت كله متجمّع بالتوقيت

التشغيل: uv run python reference/sketch/make_voices.py   (بيستهلك credits بعدد الحروف، ومش بيعيد جملة اتولدت قبل كده)
"""

import base64
import json
import re
import subprocess
import sys
from pathlib import Path

import requests

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parent.parent))
from phase0.common import load_env  # noqa: E402

MEDIA = HERE / "media"
VOICES = {"aj": "ihycSANIrpHfhWoaq1g3", "claire": "I3u6waC588j43py1kDN2"}  # Ahmad (مصري) و Fatima - Expressive Egyptian
LINES = [
    ("claire", "[annoyed] إنت فين يا بني؟! بقالي نص ساعة واقفة تحت البيت!"),
    ("aj", "[yawns] أنا نازل أهو... خمس دقايق وأكون عندك."),
    ("claire", "[shouting] خمس دقايق؟! إنت قايلها من ساعة!"),
    ("aj", "[laughs] يا ستي دي خمس دقايق مصري... مش خمس دقايق عادية!"),
]
FIRST = 1.0      # أول جملة بعد ثانية (لقطة تأسيسية للشارع)
GAP = 0.45       # سكتة + قطع للقطة اللي بعدها
TAIL = 3.4       # النهاية: Claire بتستسلم + الإفيه على الشاشة


def main() -> None:
    key = load_env().get("ELEVENLABS_API_KEY")
    MEDIA.mkdir(parents=True, exist_ok=True)
    timeline, t = [], FIRST
    for i, (who, text) in enumerate(LINES, start=1):
        mp3, js = MEDIA / f"line{i}.mp3", MEDIA / f"line{i}.json"
        if not mp3.exists():
            print(f"⏳ {who}: {text}  ({len(text)} credit تقريبًا)")
            r = requests.post(
                f"https://api.elevenlabs.io/v1/text-to-speech/{VOICES[who]}/with-timestamps",
                headers={"xi-api-key": key}, params={"output_format": "mp3_44100_128"},
                json={"text": text, "model_id": "eleven_v3", "voice_settings": {"stability": 0.0}}, timeout=180,
            )
            r.raise_for_status()
            d = r.json()
            mp3.write_bytes(base64.b64decode(d["audio_base64"]))
            js.write_text(json.dumps(d["alignment"], ensure_ascii=False), encoding="utf-8")
        al = json.loads(js.read_text(encoding="utf-8"))
        dur = al["character_end_times_seconds"][-1]
        timeline.append({"who": who, "text": re.sub(r"\[[^\]]*\]\s*", "", text), "tts": text, "start": round(t, 3),
                         "dur": round(dur, 3), "audio": f"media/line{i}.mp3", "align": f"media/line{i}.json"})
        t += dur + GAP
    total = round(t - GAP + TAIL, 2)
    (HERE / "timeline.json").write_text(json.dumps({"duration": total, "lines": timeline}, ensure_ascii=False, indent=1), encoding="utf-8")
    # الصوت كله في ملف واحد: كل جملة متأخرة لوقتها
    inputs, filters = [], []
    for i, ln in enumerate(timeline):
        inputs += ["-i", str(HERE / ln["audio"])]
        ms = int(ln["start"] * 1000)
        filters.append(f"[{i}:a]adelay={ms}|{ms}[a{i}]")
    mix = "".join(f"[a{i}]" for i in range(len(timeline))) + f"amix=inputs={len(timeline)}:normalize=0,apad=whole_dur={total}[out]"
    subprocess.run(["ffmpeg", "-y", "-loglevel", "error", *inputs, "-filter_complex", ";".join(filters) + ";" + mix,
                    "-map", "[out]", "-c:a", "aac", "-b:a", "192k", str(MEDIA / "sketch_audio.m4a")], check=True)
    for ln in timeline:
        print(f"  {ln['start']:5.2f}s  {ln['who']:6}  {ln['dur']:.2f}s  {ln['text']}")
    print(f"✅ المدة الكلية {total} ثانية")


if __name__ == "__main__":
    main()
