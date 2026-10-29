#!/usr/bin/env python3
"""
ملف منطقة (tools/osm/regions/<id>.json) لكل مدينة في cities.json — بنفس شكل shibin.json
- المركز = عقدة place=city في OSM (مكتوبة في cities.json)، والحدود ±2 كم (مربع 4×4 كم تقريبًا زي شبين)
- المعالم: بتتلقط أوتوماتيك من OSM جوه الحدود (محطات قطر، مستشفيات، جامعات، استادات، مواقف، متاحف/آثار،
  مباني حكومية، كباري ليها اسم) — بالـ id بتاعها في OSM، والاسم زي ما هو في OSM. مفيش حاجة متألفة.
تشغيل:  python3 tools/osm/egypt/make_configs.py   (بعد ما ملفات ../data/osm/egypt/cities/<id>.osm.pbf تتعمل)
"""
import json, math, os, sys
import osmium

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(os.path.dirname(os.path.dirname(HERE)))
PBF = os.path.join(os.path.dirname(ROOT), 'data', 'osm', 'egypt', 'cities')
HALF = 2000.0
MAXK = {'rail_station': 3, 'historic': 5, 'university': 3, 'hospital': 3, 'museum': 3}

# (اختبار التاج، النوع في اللعبة، الأولوية: الأصغر الأهم)
KINDS = [
    (lambda t: t.get('railway') in ('station', 'halt') and t.get('station') not in ('subway', 'light_rail') and t.get('railway') == 'station', 'rail_station', 0),
    (lambda t: t.get('amenity') == 'bus_station', 'bus_station', 1),
    (lambda t: t.get('amenity') == 'university', 'university', 1),
    (lambda t: t.get('leisure') == 'stadium', 'stadium', 1),
    (lambda t: t.get('amenity') == 'hospital', 'hospital', 2),
    (lambda t: t.get('amenity') == 'townhall' or (t.get('office') == 'government' and 'محافظ' in (t.get('name') or '')), 'government', 1),
    (lambda t: t.get('tourism') == 'museum', 'museum', 2),
    (lambda t: t.get('amenity') == 'library', 'library', 2),
    (lambda t: t.get('historic') in ('monument', 'castle', 'fort', 'archaeological_site', 'citadel') or t.get('tourism') == 'attraction', 'historic', 2),
    (lambda t: t.get('amenity') == 'college', 'university', 3),
    (lambda t: t.get('railway') == 'station' and t.get('station') == 'subway', 'metro', 3),
    (lambda t: t.get('amenity') == 'post_office', 'post', 4),
    (lambda t: t.get('leisure') == 'park', 'park', 4),
]


class H(osmium.SimpleHandler):
    def __init__(self, ok):
        super().__init__(); self.ok = ok; self.found = []

    def _take(self, typ, oid, t, lon, lat):
        n = t.get('name:ar') or t.get('name')
        if not n or not self.ok(lon, lat): return
        # اسم عربي بس (اليافطات والمحطات بالعربي)، ومش اسم شارع
        if not any('\u0600' <= ch <= '\u06ff' for ch in n) or n.startswith('شارع'): return
        for test, kind, pr in KINDS:
            if test(t):
                # المعلم المشهور (ليه wikidata/ويكيبيديا) قبل العادي من نفس النوع
                wiki = 'wikidata' in t or 'wikipedia' in t
                self.found.append(dict(osm=f'{typ}/{oid}', name=n, kind=kind, pr=pr - (1.5 if wiki else 0), lon=lon, lat=lat)); return

    def node(self, n):
        if n.tags: self._take('node', n.id, dict(n.tags), n.location.lon, n.location.lat)

    def way(self, w):
        if not w.tags or not w.is_closed(): return
        t = dict(w.tags)
        try:
            xs = [(q.lon, q.lat) for q in w.nodes]
        except osmium.InvalidLocationError:
            return
        self._take('way', w.id, t, sum(p[0] for p in xs) / len(xs), sum(p[1] for p in xs) / len(xs))

    def area(self, a):
        # المعالم المرسومة كعلاقة (القلعة/المكتبة أحيانًا): مركز أول حلقة خارجية
        if a.from_way() or not a.tags: return
        try:
            for outer in a.outer_rings():
                xs = [(q.lon, q.lat) for q in outer]
                self._take('relation', a.orig_id(), dict(a.tags), sum(p[0] for p in xs) / len(xs), sum(p[1] for p in xs) / len(xs)); return
        except osmium.InvalidLocationError:
            return


def main():
    cities = json.load(open(os.path.join(HERE, 'cities.json')))
    want = set(sys.argv[1:])
    for c in cities:
        if want and c['id'] not in want: continue
        dlat = HALF / 111320; dlon = HALF / (111320 * math.cos(math.radians(c['lat'])))
        bb = dict(south=round(c['lat'] - dlat, 6), west=round(c['lon'] - dlon, 6), north=round(c['lat'] + dlat, 6), east=round(c['lon'] + dlon, 6))
        ok = lambda lon, lat: bb['west'] <= lon <= bb['east'] and bb['south'] <= lat <= bb['north']
        pbf = os.path.join(PBF, c['id'] + '.osm.pbf')
        h = H(ok); h.apply_file(pbf, locations=True)
        # معلم واحد لكل اسم، والأهم الأول، ومش أكتر من MAXK من نفس النوع (16 في الإجمالي)
        seen, per, lms = set(), {}, []
        for f in sorted(h.found, key=lambda f: (f['pr'], math.hypot(f['lon'] - c['lon'], f['lat'] - c['lat']))):
            if f['name'] in seen or per.get(f['kind'], 0) >= MAXK.get(f['kind'], 2) or len(lms) >= 18: continue
            seen.add(f['name']); per[f['kind']] = per.get(f['kind'], 0) + 1
            lms.append(dict(id=f"{f['kind']}_{len(lms) + 1}", name=f['name'], kind=f['kind'], osm=f['osm']))
        cfg = dict(id=c['id'], name=c['name'], name_en=c['name_en'], governorate=c['gov'],
                   source_pbf=os.path.relpath(pbf, ROOT),
                   source_note='OpenStreetMap Egypt extract (download.openstreetmap.fr, 2026-10-29), cut per city with osmium extract',
                   origin=dict(lat=c['lat'], lon=c['lon'], note=f"OSM place=city node '{c['name']}' (city centre)"),
                   bbox=bb, tile_size=400, stub_outside=40, landmarks=lms, needs_verification=[])
        json.dump(cfg, open(os.path.join(ROOT, 'tools', 'osm', 'regions', c['id'] + '.json'), 'w'), ensure_ascii=False, indent=2)
        print(c['id'], len(lms), [l['kind'] for l in lms], flush=True)


if __name__ == '__main__':
    main()
