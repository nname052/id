"""الإعدادات: المسارات، وقراءة .env، والقيم الافتراضية."""

from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
VIDEOS = ROOT / "videos"
ASSETS = ROOT / "assets"
FONTS = ROOT / "fonts"
MUSIC = ROOT / "music"
APP = ROOT / "app"
PROMPTS = APP / "prompts"


def load_env() -> dict:
    env = {}
    path = ROOT / ".env"
    if path.exists():
        for line in path.read_text(encoding="utf-8").splitlines():
            line = line.strip()
            if line and not line.startswith("#") and "=" in line:
                k, v = line.split("=", 1)
                env[k.strip()] = v.strip().strip('"').strip("'")
    return env


ENV = load_env()
ELEVEN_KEY = ENV.get("ELEVENLABS_API_KEY", "")
DEFAULT_VOICE = ENV.get("ELEVENLABS_VOICE_ID") or "ihycSANIrpHfhWoaq1g3"  # Ahmad (مصري)
LLM_MODEL = ENV.get("LLM_MODEL", "opus")
TTS_MODEL = "eleven_v4"
DEFAULT_STABILITY = 0.5  # الكلام العادي (القسم 5.3 في التصميم)

W, H, FPS = 1080, 1920, 30
WORDS_PER_SECOND = 2.2  # سرعة الكلام المصري التقريبية لحساب طول السكريبت

DEFAULT_SETTINGS = {
    "duration": 30,          # بالثواني (10 لـ 60)
    "dialect": "egyptian",   # egyptian | msa | white
    "voice_id": DEFAULT_VOICE,
    "voice_name": "Ahmad",
    "mood": "motivational",  # motivational | calm | funny | serious | educational
    "subtitles": True,
    "stability": DEFAULT_STABILITY,
    "video_type": "regular",  # whiteboard | regular | 3d
    "voice_gender": "",       # male | female (علشان الشخصية اللي بتتكلم تبقى من نفس النوع)
}

VIDEO_TYPES = {
    "whiteboard": "سبورة بيضاء (إيد بقلم بترسم وتكتب وتشرح خطوة خطوة)",
    "regular": "فيديو عادي (موشن جرافيك 2D زي فيديوهات الإدمان على الموبايل)",
    "3d": "3D (شخصيات في مشاهد 3D بتتحرك حسب القصة)",
}

MOODS = {
    "motivational": "تحفيزي",
    "calm": "هادي",
    "funny": "كوميدي خفيف",
    "serious": "جاد",
    "educational": "تعليمي",
}
