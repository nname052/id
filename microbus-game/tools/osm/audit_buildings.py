#!/usr/bin/env python3
"""
فحص العمارات المولّدة ضد الطريق (أسفلت + رصيف + أسطح الكباري)
------------------------------------------------------------------
- بيرسم كل الأسفلت/الرصيف/أسطح الكباري على شبكة 0.5م للمدينة كلها (numpy)
- كل عمارة مولّدة (gen) بيتاخد منها نقط جوه المستطيل (بهامش صغير من الحواف) ونشوف هل بتقع على طريق
- --fix: العمارة اللي داخلة على الطريق بتتقص من الناحية اللي فيها التداخل (بيتشال منها شرايح لحد ما تبعد)،
         ولو فضل منها أقل من 45% (أو أقل من 4م) بتتشال خالص. الملفات بتتكتب تاني.
- --fix-real: مباني OSM الحقيقية (المدارس…) بعد ما الشوارع اتوسعت كانت حيطانها داخلة في الأسفلت:
         كل ركن جوه الأسفلت (أو أقل من 0.6م منه) بيتسحب ناحية نص المبنى لحد ما يبعد (الشكل نفسه زي ما هو تقريبًا)
تشغيل:  python3 tools/osm/audit_buildings.py [--fix] [--fix-real]
"""
import glob, json, math, os, sys
import numpy as np

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
DATA = os.path.join(os.environ.get('DATA_ROOT') or os.path.join(ROOT, 'public', 'data'), os.environ.get('REGION', 'shibin'))  # (REGION=alex DATA_ROOT=... لمدينة تانية)
RES = 0.5
INSET = {'asphalt': 0.25, 'deck': 0.25, 'sidewalk': 0.7}  # هامش من حواف العمارة (الرصيف: لمسة خفيفة مسموحة)


def tri_raster(grid, x0, z0, pts, tris):
    """بيلوّن مثلثات (x,z) على الشبكة"""
    H, W = grid.shape
    for a, b, c in tris:
        ax, az = pts[a]; bx, bz = pts[b]; cx, cz = pts[c]
        i0 = max(0, int((min(ax, bx, cx) - x0) / RES)); i1 = min(W - 1, int((max(ax, bx, cx) - x0) / RES) + 1)
        j0 = max(0, int((min(az, bz, cz) - z0) / RES)); j1 = min(H - 1, int((max(az, bz, cz) - z0) / RES) + 1)
        if i1 < i0 or j1 < j0:
            continue
        xs = x0 + (np.arange(i0, i1 + 1) + 0.5) * RES
        zs = z0 + (np.arange(j0, j1 + 1) + 0.5) * RES
        X, Z = np.meshgrid(xs, zs)
        d1 = (X - bx) * (az - bz) - (ax - bx) * (Z - bz)
        d2 = (X - cx) * (bz - cz) - (bx - cx) * (Z - cz)
        d3 = (X - ax) * (cz - az) - (cx - ax) * (Z - az)
        neg = (d1 < 0) | (d2 < 0) | (d3 < 0); pos = (d1 > 0) | (d2 > 0) | (d3 > 0)
        grid[j0:j1 + 1, i0:i1 + 1] |= ~(neg & pos)


def load():
    roads = {os.path.basename(f)[:-5]: json.load(open(f)) for f in glob.glob(os.path.join(DATA, 'roads', 't_*.json'))}
    blds = {os.path.basename(f)[:-5]: json.load(open(f)) for f in glob.glob(os.path.join(DATA, 'buildings', 't_*.json'))}
    return roads, blds


def bounds(roads, blds):
    xs, zs = [], []
    for d in roads.values():
        for k in ('asphalt', 'sidewalk'):
            v = (d.get(k) or {}).get('v') or []
            xs += v[0::2]; zs += v[1::2]
    for d in blds.values():
        for b in d.get('gen') or []:
            xs.append(b[0]); zs.append(b[1])
    return min(xs) - 40, min(zs) - 40, max(xs) + 40, max(zs) + 40


