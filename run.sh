#!/usr/bin/env bash
# تشغيل التطبيق: ./run.sh  ← بيفتح http://127.0.0.1:8000
set -e
cd "$(dirname "$0")"
PORT="${APP_PORT:-8000}"
( sleep 2 && open "http://127.0.0.1:$PORT" ) >/dev/null 2>&1 &
APP_PORT="$PORT" uv run uvicorn app.main:app --host 127.0.0.1 --port "$PORT"
