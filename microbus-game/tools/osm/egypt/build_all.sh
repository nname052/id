#!/bin/sh
# كل المدن (بالتوازي: شغّل السكريبت ده مرتين في نفس الوقت — كل مدينة بتتقفل بفولدر قفل)
#   sh tools/osm/egypt/build_all.sh [عكس]
cd "$(dirname "$0")/../../.."
LIST=$(python3 -c "import json;print(' '.join(c['id'] for c in json.load(open('tools/osm/egypt/cities.json'))))")
[ "$1" = "rev" ] && LIST=$(echo $LIST | tr ' ' '\n' | tac | tr '\n' ' ')
LOCK=$(cd .. && pwd)/data/locks; mkdir -p $LOCK
for c in $LIST; do
  [ -f public/packs/$c/base.bin ] && continue
  mkdir $LOCK/$c 2>/dev/null || continue
  echo "### $c $(date +%T)"
  sh tools/osm/egypt/build_city.sh $c 2>&1 | grep -E "^\{\"(region|ms_footprints|buildings)|done|Error|Traceback|Exception" | tail -4
done
