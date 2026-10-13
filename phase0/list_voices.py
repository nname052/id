"""يجيب أصواتك (My Voices) + أصوات المكتبة العامة العربية من ElevenLabs، ويحفظهم في voices.csv (المصري الأول).

التشغيل: uv run python -m phase0.list_voices
"""

import csv
import sys

import requests

from .common import ROOT, load_env, say

API = "https://api.elevenlabs.io"
OUT_PATH = ROOT / "voices.csv"
COLUMNS = ["name", "voice_id", "language", "accent", "gender", "age", "use_case", "description", "preview_url"]


def get(session: requests.Session, path: str, params: dict) -> dict:
    r = session.get(f"{API}{path}", params=params, timeout=60)
    if r.status_code != 200:
        sys.exit(f"❌ {path}: HTTP {r.status_code}: {r.text[:300]}")
    return r.json()


def my_voices(session: requests.Session) -> list[dict]:
    rows, token = [], None
    while True:
        params = {"page_size": 100, **({"next_page_token": token} if token else {})}
        data = get(session, "/v2/voices", params)
        for v in data.get("voices", []):
            labels = v.get("labels") or {}
            langs = [l.get("language") for l in v.get("verified_languages") or [] if l.get("language")]
            rows.append({
                "source": "mine",
                "name": v.get("name"),
                "voice_id": v.get("voice_id"),
                "language": labels.get("language") or ", ".join(dict.fromkeys(langs)),
                "accent": labels.get("accent"),
                "gender": labels.get("gender"),
                "age": labels.get("age"),
                "use_case": labels.get("use_case") or labels.get("use case"),
                "description": v.get("description") or labels.get("description"),
                "preview_url": v.get("preview_url"),
            })
        token = data.get("next_page_token")
        if not data.get("has_more") or not token:
            return rows


def shared_arabic_voices(session: requests.Session) -> list[dict]:
    rows, page, empty_pages = [], 0, 0
    while True:
        before = len(rows)
        data = get(session, "/v1/shared-voices", {"page_size": 100, "page": page, "language": "ar"})
        for v in data.get("voices", []):
            # فلتر language=ar في الـ API مش مضمون (بيرجّع لغات تانية في الصفحات المتأخرة)، فبنتأكد بنفسنا
            if v.get("language") != "ar" and not str(v.get("locale") or "").startswith("ar"):
                continue
            rows.append({
                "source": "library",
                "name": v.get("name"),
                "voice_id": v.get("voice_id"),
                "language": v.get("locale") or v.get("language"),
                "accent": v.get("accent"),
                "gender": v.get("gender"),
                "age": v.get("age"),
                "use_case": v.get("use_case"),
                "description": v.get("description"),
                "preview_url": v.get("preview_url"),
            })
        say(f"   صفحة {page + 1}: {len(rows)} صوت لحد دلوقتي")
        # العربي بييجي في الأول، وبعده صفحات بلغات تانية بس: نوقف بعد 3 صفحات ورا بعض من غير عربي
        empty_pages = empty_pages + 1 if len(rows) == before else 0
        if not data.get("has_more") or not data.get("voices") or empty_pages >= 3:
            return rows
        page += 1


def is_egyptian(row: dict) -> bool:
    text = " ".join(str(row.get(k) or "") for k in ("accent", "language", "name", "description")).lower()
    return any(w in text for w in ("egypt", "ar-eg", "مصر", "مصري"))


def main() -> None:
    key = load_env().get("ELEVENLABS_API_KEY", "")
    if not key:
        sys.exit("❌ ELEVENLABS_API_KEY فاضي في .env")
    session = requests.Session()
    session.headers["xi-api-key"] = key

    say("⏳ أصواتك (My Voices)...")
    mine = my_voices(session)
    say(f"   {len(mine)} صوت")
    say("⏳ أصوات المكتبة العامة العربية...")
    shared = shared_arabic_voices(session)

    # نشيل التكرار (لو صوت من المكتبة متضاف عندك) ونرتّب: المصري الأول، وبعدين أصواتك، وبعدين بالاسم
    seen, rows = set(), []
    for row in mine + shared:
        if row["voice_id"] not in seen:
            seen.add(row["voice_id"])
            rows.append(row)
    rows.sort(key=lambda r: (not is_egyptian(r), r["source"] != "mine", (r["name"] or "").lower()))

    with OUT_PATH.open("w", newline="", encoding="utf-8-sig") as f:  # utf-8-sig علشان Excel يقرا العربي صح
        writer = csv.DictWriter(f, fieldnames=COLUMNS)
        writer.writeheader()
        for r in rows:
            writer.writerow({k: " ".join(str(r.get(k) or "").split()) for k in COLUMNS})

    egyptian = sum(map(is_egyptian, rows))
    say(f"\n✅ {len(rows)} صوت ({len(mine)} من حسابك، {len(shared)} من المكتبة، منهم {egyptian} مصري) في: {OUT_PATH}")


if __name__ == "__main__":
    main()
