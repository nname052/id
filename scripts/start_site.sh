#!/bin/zsh
# تشغيل موقع «مشهد» بدوسة: لو شغال بيفتحه بس، ولو مقفول بيشغّله في الخلفية ويستنى لحد ما يقوم وبعدين يفتحه في المتصفح.
# بيستخدمه «مشهد.app» اللي على سطح المكتب. السجل في logs/site.log
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PORT=8002                       # 8000 عليه Docker
URL="http://localhost:$PORT"
CHECK="$URL/library"            # صفحة من الموقع نفسه (مش أي حاجة شغالة على البورت)
export PATH="/opt/homebrew/bin:/usr/local/bin:$HOME/.local/bin:$PATH"
if ! curl -sf -o /dev/null --max-time 2 "$CHECK"; then
  mkdir -p "$ROOT/logs"
  cd "$ROOT" && APP_PORT=$PORT nohup uv run --quiet uvicorn app.main:app --host 127.0.0.1 --port $PORT >> "$ROOT/logs/site.log" 2>&1 &
  for i in {1..60}; do curl -sf -o /dev/null --max-time 1 "$CHECK" && break; sleep 0.5; done
fi
if curl -sf -o /dev/null --max-time 2 "$CHECK"; then open "$URL"; else
  osascript -e 'display dialog "الموقع ما اشتغلش. افتح ملف logs/site.log في فولدر المشروع علشان تعرف السبب." buttons {"تمام"} with title "مشهد"'; fi
