#!/bin/sh
# كل اختبارات شبين بالترتيب. بيشغّل سيرفر vite لوحده لو مش شغال، وبيقفله في الآخر.
#   sh tools/tests/run-all.sh [test ...]     (من غير أسماء = الكل)
cd "$(dirname "$0")/../.." || exit 1
B=http://localhost:5173/
OWN=""
if ! curl -s -o /dev/null "$B"; then
  NOHMR=1 npx vite --port 5173 --strictPort > /tmp/egy-vite.log 2>&1 &
  OWN=$!
  i=0; until curl -s -o /dev/null "$B" || [ $i -gt 60 ]; do sleep 1; i=$((i+1)); done
fi
TESTS=${*:-"wheel:taxi wheel:microbus wheel:tuktuk road-surface lane-scan city-life boarding checkpoint audio-radio perf-budget microbus-lines street-kit bridge-audit rail-system accident-ems living-city tier-perf shibin-e2e"}
for t in $TESTS; do
  echo "===== $t"
  case $t in
    wheel:*) node tools/tests/wheel-integrity.mjs "${t#wheel:}" "$B" 2>&1 | tail -3 ;;
    *) node tools/tests/$t.mjs "$B" 2>&1 | tail -${TAIL:-40} ;;
  esac
done
[ -n "$OWN" ] && kill $OWN
echo "===== done"
