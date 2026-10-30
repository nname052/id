#!/usr/bin/env python3
"""
مدينة مضغوطة (Compact city): نفس بيانات OSM الحقيقية، بس المسافات بين الأحياء المهمة متقصّرة.
  - المحور: خط (الكورنيش مثلاً) بنقط بالمتر في الإعداد، بيتنعّم (Chaikin).
  - كل نقطة → (t على طول المحور، والإزاحة العمودية). الإزاحة العمودية مابتتغيرش (عمق الحي زي ما هو)،
    و t بيتضغط حسب المنطقة: الأحياء المهمة بمقاسها (scale≈1) والمسافات اللي بينها متقصّرة (scale صغير).
    المحور نفسه بيتعاد بناؤه من حتت متصغّرة (نفس الاتجاهات) فالشوارع بتفضل متصلة.
  - المباني: بتتنقل كتلة واحدة (من غير ما تتمط/تتكبس)، وفي المناطق المتقصّرة بيتساب جزء منها بس (= scale)
    عشان مايركبوش على بعض. الشوارع الصغيرة في المناطق المتقصّرة بتتشال (الرئيسية بس بتفضل).
  - كل حاجة برّه الشريط (band) حوالين المحور بتتشال. خط الساحل بيفضل كامل (البحر بيتبني منه).
  - الخرج: ملف PBF جديد (lon/lat) بيدخل نفس خط البناء (build_city.sh) زي أي مدينة.
تشغيل:  python3 tools/osm/egypt/compact_city.py tools/osm/egypt/compact/<id>.json
"""
import json, os, sys, math, zlib
import numpy as np
import osmium
from pyproj import Transformer

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(os.path.dirname(os.path.dirname(HERE)))


def chaikin(A, n=4):
    for _ in range(n):
        Q = [A[0]]
        for i in range(len(A) - 1):
            p, q = A[i], A[i + 1]
            Q += [0.75 * p + 0.25 * q, 0.25 * p + 0.75 * q]
        Q.append(A[-1]); A = np.array(Q)
    return A


class Warp:
    def __init__(self, C):
        A = chaikin(np.array(C['axis'], float))
        # إعادة تقسيم كل 4م (عشان البحث والبناء)
        seg = np.diff(A, axis=0); L = np.hypot(seg[:, 0], seg[:, 1]); cum = np.concatenate([[0], np.cumsum(L)])
        ts = np.arange(0, cum[-1], 4.0)
        self.P = np.stack([np.interp(ts, cum, A[:, 0]), np.interp(ts, cum, A[:, 1])], 1)
        self.t = ts
        self.zones = C['zones']  # [{t0, t1, scale}]
        self.t0, self.t1 = C['t_range']
        # t → t' (متراكم حسب scale كل منطقة)
        s = np.array([self.scale(t) for t in ts])
        dt = np.diff(ts, prepend=ts[0])
        self.tp = np.cumsum(s * dt)
        # المحور الجديد: كل خطوة صغيرة متصغّرة بنفس الـ scale (الاتجاهات زي ما هي)
        d = np.diff(self.P, axis=0, prepend=self.P[:1])
        self.Pp = np.cumsum(d * s[:, None], axis=0) + self.P[0]
        self.seg = np.diff(self.P, axis=0); self.L = np.hypot(self.seg[:, 0], self.seg[:, 1])

    def scale(self, t):
        for z in self.zones:
            if z['t0'] <= t < z['t1']: return z['scale']
        return self.zones[0]['scale'] if t < self.zones[0]['t0'] else self.zones[-1]['scale']

    def project(self, X):
        """X: (N,2) → (t, n, i) لأقرب نقطة على المحور (n موجب = يمين اتجاه المحور = ناحية البر)"""
        a = self.P[:-1]; d = self.seg; L2 = np.maximum(self.L ** 2, 1e-9)
        out_t = np.empty(len(X)); out_n = np.empty(len(X)); out_i = np.empty(len(X), int); out_u = np.empty(len(X))
        B = 4096
        for k in range(0, len(X), B):
            p = X[k:k + B]
            u = np.clip((((p[:, None, :] - a[None]) * d[None]).sum(2)) / L2[None], 0, 1)
            c = a[None] + d[None] * u[..., None]
            dist = np.hypot(*(p[:, None, :] - c).transpose(2, 0, 1))
            i = dist.argmin(1)
            ui = u[np.arange(len(p)), i]
            ci = c[np.arange(len(p)), i]
            v = p - ci; dd = d[i] / np.maximum(self.L[i], 1e-9)[:, None]
            out_n[k:k + B] = -(dd[:, 0] * v[:, 1] - dd[:, 1] * v[:, 0])
            out_t[k:k + B] = self.t[i] + ui * self.L[i]
            out_i[k:k + B] = i; out_u[k:k + B] = ui
        return out_t, out_n, out_i, out_u

    def normal_at(self, ts):
        """العمودي (ناحية البر) عند t — نفس الاتجاه في المحور القديم والجديد"""
        i = np.clip(np.searchsorted(self.t, ts) - 1, 0, len(self.seg) - 1)
        d = self.seg[i] / np.maximum(self.L[i], 1e-9)[:, None]
        return np.stack([d[:, 1], -d[:, 0]], 1)

    def apply(self, X):
        """مكان جديد: نفس الإزاحة عن المحور، والنقطة على المحور اتنقلت لمكانها على المحور المتقصّر"""
        t, n, i, u = self.project(X)
        c = self.P[i] + self.seg[i] * u[:, None]
        cp = self.Pp[i] + (self.Pp[np.minimum(i + 1, len(self.Pp) - 1)] - self.Pp[i]) * u[:, None]
        return X - c + cp, t, n


