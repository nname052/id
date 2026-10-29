#!/bin/sh
# مدينة كاملة من OSM + بصمات Microsoft (نفس ترتيب شبين في CLAUDE.md):
#   sh tools/osm/egypt/build_city.sh <id>      (من جذر microbus-game)
set -e
ID=$1
cd "$(dirname "$0")/../../.."
# البيانات الخام برّه public (كبيرة): ../data/cities/<id> — اللعبة بتاخد النسخة المضغوطة (pack_city.py → public/packs/<id>)
export DATA_ROOT=${DATA_ROOT:-$(cd .. && pwd)/data/cities}
mkdir -p $DATA_ROOT
CFG=tools/osm/regions/$ID.json
PBF=$(python3 -c "import json;print(json.load(open('$CFG'))['source_pbf'])")
python3 -I tools/osm/build_region.py $CFG --out $DATA_ROOT
python3 tools/osm/extract_features.py --config $CFG --out $DATA_ROOT
if [ -f tools/osm/egypt/ms/$ID.json.gz ] && python3 -c "import gzip,json,sys;sys.exit(0 if json.load(gzip.open('tools/osm/egypt/ms/$ID.json.gz')) else 1)"; then REGION=$ID python3 tools/osm/import_ms_buildings.py tools/osm/egypt/ms/$ID.json.gz; fi
python3 tools/osm/egypt/roundabouts_from_pbf.py $PBF /tmp/rb_$ID.json
REGION=$ID python3 tools/osm/roundabouts.py /tmp/rb_$ID.json
for i in 1 2 3 4; do REGION=$ID python3 tools/osm/unify_ramps.py > /dev/null; done
REGION=$ID python3 tools/osm/smooth_ramps.py
REGION=$ID python3 tools/osm/audit_buildings.py --fix
REGION=$ID python3 tools/osm/clean_sidewalks.py
REGION=$ID python3 tools/osm/audit_buildings.py --fix-real
rm -f /tmp/rb_$ID.json
python3 tools/osm/egypt/pack_city.py $ID
echo "== $ID done"
