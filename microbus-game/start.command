#!/bin/bash
# تشغيل اللعبة على الماك: دبل كليك على الملف ده
cd "$(dirname "$0")"
if ! command -v npm >/dev/null 2>&1; then
  echo "لازم تنزل Node.js الأول من https://nodejs.org (نسخة LTS) وبعدين تفتح الملف ده تاني."
  read -p "اضغط Enter للخروج"; exit 1
fi
[ -d node_modules ] || npm install
npm run dev