def rasterize(roads, box):
    x0, z0, x1, z1 = box
    W, H = int((x1 - x0) / RES) + 1, int((z1 - z0) / RES) + 1
    g = {k: np.zeros((H, W), dtype=bool) for k in ('asphalt', 'sidewalk', 'deck')}
    for d in roads.values():
        for k in ('asphalt', 'sidewalk'):
            L = d.get(k)
            if not L or not L.get('v'):
                continue
            v = L['v']; pts = [(v[i], v[i + 1]) for i in range(0, len(v), 2)]
            I = L['i']; tri_raster(g[k], x0, z0, pts, [(I[i], I[i + 1], I[i + 2]) for i in range(0, len(I), 3)])
        decks = d.get('decks') or []
        for D in (decks if isinstance(decks, list) else [decks]):
            p = D.get('p') or []; w = D.get('w', 8) / 2
            P = [(p[i], p[i + 1], p[i + 2]) for i in range(0, len(p), 3)]
            for (ax, ay, az), (bx, by, bz) in zip(P, P[1:]):
                if max(ay, by) < 2.0:  # جزء واطي من المطلع: الأسفلت العادي بيغطيه
                    continue
                L = math.hypot(bx - ax, bz - az) or 1
                nx, nz = -(bz - az) / L * w, (bx - ax) / L * w
                q = [(ax + nx, az + nz), (bx + nx, bz + nz), (bx - nx, bz - nz), (ax - nx, az - nz)]
                tri_raster(g['deck'], x0, z0, q, [(0, 1, 2), (0, 2, 3)])
    return g


def samples(b, inset):
    cx, cz, w, d, a = b[:5]
    # الـ z المحلي = ناحية الشارع (الواجهة)؛ x المحلي = العرض
    ca, sa = math.cos(a), math.sin(a)
    us = np.arange(-w / 2 + inset, w / 2 - inset + 1e-6, RES * 0.8)
    vs = np.arange(-d / 2 + inset, d / 2 - inset + 1e-6, RES * 0.8)
    if not len(us) or not len(vs):
        return None
    U, V = np.meshgrid(us, vs)
    X = cx + U * ca + V * sa
    Z = cz - U * sa + V * ca
    return U, V, X, Z


def hits(g, box, b, kind):
    s = samples(b, INSET[kind])
    if s is None:
        return None
    U, V, X, Z = s
    x0, z0 = box[0], box[1]
    i = ((X - x0) / RES).astype(int); j = ((Z - z0) / RES).astype(int)
    G = g[kind]
    ok = (i >= 0) & (j >= 0) & (i < G.shape[1]) & (j < G.shape[0])
    m = np.zeros_like(ok)
    m[ok] = G[j[ok], i[ok]]
    return U, V, m


def overlap(g, box, b):
    out = {}
    for k in INSET:
        r = hits(g, box, b, k)
        if r is not None and r[2].any():
            out[k] = r
    return out


def shrink(g, box, b):
    """بيقص العمارة من الناحية اللي فيها التداخل لحد ما تبعد عن الطريق"""
    cx, cz, w, d, a = b[:5]
    ca, sa = math.cos(a), math.sin(a)
    cur = list(b)
    for _ in range(40):
        ov = overlap(g, box, cur)
        if not ov:
            return cur
        # مركز نقط التداخل (محلي) → نقص من الناحية دي
        us, vs = [], []
        for U, V, m in ov.values():
            us += list(U[m]); vs += list(V[m])
        mu, mv = float(np.mean(us)), float(np.mean(vs))
        cw, cd = cur[2], cur[3]
        # الناحية الأقرب للحافة (نسبيًا) هي اللي بنقص منها
        if abs(mu) / cw > abs(mv) / cd:
            step = 0.5; cw -= step; sh = -math.copysign(step / 2, mu)
            ncx, ncz = cur[0] + sh * ca, cur[1] - sh * sa
            cur = [ncx, ncz, cw, cd] + cur[4:]
        else:
            step = 0.5; cd -= step; sh = -math.copysign(step / 2, mv)
            ncx, ncz = cur[0] + sh * sa, cur[1] + sh * ca
            cur = [ncx, ncz, cw, cd] + cur[4:]
        if cw < 4 or cd < 4 or cw * cd < 0.45 * w * d:
            return None
    return None


