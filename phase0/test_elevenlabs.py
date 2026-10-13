"""تجربة 2: eleven_v3 + with-timestamps بجملة مصرية مشكّلة فيها tag، وربط التوقيت بالكلمات."""

import base64
import datetime
import difflib
import json
import shutil
import subprocess
import sys
import time

import requests

from .common import OUT, Report, load_env, say, short

API = "https://api.elevenlabs.io"
DIR = OUT / "elevenlabs"
MODEL = "eleven_v3"

# كل token: (النوع، النص اللي بيروح للصوت، النص اللي بيظهر كترجمة)
TOKENS = [
    ("tag", "[whispers]", None),
    ("word", "أَنَا", "أنا"),
    ("word", "عَارِف", "عارف"),
    ("word", "إِنَّك", "إنك"),
    ("word", "خَايِف", "خايف"),
    ("word", "تِفْشَل...", "تفشل..."),
    ("word", "بَسّ", "بس"),
    ("word", "الخُوف", "الخوف"),
    ("word", "مِش", "مش"),
    ("word", "هَيِحْمِيك.", "هيحميك."),
]


def build_texts():
    """يبني tts_text و display_text ويسجّل مكان كل token بالحروف (char span)."""
    parts, spans, pos = [], [], 0
    for kind, tts, display in TOKENS:
        if parts:
            pos += 1  # المسافة
        spans.append({"kind": kind, "tts": tts, "display": display, "start": pos, "end": pos + len(tts)})
        parts.append(tts)
        pos += len(tts)
    tts_text = " ".join(parts)
    display_text = " ".join(d for k, _, d in TOKENS if k == "word")
    return tts_text, display_text, spans


def char_index_map(source: str, aligned: str) -> dict[int, int]:
    """يربط كل حرف في النص الأصلي بمكانه في نص التوقيت، حتى لو ElevenLabs غيّر شوية حروف."""
    if source == aligned:
        return {i: i for i in range(len(source))}
    mapping = {}
    for block in difflib.SequenceMatcher(None, source, aligned, autojunk=False).get_matching_blocks():
        for k in range(block.size):
            mapping[block.a + k] = block.b + k
    return mapping


def words_from_alignment(alignment: dict, tts_text: str, spans: list[dict]) -> list[dict]:
    chars = alignment.get("characters") or []
    starts = alignment.get("character_start_times_seconds") or []
    ends = alignment.get("character_end_times_seconds") or []
    mapping = char_index_map(tts_text, "".join(chars))
    out = []
    for sp in spans:
        idx = [mapping[i] for i in range(sp["start"], sp["end"]) if i in mapping]
        if idx:
            out.append({**sp, "t0": starts[min(idx)], "t1": ends[max(idx)]})
        else:
            out.append({**sp, "t0": None, "t1": None})
    return out


def subscription(headers) -> dict | None:
    r = requests.get(f"{API}/v1/user/subscription", headers=headers, timeout=30)
    if r.status_code != 200:
        return {"_error": r.status_code, "_body": short(r.text, 300)}
    return r.json()


def fmt_reset(unix) -> str:
    try:
        return datetime.datetime.fromtimestamp(int(unix)).strftime("%Y-%m-%d %H:%M")
    except (TypeError, ValueError):
        return "-"


def pick_voice(headers, env) -> dict | None:
    if env.get("ELEVENLABS_VOICE_ID"):
        return {"voice_id": env["ELEVENLABS_VOICE_ID"], "name": "(من .env)", "category": "-"}
    r = requests.get(f"{API}/v1/voices", headers=headers, timeout=30)
    if r.status_code != 200:
        return None
    voices = r.json().get("voices", [])
    own = [v for v in voices if v.get("category") in ("cloned", "generated", "professional")]
    return (own or voices or [None])[0]


def ask(question: str) -> str:
    try:
        return input(f"   {question} ").strip()
    except EOFError:
        return ""


