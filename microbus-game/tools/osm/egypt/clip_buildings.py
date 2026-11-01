"""بيشيل العمارات البعيدة عن أي شارع (> CLIP_M متر) — بعد تصغير الخريطة بصمات Microsoft كانت لسه
بتغطي المساحة القديمة (~5 كم) فاللعبة كانت بتحمّل مئات المربعات عمارات من غير شوارع.
    python3 tools/osm/egypt/clip_buildings.py <id>     (DATA_ROOT=../data/cities افتراضي)"""
import collections, glob, json, math, os, sys

CLIP_M = float(os.environ.get('CLIP_M', 45))


def centre(b):
    if isinstance(b, dict):
        if isinstance(b.get('v'), list) and len(b['v']) >= 2:
            xs, zs = b['v'][0::2], b['v'][1::2]; return sum(xs) / len(xs), sum(zs) / len(zs)
        for k in ('footprint', 'pts', 'poly', 'ring'):
            if k in b: return centre(b[k])
        if 'x' in b and 'z' in b: return b['x'], b['z']
        return None
    if b and isinstance(b[0], (list, tuple)):
        return sum(p[0] for p in b) / len(b), sum(p[1] for p in b) / len(b)
    if len(b) >= 2 and all(isinstance(v, (int, float)) for v in b[:2]):
        return b[0], b[1]
    return None