def main(cfg_path):
    C = json.load(open(cfg_path))
    src = os.path.join(ROOT, C['source_pbf']); dst = os.path.join(ROOT, C['out_pbf'])
    tr = Transformer.from_crs('EPSG:4326', C['proj'], always_xy=True)
    inv = Transformer.from_crs(C['proj'], 'EPSG:4326', always_xy=True)
    W = Warp(C)
    nlo, nhi = C['band']
    big = set(C['keep_roads_in_compressed'])

    # ===== 1) كل النقط + الطرق (مين جوه الشريط، ومين مبنى) =====
    class P1(osmium.SimpleHandler):
        def __init__(s): super().__init__(); s.nodes = {}; s.ways = {}
        def node(s, n): s.nodes[n.id] = (n.location.lon, n.location.lat)
        def way(s, w): s.ways[w.id] = (dict(w.tags), [n.ref for n in w.nodes])
    h = P1(); h.apply_file(src)
    ids = np.array(list(h.nodes.keys())); ll = np.array([h.nodes[i] for i in ids])
    xy = np.stack(tr.transform(ll[:, 0], ll[:, 1]), 1)
    new, t, n = W.apply(xy)
    idx = {k: j for j, k in enumerate(ids)}
    inband = (n >= nlo) & (n <= nhi) & (t >= W.t0) & (t <= W.t1)
    print('nodes', len(ids), 'in band', int(inband.sum()))

    def hashf(i, salt=0): return (zlib.crc32(f'{i}:{salt}'.encode()) & 0xffff) / 65535

    # خط الساحل في المناطق المتقصّرة: الخلجان الصغيرة لو اتكبست بقت سنان حادة → سور بحر شبه مستقيم
    # (الإزاحة عن المحور بتتحصر في [-90, 0]م = البحر على طول الكورنيش)
    coast_ids = set()
    for wid, (tags, refs) in h.ways.items():
        if tags.get('natural') == 'coastline': coast_ids.update(refs)
    cj = np.array([idx[r] for r in coast_ids if r in idx], int)
    if len(cj):
        sc_c = np.array([W.scale(v) for v in t[cj]])
        m = sc_c < 0.5
        if m.any():
            sel = cj[m]
            n2 = np.clip(n[sel], -90, 0)
            new[sel] = new[sel] + (W.normal_at(t[sel]) * (n2 - n[sel])[:, None])
            n[sel] = n2
    # والكورنيش نفسه (والشوارع) في المناطق المتقصّرة: كان بيلف حوالين كل خليج → سنان؛ بيفضل ورا سور البحر
    sc_all = np.array([W.scale(v) for v in t])
    m = (sc_all < 0.5) & (n < -25)
    if len(cj): m[cj] = False
    if m.any():
        sel = np.where(m)[0]
        new[sel] = new[sel] + W.normal_at(t[sel]) * (-25 - n[sel])[:, None]
        n[sel] = -25
    keep_way = set(); shift = {}  # node id → إزاحة جاهزة (للمباني)
    stats = {'roads': 0, 'roads_dropped_compressed': 0, 'bld': 0, 'bld_dropped_compressed': 0, 'coast': 0}
    for wid, (tags, refs) in h.ways.items():
        js = [idx[r] for r in refs if r in idx]
        if not js: continue
        nat = tags.get('natural')
        if nat == 'coastline':  # (البحر بيتكتب جاهز كمساحة مية تحت — خط الساحل المتقصّر ممكن يقطع نفسه)
            stats['coast'] += 1
            continue
        if not inband[js].any(): continue
        tm = float(np.median(t[js])); sc = W.scale(tm)
        if 'building' in tags or ('building:part' in tags):
            if sc < 0.95 and hashf(wid) > sc * 1.05: stats['bld_dropped_compressed'] += 1; continue
            # كتلة واحدة: كل النقط بتتحرك بنفس إزاحة المركز
            c0 = xy[js].mean(0); c1 = new[js].mean(0)
            for r in refs: shift[r] = c1 - c0
            keep_way.add(wid); stats['bld'] += 1
            continue
        hw = tags.get('highway')
        if hw and sc < 0.5 and hw not in big and not any(k in (tags.get('name') or '') for k in C.get('keep_names', [])):
            stats['roads_dropped_compressed'] += 1; continue
        if hw: stats['roads'] += 1
        keep_way.add(wid)
    used = set()
    for wid in keep_way: used.update(h.ways[wid][1])
    print(stats)

    # ===== البحر: من خط الساحل الأصلي (قبل الضغط) بنفس طريقة build_region، وبعدين بيتضغط بنفس التحويل =====
    from shapely.geometry import LineString, Polygon, box as sbox
    from shapely.ops import polygonize, unary_union
    coast_lines = []
    for wid, (tags, refs) in h.ways.items():
        if tags.get('natural') != 'coastline': continue
        js = [idx[r] for r in refs if r in idx]
        if len(js) >= 2: coast_lines.append([tuple(xy[j]) for j in js])
    # (الصندوق من المحور نفسه + عرض الشريط: نقط OSM شاردة كانت بتكبّره لـ 28 كم فالساحل مايقسموش نصين)
    pad = max(abs(nlo), abs(nhi)) + 600
    area = sbox(W.P[:, 0].min() - pad, W.P[:, 1].min() - pad, W.P[:, 0].max() + pad, W.P[:, 1].max() + pad)
    lines = [LineString(c) for c in coast_lines]; lines = [l for l in lines if l.intersects(area)]
    faces = list(polygonize(unary_union([area.exterior] + [l.intersection(area) for l in lines])))
    # كل وش: بنقارن قد إيه منه لازق في يمين خط الساحل (بحر) مقابل شماله (يابسة) — شريط 4م على كل ناحية.
    # (نقطة واحدة جوه الوش ممكن تبقى بعيدة جدًا عن الساحل فتاخد أقرب حتة غلط — زي رصيف الميناء)
    right = unary_union([l.buffer(-4, single_sided=True) for l in lines])
    left = unary_union([l.buffer(4, single_sided=True) for l in lines])
    sea_parts = [f for f in faces if f.intersection(right).area > f.intersection(left).area]
    print('area box', [round(v) for v in area.bounds], 'faces', [(round(f.area / 1e6, 2), round(f.intersection(right).area), round(f.intersection(left).area)) for f in sorted(faces, key=lambda f: -f.area)[:4]])
    sea = unary_union(sea_parts) if sea_parts else Polygon()
    print('sea area km2 (original)', round(sea.area / 1e6, 2))
    sea_out = []
    for pg in (getattr(sea, 'geoms', None) or [sea]):
        if pg.is_empty or pg.area < 2000: continue
        ring = np.array(pg.exterior.segmentize(15).coords)
        warped, tt, nn = W.apply(ring)
        # نفس سور البحر في المناطق المتقصّرة
        scr = np.array([W.scale(v) for v in tt]); m = (scr < 0.5) & (nn > -400) & (nn < -90)
        if m.any(): warped[m] = warped[m] + W.normal_at(tt[m]) * (-90 - nn[m])[:, None]
        poly = Polygon(warped).buffer(0)
        for q in (getattr(poly, 'geoms', None) or [poly]):
            if not q.is_empty and q.area > 2000: sea_out.append(q.simplify(1.5))
    print('sea parts out', len(sea_out), 'km2', round(sum(q.area for q in sea_out) / 1e6, 2))

    # ===== 2) الكتابة =====
    if os.path.exists(dst): os.remove(dst)
    wr = osmium.SimpleWriter(dst)
    outxy = {}

    class P2(osmium.SimpleHandler):
        def node(s, nd):
            j = idx.get(nd.id)
            keep_node = nd.id in used or (j is not None and inband[j] and len(nd.tags))
            if not keep_node: return
            if nd.id in shift: p = xy[j] + shift[nd.id]
            else: p = new[j]
            lon, lat = inv.transform(p[0], p[1])
            if nd.id not in coast_ids: outxy[nd.id] = p
            wr.add_node(nd.replace(location=osmium.osm.Location(lon, lat)))
        def way(s, w):
            if w.id in keep_way: wr.add_way(w)
        def relation(s, r):
            if any(m.type == 'w' and m.ref in keep_way for m in r.members): wr.add_relation(r)
    # مساحات البحر الجاهزة (natural=water + water=sea) — نقط وطرق جديدة.
    # النقط لازم تتكتب قبل أي طريق (اللي بيقرا الملف بيحتاج مكان النقطة قبل ما يوصل للطريق)
    nid, sea_ways = 90_000_000_000, []  # (أرقام موجبة كبيرة: فهرس المواقع في osmium مابيقبلش السالب)
    for q in sea_out:
        refs = []
        for (x, y) in list(q.exterior.coords)[:-1]:
            lon, lat = inv.transform(x, y)
            wr.add_node(osmium.osm.mutable.Node(id=nid, location=osmium.osm.Location(lon, lat), tags={}))
            refs.append(nid); nid += 1
        sea_ways.append(refs + [refs[0]])
    P2().apply_file(src)
    for k, refs in enumerate(sea_ways):
        wr.add_way(osmium.osm.mutable.Way(id=90_000_000_000 + k, nodes=refs, tags={'natural': 'water', 'water': 'sea', 'note': 'compact_city: sea'}))
    wr.close()
    P = np.array(list(outxy.values()))
    lo = inv.transform(P[:, 0].min(), P[:, 1].min()); hi = inv.transform(P[:, 0].max(), P[:, 1].max())
    info = {'bbox_lonlat': [lo[0], lo[1], hi[0], hi[1]], 'axis_len_m': float(W.t[-1]), 'axis_len_out_m': float(W.tp[-1]), 'stats': stats}
    # أماكن المعالم بعد الضغط (للتأكد)
    for z in C['zones']:
        info.setdefault('zones_out', []).append({'name': z['name'], 't0': z['t0'], 't1': z['t1'], 'scale': z['scale'],
            't0_out': float(np.interp(z['t0'], W.t, W.tp)), 't1_out': float(np.interp(z['t1'], W.t, W.tp))})
    json.dump(info, open(dst + '.info.json', 'w'), ensure_ascii=False, indent=1)
    print(json.dumps(info, ensure_ascii=False, indent=1))


if __name__ == '__main__':
    main(sys.argv[1])
