#!/usr/bin/env python3
"""
فحص مستقل لبيانات المنطقة بعد البناء (بيقرا ملف OSM الخام تاني ويقارن):
  1) دقة التحويل: كل نقطة في شبكة الطرق = نقطة OSM حقيقية بعد التحويل (أقصى خطأ)
  2) الأسماء: كل اسم شارع في اللعبة موجود بنفسه على نفس الطريق في OSM (مفيش اسم متألف)
  3) المعالم: كل معلم "مؤكد" ليه id في OSM والمكان مطابق
  4) العمارات: ولا عمارة على أسفلت/رصيف/مية/سكة
  5) الشبكة: الاتصال، والحواف المكررة، والتوجيه (مع الاتجاه الواحد)
  6) البوابات: على حدود المنطقة بالظبط، والوصلة بتاعتها مقفولة في الشبكة
الاستخدام:  python -I tools/osm/validate_region.py tools/osm/regions/shibin.json --pbf <file> [--data public/data]
"""
import argparse, json, math, os, glob, collections, random
import osmium
from pyproj import Transformer
from shapely.geometry import LineString, Point, Polygon
from shapely.strtree import STRtree


class R(osmium.SimpleHandler):
    def __init__(self, want_ways, want_nodes):
        super().__init__(); self.ww = want_ways; self.wn = want_nodes; self.ways = {}; self.nodes = {}

    def node(self, n):
        if n.id in self.wn: self.nodes[n.id] = (dict(n.tags), n.location.lon, n.location.lat)

    def way(self, w):
        if w.id in self.ww:
            try: self.ways[w.id] = (dict(w.tags), [(n.ref, n.lon, n.lat) for n in w.nodes])
            except osmium.InvalidLocationError: pass


