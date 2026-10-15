#!/usr/bin/env python3
"""
بناء بيانات منطقة حقيقية للعبة من ملف OpenStreetMap (PBF) — وقت البناء مش وقت اللعب.

الاستخدام (من جذر microbus-game):
    python -I tools/osm/build_region.py tools/osm/regions/shibin.json [--pbf path] [--out public/data]

المخرجات: public/data/<region>/
    metadata/metadata.json      المصدر، تاريخ الاستخراج، نقطة الأصل، طريقة التحويل، الترخيص، الأعداد
    metadata/streets.json       أسماء الشوارع الحقيقية (من OSM بس — مفيش اسم متألف)
    metadata/qa.json            نتيجة اختبار الاتصال والتحويل
    navigation/graph.json       شبكة الطرق (GPS / المرور / الشرطة)
    boundaries/region.json      حدود المنطقة + بوابات التوسع
    landmarks/landmarks.json    المعالم المؤكدة + NEEDS_VERIFICATION
    roads/t_<i>_<j>.json        الأسفلت والأرصفة والعلامات والكباري لكل مربع
    buildings/t_<i>_<j>.json    المباني لكل مربع
    water/t_<i>_<j>.json        الترع والمصارف
    railways/t_<i>_<j>.json     السكة الحديد والأرصفة
الإحداثيات: متر، x = شرق، z = جنوب (يعني الشمال = -z)، y = لفوق. نقطة الأصل ثابتة في ملف المنطقة.
"""
import argparse, json, math, os, random, sys, time, hashlib, collections
import osmium
from pyproj import Transformer
from shapely.geometry import LineString, Point, Polygon, MultiPolygon, box, mapping
from shapely.ops import unary_union, linemerge
from shapely.strtree import STRtree
from shapely import prepared
import mapbox_earcut as earcut
import numpy as np

GEN_VERSION = 1

# ===================== جداول الطرق =====================
DRIVE = ['motorway', 'trunk', 'primary', 'secondary', 'tertiary', 'unclassified', 'residential', 'living_street', 'service', 'road', 'track',
         'motorway_link', 'trunk_link', 'primary_link', 'secondary_link', 'tertiary_link']
FOOT = ['footway', 'path', 'pedestrian', 'steps', 'cycleway']
WIDTH = {'motorway': 14, 'trunk': 12, 'primary': 12, 'secondary': 10, 'tertiary': 8, 'unclassified': 6.5, 'residential': 6, 'living_street': 5,
         'service': 4.5, 'road': 6, 'track': 3.5, 'motorway_link': 7, 'trunk_link': 7, 'primary_link': 6.5, 'secondary_link': 6.5, 'tertiary_link': 6,
         'footway': 2.2, 'path': 2.0, 'pedestrian': 4, 'steps': 2, 'cycleway': 2}
LANES = {'motorway': 4, 'trunk': 4, 'primary': 4, 'secondary': 2, 'tertiary': 2, 'unclassified': 2, 'residential': 2, 'living_street': 1,
         'service': 1, 'road': 2, 'track': 1}
SIDEWALK = {'motorway': 0, 'trunk': 2, 'primary': 3, 'secondary': 2.5, 'tertiary': 2, 'unclassified': 1.5, 'residential': 1.2, 'road': 1.2}
SPEED = {'motorway': 80, 'trunk': 70, 'primary': 60, 'secondary': 50, 'tertiary': 40, 'unclassified': 35, 'residential': 30, 'living_street': 15,
         'service': 15, 'road': 30, 'track': 20}
WATER_W = {'river': 30, 'canal': 10, 'drain': 5, 'ditch': 3, 'stream': 4}
NO_BUILD_LANDUSE = {'farmland', 'orchard', 'cemetery', 'grass', 'meadow', 'reservoir', 'basin'}
NO_BUILD_LEISURE = {'park', 'pitch', 'stadium', 'garden', 'playground', 'track'}
OVERPASS_H = 6.0   # ارتفاع الكوبري فوق طريق/سكة (OSM مفيهوش ارتفاعات → قيمة تقديرية موثقة)
SMALL_BRIDGE_H = 1.0  # كوبري على ترعة: حدبة خفيفة
RAMP_LEN = 140.0


def cls_of(hw):
    if hw in DRIVE: return 'drive'
    if hw in FOOT: return 'foot'
    return None


def num(v):
    if v is None: return None
    try:
        return float(str(v).replace(',', '.').split(';')[0].split()[0].rstrip('m'))
    except Exception:
        return None


def r1(v): return round(float(v), 1)
def r2(v): return round(float(v), 2)


# ===================== قراءة الملف =====================
class Reader(osmium.SimpleHandler):
    def __init__(self, lonlat_ok):
        super().__init__()
        self.ok = lonlat_ok
        self.ways = {}       # id -> (tags, [(nid, lon, lat)])
        self.nodes = {}      # id -> (tags, lon, lat) للعقد اللي ليها tags مهمة
        self.areas = []      # (kind, tags, [(lon,lat)])

    def node(self, n):
        if not n.tags: return
        t = dict(n.tags)
        if not self.ok(n.location.lon, n.location.lat, 0.01): return
        if any(k in t for k in ('railway', 'amenity', 'highway', 'public_transport', 'name', 'leisure', 'barrier', 'place')):
            self.nodes[n.id] = (t, n.location.lon, n.location.lat)

    def way(self, w):
        t = dict(w.tags)
        keep = 'highway' in t or 'railway' in t or 'waterway' in t or 'building' in t or t.get('natural') == 'water' or \
            t.get('landuse') in NO_BUILD_LANDUSE or t.get('leisure') in NO_BUILD_LEISURE or t.get('amenity') in ('university', 'hospital', 'school') or \
            t.get('landuse') in ('residential', 'industrial', 'commercial')
        if not keep: return
        try:
            pts = [(n.ref, n.lon, n.lat) for n in w.nodes]
        except osmium.InvalidLocationError:
            return
        if len(pts) < 2: return
        if not any(self.ok(p[1], p[2], 0.004) for p in pts): return
        self.ways[w.id] = (t, pts)


# ===================== المساعدات الهندسية =====================
def polyline_len(p):
    return sum(math.hypot(p[i + 1][0] - p[i][0], p[i + 1][1] - p[i][1]) for i in range(len(p) - 1))


def densify(p, step):
    out = [p[0]]
    for i in range(len(p) - 1):
        a, b = p[i], p[i + 1]
        L = math.hypot(b[0] - a[0], b[1] - a[1])
        n = max(1, int(math.ceil(L / step)))
        for k in range(1, n + 1):
            t = k / n
            out.append((a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t))
    return out


def triangulate(geom):
    """مضلعات shapely → (vertices [x,z,...], indices) بالـ earcut"""
    V, I = [], []
    polys = [geom] if isinstance(geom, Polygon) else list(getattr(geom, 'geoms', []))
    for pg in polys:
        if not isinstance(pg, Polygon) or pg.is_empty or pg.area < 0.05: continue
        rings = [list(pg.exterior.coords)[:-1]] + [list(r.coords)[:-1] for r in pg.interiors]
        rings = [r for r in rings if len(r) >= 3]
        if not rings: continue
        flat, ends, n = [], [], 0
        for r in rings:
            flat.extend(r); n += len(r); ends.append(n)
        arr = np.array(flat, dtype=np.float64).reshape(-1, 2)
        tri = earcut.triangulate_float64(arr, np.array(ends, dtype=np.uint32))
        base = len(V) // 2
        for x, z in flat: V.extend((r1(x), r1(z)))
        I.extend(int(i) + base for i in tri)
    return V, I


