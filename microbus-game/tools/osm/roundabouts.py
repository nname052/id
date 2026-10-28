#!/usr/bin/env python3
"""
الميادين/الدورانات الحقيقية (OSM junction=roundabout) → جزيرة النص
--------------------------------------------------------------------
- بياخد حلقات الدوران من رد Overpass (out geom) ويحسب الجزيرة = جوه الحلقة ناقص الأسفلت
- بيكتبها في landmarks/features.json تحت "roundabouts" (اللعبة بتزرعها: نجيلة + حرف ملون + نخل)
- أي عمارة (مولّدة/من Microsoft) مركزها جوه الحلقة بتتشال (كان فيه عمارة طالعة في نص الدوران)
تشغيل:  python3 tools/osm/roundabouts.py <overpass_roundabouts.json>
"""
import glob, json, os, sys
from shapely.geometry import Polygon, Point
from shapely.ops import unary_union
from pyproj import Transformer

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
DATA = os.path.join(ROOT, 'public', 'data', 'shibin')


def main():
    meta = json.load(open(os.path.join(DATA, 'metadata', 'metadata.json')))
    T = Transformer.from_crs('EPSG:4326', meta['projection']['proj'], always_xy=True)
    ov = json.load(open(sys.argv[1]))
    asph = []
    for f in glob.glob(os.path.join(DATA, 'roads', 't_*.json')):
        d = json.load(open(f)); A = d.get('asphalt')
        if A:
            v, I = A['v'], A['i']
            asph += [Polygon([(v[2 * I[k + j]], v[2 * I[k + j] + 1]) for j in range(3)]) for k in range(0, len(I), 3)]
    AS = unary_union([p for p in asph if p.is_valid])
    out, rings = [], []
    for e in ov['elements']:
        g = e.get('geometry') or []
        if len(g) < 4: continue
        xs, ys = T.transform([q['lon'] for q in g], [q['lat'] for q in g])
        ring = Polygon([(x, -y) for x, y in zip(xs, ys)])
        if not ring.is_valid: ring = ring.buffer(0)
        island = ring.difference(AS)
        parts = [island] if island.geom_type == 'Polygon' else list(getattr(island, 'geoms', []))
        parts = [p for p in parts if p.geom_type == 'Polygon' and p.area > 4]
        rings.append(ring)
        if not parts: continue
        isl = max(parts, key=lambda p: p.area).buffer(-0.3)
        if isl.is_empty or isl.geom_type != 'Polygon': continue
        c = isl.centroid
        out.append({'osm': f"way/{e['id']}", 'highway': e.get('tags', {}).get('highway'), 'x': round(c.x, 1), 'z': round(c.y, 1),
                    'area': round(isl.area), 'island': [round(v, 1) for xy in list(isl.exterior.coords)[:-1] for v in xy]})
    F = json.load(open(os.path.join(DATA, 'landmarks', 'features.json')))
    F['roundabouts'] = out
    json.dump(F, open(os.path.join(DATA, 'landmarks', 'features.json'), 'w'), ensure_ascii=False, indent=1)
    # العمارات اللي جوه الحلقات
    R = unary_union(rings)
    removed = 0
    for f in glob.glob(os.path.join(DATA, 'buildings', 't_*.json')):
        d = json.load(open(f))
        g = d.get('gen') or []
        keep = [b for b in g if not R.contains(Point(b[0], b[1]))]
        if len(keep) != len(g):
            removed += len(g) - len(keep); d['gen'] = keep
            json.dump(d, open(f, 'w'), ensure_ascii=False, separators=(',', ':'))
    print(json.dumps({'roundabouts': len(out), 'areas': [r['area'] for r in out], 'buildings_removed': removed}))


if __name__ == '__main__':
    main()