def run_tests(rep: Report, args) -> None:
    rep.h("تجربة 2: ElevenLabs (eleven_v3 + with-timestamps)")
    DIR.mkdir(parents=True, exist_ok=True)
    env = load_env()
    key = env.get("ELEVENLABS_API_KEY", "")
    rep.add_secret(key)
    if not key:
        rep.check("مفتاح ElevenLabs في .env", False, "ELEVENLABS_API_KEY فاضي. شوف phase0/README.md (خطوة 6)")
        return
    headers = {"xi-api-key": key}

    # --- 2.1 الاشتراك والرصيد ---
    before = subscription(headers)
    if not before or "_error" in before:
        rep.check("المفتاح شغال", False, f"{before}. اتأكد إن المفتاح صح، وإن صلاحية User read مفعّلة")
        return
    rep.check("المفتاح شغال", True)
    rep.kv("الخطة", before.get("tier"))
    rep.kv("الرصيد", f"{before.get('character_count')} مستخدم من {before.get('character_limit')}")
    rep.kv("الرصيد بيتجدد", fmt_reset(before.get("next_character_count_reset_unix")))

    voice = pick_voice(headers, env)
    if not voice:
        rep.check("لقيت صوت", False, "مفيش أصوات، أو صلاحية Voices read مقفولة")
        return
    rep.kv("الصوت", f"{voice.get('name')} ({voice.get('category')}), id={voice.get('voice_id')}")

    tts_text, display_text, spans = build_texts()
    rep.kv("tts_text", f"`{tts_text}`")
    rep.kv("display_text", f"`{display_text}`")
    expected = len(tts_text)
    rep.kv("الـ credits المتوقعة (عدد الحروف)", expected)
    rep.save()

    # --- 2.2 eleven_v3 + with-timestamps ---
    rep.h("2.2 eleven_v3 + with-timestamps", 3)
    t0 = time.time()
    r = requests.post(
        f"{API}/v1/text-to-speech/{voice['voice_id']}/with-timestamps",
        headers=headers,
        params={"output_format": "mp3_44100_128"},
        json={"text": tts_text, "model_id": MODEL},
        timeout=180,
    )
    secs = time.time() - t0
    audio_path = DIR / "v3_with_timestamps.mp3"
    v3_words = None
    if r.status_code == 200:
        data = r.json()
        audio_path.write_bytes(base64.b64decode(data["audio_base64"]))
        (DIR / "v3_alignment.json").write_text(
            json.dumps({k: data.get(k) for k in ("alignment", "normalized_alignment")}, ensure_ascii=False, indent=1),
            encoding="utf-8",
        )
        alignment = data.get("alignment") or {}
        aligned = "".join(alignment.get("characters") or [])
        rep.check("eleven_v3 بيشتغل مع with-timestamps", bool(alignment), f"{secs:.1f} ثانية")
        rep.check(
            "التوقيت على النص الأصلي بالظبط (حرف بحرف، والـ tag جواه)",
            aligned == tts_text,
            "" if aligned == tts_text else f"اختلاف: {len(aligned)} حرف مقابل {len(tts_text)}. هنربط بالمقارنة",
        )
        if aligned != tts_text:
            rep.code({"sent": tts_text, "aligned": aligned})
        v3_words = words_from_alignment(alignment, tts_text, spans)
        rows = []
        for w in v3_words:
            label = w["display"] if w["kind"] == "word" else f"🏷 {w['tts']}"
            t_0 = "-" if w["t0"] is None else f"{w['t0']:.2f}"
            t_1 = "-" if w["t1"] is None else f"{w['t1']:.2f}"
            rows.append([label, w["tts"], t_0, t_1])
        rep.table(["الكلمة (عرض)", "الكلمة (صوت)", "بداية (ث)", "نهاية (ث)"], rows)
        words_only = [w for w in v3_words if w["kind"] == "word" and w["t0"] is not None]
        monotonic = all(a["t0"] <= b["t0"] for a, b in zip(words_only, words_only[1:]))
        rep.check("توقيت الكلمات مترتب", monotonic and len(words_only) == sum(1 for t in TOKENS if t[0] == "word"))
    else:
        rep.check("eleven_v3 بيشتغل مع with-timestamps", False, f"HTTP {r.status_code}: {short(r.text, 400)}")
        rep.line("هنجرّب نولّد الصوت من غير timestamps، علشان نجرّب البديل (Forced Alignment).")
        r2 = requests.post(
            f"{API}/v1/text-to-speech/{voice['voice_id']}",
            headers=headers,
            params={"output_format": "mp3_44100_128"},
            json={"text": tts_text, "model_id": MODEL},
            timeout=180,
        )
        if r2.status_code != 200:
            rep.check("eleven_v3 من غير timestamps", False, f"HTTP {r2.status_code}: {short(r2.text, 300)}")
            rep.save()
            return
        audio_path = DIR / "v3_plain.mp3"
        audio_path.write_bytes(r2.content)
        rep.check("eleven_v3 من غير timestamps", True)
    rep.save()

    # --- 2.3 الاستهلاك الفعلي ---
    time.sleep(3)
    after = subscription(headers) or {}
    try:
        actual = int(after["character_count"]) - int(before["character_count"])
    except (KeyError, TypeError, ValueError):
        actual = None
    rep.kv("الـ credits: المتوقع ← الفعلي", f"{expected} ← {actual}")
    rep.summary.append(("credits متوقع/فعلي", None, f"{expected} / {actual}"))

    # --- 2.4 البديل: Forced Alignment ---
    rep.h("2.4 البديل: Forced Alignment على نفس الصوت", 3)
    with open(audio_path, "rb") as f:
        r = requests.post(
            f"{API}/v1/forced-alignment",
            headers=headers,
            files={"file": (audio_path.name, f, "audio/mpeg")},
            data={"text": display_text},
            timeout=180,
        )
    if r.status_code == 200:
        fa = r.json()
        (DIR / "forced_alignment.json").write_text(json.dumps(fa, ensure_ascii=False, indent=1), encoding="utf-8")
        fa_words = [w for w in fa.get("words", []) if w.get("text", "").strip()]
        rep.check("Forced Alignment شغال", bool(fa_words), f"{len(fa_words)} كلمة")
        v3_only = [w for w in (v3_words or []) if w["kind"] == "word"]
        rows = []
        for i, w in enumerate(fa_words):
            v3_start = v3_only[i]["t0"] if i < len(v3_only) and v3_only[i]["t0"] is not None else None
            diff = "-" if v3_start is None else f"{(w['start'] - v3_start) * 1000:+.0f}ms"
            rows.append([w.get("text"), f"{w.get('start', 0):.2f}", f"{w.get('end', 0):.2f}", diff])
        rep.table(["الكلمة", "بداية", "نهاية", "الفرق عن with-timestamps"], rows)
    else:
        rep.check("Forced Alignment شغال", False, f"HTTP {r.status_code}: {short(r.text, 300)}")
    after2 = subscription(headers) or {}
    try:
        rep.kv("credits الـ Forced Alignment", int(after2["character_count"]) - int(after["character_count"]))
    except (KeyError, TypeError, ValueError):
        pass
    rep.save()

    # --- 2.5 سماع الصوت (إنت بتجاوب) ---
    rep.h("2.5 تقييمك للصوت", 3)
    if args.no_questions or not sys.stdin.isatty() or not shutil.which("afplay"):
        rep.check("تقييم السمع", None, f"اتخطى. اسمع الملف بنفسك: {audio_path}")
        return
    say("\n🔊 هشغّل الصوت دلوقتي. (اكتب r وبعدها Enter لو عايز تسمعه تاني)")
    while True:
        subprocess.run(["afplay", str(audio_path)])
        if ask("سمعته؟ اضغط Enter للأسئلة، أو r لإعادة التشغيل:").lower() != "r":
            break
    q = [
        ("هل كلمة whispers (أو أي كلام إنجليزي) اتنطقت بصوت عالي؟ (y/n)", "الـ tag ما اتنطقش كلام"),
        ("هل أول الجملة اتقال بهمس أو بصوت أوطى؟ (y/n)", "الهمس اتطبق"),
        ("هل نطق الكلمات العربية مظبوط مع التشكيل؟ (y/n)", "النطق مظبوط"),
    ]
    for question, label in q:
        ans = ask(question).lower()
        good = {"y": True, "n": False}.get(ans[:1])
        if label == "الـ tag ما اتنطقش كلام" and good is not None:
            good = not good  # لو اتنطق يبقى فشل
        rep.check(label, good, f"إجابتك: {ans or '-'}")
    note = ask("أي ملاحظة على الصوت؟ (اكتبها أو اضغط Enter):")
    if note:
        rep.kv("ملاحظتك", note)
    rep.save()