def main(cid):
    root = os.environ.get('DATA_ROOT') or os.path.join(os.path.dirname(__file__), '../../../../data/cities')
    D = os.path.join(root, cid)
    g = json.load(open(os.path.join(D, 'navigation/graph.json')))
    C = 30.0; cells = set()
    for e in g['edges']:
        P = e[10]
        for i in range(0, len(P) - 2, 2):
            x0, z0, x1, z1 = P[i], P[i + 1], P[i + 2], P[i + 3]
            n = max(1, int(math.hypot(x1 - x0, z1 - z0) / 10))
            for k in range(n + 1):
                cells.add((math.floor((x0 + (x1 - x0) * k / n) / C), math.floor((z0 + (z1 - z0) * k / n) / C)))
    R = int(math.ceil(CLIP_M / C))
    near = set()
    for (i, j) in cells:
        for di in range(-R, R + 1):
            for dj in range(-R, R + 1):
                if (di * C) ** 2 + (dj * C) ** 2 <= (CLIP_M + C) ** 2: near.add((i + di, j + dj))
    ok = lambda c: c is None or (math.floor(c[0] / C), math.floor(c[1] / C)) in near
    # آخر الشارع المسدود (شارع عربيات): العمارة المولّدة اللي قاعدة قصاده بالظبط بتتشال — كانت بتقفل الطريق
    # (البصمات الحقيقية بتفضل: الحارة السد الحقيقية آخرها بيت فعلًا)
    deg = [0] * len(g['nodes'])
    for e in g['edges']: deg[e[0]] += 1; deg[e[1]] += 1
    deg_all = {i: k for i, k in enumerate(deg) if k}
    CARS = {'primary', 'secondary', 'tertiary', 'residential', 'unclassified', 'road', 'living_street', 'service', 'trunk', 'motorway', 'primary_link', 'secondary_link', 'tertiary_link', 'trunk_link', 'motorway_link'}
    tips = []
    for e in g['edges']:
        if g['classes'][e[3]] not in CARS: continue
        P = e[10]
        for end, (px, pz, qx, qz) in ((e[1], (P[-4], P[-3], P[-2], P[-1])), (e[0], (P[2], P[3], P[0], P[1]))):
            if deg[end] != 1 or g['nodes'][end][2] & 1: continue
            l = math.hypot(qx - px, qz - pz) or 1
            tips.append((qx, qz, (qx - px) / l, (qz - pz) / l, e[7] / 2 + 0.8))
    tgrid = {}
    for tp in tips: tgrid.setdefault((math.floor(tp[0] / 30), math.floor(tp[1] / 30)), []).append(tp)
    def blocks(b):
        cx, cz, w, d, a = b[0], b[1], b[2], b[3], b[4]
        ca, sa = math.cos(a), math.sin(a)
        for i in (-1, 0, 1):
            for j in (-1, 0, 1):
                for (qx, qz, dx, dz, hw) in tgrid.get((math.floor(cx / 30) + i, math.floor(cz / 30) + j), []):
                    for s in range(0, 13, 1):
                        for o in (-hw, 0, hw):
                            X, Z = qx + dx * s - dz * o, qz + dz * s + dx * o
                            u, v = (X - cx) * ca - (Z - cz) * sa, (X - cx) * sa + (Z - cz) * ca
                            if abs(u) < w / 2 and abs(v) < d / 2: return True
        return False
    dead_cut = 0
    # التقاطعات (3 شوارع أو أكتر): العمارة المولّدة اللي مستطيلها بيلمس دايرة التقاطع (نص أعرض شارع + 1م) بتتشال
    jw = collections.defaultdict(float)
    for e in g['edges']:
        for n in (e[0], e[1]): jw[n] = max(jw[n], e[7] / 2)
    jgrid = {}
    for n, k in deg_all.items():
        if k >= 3: x, z = g['nodes'][n][0], g['nodes'][n][1]; jgrid.setdefault((math.floor(x / 30), math.floor(z / 30)), []).append((x, z, jw[n] + 1.0))
    def in_junction(b):
        ca, sa = math.cos(b[4]), math.sin(b[4])
        for i in (-1, 0, 1):
            for j in (-1, 0, 1):
                for (x, z, R) in jgrid.get((math.floor(b[0] / 30) + i, math.floor(b[1] / 30) + j), []):
                    dx, dz = x - b[0], z - b[1]; u, v = dx * ca - dz * sa, dx * sa + dz * ca
                    cu, cv = max(-b[2] / 2, min(b[2] / 2, u)), max(-b[3] / 2, min(b[3] / 2, v))
                    if math.hypot(u - cu, v - cv) < R: return True
        return False
    meta_p = os.path.join(D, 'metadata/metadata.json'); meta = json.load(open(meta_p))
    kept = dropped = tiles_gone = 0
    for f in glob.glob(os.path.join(D, 'buildings', 't_*.json')):
        d = json.load(open(f)); n0 = 0; n1 = 0
        for key in ('gen', 'real'):
            if isinstance(d.get(key), list):
                n0 += len(d[key]); d[key] = [b for b in d[key] if ok(centre(b))]
                # (التقاطعات دايمًا — كانت بتتعمل بس لو فيه شوارع مسدودة، فالمدن اللي مافيهاش ولا مسدود فضلت فيها عماير في التقاطع)
                if key == 'gen':
                    k0 = len(d[key]); d[key] = [b for b in d[key] if not (tips and blocks(b)) and not in_junction(b)]; dead_cut += k0 - len(d[key])
                n1 += len(d[key])
        kept += n1; dropped += n0 - n1
        name = os.path.basename(f)[:-5]
        if n1 == 0:
            os.remove(f)
            L = meta['tiles'].get(name, [])
            if 'buildings' in L: L.remove('buildings')
            if not L: meta['tiles'].pop(name, None); tiles_gone += 1
        elif n1 != n0:
            json.dump(d, open(f, 'w'), separators=(',', ':'), ensure_ascii=False)
    json.dump(meta, open(meta_p, 'w'), ensure_ascii=False, indent=1)
    print(f'clip_buildings {cid}: kept {kept}, dropped {dropped} (> {CLIP_M:.0f} m from roads), empty tiles removed {tiles_gone}, tiles now {len(meta["tiles"])}, dead-end blockers removed {dead_cut}')


if __name__ == '__main__':
    main(sys.argv[1])
