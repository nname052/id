#!/usr/bin/env python3
"""
الشطوط (natural=beach من OSM) → landmarks/features.json  (beaches: حلقات [x,z,...] بإحداثيات المدينة)
اللعبة بترسمها رمل، والبحر اللي جنبها بينزل على الرمل بميل (بدل حيطة 55سم).
تشغيل:  python3 tools/osm/egypt/beaches.py <id> [id ...]
"""
import json, os, sys
import osmium
from pyproj import Transformer

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(os.path.dirname(os.path.dirname(HERE)))
DATA = os.path.join(os.path.dirname(ROOT), 'data')


class H(osmium.SimpleHandler):
    def __init__(self):
        super().__init__(); self.rings = []

    def area(self, a):
        if a.tags.get('natural') != 'beach': return
        for outer in a.outer_rings():
            self.rings.append([(n.lon, n.lat) for n in outer])


def run(rid):
    d = os.path.join(ROOT, 'public', 'data', rid) if rid == 'shibin' else os.path.join(DATA, 'cities', rid)
    pbf = os.path.join(DATA, 'osm', 'egypt', 'cities', f'{rid}.osm.pbf')
    meta = json.load(open(os.path.join(d, 'metadata', 'metadata.json')))
    tr = Transformer.from_crs('EPSG:4326', meta['projection']['proj'], always_xy=True)
    h = H(); h.apply_file(pbf, locations=True)
    x0, z0, x1, z1 = meta['bbox_local']
    out = []
    for r in h.rings:
        flat = []
        for lon, lat in r:
            x, y = tr.transform(lon, lat); flat += [round(x, 1), round(-y, 1)]
        xs, zs = flat[0::2], flat[1::2]
        if max(xs) < x0 or min(xs) > x1 or max(zs) < z0 or min(zs) > z1: continue
        out.append(flat)
    F = json.load(open(os.path.join(d, 'landmarks', 'features.json')))
    F['beaches'] = out
    json.dump(F, open(os.path.join(d, 'landmarks', 'features.json'), 'w'), ensure_ascii=False, separators=(',', ':'))
    print(rid, 'beaches', len(out))


if __name__ == '__main__':
    for rid in sys.argv[1:]: run(rid)
