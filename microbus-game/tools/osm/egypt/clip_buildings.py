"""بيشيل العمارات البعيدة عن أي شارع (> CLIP_M متر) — بعد تصغير الخريطة بصمات Microsoft كانت لسه
بتغطي المساحة القديمة (~5 كم) فاللعبة كانت بتحمّل مئات المربعات عمارات من غير شوارع.
    python3 tools/osm/egypt/clip_buildings.py <id>     (DATA_ROOT=../data/cities افتراضي)"""
import glob, json, math, os, sys

CLIP_M = float(os.environ.get('CLIP_M', 90))


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
    meta_p = os.path.join(D, 'metadata/metadata.json'); meta = json.load(open(meta_p))
    kept = dropped = tiles_gone = 0
    for f in glob.glob(os.path.join(D, 'buildings', 't_*.json')):
        d = json.load(open(f)); n0 = 0; n1 = 0
        for key in ('gen', 'real'):
            if isinstance(d.get(key), list):
                n0 += len(d[key]); d[key] = [b for b in d[key] if ok(centre(b))]; n1 += len(d[key])
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
    print(f'clip_buildings {cid}: kept {kept}, dropped {dropped} (> {CLIP_M:.0f} m from roads), empty tiles removed {tiles_gone}, tiles now {len(meta["tiles"])}')


if __name__ == '__main__':
    main(sys.argv[1])