def main():
    ap = argparse.ArgumentParser(); ap.add_argument('config'); ap.add_argument('--pbf'); ap.add_argument('--data', default='public/data')
    a = ap.parse_args()
    cfg = json.load(open(a.config, encoding='utf-8'))
    D = os.path.join(a.data, cfg['id'])
    O = cfg['origin']
    tr = Transformer.from_crs('EPSG:4326', f"+proj=tmerc +lat_0={O['lat']} +lon_0={O['lon']} +k=1 +x_0=0 +y_0=0 +ellps=WGS84 +units=m +no_defs", always_xy=True)
    P = lambda lon, lat: (lambda e, n: (e, -n))(*tr.transform(lon, lat))
    G = json.load(open(f'{D}/navigation/graph.json', encoding='utf-8'))
    LM = json.load(open(f'{D}/landmarks/landmarks.json', encoding='utf-8'))
    REG = json.load(open(f'{D}/boundaries/region.json', encoding='utf-8'))
    want_w = set(G['edge_osm'])
    want_n = set()
    for l in LM['confirmed']:
        for ref in str(l.get('osm', '')).split(','):
            if ref.startswith('way/'): want_w.add(int(ref[4:]))
            if ref.startswith('node/'): want_n.add(int(ref[5:]))
    rd = R(want_w, want_n); rd.apply_file(a.pbf or cfg['source_pbf'], locations=True)
    rep = {}

    # 1+2) دقة التحويل والأسماء
    max_err, bad_names, missing = 0.0, [], 0
    lines = {}
    for wid, (t, pts) in rd.ways.items():
        if 'highway' in t: lines[wid] = LineString([P(lon, lat) for _, lon, lat in pts])
    for k, e in enumerate(G['edges']):
        wid = G['edge_osm'][k]
        if wid not in rd.ways: missing += 1; continue
        t, _ = rd.ways[wid]
        name = G['names'][e[4]] if e[4] >= 0 else None
        if name and t.get('name') != name: bad_names.append([wid, name, t.get('name')])
        if e[9] & 1: continue  # بوابة: الـ stub برا الحدود جزء من نفس الطريق
        L = lines[wid]
        flat = e[10]
        for i in range(0, len(flat), 2):
            max_err = max(max_err, L.distance(Point(flat[i], flat[i + 1])))
    rep['conversion'] = dict(edges=len(G['edges']), max_point_error_m=round(max_err, 3), osm_ways_missing=missing)
    rep['names'] = dict(named_edges=sum(1 for e in G['edges'] if e[4] >= 0), mismatched=len(bad_names), examples=bad_names[:10],
                        unnamed_edges_kept_unnamed=sum(1 for k, e in enumerate(G['edges']) if e[4] < 0 and not rd.ways.get(G['edge_osm'][k], ({}, []))[0].get('name')))

    # 3) المعالم
    lm_bad = []
    for l in LM['confirmed']:
        ref = str(l.get('osm', ''))
        if ref.startswith('node/'):
            nid = int(ref[5:])
            if nid not in rd.nodes: lm_bad.append([l['id'], 'node not in OSM']); continue
            _, lon, lat = rd.nodes[nid]; x, z = P(lon, lat)
            if math.hypot(x - l['x'], z - l['z']) > 1.0: lm_bad.append([l['id'], 'position mismatch'])
        elif ref.startswith('way/'):
            for r in ref.split(','):
                if int(r.split('/')[1]) not in rd.ways: lm_bad.append([l['id'], f'{r} not in OSM'])
        else:
            lm_bad.append([l['id'], 'no OSM reference'])
    rep['landmarks'] = dict(confirmed=len(LM['confirmed']), invalid=len(lm_bad), invalid_list=lm_bad,
                            needs_verification=[x['name'] for x in LM['needs_verification']])

    # 4) العمارات على الطرق/الأرصفة/المية/السكة
    road_polys = []
    for e in G['edges']:
        if e[9] & 8: continue
        flat = e[10]; pts = [(flat[i], flat[i + 1]) for i in range(0, len(flat), 2)]
        # (الكباري كمان: مفيش عمارة تحت كوبري ولا عليه)
        road_polys.append(LineString(pts).buffer(e[7] / 2, cap_style='flat'))
    tree = STRtree(road_polys)
    water = []
    for f in glob.glob(f'{D}/water/t_*.json'):
        W = json.load(open(f))
        if 'water' in W:
            v, ix = W['water']['v'], W['water']['i']
            for k in range(0, len(ix), 3):
                water.append(Polygon([(v[ix[k + j] * 2], v[ix[k + j] * 2 + 1]) for j in range(3)]))
    wtree = STRtree(water) if water else None
    rails = []
    for f in glob.glob(f'{D}/railways/t_*.json'):
        for l in json.load(open(f)).get('lines', []):
            p = l['p']; rails.append(LineString([(p[i], p[i + 1]) for i in range(0, len(p), 2)]).buffer(2.0))
    rtree = STRtree(rails) if rails else None
    n_b, on_road, on_water, on_rail, worst = 0, 0, 0, 0, 0.0
    for f in glob.glob(f'{D}/buildings/t_*.json'):
        for b in json.load(open(f)).get('gen', []):
            n_b += 1
            cx, cz, w, d, ang = b[:5]
            ax, az, bx, bz = math.cos(ang), -math.sin(ang), math.sin(ang), math.cos(ang)
            poly = Polygon([(cx + ax * w / 2 * i + bx * d / 2 * j, cz + az * w / 2 * i + bz * d / 2 * j) for i, j in ((-1, -1), (1, -1), (1, 1), (-1, 1))])
            ov = sum(road_polys[k].intersection(poly).area for k in tree.query(poly))
            if ov > 0.05: on_road += 1; worst = max(worst, ov)
            if wtree is not None and sum(water[k].intersection(poly).area for k in wtree.query(poly)) > 0.05: on_water += 1
            if rtree is not None and any(rails[k].intersects(poly) and rails[k].intersection(poly).area > 0.05 for k in rtree.query(poly)): on_rail += 1
    rep['buildings'] = dict(generated=n_b, on_road=on_road, worst_overlap_m2=round(worst, 2), on_water=on_water, on_rail=on_rail)

    # 5) الشبكة (من غير البوابات ومن غير المشايات)
    drive = [e for e in G['edges'] if not (e[9] & 9)]
    und = collections.defaultdict(set); dirg = collections.defaultdict(set)
    for e in drive:
        und[e[0]].add(e[1]); und[e[1]].add(e[0])
        dirg[e[0]].add(e[1])
        if not e[5]: dirg[e[1]].add(e[0])
    comp, sizes = {}, []
    for n in und:
        if n in comp: continue
        st = [n]; comp[n] = len(sizes); c = 0
        while st:
            m = st.pop(); c += 1
            for k in und[m]:
                if k not in comp: comp[k] = len(sizes); st.append(k)
        sizes.append(c)
    main = max(range(len(sizes)), key=lambda i: sizes[i])
    nodes_main = [n for n, c in comp.items() if c == main]
    rnd = random.Random(3); ok = 0; fails = []
    for _ in range(400):
        s, t = rnd.choice(nodes_main), rnd.choice(nodes_main)
        seen = {s}; q = collections.deque([s]); found = False
        while q:
            m = q.popleft()
            if m == t: found = True; break
            for k in dirg[m]:
                if k not in seen: seen.add(k); q.append(k)
        ok += found
        if not found: fails.append([s, t])
    pairs = collections.Counter((min(e[0], e[1]), max(e[0], e[1]), round(e[2])) for e in drive)
    rep['network'] = dict(drive_edges=len(drive), components=len(sizes), main_component_nodes=sizes[main],
                          small_components=sorted([s for i, s in enumerate(sizes) if i != main], reverse=True)[:10],
                          duplicate_edges=sum(1 for v in pairs.values() if v > 1), routing_samples=400, routing_ok=ok, routing_failed=len(fails),
                          note='small components / routing failures come from the OSM source data (oneway dead-ends, isolated ways); nothing is invented to "fix" them')

    # 5b) الارتفاع عند كل عقدة لازم يبقى واحد من كل الوصلات اللي فيها (غير كده = عتبة/قفزة في الكوبري)
    NH = collections.defaultdict(list)
    for e in G['edges']:
        h = e[11]
        NH[e[0]].append(h[0] if h else 0.0); NH[e[1]].append(h[-1] if h else 0.0)
    rep['network']['node_height_mismatches'] = sum(1 for v in NH.values() if max(v) - min(v) > 0.05)

    # 6) البوابات
    bnd = LineString(REG['polygon'])
    gate_bad = []
    for g in REG['gates']:
        d = bnd.distance(Point(g['x'], g['z']))
        e = G['edges'][g['edge']]
        if d > 1.0 or not (e[9] & 1) or not g.get('locked'): gate_bad.append([g['id'], round(d, 2)])
    rep['gates'] = dict(count=len(REG['gates']), invalid=len(gate_bad), invalid_list=gate_bad[:10])

    ok_all = rep['conversion']['max_point_error_m'] < 0.2 and not rep['names']['mismatched'] and not rep['landmarks']['invalid'] \
        and not rep['buildings']['on_road'] and not rep['buildings']['on_water'] and not rep['buildings']['on_rail'] and not rep['gates']['invalid'] and not rep['network']['node_height_mismatches']
    rep['PASS'] = ok_all
    out = f'{D}/metadata/validation.json'
    json.dump(rep, open(out, 'w', encoding='utf-8'), ensure_ascii=False, indent=1)
    print(json.dumps(rep, ensure_ascii=False, indent=1)[:4000])


if __name__ == '__main__':
    main()