def rings_of(geom):
    out = []
    polys = [geom] if isinstance(geom, Polygon) else list(getattr(geom, 'geoms', []))
    for pg in polys:
        if not isinstance(pg, Polygon) or pg.is_empty: continue
        for r in [pg.exterior] + list(pg.interiors):
            c = list(r.coords)
            if len(c) >= 4: out.append([v for x, z in c for v in (r1(x), r1(z))])
    return out


def as_polys(g):
    if g.is_empty: return []
    if isinstance(g, Polygon): return [g]
    return [x for x in getattr(g, 'geoms', []) if isinstance(x, Polygon)]


# ===================== البرنامج =====================
def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('config')
    ap.add_argument('--pbf')
    ap.add_argument('--out', default='public/data')
    args = ap.parse_args()
    t0 = time.time()
    cfg = json.load(open(args.config, encoding='utf-8'))
    rid = cfg['id']
    pbf = args.pbf or cfg['source_pbf']
    out_root = os.path.join(args.out, rid)
    random.seed(1)

    O = cfg['origin']
    proj = Transformer.from_crs('EPSG:4326', f"+proj=tmerc +lat_0={O['lat']} +lon_0={O['lon']} +k=1 +x_0=0 +y_0=0 +ellps=WGS84 +units=m +no_defs", always_xy=True)
    def P(lon, lat):
        e, n = proj.transform(lon, lat)
        return (e, -n)  # z = جنوب
    B = cfg['bbox']
    def ll_ok(lon, lat, m):
        return B['west'] - m <= lon <= B['east'] + m and B['south'] - m <= lat <= B['north'] + m

    # حدود المنطقة بالمتر (المستطيل الجغرافي بعد التحويل = مضلع شبه مستطيل)
    corners = [P(B['west'], B['south']), P(B['east'], B['south']), P(B['east'], B['north']), P(B['west'], B['north'])]
    REGION = Polygon(corners)
    REGION_P = prepared.prep(REGION)
    rx0, rz0, rx1, rz1 = REGION.bounds
    TS = cfg.get('tile_size', 400)
    def tile_of(x, z): return (int(math.floor(x / TS)), int(math.floor(z / TS)))

    print('reading', pbf)
    rd = Reader(ll_ok)
    rd.apply_file(pbf, locations=True)
    print(f'  ways {len(rd.ways)} nodes {len(rd.nodes)}  ({time.time() - t0:.1f}s)')

    # ===================== الطرق =====================
    names = []
    name_ix = {}
    def name_id(n):
        if not n: return -1
        if n not in name_ix: name_ix[n] = len(names); names.append(n)
        return name_ix[n]

    roads = {}   # wid -> dict
    for wid, (t, pts) in rd.ways.items():
        hw = t.get('highway')
        k = cls_of(hw) if hw else None
        if not k: continue
        if t.get('area') == 'yes': continue
        xy = [P(lon, lat) for _, lon, lat in pts]
        ids = [nid for nid, _, _ in pts]
        ow = 0
        o = t.get('oneway')
        if o in ('yes', '1', 'true') or t.get('junction') in ('roundabout', 'circular'): ow = 1
        elif o == '-1': ow = 1; xy = xy[::-1]; ids = ids[::-1]
        lanes = num(t.get('lanes'))
        width = num(t.get('width'))
        if width is None or width < 2 or width > 40:
            width = WIDTH.get(hw, 5)
            if lanes and k == 'drive': width = max(width, lanes * 3.1 if not ow else lanes * 3.3)
        if not lanes: lanes = (LANES.get(hw.replace('_link', ''), 1) if not hw.endswith('_link') else 1) if k == 'drive' else 0
        if ow and not t.get('lanes') and lanes > 1 and hw in ('primary', 'trunk'): lanes = 2
        layer = int(num(t.get('layer')) or 0)
        roads[wid] = dict(id=wid, hw=hw, k=k, ids=ids, xy=xy, ow=ow, lanes=int(lanes), w=r1(width), hwid=r2(width / 2),
                          sw=0 if k == 'foot' else SIDEWALK.get(hw, 0), name=t.get('name'), name_en=t.get('name:en'),
                          bridge=t.get('bridge') not in (None, 'no'), tunnel=t.get('tunnel') not in (None, 'no'), layer=layer,
                          access=t.get('access'), maxspeed=num(t.get('maxspeed')), speed=SPEED.get(hw.replace('_link', ''), 30))

    # ----- القص على حدود المنطقة + بوابات التوسع -----
    gates = []
    STUB = cfg.get('stub_outside', 40)
    clipped = {}
    for wid, r in roads.items():
        xy, ids = r['xy'], r['ids']
        inside = [REGION_P.contains(Point(p)) for p in xy]
        if all(inside): clipped[wid] = [(xy, ids, None, None)]; continue
        if not any(inside):
            # ممكن يعدّي جوه المنطقة من غير نقط جوه (نادر) — بنسيبه
            if not REGION.intersects(LineString(xy)): continue
        # نقسم لقطع جوه + "stub" قصير برا عند كل خروج
        parts = []
        cur, cur_ids = [], []
        start_gate = None
        for i in range(len(xy)):
            if inside[i]:
                if not cur and i > 0 and not inside[i - 1]:
                    # دخول: نقطة التقاطع مع الحد
                    seg = LineString([xy[i - 1], xy[i]])
                    ip = seg.intersection(REGION.exterior)
                    ip = ip if isinstance(ip, Point) else (list(ip.geoms)[0] if hasattr(ip, 'geoms') else Point(xy[i]))
                    start_gate = (ip.x, ip.y, xy[i - 1])
                    cur.append((ip.x, ip.y)); cur_ids.append(None)
                cur.append(xy[i]); cur_ids.append(ids[i])
            else:
                if cur:
                    seg = LineString([xy[i - 1], xy[i]])
                    ip = seg.intersection(REGION.exterior)
                    ip = ip if isinstance(ip, Point) else (list(ip.geoms)[0] if hasattr(ip, 'geoms') else Point(xy[i]))
                    cur.append((ip.x, ip.y)); cur_ids.append(None)
                    parts.append((cur, cur_ids, start_gate, (ip.x, ip.y, xy[i])))
                    cur, cur_ids, start_gate = [], [], None
        if cur: parts.append((cur, cur_ids, start_gate, None))
        out = []
        for (c, cids, sg, eg) in parts:
            if len(c) < 2: continue
            out.append((c, cids, sg, eg))
        if out: clipped[wid] = out

    # ===================== الشبكة =====================
    # العقد اللي بتتقسم عندها الطرق: نهايات + أي عقدة مشتركة بين طريقين (نفس نوع الحركة)
    use = collections.Counter()
    for wid, parts in clipped.items():
        for (c, cids, sg, eg) in parts:
            for n in cids:
                if n is not None: use[(roads[wid]['k'], n)] += 1
            # عقدة متكررة جوه نفس الطريق (لفة) بتتحسب
    node_xy = {}
    for wid, (t, pts) in rd.ways.items():
        if wid in roads:
            for (nid, lon, lat) in pts: node_xy.setdefault(nid, P(lon, lat))
    edges = []
    gnodes = {}  # key -> {id,x,z,...}
    def gnode(key, x, z, **kw):
        if key not in gnodes: gnodes[key] = dict(id=len(gnodes), key=key, x=r2(x), z=r2(z), **kw)
        return gnodes[key]['id']
    gate_count = 0
    for wid, parts in clipped.items():
        r = roads[wid]
        for pi, (c, cids, sg, eg) in enumerate(parts):
            # نقط التقسيم
            cut = [0]
            for i in range(1, len(c) - 1):
                n = cids[i]
                if n is not None and use[(r['k'], n)] > 1: cut.append(i)
            cut.append(len(c) - 1)
            for a, b in zip(cut, cut[1:]):
                seg = c[a:b + 1]
                if len(seg) < 2 or polyline_len(seg) < 0.05: continue
                def nkey(i):
                    n = cids[i]
                    if n is not None: return f"n{n}" if r['k'] == 'drive' else f"f{n}"
                    return f"b{wid}_{pi}_{i}"
                ka, kb = nkey(a), nkey(b)
                na = gnode(ka, *seg[0], osm=cids[a])
                nb = gnode(kb, *seg[-1], osm=cids[b])
                edges.append(dict(id=len(edges), a=na, b=nb, pts=seg, way=wid, k=r['k']))
            # بوابات التوسع: عند الدخول/الخروج من الحدود (طرق العربيات بس)
            for gi, g in enumerate((sg, eg)):
                if g is None or r['k'] != 'drive': continue
                gx, gz, outside = g
                gate_count += 1
                key = f"b{wid}_{pi}_{0 if gi == 0 else len(c) - 1}"
                nid = gnode(key, gx, gz)
                # stub برا الحدود بنفس اتجاه الطريق الحقيقي (للرسم + حافة مقفولة في الشبكة)
                dx, dz = outside[0] - gx, outside[1] - gz
                L = math.hypot(dx, dz) or 1
                sx, sz = gx + dx / L * min(STUB, L), gz + dz / L * min(STUB, L)
                snode = gnode(f"s{wid}_{pi}_{gi}", sx, sz, outside=True)
                gid = f"exit_{wid}_{pi}_{gi}"
                eid = len(edges)
                spts = [(gx, gz), (sx, sz)] if gi == 1 else [(sx, sz), (gx, gz)]
                edges.append(dict(id=eid, a=nid if gi == 1 else snode, b=snode if gi == 1 else nid, pts=spts, way=wid, k='drive', gate=gid))
                gates.append(dict(id=gid, type='expansion_gate', targetRegion='future_region', locked=True, x=r2(gx), z=r2(gz),
                                  heading=r2(math.atan2(dx, dz)), node=nid, edge=eid, osm_way=wid, road_class=r['hw'],
                                  road_name=r['name'], road_width=r['w']))
    print(f'  graph: {len(gnodes)} nodes, {len(edges)} edges, {len(gates)} gates  ({time.time() - t0:.1f}s)')

    # ===================== الارتفاعات (الكباري) =====================
    for e in edges:
        e['h'] = [0.0] * len(e['pts'])
    drive_ground = [LineString(e['pts']) for e in edges if e['k'] == 'drive' and not roads[e['way']]['bridge'] and 'gate' not in e]
    rail_lines = []
    for wid, (t, pts) in rd.ways.items():
        if t.get('railway') in ('rail', 'light_rail', 'narrow_gauge') and t.get('bridge') in (None, 'no'):
            rail_lines.append(LineString([P(lon, lat) for _, lon, lat in pts]))
    under_tree = STRtree(drive_ground + rail_lines)
    under_geoms = drive_ground + rail_lines
    # كل كوبري = سلسلة حواف bridge متصلة بنفس الاسم/الطريق
    bridge_edges = [e for e in edges if roads[e['way']]['bridge'] and e['k'] == 'drive']
    adj = collections.defaultdict(list)
    for e in edges:
        adj[e['a']].append(e); adj[e['b']].append(e)
    seen = set()
    bridge_info = []
    for e0 in bridge_edges:
        if e0['id'] in seen: continue
        # سلسلة متصلة من حواف كوبري
        chain, stack = [], [e0]
        while stack:
            e = stack.pop()
            if e['id'] in seen: continue
            seen.add(e['id']); chain.append(e)
            for n in (e['a'], e['b']):
                for f in adj[n]:
                    if f['id'] not in seen and roads[f['way']]['bridge'] and f['k'] == 'drive' and roads[f['way']]['layer'] == roads[e0['way']]['layer']:
                        stack.append(f)
        geom = unary_union([LineString(e['pts']) for e in chain])
        crosses = False
        for gi in under_tree.query(geom):
            g = under_geoms[gi]
            if g.crosses(geom) or (g.intersects(geom) and not g.touches(geom)):
                crosses = True; break
        H = OVERPASS_H if crosses else SMALL_BRIDGE_H
        name = roads[e0['way']]['name']
        bridge_info.append(dict(name=name, edges=[e['id'] for e in chain], H=H, overpass=crosses))
        # المسافة على السلسلة من أقرب طرف "على الأرض"
        # الأطراف: عقد السلسلة اللي فيها حواف مش كوبري
        cn = collections.Counter()
        for e in chain: cn[e['a']] += 1; cn[e['b']] += 1
        ends = [n for n in cn if any(not roads[f['way']]['bridge'] for f in adj[n]) or cn[n] == 1]
        # ramps: لو الكوبري فوق طريق، والطريق اللي بعد الطرف بنفس الاسم (مطلع) → الطلعة عليه
        ramp_edges = []
        if crosses:
            for n in ends:
                for f in adj[n]:
                    if roads[f['way']]['bridge'] or f in chain: continue
                    if name and roads[f['way']]['name'] == name:
                        ramp_edges.append((n, f))
        for e in chain:
            e['pts'] = densify(e['pts'], 8)
        for n, f in ramp_edges:
            f['pts'] = densify(f['pts'], 8)
        # distances: Dijkstra من الأطراف الأرضية (أطراف السلسلة أو أطراف المطالع البعيدة)
        sub = chain + [f for _, f in ramp_edges]
        sadj = collections.defaultdict(list)
        for e in sub:
            L = polyline_len(e['pts'])
            sadj[e['a']].append((e['b'], L)); sadj[e['b']].append((e['a'], L))
        ground_nodes = set()
        ramp_ns = {n for n, _ in ramp_edges}
        for n in ends:
            if n not in ramp_ns: ground_nodes.add(n)
        for n, f in ramp_edges:
            ground_nodes.add(f['b'] if f['a'] == n else f['a'])
        import heapq
        dist = {n: 0.0 for n in ground_nodes}
        pq = [(0.0, n) for n in ground_nodes]
        while pq:
            d, n = heapq.heappop(pq)
            if d > dist.get(n, 1e18): continue
            for m, L in sadj[n]:
                if d + L < dist.get(m, 1e18): dist[m] = d + L; heapq.heappush(pq, (d + L, m))
        ramp = RAMP_LEN if crosses else None
        for e in sub:
            pts = e['pts']
            cum = [0.0]
            for i in range(len(pts) - 1): cum.append(cum[-1] + math.hypot(pts[i + 1][0] - pts[i][0], pts[i + 1][1] - pts[i][1]))
            L = cum[-1]
            da, db = dist.get(e['a'], 1e9), dist.get(e['b'], 1e9)
            hs = []
            for s in cum:
                d = min(da + s, db + (L - s))
                if crosses:
                    u = min(1.0, d / ramp)
                    hs.append(r2(H * (u * u * (3 - 2 * u))))
                else:
                    # حدبة: سلسلة قصيرة فوق مية — بنستخدم طول السلسلة كلها
                    tot = max(1.0, dist_total(chain))
                    u = min(1.0, d / (tot / 2))
                    hs.append(r2(H * math.sin(u * math.pi / 2)))
            e['h'] = hs

    # ===================== اختبار الاتصال (QA) =====================
    qa = run_qa(edges, gnodes, roads, gates)
    print('  QA:', json.dumps({k: v for k, v in qa.items() if not isinstance(v, list)}, ensure_ascii=False))

    # ===================== الأرض: أسفلت/أرصفة/علامات لكل مربع =====================
    os.makedirs(out_root, exist_ok=True)
    for sub in ('metadata', 'navigation', 'boundaries', 'landmarks', 'roads', 'buildings', 'water', 'railways'):
        os.makedirs(os.path.join(out_root, sub), exist_ok=True)
        for f in os.listdir(os.path.join(out_root, sub)):
            if f.startswith('t_'): os.remove(os.path.join(out_root, sub, f))

    ELEV = 0.35  # أعلى من كده = سطح كوبري منفصل (مش جزء من أرضية الأسفلت)
    ground_bufs, foot_bufs, side_bufs = [], [], []
    deck_list = []
    for e in edges:
        r = roads[e['way']]
        pts, hs = e['pts'], e['h']
        # نقسم الحافة لأجزاء أرضية وأجزاء عالية
        lo, hi = [], []
        cur, curh, mode = [], [], None
        for p, h in zip(pts, hs):
            m = 'hi' if h > ELEV else 'lo'
            if mode is None: mode = m
            if m != mode:
                cur.append(p); curh.append(h)
                (hi if mode == 'hi' else lo).append((cur, curh))
                cur, curh, mode = [p], [h], m
            else:
                cur.append(p); curh.append(h)
        if cur: (hi if mode == 'hi' else lo).append((cur, curh))
        for c, ch in lo:
            if len(c) < 2: continue
            g = LineString(c).buffer(r['hwid'], cap_style='round', join_style='round', quad_segs=4)
            (ground_bufs if r['k'] == 'drive' else foot_bufs).append(g)
            if r['sw'] > 0 and 'gate' not in e:
                side_bufs.append(LineString(c).buffer(r['hwid'] + r['sw'], cap_style='flat', join_style='round', quad_segs=4))
        for c, ch in hi:
            if len(c) < 2: continue
            deck_list.append(dict(edge=e['id'], w=r['w'], pts=c, h=ch, name=r['name']))
    print(f'  unions... ({time.time() - t0:.1f}s)')
    asphalt_all = unary_union(ground_bufs)
    foot_all = unary_union(foot_bufs).difference(asphalt_all) if foot_bufs else Polygon()
    side_all = unary_union(side_bufs).difference(asphalt_all) if side_bufs else Polygon()

    # ===================== الميه =====================
    water_bufs, canals = [], []
    for wid, (t, pts) in rd.ways.items():
        ww = t.get('waterway')
        if ww in WATER_W:
            xy = [P(lon, lat) for _, lon, lat in pts]
            w = num(t.get('width')) or WATER_W[ww]
            canals.append(dict(way=wid, kind=ww, name=t.get('name'), w=w, pts=xy))
            water_bufs.append(LineString(xy).buffer(w / 2, cap_style='flat', join_style='round', quad_segs=4))
        elif t.get('natural') == 'water' and pts[0][0] == pts[-1][0] and len(pts) >= 4:
            water_bufs.append(Polygon([P(lon, lat) for _, lon, lat in pts]).buffer(0))
    water_all = unary_union(water_bufs).difference(asphalt_all) if water_bufs else Polygon()
    water_all = water_all.intersection(REGION.buffer(STUB))
    side_all = side_all.difference(water_all)
    foot_all = foot_all.difference(water_all)

    # ===================== السكة الحديد =====================
    rails, platforms = [], []
    for wid, (t, pts) in rd.ways.items():
        rw = t.get('railway')
        if rw in ('rail', 'light_rail', 'narrow_gauge', 'disused'):
            rails.append(dict(way=wid, kind=rw, pts=[P(lon, lat) for _, lon, lat in pts], bridge=t.get('bridge') not in (None, 'no')))
        elif rw == 'platform' and pts[0][0] == pts[-1][0] and len(pts) >= 4:
            platforms.append(Polygon([P(lon, lat) for _, lon, lat in pts]).buffer(0))
    rail_buf = unary_union([LineString(r['pts']).buffer(3.5) for r in rails]) if rails else Polygon()

    # ===================== مناطق ممنوع فيها البناء + المباني الحقيقية =====================
    excl, real_bldg, urban_areas, landmark_areas = [], [], [], {}
    for wid, (t, pts) in rd.ways.items():
        closed = pts[0][0] == pts[-1][0] and len(pts) >= 4
        if not closed: continue
        poly = Polygon([P(lon, lat) for _, lon, lat in pts]).buffer(0)
        if poly.is_empty: continue
        landmark_areas[wid] = poly
        if t.get('landuse') in NO_BUILD_LANDUSE or t.get('leisure') in NO_BUILD_LEISURE: excl.append(poly)
        if 'building' in t and REGION.contains(poly.centroid):
            lv = num(t.get('building:levels'))
            real_bldg.append(dict(way=wid, poly=poly, floors=int(lv) if lv else 3, kind=t.get('building'), name=t.get('name')))
    excl_all = unary_union(excl) if excl else Polygon()

    # ===================== توليد المباني (OSM مفيهوش مباني تقريبًا في المدينة) =====================
    buildings = generate_buildings(edges, roads, gnodes, asphalt_all, side_all, foot_all, water_all, rail_buf, excl_all, real_bldg, REGION, t0)
    print(f'  buildings: generated {len(buildings)}, real {len(real_bldg)}  ({time.time() - t0:.1f}s)')

    # ===================== علامات الطريق =====================
    deg = collections.Counter()
    for e in edges:
        if e['k'] == 'drive': deg[e['a']] += 1; deg[e['b']] += 1
    node_r = collections.defaultdict(float)
    for e in edges:
        if e['k'] != 'drive': continue
        hwid = roads[e['way']]['hwid']
        node_r[e['a']] = max(node_r[e['a']], hwid); node_r[e['b']] = max(node_r[e['b']], hwid)
    markings = []
    for e in edges:
        r = roads[e['way']]
        if r['k'] != 'drive' or 'gate' in e or r['hw'] in ('service', 'track', 'living_street'): continue
        if r['hw'] == 'residential' and r['w'] < 6: continue
        pts, hs = e['pts'], e['h']
        if max(hs) > ELEV: continue
        L = polyline_len(pts)
        ta = (node_r[e['a']] + 2.5) if deg[e['a']] >= 3 else 1.0
        tb = (node_r[e['b']] + 2.5) if deg[e['b']] >= 3 else 1.0
        if L - ta - tb < 6: continue
        line = LineString(pts)
        sub_ = substring(line, ta, L - tb)
        if sub_ is None: continue
        c = [(r1(x), r1(z)) for x, z in sub_.coords]
        if not r['ow']:
            markings.append(dict(t='c', pts=c, solid=r['hw'] in ('primary', 'trunk')))
        elif r['lanes'] >= 2:
            # خطوط بين الحارات في الاتجاه الواحد
            n = r['lanes']
            for k in range(1, n):
                off = -r['hwid'] + r['w'] * k / n
                o = line_offset(sub_, off)
                if o is not None: markings.append(dict(t='l', pts=[(r1(x), r1(z)) for x, z in o.coords], solid=False))
    print(f'  markings {len(markings)}  ({time.time() - t0:.1f}s)')

    # ===================== التقسيم لمربعات والكتابة =====================
    tiles = collections.defaultdict(lambda: collections.defaultdict(list))
    ex0, ez0, ex1, ez1 = REGION.buffer(STUB + 5).bounds
    i0, j0 = tile_of(ex0, ez0); i1, j1 = tile_of(ex1, ez1)
    stats = collections.Counter()
    for i in range(i0, i1 + 1):
        for j in range(j0, j1 + 1):
            tb = box(i * TS, j * TS, (i + 1) * TS, (j + 1) * TS)
            T = tiles[(i, j)]
            a = asphalt_all.intersection(tb)
            if not a.is_empty:
                v, ix = triangulate(a); T['roads_asphalt'] = dict(v=v, i=ix); stats['asphalt_tris'] += len(ix) // 3
            s = side_all.intersection(tb)
            if not s.is_empty:
                v, ix = triangulate(s); T['roads_sidewalk'] = dict(v=v, i=ix, rings=rings_of(s)); stats['sidewalk_tris'] += len(ix) // 3
            f = foot_all.intersection(tb)
            if not f.is_empty:
                v, ix = triangulate(f); T['roads_foot'] = dict(v=v, i=ix)
            wtr = water_all.intersection(tb)
            if not wtr.is_empty:
                v, ix = triangulate(wtr); T['water_water'] = dict(v=v, i=ix, rings=rings_of(wtr))
            for pl in platforms:
                if pl.intersects(tb):
                    g = pl.intersection(tb)
                    v, ix = triangulate(g)
                    T['railways_platforms'].append(dict(v=v, i=ix, rings=rings_of(g)))
    def put(layer, x, z, item):
        tiles[tile_of(x, z)][layer].append(item)
    for d in deck_list:
        mid = d['pts'][len(d['pts']) // 2]
        put('roads_decks', mid[0], mid[1], dict(edge=d['edge'], w=d['w'], p=[v for (x, z), h in zip(d['pts'], d['h']) for v in (r1(x), r2(h), r1(z))]))
    for m in markings:
        # العلامات الطويلة بتتقسم على المربعات
        for chunk in split_by_tiles(m['pts'], TS):
            mid = chunk[len(chunk) // 2]
            put('roads_marks', mid[0], mid[1], dict(t=m['t'], s=1 if m['solid'] else 0, p=[v for p in chunk for v in p]))
    for b in buildings:
        put('buildings_gen', b[0], b[1], b)
    for rb in real_bldg:
        c = rb['poly'].centroid
        v, ix = triangulate(rb['poly'])
        put('buildings_real', c.x, c.y, dict(way=rb['way'], floors=rb['floors'], kind=rb['kind'], name=rb['name'], v=v, i=ix, rings=rings_of(rb['poly'])))
    for r in rails:
        for chunk in split_by_tiles([(r1(x), r1(z)) for x, z in r['pts']], TS):
            mid = chunk[len(chunk) // 2]
            if not REGION.buffer(STUB).contains(Point(mid)): continue
            put('railways_lines', mid[0], mid[1], dict(way=r['way'], kind=r['kind'], bridge=r['bridge'], p=[v for p in chunk for v in p]))
    for c in canals:
        for chunk in split_by_tiles([(r1(x), r1(z)) for x, z in c['pts']], TS):
            mid = chunk[len(chunk) // 2]
            if not REGION.buffer(STUB).contains(Point(mid)): continue
            put('water_lines', mid[0], mid[1], dict(way=c['way'], kind=c['kind'], name=c['name'], w=c['w'], p=[v for p in chunk for v in p]))
    # أسماء الشوارع على الأرض/اليافطات: عند منتصف كل حافة مسماة طويلة كفاية
    for e in edges:
        r = roads[e['way']]
        if not r['name'] or r['k'] != 'drive' or 'gate' in e: continue
        L = polyline_len(e['pts'])
        if L < 40: continue
        mp = LineString(e['pts']).interpolate(L / 2)
        put('roads_labels', mp.x, mp.y, dict(n=name_id(r['name']), x=r1(mp.x), z=r1(mp.y), e=e['id']))

    # بنكتب كل طبقة في فولدرها
    files = 0
    tile_index = {}
    for (i, j), T in tiles.items():
        key = f't_{i}_{j}'
        layers = collections.defaultdict(dict)
        for k, v in T.items():
            folder, name = k.split('_', 1)
            layers[folder][name] = v
        present = []
        for folder, data in layers.items():
            if not any(data.values()): continue
            data = dict(data)
            data['tile'] = [i, j]
            if folder == 'buildings' and 'gen' in data:
                data['gen_format'] = ['cx', 'cz', 'w', 'd', 'angle', 'floors', 'style', 'flags']
            with open(os.path.join(out_root, folder, key + '.json'), 'w', encoding='utf-8') as fh:
                json.dump(data, fh, ensure_ascii=False, separators=(',', ':'))
            files += 1; present.append(folder)
        if present: tile_index[key] = present
    print(f'  tiles written: {len(tile_index)} tiles, {files} files  ({time.time() - t0:.1f}s)')

    # ===================== الشبكة =====================
    N = sorted(gnodes.values(), key=lambda n: n['id'])
    graph = dict(
        format='v1', note='nodes: [x,z,flags] flags: 1=outside region (gate stub); edges: [a,b,lenM,class,nameIndex,oneway,lanes,width,speedKmh,flags,pts([x,z]...),heights|null]',
        classes=DRIVE + FOOT, names=names,
        nodes=[[n['x'], n['z'], 1 if n.get('outside') else 0] for n in N],
        node_osm=[n.get('osm') for n in N],
        edges=[],
    )
    for e in edges:
        r = roads[e['way']]
        flags = (1 if 'gate' in e else 0) | (2 if r['bridge'] else 0) | (4 if r['tunnel'] else 0) | (8 if r['k'] == 'foot' else 0) | \
                (16 if r['access'] in ('no', 'private') else 0)
        L = polyline_len(e['pts'])
        hs = e['h'] if max(e['h']) > 0.01 else None
        graph['edges'].append([e['a'], e['b'], r1(L), (DRIVE + FOOT).index(r['hw']), name_id(r['name']), r['ow'], r['lanes'], r['w'],
                               int(r['maxspeed'] or r['speed']), flags, [v for p in e['pts'] for v in (r1(p[0]), r1(p[1]))], hs])
    graph['edge_osm'] = [e['way'] for e in edges]
    with open(os.path.join(out_root, 'navigation', 'graph.json'), 'w', encoding='utf-8') as fh:
        json.dump(graph, fh, ensure_ascii=False, separators=(',', ':'))

    # ===================== المعالم =====================
    lm = build_landmarks(cfg, rd, roads, landmark_areas, P, REGION)
    with open(os.path.join(out_root, 'landmarks', 'landmarks.json'), 'w', encoding='utf-8') as fh:
        json.dump(lm, fh, ensure_ascii=False, indent=1)

    # ===================== الحدود والبوابات =====================
    with open(os.path.join(out_root, 'boundaries', 'region.json'), 'w', encoding='utf-8') as fh:
        json.dump(dict(region=rid, polygon=[[r1(x), r1(z)] for x, z in REGION.exterior.coords], bbox_local=[r1(rx0), r1(rz0), r1(rx1), r1(rz1)],
                       gates=gates, gate_format_note='locked gates close the road at the region edge; open later by setting locked=false and loading the target region'),
                  fh, ensure_ascii=False, indent=1)

    # ===================== الميتاداتا =====================
    street_list = sorted({r['name'] for r in roads.values() if r['name'] and r['k'] == 'drive'})
    with open(os.path.join(out_root, 'metadata', 'streets.json'), 'w', encoding='utf-8') as fh:
        json.dump(dict(note='real street names from OSM name tags only; unnamed streets stay unnamed', count=len(street_list), names=street_list), fh, ensure_ascii=False, indent=0)
    with open(os.path.join(out_root, 'metadata', 'qa.json'), 'w', encoding='utf-8') as fh:
        json.dump(qa, fh, ensure_ascii=False, indent=1)
    meta = dict(
        region=rid, name=cfg['name'], name_en=cfg.get('name_en'), governorate=cfg.get('governorate'), generator_version=GEN_VERSION,
        source=dict(file=os.path.basename(pbf), note=cfg.get('source_note'), sha1=sha1(pbf), osm_header_bbox=None),
        extracted_at=time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime()),
        license=dict(data='Open Database License (ODbL) 1.0', attribution='© OpenStreetMap contributors', url='https://www.openstreetmap.org/copyright'),
        origin=cfg['origin'],
        projection=dict(method='Transverse Mercator centred on the origin (pyproj)', proj=f"+proj=tmerc +lat_0={O['lat']} +lon_0={O['lon']} +k=1 +ellps=WGS84 +units=m",
                        axes='x = east (m), z = south (m) so north = -z, y = up (m)'),
        bbox_latlon=cfg['bbox'], bbox_local=[r1(rx0), r1(rz0), r1(rx1), r1(rz1)], tile_size=TS, tiles=tile_index,
        counts=dict(roads_ways=sum(1 for r in roads.values() if r['k'] == 'drive' and r['id'] in clipped), foot_ways=sum(1 for r in roads.values() if r['k'] == 'foot' and r['id'] in clipped),
                    graph_nodes=len(gnodes), graph_edges=len(edges), named_streets=len(street_list), gates=len(gates),
                    buildings_generated=len(buildings), buildings_real=len(real_bldg), bridges=len(bridge_info), canals=len(canals), rails=len(rails),
                    road_km=r1(sum(polyline_len(e['pts']) for e in edges if e['k'] == 'drive' and 'gate' not in e) / 1000)),
        bridges=[dict(name=b['name'], H=b['H'], overpass=b['overpass'], edges=b['edges']) for b in bridge_info],
        generated=dict(
            buildings='OSM has almost no building footprints in this city, so buildings are GENERATED along real streets (no building on any road/sidewalk/water/rail/park). Real OSM footprints are used where they exist.',
            elevation='OSM has no elevations: the ground is flat (y=0); bridge decks get an estimated profile (overpass 6 m with 140 m ramps, canal bridges 1 m hump).',
            widths='road width/lanes from OSM tags when present, otherwise class defaults (see tools/osm/build_region.py WIDTH/LANES)',
            sidewalks='sidewalk widths by road class (not in OSM)'),
        build_seconds=r1(time.time() - t0),
    )
    with open(os.path.join(out_root, 'metadata', 'metadata.json'), 'w', encoding='utf-8') as fh:
        json.dump(meta, fh, ensure_ascii=False, indent=1)
    print(json.dumps(meta['counts'], ensure_ascii=False))
    print(f'done in {time.time() - t0:.1f}s')


def dist_total(chain):
    return sum(polyline_len(e['pts']) for e in chain)


def sha1(path):
    h = hashlib.sha1()
    with open(path, 'rb') as f:
        for b in iter(lambda: f.read(1 << 20), b''): h.update(b)
    return h.hexdigest()


def substring(line, a, b):
    from shapely.ops import substring as ss
    if b <= a: return None
    g = ss(line, a, b)
    return g if isinstance(g, LineString) and len(g.coords) >= 2 else None


def line_offset(line, d):
    try:
        g = line.offset_curve(d, join_style='mitre', mitre_limit=3)
        if isinstance(g, LineString) and len(g.coords) >= 2: return g
    except Exception:
        return None
    return None


def split_by_tiles(pts, TS):
    """بيقسم polyline لأجزاء كل جزء جوه مربع واحد تقريبًا (بنفس النقط)"""
    out, cur, ct = [], [], None
    for p in pts:
        t = (int(math.floor(p[0] / TS)), int(math.floor(p[1] / TS)))
        if ct is None: ct = t
        if t != ct and len(cur) >= 1:
            cur.append(p)
            if len(cur) >= 2: out.append(cur)
            cur, ct = [p], t
        else:
            cur.append(p)
    if len(cur) >= 2: out.append(cur)
    return out


def run_qa(edges, gnodes, roads, gates):
    """اختبار الاتصال: مكونات منفصلة، تقاطعات مكسورة، فجوات، حواف مكررة، توجيه مستحيل"""
    drive = [e for e in edges if e['k'] == 'drive']
    adj = collections.defaultdict(set)
    for e in drive:
        if 'gate' in e: continue
        adj[e['a']].add(e['b']); adj[e['b']].add(e['a'])
    comp, cid = {}, 0
    sizes = []
    for n in list(adj):
        if n in comp: continue
        stack = [n]; comp[n] = cid; cnt = 0
        while stack:
            m = stack.pop(); cnt += 1
            for k in adj[m]:
                if k not in comp: comp[k] = cid; stack.append(k)
        sizes.append(cnt); cid += 1
    main = max(range(len(sizes)), key=lambda i: sizes[i]) if sizes else -1
    # حواف مكررة
    pairs = collections.Counter()
    for e in drive:
        if 'gate' in e: continue
        pairs[(min(e['a'], e['b']), max(e['a'], e['b']), round(polyline_len(e['pts']), 0))] += 1
    dups = [list(k) for k, v in pairs.items() if v > 1]
    zero = [e['id'] for e in drive if polyline_len(e['pts']) < 0.3]
    # فجوات: نهاية طريق (درجة 1) قريبة من طريق تاني من غير ما تكون متوصلة (مشكلة في البيانات الأصلية — بنبلغ ومش بنصلح)
    deg = collections.Counter()
    for e in drive:
        deg[e['a']] += 1; deg[e['b']] += 1
    ends = [n for n, d in deg.items() if d == 1 and not gnodes_by_id(gnodes)[n].get('outside')]
    lines = [LineString(e['pts']) for e in drive if 'gate' not in e]
    owner = [e for e in drive if 'gate' not in e]
    tree = STRtree(lines)
    near_miss = []
    G = gnodes_by_id(gnodes)
    for n in ends:
        p = Point(G[n]['x'], G[n]['z'])
        for li in tree.query(p.buffer(2.0)):
            e = owner[li]
            if n in (e['a'], e['b']): continue
            d = lines[li].distance(p)
            if d < 2.0:
                near_miss.append(dict(node=n, x=G[n]['x'], z=G[n]['z'], dist=round(d, 2), near_edge=e['id'], osm_way=e['way']))
                break
    # توجيه: عينة من الأزواج في المكون الرئيسي (مع احترام الاتجاه الواحد)
    dadj = collections.defaultdict(list)
    for e in drive:
        if 'gate' in e: continue
        r = roads[e['way']]
        dadj[e['a']].append(e['b'])
        if not r['ow']: dadj[e['b']].append(e['a'])
    main_nodes = [n for n, c in comp.items() if c == main]
    rnd = random.Random(7)
    tries, ok, fail = 300, 0, []
    for _ in range(tries):
        a, b = rnd.choice(main_nodes), rnd.choice(main_nodes)
        seen = {a}; q = collections.deque([a]); found = False
        while q:
            m = q.popleft()
            if m == b: found = True; break
            for k in dadj[m]:
                if k not in seen: seen.add(k); q.append(k)
        if found: ok += 1
        else: fail.append([a, b])
    # المكون الرئيسي المتصل بقوة (اتجاهات): عقد مينفعش توصل لها أو تخرج منها
    small = sorted([s for i, s in enumerate(sizes) if i != main], reverse=True)
    return dict(
        drive_edges=len(drive), components=len(sizes), main_component_nodes=sizes[main] if sizes else 0,
        other_components_nodes=sum(small), largest_other_components=small[:10],
        duplicate_edges=len(dups), duplicate_list=dups[:50], zero_length_edges=len(zero),
        dead_ends=len(ends), near_miss_gaps=len(near_miss), near_miss_list=near_miss[:200],
        routing_samples=tries, routing_ok=ok, routing_failed=len(fail), routing_failed_list=fail[:20],
        gates=len(gates),
        note='near_miss = a road end within 2 m of another road without a shared OSM node (source-data gap, NOT auto-fixed). routing failures come from oneway restrictions in the source data.',
    )


_GB = {}
def gnodes_by_id(gnodes):
    if not _GB:
        for n in gnodes.values(): _GB[n['id']] = n
    return _GB


def generate_buildings(edges, roads, gnodes, asphalt, side, foot, water, rail, excl, real, REGION, t0):
    """مباني على جانبي الشوارع الحقيقية: ولا مبنى على طريق/رصيف/مية/سكة/حديقة. الأبعاد مصرية (أبراج ضيقة متلاصقة)."""
    rnd = random.Random(42)
    # ممنوع البناء: الأسفلت + الأرصفة + المشايات + الميه + السكة + المناطق الممنوعة (هامش صغير)
    nb_parts = [asphalt.buffer(0.6), side.buffer(0.2), foot.buffer(0.4), water.buffer(1.5), rail, excl]
    no_build = unary_union([g for g in nb_parts if not g.is_empty])
    nb_polys = []
    for g in as_polys(no_build): nb_polys.extend(split_poly_grid(g, 120))
    nb_tree = STRtree(nb_polys)
    region_in = prepared.prep(REGION.buffer(-3))
    # كثافة الطرق (مدينة ولا غيط)
    cell = 100
    dens = collections.Counter()
    for e in edges:
        if 'gate' in e: continue
        pts = densify(e['pts'], 10)
        for i in range(len(pts) - 1):
            dens[(int(pts[i][0] // cell), int(pts[i][1] // cell))] += math.hypot(pts[i + 1][0] - pts[i][0], pts[i + 1][1] - pts[i][1])
    def urban(x, z):
        ci, cj = int(x // cell), int(z // cell)
        s = sum(dens.get((ci + a, cj + b), 0) for a in (-1, 0, 1) for b in (-1, 0, 1))
        return s
    placed = []
    grid = collections.defaultdict(list)
    G = 20
    def overlaps(poly):
        x0, z0, x1, z1 = poly.bounds
        for gi in range(int(x0 // G), int(x1 // G) + 1):
            for gj in range(int(z0 // G), int(z1 // G) + 1):
                for q in grid[(gi, gj)]:
                    if q.intersects(poly) and q.intersection(poly).area > 0.3: return True
        return False
    def add(poly):
        x0, z0, x1, z1 = poly.bounds
        for gi in range(int(x0 // G), int(x1 // G) + 1):
            for gj in range(int(z0 // G), int(z1 // G) + 1):
                grid[(gi, gj)].append(poly)
    def blocked(poly):
        for k in nb_tree.query(poly):
            if nb_polys[k].intersects(poly) and nb_polys[k].intersection(poly).area > 0.05: return True
        return False
    for rb in real: add(rb['poly'])
    edge_owner = [e for e in edges if e['k'] == 'drive' and 'gate' not in e]
    edge_lines = STRtree([LineString(e['pts']) for e in edge_owner])
    out = []
    order = sorted([e for e in edges if e['k'] == 'drive' and 'gate' not in e and max(e['h']) < 0.35], key=lambda e: -roads[e['way']]['w'])
    for e in order:
        r = roads[e['way']]
        if r['hw'] in ('track',): continue
        pts = e['pts']
        L = polyline_len(pts)
        if L < 8: continue
        line = LineString(pts)
        main_road = r['hw'] in ('primary', 'secondary', 'tertiary', 'trunk')
        for side_ in (-1, 1):
            if r['ow'] and r['hw'] in ('primary', 'trunk', 'secondary') and side_ == -1:
                # الطرق المزدوجة: الجنب الشمال غالبًا الجزيرة (الفحص بيمنع البناء هناك على أي حال)
                pass
            s = rnd.uniform(1, 4)
            while s < L - 4:
                wF = rnd.uniform(7.5, 13.5) if main_road else rnd.uniform(6.5, 12)
                p = line.interpolate(min(L, s + wF / 2))
                p0 = line.interpolate(max(0, s + wF / 2 - 1)); p1 = line.interpolate(min(L, s + wF / 2 + 1))
                tx, tz = p1.x - p0.x, p1.y - p0.y
                tl = math.hypot(tx, tz)
                if tl < 0.5:
                    s += wF; continue
                tx, tz = tx / tl, tz / tl
                nx, nz = -tz * side_, tx * side_
                u = urban(p.x, p.y)
                if u < 900:
                    s += wF + rnd.uniform(4, 25); continue
                setback = r['hwid'] + r['sw'] + 0.6
                rows = 3 if u > 2400 else 2 if u > 1500 else 1
                depth_acc = setback
                for row in range(rows):
                    d = rnd.uniform(9, 17) if row == 0 else rnd.uniform(8, 14)
                    cx, cz = p.x + nx * (depth_acc + d / 2), p.y + nz * (depth_acc + d / 2)
                    poly = rect(cx, cz, tx, tz, wF / 2 - 0.05, d / 2)
                    if not region_in.contains(Point(cx, cz)) or poly.area < 20: break
                    if blocked(poly) or overlaps(poly):
                        # نجرب أعماق أقل قبل ما نستسلم
                        d2 = d * 0.6
                        cx, cz = p.x + nx * (depth_acc + d2 / 2), p.y + nz * (depth_acc + d2 / 2)
                        poly = rect(cx, cz, tx, tz, wF / 2 - 0.05, d2 / 2)
                        if d2 < 6 or blocked(poly) or overlaps(poly): break
                        d = d2
                    if row == 0 and is_median(p.x + nx * (depth_acc + d), p.y + nz * (depth_acc + d), tx, tz, e, r, edge_lines, edge_owner, roads):
                        # الجزيرة اللي بين اتجاهين لنفس الشارع (طريق مزدوج): مفيش مباني
                        break
                    add(poly)
                    dc = math.hypot(cx, cz)
                    base = 5 if dc < 1500 else 4
                    floors = max(2, int(round(rnd.gauss(base + (2.5 if main_road and row == 0 else 0) + (1.5 if u > 2400 else 0), 1.6))))
                    floors = min(floors, 13)
                    style = rnd.randrange(8)
                    flags = (1 if (row == 0 and (main_road or rnd.random() < 0.35)) else 0) | (2 if rnd.random() < 0.18 else 0)
                    ang = math.atan2(-nx, -nz)  # المحور z المحلي للمبنى = ناحية الشارع (الواجهة)
                    out.append([r1(cx), r1(cz), r1(wF - 0.1), r1(d), round(ang, 3), floors, style, flags])
                    depth_acc += d + 0.1
                s += wF
    return out


def is_median(bx, bz, tx, tz, e, r, tree, owner, roads):
    """ورا المبنى على بعد قليل فيه طريق موازي بنفس الاسم (أو الاتجاهين one-way متوازيين) → ده جزيرة طريق مزدوج"""
    p = Point(bx, bz)
    for k in tree.query(p.buffer(14)):
        f = owner[k]
        if f is e: continue
        rf = roads[f['way']]
        line = tree.geometries[k]
        if line.distance(p) > rf['hwid'] + 8: continue
        # اتجاه الطريق التاني عند أقرب نقطة
        s = line.project(p)
        a, b = line.interpolate(max(0, s - 2)), line.interpolate(min(line.length, s + 2))
        dx, dz = b.x - a.x, b.y - a.y
        L = math.hypot(dx, dz) or 1
        par = abs(dx / L * tx + dz / L * tz) > 0.94
        same = (r['name'] and rf['name'] == r['name']) or (r['ow'] and rf['ow'])
        if par and same: return True
    return False


def rect(cx, cz, tx, tz, hw, hd):
    nx, nz = -tz, tx
    pts = []
    for a, b in ((-1, -1), (1, -1), (1, 1), (-1, 1)):
        pts.append((cx + tx * hw * a + nx * hd * b, cz + tz * hw * a + nz * hd * b))
    return Polygon(pts)


def split_poly_grid(g, size):
    x0, z0, x1, z1 = g.bounds
    if x1 - x0 <= size and z1 - z0 <= size: return [g]
    out = []
    i = x0
    while i < x1:
        j = z0
        while j < z1:
            part = g.intersection(box(i, j, i + size, j + size))
            if not part.is_empty: out.extend(as_polys(part))
            j += size
        i += size
    return out


def build_landmarks(cfg, rd, roads, areas, P, REGION):
    out, nv = [], []
    by_name = collections.defaultdict(list)
    for r in roads.values():
        if r['name']: by_name[r['name']].append(r)
    for L in cfg.get('landmarks', []):
        item = dict(id=L['id'], name=L['name'], kind=L['kind'])
        if L.get('name_note'): item['name_note'] = L['name_note']
        found = None
        if 'osm' in L:
            typ, oid = L['osm'].split('/'); oid = int(oid)
            if typ == 'node' and oid in rd.nodes:
                t, lon, lat = rd.nodes[oid]; x, z = P(lon, lat)
                found = dict(x=r1(x), z=r1(z), osm=L['osm'], osm_name=t.get('name'))
            elif typ == 'way' and oid in rd.ways:
                t, pts = rd.ways[oid]
                poly = areas.get(oid)
                if poly is not None:
                    c = poly.centroid
                    found = dict(x=r1(c.x), z=r1(c.y), osm=L['osm'], osm_name=t.get('name'), footprint=[[r1(x), r1(z)] for x, z in poly.exterior.coords])
                else:
                    xy = [P(lon, lat) for _, lon, lat in pts]
                    m = LineString(xy).interpolate(0.5, normalized=True)
                    found = dict(x=r1(m.x), z=r1(m.y), osm=L['osm'], osm_name=t.get('name'))
        elif 'osm_name' in L:
            rs = by_name.get(L['osm_name']) or []
            if not rs:
                # ممكن يكون مجرى مية بالاسم ده
                for wid, (t, pts) in rd.ways.items():
                    if t.get('name') == L['osm_name']: rs.append(dict(id=wid, xy=[P(lon, lat) for _, lon, lat in pts]))
            if rs:
                allp = [p for r in rs for p in r['xy']]
                g = unary_union([LineString(r['xy']) for r in rs])
                c = g.centroid
                found = dict(x=r1(c.x), z=r1(c.y), osm=','.join(f"way/{r['id']}" for r in rs[:12]), osm_name=L['osm_name'],
                             length_m=r1(sum(polyline_len(r['xy']) for r in rs)))
        if found:
            inside = REGION.contains(Point(found['x'], found['z']))
            item.update(found); item['status'] = 'confirmed'; item['inside_region'] = inside
            out.append(item)
        else:
            item['status'] = 'NEEDS_VERIFICATION'; item['reason'] = 'listed id/name not found in the extract'
            nv.append(item)
    for L in cfg.get('needs_verification', []):
        nv.append(dict(L, status='NEEDS_VERIFICATION'))
    return dict(note='coordinates come ONLY from OSM features; nothing is placed by guess', confirmed=out, needs_verification=nv)


if __name__ == '__main__':
    main()
