#!/usr/bin/env python3
"""
عمارات شبين الحقيقية من Microsoft Global ML Building Footprints (ODbL)
------------------------------------------------------------------------
OSM فيه 13 مبنى بس في شبين، فالعمارات كانت متولّدة على جنب الشوارع. Microsoft نشرت بصمات المباني
(Footprints) المستخرجة من صور الأقمار الصناعية لمصر كلها برخصة ODbL — المكان والشكل حقيقيين.
- الارتفاع مش موجود في البيانات (height = -1): عدد الأدوار/الطراز بيتاخد من أقرب عمارة مولّدة قديمة
  (نفس قواعد الدلتا اللي كانت متطبقة) — تقدير، ومكتوب كده في الـ metadata.
- كل بصمة بتتقص من الأسفلت/الرصيف/الكباري/الترع/المباني الحقيقية (OSM)، وبعدين بتتحول لمستطيلات
  (مستطيل واحد لو الشكل قريب منه، أو شبكة ~11م على محاور البصمة للأشكال المعقدة/البلوكات اللازقة في بعض)
  عشان تمشي في نظام العمارات الموجود (InstancedMesh واحد للمربع: نفس الأداء على الموبايل).
- واجهة كل مستطيل (z المحلي) ناحية أقرب شارع.
تشغيل:
  python3 tools/osm/import_ms_buildings.py [shibin_ms.json]
  (الافتراضي tools/osm/shibin_ms_footprints.json.gz = سطور الـ quadkey 122121120 من dataset-links.csv بتاعة Microsoft
   — نسخة 2026-02-03 — متفلترة على حدود المدينة)
"""
import glob, json, math, os, sys
import numpy as np
from shapely.geometry import Polygon, Point, box
from shapely.ops import unary_union
from shapely.strtree import STRtree
from shapely import affinity
from pyproj import Transformer

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
DATA = os.path.join(ROOT, 'public', 'data', 'shibin')
CELL = 11.0


def tri_union(S):
    v, I = S['v'], S['i']
    return [Polygon([(v[2 * I[k + j]], v[2 * I[k + j] + 1]) for j in range(3)]) for k in range(0, len(I), 3)]


