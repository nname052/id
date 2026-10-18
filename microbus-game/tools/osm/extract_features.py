"""
مميزات حقيقية من OSM لمنطقة (شبين): ملاعب/استاد/تراك، حدائق، محلات ومطاعم وصيدليات ومخابز وكافيهات وبنزينات،
مواقف ومحطات أتوبيس/ميكروباص، أسامي الترع. كل حاجة بإحداثياتها المحلية (نفس تحويل build_region.py).
مفيش أي حاجة بتتألف: اللي مش في OSM مش بيطلع.
  python tools/osm/extract_features.py [--pbf path] [--config tools/osm/regions/shibin.json]
→ public/data/<id>/landmarks/features.json
"""
import argparse, json, os, math
import osmium
from pyproj import Transformer

ap = argparse.ArgumentParser()
ap.add_argument('--config', default=os.path.join(os.path.dirname(__file__), 'regions', 'shibin.json'))
ap.add_argument('--pbf', default=None)
ap.add_argument('--out', default=os.path.join(os.path.dirname(__file__), '..', '..', 'public', 'data'))
args = ap.parse_args()
cfg = json.load(open(args.config))
O = cfg['origin']; B = cfg['bbox']
proj = Transformer.from_crs('EPSG:4326', f"+proj=tmerc +lat_0={O['lat']} +lon_0={O['lon']} +k=1 +x_0=0 +y_0=0 +ellps=WGS84 +units=m +no_defs", always_xy=True)
def P(lon, lat):
    e, n = proj.transform(lon, lat); return [round(e, 1), round(-n, 1)]
def inside(lon, lat): return B['west'] <= lon <= B['east'] and B['south'] <= lat <= B['north']

SHOP_AMENITY = {'cafe', 'restaurant', 'fast_food', 'pharmacy', 'bank', 'fuel', 'bakery', 'atm', 'clinic', 'hospital', 'school', 'mosque', 'place_of_worship', 'police', 'post_office', 'marketplace', 'bus_station', 'taxi'}
AREA_LEISURE = {'stadium', 'pitch', 'track', 'sports_centre', 'park', 'garden'}

class H(osmium.SimpleHandler):
    def __init__(s):
        super().__init__(); s.pois = []; s.areas = []; s.stops = []
    def _poi(s, kind, tags, lon, lat, osm):
        s.pois.append({'kind': kind, 'name': tags.get('name:ar') or tags.get('name') or '', 'p': P(lon, lat), 'osm': osm,
                       'tags': {k: tags[k] for k in ('amenity', 'shop', 'cuisine', 'brand', 'sport', 'religion') if k in tags}})
    def node(s, n):
        t = n.tags
        if not n.location.valid() or not inside(n.location.lon, n.location.lat): return
        lon, lat = n.location.lon, n.location.lat
        if t.get('highway') == 'bus_stop' or t.get('public_transport') in ('platform', 'stop_position') or t.get('amenity') in ('bus_station', 'taxi'):
            s.stops.append({'name': t.get('name:ar') or t.get('name') or '', 'p': P(lon, lat), 'osm': f'node/{n.id}', 'tags': dict(t)})
        if 'shop' in t: s._poi('shop', t, lon, lat, f'node/{n.id}')
        elif t.get('amenity') in SHOP_AMENITY: s._poi(t['amenity'], t, lon, lat, f'node/{n.id}')
    def area(s, a):
        t = a.tags
        kind = t.get('leisure') if t.get('leisure') in AREA_LEISURE else ('shop' if 'shop' in t else t.get('amenity') if t.get('amenity') in SHOP_AMENITY else None)
        if not kind: return
        try:
            rings = []
            for outer in a.outer_rings():
                pts = [(nd.lon, nd.lat) for nd in outer]
                if not any(inside(*q) for q in pts): continue
                rings.append([P(*q) for q in pts])
        except Exception:
            return
        if not rings: return
        osm = f"{'way' if a.from_way() else 'relation'}/{a.orig_id()}"
        if kind in AREA_LEISURE:
            s.areas.append({'kind': kind, 'name': t.get('name:ar') or t.get('name') or '', 'sport': t.get('sport', ''), 'ring': rings[0], 'osm': osm})
        else:
            xs = [q[0] for q in rings[0]]; zs = [q[1] for q in rings[0]]
            s.pois.append({'kind': kind, 'name': t.get('name:ar') or t.get('name') or '', 'p': [round(sum(xs) / len(xs), 1), round(sum(zs) / len(zs), 1)], 'osm': osm,
                           'tags': {k: t[k] for k in ('amenity', 'shop', 'cuisine', 'brand', 'sport', 'religion') if k in t}})

h = H()
pbf = args.pbf or cfg['source_pbf']
h.apply_file(pbf, locations=True)
out = {'note': 'all features come from OSM (ODbL); nothing invented', 'source': os.path.basename(pbf),
       'areas': h.areas, 'pois': h.pois, 'transit_stops': h.stops}
od = os.path.join(args.out, cfg['id'], 'landmarks'); os.makedirs(od, exist_ok=True)
json.dump(out, open(os.path.join(od, 'features.json'), 'w'), ensure_ascii=False, separators=(',', ':'))
from collections import Counter
print('areas', Counter(a['kind'] for a in h.areas), 'pois', Counter(p['kind'] for p in h.pois), 'named pois', sum(1 for p in h.pois if p['name']), 'stops', len(h.stops))