def near_road(g, box, x, z, r=0.6):
    x0, z0 = box[0], box[1]
    for dx in (-r, 0, r):
        for dz in (-r, 0, r):
            i = int((x + dx - x0) / RES); j = int((z + dz - z0) / RES)
            if 0 <= j < g['asphalt'].shape[0] and 0 <= i < g['asphalt'].shape[1] and (g['asphalt'][j, i] or g['deck'][j, i]):
                return True
    return False


def fix_real(g, box, blds):
    moved = 0
    for name, d in blds.items():
        changed = False
        for rb in d.get('real') or []:
            v = rb['v']; n = len(v) // 2
            cx = sum(v[0::2]) / n; cz = sum(v[1::2]) / n
            newv = list(v)
            for k in range(n):
                x, z = v[2 * k], v[2 * k + 1]
                if not near_road(g, box, x, z):
                    continue
                L = math.hypot(cx - x, cz - z) or 1
                ux, uz = (cx - x) / L, (cz - z) / L
                for s in np.arange(0.25, min(10.0, L * 0.6), 0.25):
                    if not near_road(g, box, x + ux * s, z + uz * s):
                        newv[2 * k], newv[2 * k + 1] = round(x + ux * s, 2), round(z + uz * s, 2); moved += 1; changed = True
                        break
            if newv != v:
                # الحلقات بنفس النقط (آخر نقطة = أول نقطة)
                m = {(v[2 * k], v[2 * k + 1]): (newv[2 * k], newv[2 * k + 1]) for k in range(n)}
                rb['rings'] = [[c for i in range(0, len(r), 2) for c in m.get((r[i], r[i + 1]), (r[i], r[i + 1]))] for r in rb['rings']]
                rb['v'] = newv
        if changed:
            json.dump(d, open(os.path.join(DATA, 'buildings', name + '.json'), 'w'), ensure_ascii=False, separators=(',', ':'))
    return moved


def main():
    fix = '--fix' in sys.argv
    roads, blds = load()
    box = bounds(roads, blds)
    g = rasterize(roads, box)
    if '--fix-real' in sys.argv:
        print('real vertices moved:', fix_real(g, box, blds))
    stats = {'buildings': 0, 'asphalt': 0, 'sidewalk': 0, 'deck': 0, 'shrunk': 0, 'removed': 0}
    worst = []
    for name, d in sorted(blds.items()):
        gen = d.get('gen') or []
        new = []
        changed = False
        for b in gen:
            stats['buildings'] += 1
            ov = overlap(g, box, b)
            for k, (U, V, m) in ov.items():
                stats[k] += 1
                worst.append((int(m.sum()), k, name, [round(x, 1) for x in b[:2]]))
            if ov and fix:
                nb = shrink(g, box, b)
                changed = True
                if nb is None:
                    stats['removed'] += 1
                    continue
                stats['shrunk'] += 1
                b = [round(nb[0], 2), round(nb[1], 2), round(nb[2], 2), round(nb[3], 2)] + list(b[4:])
            new.append(b)
        if fix and changed:
            d['gen'] = new
            json.dump(d, open(os.path.join(DATA, 'buildings', name + '.json'), 'w'), ensure_ascii=False, separators=(',', ':'))
    worst.sort(reverse=True)
    print(json.dumps(stats, ensure_ascii=False))
    for w in worst[:12]:
        print(w)


if __name__ == '__main__':
    main()