def main():
    meta = json.load(open(os.path.join(DATA, 'metadata', 'metadata.json')))
    T = Transformer.from_crs('EPSG:4326', meta['projection']['proj'], always_xy=True)
    TS = meta['tile_size']
    import gzip
    src = sys.argv[1] if len(sys.argv) > 1 else os.path.join(os.path.dirname(os.path.abspath(__file__)), 'shibin_ms_footprints.json.gz')
    ms = json.load(gzip.open(src, 'rt') if src.endswith('.gz') else open(src))

    # ===== الممنوع: أسفلت + رصيف + كباري + مية + سكة حديد + مباني OSM =====
    blocked, roadish = [], []
    for f in glob.glob(os.path.join(DATA, 'roads', 't_*.json')):
        d = json.load(open(f))
        for k, buf in (('asphalt', 0.6), ('sidewalk', 0.15)):
            if d.get(k):
                g = unary_union([t for t in tri_union(d[k]) if t.is_valid]).buffer(buf)
                blocked.append(g); roadish.append(g)
        decks = d.get('decks') or []
        for D in decks:
            p = D['p']; P = [(p[i], p[i + 2]) for i in range(0, len(p), 3)]
            if len(P) >= 2:
                from shapely.geometry import LineString
                blocked.append(LineString(P).buffer(D.get('w', 8) / 2 + 1.0, cap_style='flat'))
    for f in glob.glob(os.path.join(DATA, 'water', 't_*.json')):
        d = json.load(open(f))
        if d.get('water'):
            blocked.append(unary_union(tri_union(d['water'])).buffer(1.5))
    for f in glob.glob(os.path.join(DATA, 'railways', 't_*.json')):
        d = json.load(open(f))
        for k, v in d.items():
            if isinstance(v, dict) and v.get('v') and v.get('i'):
                blocked.append(unary_union(tri_union(v)).buffer(1.0))
    old_gen, real_polys = [], []
    for f in glob.glob(os.path.join(DATA, 'buildings', 't_*.json')):
        d = json.load(open(f))
        old_gen += d.get('gen') or []
        for rb in d.get('real') or []:
            r = rb['rings'][0]
            real_polys.append(Polygon([(r[i], r[i + 1]) for i in range(0, len(r) - 1, 2)]).buffer(1.0))
    blocked += real_polys
    # معالم اللعبة اللي بتتبني لوحدها على مساحتها (الاستاد: المدرجات حوالين الملعب)
    LM = json.load(open(os.path.join(DATA, 'landmarks', 'landmarks.json')))
    for l in LM.get('confirmed', []):
        if l.get('id') == 'stadium' and l.get('footprint'):
            blocked.append(Polygon(l['footprint']).buffer(3.0))
    B = unary_union(blocked)
    road = unary_union(roadish)
    print('blocked built')

    # أقرب عمارة قديمة (للأدوار/الطراز/المحلات)
    og = np.array([[b[0], b[1]] for b in old_gen])
    grid = {}
    for i, (x, z) in enumerate(og):
        grid.setdefault((int(x // 30), int(z // 30)), []).append(i)

    def nearest_old(x, z):
        best, bd = None, 1e18
        for r in range(0, 4):
            for gx in range(int(x // 30) - r, int(x // 30) + r + 1):
                for gz in range(int(z // 30) - r, int(z // 30) + r + 1):
                    for i in grid.get((gx, gz), ()):
                        d = (og[i][0] - x) ** 2 + (og[i][1] - z) ** 2
                        if d < bd: bd, best = d, i
            if best is not None: break
        return old_gen[best] if best is not None else [x, z, 10, 10, 0, 4, 3, 0]

    road_tree = road  # (بنستخدم المسافة للأسفلت/الرصيف)

    rects = []
    coverage = []
    for feat in ms:
        c = feat['geometry']['coordinates'][0]
        xs, ys = T.transform([q[0] for q in c], [q[1] for q in c])
        poly = Polygon([(x, -y) for x, y in zip(xs, ys)])  # z = جنوب = -north
        if not poly.is_valid: poly = poly.buffer(0)
        if poly.area < 20: continue
        coverage.append(poly)
        part = poly.difference(B)
        for pg in ([part] if part.geom_type == 'Polygon' else list(getattr(part, 'geoms', []))):
            if pg.geom_type != 'Polygon' or pg.area < 18: continue
            mrr = pg.minimum_rotated_rectangle
            cs = list(mrr.exterior.coords)[:4]
            e1 = (cs[1][0] - cs[0][0], cs[1][1] - cs[0][1]); a = math.atan2(e1[1], e1[0])
            # محاور البصمة: نلفها لمحاور x/z ونقسمها شبكة
            loc = affinity.rotate(pg, -a, origin=(0, 0), use_radians=True)
            minx, minz, maxx, maxz = loc.bounds
            pieces = []
            if pg.area / mrr.area >= 0.72 and (maxx - minx) < 40 and (maxz - minz) < 40:
                pieces.append(loc.bounds)
            else:
                nx = max(1, round((maxx - minx) / CELL)); nz = max(1, round((maxz - minz) / CELL))
                sx = (maxx - minx) / nx; sz = (maxz - minz) / nz
                for i in range(nx):
                    for j in range(nz):
                        cellb = box(minx + i * sx, minz + j * sz, minx + (i + 1) * sx, minz + (j + 1) * sz)
                        q = loc.intersection(cellb)
                        if q.is_empty or q.area < 12: continue
                        bx = q.bounds
                        if q.area / ((bx[2] - bx[0]) * (bx[3] - bx[1]) + 1e-9) < 0.55: continue
                        pieces.append(bx)
            for (ax0, az0, ax1, az1) in pieces:
                w, d = ax1 - ax0, az1 - az0
                if w < 3 or d < 3: continue
                ccx, ccz = (ax0 + ax1) / 2, (az0 + az1) / 2
                X = ccx * math.cos(a) - ccz * math.sin(a); Z = ccx * math.sin(a) + ccz * math.cos(a)
                rects.append([X, Z, w, d, a])
    print('rects', len(rects))

    # ===== الواجهة ناحية أقرب شارع + أدوار/طراز من أقرب عمارة قديمة =====
    out = []
    for X, Z, w, d, a in rects:
        ux, uz = math.cos(a), math.sin(a)      # محور العرض (x المحلي قبل التدوير)
        vx, vz = -math.sin(a), math.cos(a)     # المحور التاني
        best = None
        for (nx_, nz_, half, along) in ((vx, vz, d / 2, w), (-vx, -vz, d / 2, w), (ux, uz, w / 2, d), (-ux, -uz, w / 2, d)):
            p = Point(X + nx_ * (half + 3), Z + nz_ * (half + 3))
            dist = road.distance(p)
            if best is None or dist < best[0]: best = (dist, nx_, nz_, along, half * 2)
        _, fx, fz, W_, D_ = best
        # في اللعبة: الـ z المحلي (الواجهة) = (sin(angle), cos(angle))
        ang = math.atan2(fx, fz)
        o = nearest_old(X, Z)
        floors, style, flags = o[5], o[6], o[7]
        # بلوك عريض أوي من غير شارع قريب: من غير محلات
        if best[0] > 12: flags = flags & ~1
        out.append([round(X, 1), round(Z, 1), round(W_, 1), round(D_, 1), round(ang, 3), int(floors), int(style), int(flags)])

    # ===== نكتب: العمارات المولّدة اللي جوه تغطية Microsoft بتتشال، اللي برّه بتفضل =====
    cov = unary_union([p.buffer(25) for p in coverage]).buffer(-10)
    ctree = cov
    tiles = {}
    for b in out:
        tiles.setdefault((math.floor(b[0] / TS), math.floor(b[1] / TS)), []).append(b)
    kept_old = removed_old = 0
    for f in glob.glob(os.path.join(DATA, 'buildings', 't_*.json')):
        d = json.load(open(f))
        ti, tj = d['tile']
        keep = []
        for b in d.get('gen') or []:
            if ctree.contains(Point(b[0], b[1])): removed_old += 1
            else: keep.append(b); kept_old += 1
        d['gen'] = keep + tiles.pop((ti, tj), [])
        d['gen_source'] = 'Microsoft Global ML Building Footprints (ODbL) where available; floors/style estimated'
        json.dump(d, open(f, 'w'), ensure_ascii=False, separators=(',', ':'))
    # مربعات مافيهاش ملف عمارات قبل كده
    for (ti, tj), lst in tiles.items():
        name = f't_{ti}_{tj}'
        fn = os.path.join(DATA, 'buildings', name + '.json')
        json.dump({'gen': lst, 'real': [], 'tile': [ti, tj], 'gen_format': ['cx', 'cz', 'w', 'd', 'angle', 'floors', 'style', 'flags'],
                   'gen_source': 'Microsoft Global ML Building Footprints (ODbL); floors/style estimated'}, open(fn, 'w'), ensure_ascii=False, separators=(',', ':'))
        layers = meta['tiles'].setdefault(name, [])
        if 'buildings' not in layers: layers.append('buildings')
    meta['generated']['buildings'] = ('Building footprints: Microsoft Global ML Building Footprints (ODbL, from satellite imagery) inside the city; '
                                      'each footprint is clipped off roads/sidewalks/water and split into rectangles. Heights are not in the data: '
                                      'floors/style are estimated (nearest previously generated building). Real OSM footprints are kept. '
                                      'Outside the Microsoft coverage the old generated buildings remain.')
    json.dump(meta, open(os.path.join(DATA, 'metadata', 'metadata.json'), 'w'), ensure_ascii=False, indent=1)
    print(json.dumps({'ms_footprints': len(coverage), 'new_rects': len(out), 'old_removed': removed_old, 'old_kept': kept_old}))


if __name__ == '__main__':
    main()
