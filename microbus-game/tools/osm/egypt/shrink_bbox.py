"""
خرايط أصغر (طلب صاحب اللعبة: "المدن كبيرة — خليها أقل بكتير"): كل مدينة مربع SIDE متر حوالين وسطها
(نقطة place=city في OSM = نفس نقطة الأصل، فكل الإحداثيات اللي في الكود بتفضل زي ما هي).
الخرايط المضغوطة (إسكندرية/الجيزة) ليها إعداد ضغط لوحدها (compact/*.json).
تشغيل:  python3 tools/osm/egypt/shrink_bbox.py [SIDE=1600]
"""
import json, math, os, sys
ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))))
P = os.path.join(ROOT, 'tools/osm/egypt/cities.json')
SIDE = float(sys.argv[1]) if len(sys.argv) > 1 else 1600
BIG = {'cairo': 1800, 'cairo_east': 1800}
SKIP = {'alexandria', 'giza', 'alex', 'alex_east'}
d = json.load(open(P))
for c in d:
    if c['id'] in SKIP: continue
    s = BIG.get(c['id'], SIDE) / 2
    dlat, dlon = s / 110574, s / (111320 * math.cos(math.radians(c["lat"])))
    old = c.get('bbox')
    c['bbox'] = [round(c['lon'] - dlon, 6), round(c['lat'] - dlat, 6), round(c['lon'] + dlon, 6), round(c['lat'] + dlat, 6)]
    print(c['id'], old, '->', c['bbox'])
json.dump(d, open(P, 'w'), ensure_ascii=False, indent=1)
