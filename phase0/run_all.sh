#!/usr/bin/env bash
# تشغيل كل تجارب المرحلة 0 بأمر واحد. النتايج بتتحفظ في phase0_results.md
# أمثلة:
#   ./phase0/run_all.sh                    كل التجارب
#   ./phase0/run_all.sh --only render      تجربة الريندر بس
set -u
cd "$(dirname "$0")/.."

echo "🔎 بنتأكد من المتطلبات..."
if ! command -v uv >/dev/null 2>&1; then
  echo "❌ مش لاقي uv. شغّل:  brew install uv   (شوف phase0/README.md خطوة 2)"
  exit 1
fi
command -v ffmpeg >/dev/null 2>&1 && echo "✅ ffmpeg" || echo "⚠️  مش لاقي ffmpeg، فتجربة الريندر هتفشل (brew install ffmpeg)"
command -v claude >/dev/null 2>&1 && echo "✅ claude" || echo "⚠️  مش لاقي claude، فتجربة Claude هتفشل (README خطوة 3)"
[ -f .env ] && echo "✅ .env" || echo "⚠️  مفيش ملف .env، فتجربة ElevenLabs هتتخطى (README خطوة 6)"

echo "⏳ تثبيت مكتبات Python (أول مرة بتاخد دقيقة)..."
uv sync --quiet || { echo "❌ uv sync فشل"; exit 1; }

echo "⏳ تثبيت متصفح Chromium لـ Playwright (أول مرة بس، حوالي 150MB)..."
uv run --quiet playwright install chromium || { echo "❌ تثبيت Chromium فشل"; exit 1; }

uv run --quiet python -m phase0.run_all "$@"
