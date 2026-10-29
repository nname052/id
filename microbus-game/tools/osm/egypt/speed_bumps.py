#!/usr/bin/env python3
"""
المطبات → landmarks/features.json  (bumps)
1) الحقيقية: نقط traffic_calming من OSM (bump / hump / table / cushion / rumble_strip) — بتتلزق على أقرب شارع عربيات (≤ 8م)
2) "مستنتجة" (src=1): مطب واحد على الشارع اللي قدام كل مدرسة/مستشفى (من OSM) لو مفيش مطب حقيقي في 80م —
   ده مألوف جدًا في مصر بس مش متسجّل في OSM، فبيتعلّم "مستنتج" في البيانات (ومش بيتعرض إنه حقيقي)
كل مطب: [x, z, dx, dz, نص العرض, النوع, المصدر, رقم الشارع]   النوع: 0 مطب عادي 1 مطب عريض (hump/table) 2 شريط اهتزاز
تشغيل:  python3 tools/osm/egypt/speed_bumps.py <id> [id ...]
   (المصدر: ../data/osm/egypt/traffic_calming.osm.pbf = osmium tags-filter egypt-latest.osm.pbf n/traffic_calming)
"""
import json, math, os, sys
import osmium
from pyproj import Transformer

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(os.path.dirname(os.path.dirname(HERE)))
DATA = os.path.join(os.path.dirname(ROOT), 'data')
PBF = os.path.join(DATA, 'osm', 'egypt', 'traffic_calming.osm.pbf')
KIND = {'bump': 0, 'yes': 0, 'cushion': 0, 'hump': 1, 'table': 1, 'rumble_strip': 2}
CARS = {'motorway', 'trunk', 'primary', 'secondary', 'tertiary', 'unclassified', 'residential', 'living_street', 'service', 'road',
        'motorway_link', 'trunk_link', 'primary_link', 'secondary_link', 'tertiary_link'}
NO_INFER = {'motorway', 'trunk', 'motorway_link', 'trunk_link', 'service'}


def region_dir(rid):
    return os.path.join(ROOT, 'public', 'data', rid) if rid == 'shibin' else os.path.join(DATA, 'cities', rid)


class Nodes(osmium.SimpleHandler):
    def __init__(self):
        super().__init__(); self.pts = []

    def node(self, n):
        k = KIND.get(n.tags.get('traffic_calming'))
        if k is not None: self.pts.append((n.location.lon, n.location.lat, k, n.id))


def seg_near(segs, grid, x, z, r):
    best = None
    for c in {(int(math.floor((x + dx) / 25)), int(math.floor((z + dz) / 25))) for dx in (-r, 0, r) for dz in (-r, 0, r)}:
        for si in grid.get(c, ()):
            ax, az, bx, bz, ei, s0 = segs[si]
            ex, ez = bx - ax, bz - az; l2 = ex * ex + ez * ez or 1e-9
            t = max(0.0, min(1.0, ((x - ax) * ex + (z - az) * ez) / l2))
            px, pz = ax + ex * t, az + ez * t; d = math.hypot(x - px, z - pz)
            if d <= r and (best is None or d < best[0]): best = (d, px, pz, ex / math.sqrt(l2), ez / math.sqrt(l2), ei, s0 + t * math.sqrt(l2))
    return best


def run(rid, pts):
    d = region_dir(rid)
    meta = json.load(open(os.path.join(d, 'metadata', 'metadata.json')))
    tr = Transformer.from_crs('EPSG:4326', meta['projection']['proj'], always_xy=True)
    G = json.load(open(os.path.join(d, 'navigation', 'graph.json')))
    cls = G['classes']; nodes = G['nodes']
    segs, grid, edges = [], {}, []
    for ei, e in enumerate(G['edges']):
        a, b, L, c, _n, _ow, _ln, w, _sp, _fl, P, H = e
        c = cls[c]; edges.append((c, w, H is not None, L))
        if c not in CARS or H is not None: continue  # مفيش مطبات على الكباري
        s = 0.0
        for k in range(0, len(P) - 2, 2):
            ax, az, bx, bz = P[k], P[k + 1], P[k + 2], P[k + 3]
            segs.append((ax, az, bx, bz, ei, s)); s += math.hypot(bx - ax, bz - az)
            for gx in range(int(math.floor(min(ax, bx) / 25)), int(math.floor(max(ax, bx) / 25)) + 1):
                for gz in range(int(math.floor(min(az, bz) / 25)), int(math.floor(max(az, bz) / 25)) + 1):
                    grid.setdefault((gx, gz), []).append(len(segs) - 1)
    x0, z0, x1, z1 = meta['bbox_local']
    out = []

    def far_from_ends(ei, s):
        L = edges[ei][3]; return 9 < s < L - 9  # مش في نص التقاطع

    def add(x, z, k, src, r):
        h = seg_near(segs, grid, x, z, r)
        if not h: return False
        _d, px, pz, dx, dz, ei, s = h
        if src == 1 and not far_from_ends(ei, s): return False
        for b in out:  # تكرار (نقطتين لنفس المطب على الاتجاهين)
            if math.hypot(b[0] - px, b[1] - pz) < 6: return False
        out.append([round(px, 2), round(pz, 2), round(dx, 4), round(dz, 4), round(edges[ei][1] / 2, 2), k, src, ei])
        return True

    for lon, lat, k, _id in pts:
        x, y = tr.transform(lon, lat); z = -y
        if x0 - 5 <= x <= x1 + 5 and z0 - 5 <= z <= z1 + 5: add(x, z, k, 0, 8)
    real = len(out)
    F = json.load(open(os.path.join(d, 'landmarks', 'features.json')))
    for p in F.get('pois', []):
        if p['kind'] not in ('school', 'hospital'): continue
        x, z = p['p']
        if any(math.hypot(b[0] - x, b[1] - z) < 80 for b in out): continue
        h = seg_near(segs, grid, x, z, 60)
        if not h or edges[h[5]][0] in NO_INFER: continue
        add(x, z, 0, 1, 60)
    F['bumps'] = out
    F['bumps_note'] = '[x,z,dx,dz,halfWidth,kind(0 bump,1 hump/table,2 rumble),src(0 OSM traffic_calming,1 inferred near school/hospital),edgeIndex]'
    json.dump(F, open(os.path.join(d, 'landmarks', 'features.json'), 'w'), ensure_ascii=False, separators=(',', ':'))
    print(rid, 'osm', real, 'inferred', len(out) - real)


if __name__ == '__main__':
    h = Nodes(); h.apply_file(PBF)
    for rid in sys.argv[1:]: run(rid, h.pts)
