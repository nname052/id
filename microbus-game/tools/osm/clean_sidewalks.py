#!/usr/bin/env python3
"""
تنضيف الأرصفة: الأسنان الرفيعة اللي بتطلع في نص التقاطعات
-------------------------------------------------------------
الرصيف بيتولّد من الشارع (buffer بنهايات مقصوصة): في التقاطعات اللي بزاوية حادة كانت بتطلع
"أسنان" رصيف رفيعة بحرف أبيض/أسود داخلة في الأسفلت ومالهاش أي معنى.
الحل: عند كل تقاطع (3 شوارع أو أكتر) الرصيف اللي جوه دايرة نص قطرها = نص عرض أعرض شارع + 1.2م بيتحول
أسفلت (الحتت دي كانت سادّة فراغ بين أسفلت الشوارع جوه التقاطع — لو اتشالت بس بيبان تراب)؛
ركن الرصيف العادي في التقاطع القايم أبعد من كده فبيفضل، بشطفة صغيرة،
وبعدين فتح مورفولوجي خفيف (0.4م) يشيل الشرايح الرفيعة اللي فاضلة. (الأرصفة هنا ~1.2-1.4م عرض: فتح أكبر بيمسحها)
تشغيل:  python3 tools/osm/clean_sidewalks.py   (بعد build_region.py)
"""
import glob, json, os
import numpy as np
import mapbox_earcut as earcut
from shapely.geometry import Polygon
from shapely.ops import unary_union

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
DATA = os.path.join(ROOT, 'public', 'data', 'shibin', 'roads')
R = 0.4
J_EXTRA = 1.2


def r1(x):
    return round(x, 1)


def polys_of(g):
    if g.is_empty:
        return []
    return [g] if isinstance(g, Polygon) else [x for x in getattr(g, 'geoms', []) if isinstance(x, Polygon)]


def triangulate(geom):
    V, I = [], []
    for pg in polys_of(geom):
        if pg.area < 0.05:
            continue
        rings = [list(pg.exterior.coords)[:-1]] + [list(r.coords)[:-1] for r in pg.interiors]
        rings = [r for r in rings if len(r) >= 3]
        flat, ends, n = [], [], 0
        for r in rings:
            flat.extend(r); n += len(r); ends.append(n)
        arr = np.array(flat, dtype=np.float64).reshape(-1, 2)
        tri = earcut.triangulate_float64(arr, np.array(ends, dtype=np.uint32))
        base = len(V) // 2
        for x, z in flat:
            V += [r1(x), r1(z)]
        I += [int(t) + base for t in tri]
    return V, I


def rings_of(geom):
    out = []
    for pg in polys_of(geom):
        for r in [pg.exterior] + list(pg.interiors):
            c = list(r.coords)
            if len(c) >= 4:
                out.append([v for x, z in c for v in (r1(x), r1(z))])
    return out


def junction_cuts():
    """دواير التقاطعات من شبكة الطرق: [(x, z, r)]"""
    from shapely.geometry import Point
    G = json.load(open(os.path.join(os.path.dirname(DATA), 'navigation', 'graph.json')))
    deg, hw = {}, {}
    for e in G['edges']:
        for n in (e[0], e[1]):
            deg[n] = deg.get(n, 0) + 1
            hw[n] = max(hw.get(n, 0), e[7] / 2)
    out = []
    for n, k in deg.items():
        if k < 3:
            continue
        x, z = G['nodes'][n][0], G['nodes'][n][1]
        out.append(Point(x, z).buffer(hw[n] + J_EXTRA, quad_segs=6))
    return out


def main():
    from shapely.strtree import STRtree
    cuts = junction_cuts(); tree = STRtree(cuts)
    before = after = 0.0; n = 0
    for f in sorted(glob.glob(os.path.join(DATA, 't_*.json'))):
        d = json.load(open(f))
        S = d.get('sidewalk')
        if not S or not S.get('v'):
            continue
        v, I = S['v'], S['i']
        tris = [Polygon([(v[2 * I[k + j]], v[2 * I[k + j] + 1]) for j in range(3)]) for k in range(0, len(I), 3)]
        tris = [t for t in tris if t.is_valid and t.area > 1e-4]
        g = unary_union(tris).buffer(0)
        near = [cuts[i] for i in tree.query(g)]
        o = g
        if near and d.get('asphalt'):
            A = d['asphalt']; av, ai = A['v'], A['i']
            ag0 = unary_union([Polygon([(av[2 * ai[k + j]], av[2 * ai[k + j] + 1]) for j in range(3)]) for k in range(0, len(ai), 3)]).buffer(0)
            # جوه كل دايرة: الرصيف اللي "بين" الشوارع بس (جوه الـ convex hull بتاع أسفلت التقاطع ده) —
            # الرصيف اللي على الناحية التانية من الشارع المستقيم (تقاطع T) برا الـ hull فبيفضل
            fill = [c.intersection(ag0.intersection(c).convex_hull) for c in near]
            fill = unary_union([f for f in fill if not f.is_empty])
            if not fill.is_empty: o = g.difference(fill)
        o = o.buffer(-R, join_style='mitre', mitre_limit=4).buffer(R, join_style='mitre', mitre_limit=4)
        # ماناخدش أي حاجة جديدة برا الرصيف الأصلي (التكبير بأركان حادة ممكن يزوّد سنتيمترات)
        o = o.intersection(g)
        # اللي اتشال من الرصيف → أسفلت (التقاطع يبقى متسفلت كله)
        paved = g.difference(o)
        if not paved.is_empty and d.get('asphalt'):
            A = d['asphalt']; av, ai = A['v'], A['i']
            ag = unary_union([Polygon([(av[2 * ai[k + j]], av[2 * ai[k + j] + 1]) for j in range(3)]) for k in range(0, len(ai), 3)] + [paved]).buffer(0)
            AV, AI = triangulate(ag)
            A['v'], A['i'] = AV, AI
            if 'rings' in A: A['rings'] = rings_of(ag)
        before += g.area; after += o.area; n += 1
        V, IX = triangulate(o)
        if not IX:
            d.pop('sidewalk', None)
        else:
            d['sidewalk'] = dict(v=V, i=IX, rings=rings_of(o))
        json.dump(d, open(f, 'w'), ensure_ascii=False, separators=(',', ':'))
    print(f'tiles {n}: sidewalk {before / 1e6:.3f} km2 -> {after / 1e6:.3f} km2 (removed {100 * (1 - after / max(before, 1)):.1f}%)')


if __name__ == '__main__':
    main()
