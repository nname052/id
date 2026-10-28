#!/usr/bin/env python3
"""
مطالع الكباري: الاتجاهين لازقين في بعض بس كل واحد له ارتفاع
-------------------------------------------------------------
في المطلعين (شرق/غرب كوبرى شبين العلوي) سطحين الاتجاهين متداخلين بالعرض، وكل واحد طالع بميل مختلف:
في حتة التداخل كان فيه سطحين فوق بعض بفرق لحد 1م = "حتة عالية وحتة واطية" والعربية تقف على الحرف.
الحل: أي نقطة على سطح كوبري جنبها سطح تاني متداخل → الاتنين بياخدوا متوسط الارتفاعين هناك
(بوزن بيقل تدريجيًا على 3م لما يبعدوا عن بعض: من غير عتبة جديدة عند نهاية التداخل).
بيتطبق على أسطح الكباري في roads/t_*.json وعلى ارتفاعات نفس الوصلات في navigation/graph.json.
تشغيل:  python3 tools/osm/unify_ramps.py   (بعد build_region.py)
"""
import glob, json, math, os

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
DATA = os.path.join(ROOT, 'public', 'data', 'shibin')
BLEND = 3.0
MAXG = 0.08


def proj(segs, x, z):
    best = None
    for (ax, ay, az), (bx, by, bz) in segs:
        ex, ez = bx - ax, bz - az; l2 = ex * ex + ez * ez or 1e-9
        t = max(0.0, min(1.0, ((x - ax) * ex + (z - az) * ez) / l2))
        d = math.hypot(x - (ax + ex * t), z - (az + ez * t))
        if best is None or d < best[0]: best = (d, ay + (by - ay) * t)
    return best


def main():
    tiles = {f: json.load(open(f)) for f in glob.glob(os.path.join(DATA, 'roads', 't_*.json'))}
    segs, width = {}, {}
    for d in tiles.values():
        for D in d.get('decks') or []:
            p = D['p']; P = [(p[i], p[i + 1], p[i + 2]) for i in range(0, len(p), 3)]
            segs.setdefault(D['edge'], []).extend(zip(P, P[1:])); width[D['edge']] = D.get('w', 8)
    G = json.load(open(os.path.join(DATA, 'navigation', 'graph.json')))

    def target(e, x, y, z):
        """الارتفاع الجديد لنقطة على الوصلة e"""
        acc, wsum = y, 1.0
        for o, S in segs.items():
            if o == e: continue
            r = proj(S, x, z)
            if not r: continue
            dist, h = r
            lim = (width.get(e, 8) + width[o]) / 2
            w = max(0.0, min(1.0, (lim + BLEND - dist) / BLEND))
            # الاتنين على الأرض تقريبًا (كباري الترعة الصغيرة): من غير تعديل. لو واحد منهم طالع: نوحّدهم
            w *= max(0.0, min(1.0, (max(h, y) - 0.1) / 0.4))
            if w <= 0 or abs(h - y) < 0.02: continue
            acc += h * w; wsum += w
        # متوسط مرجّح: في التداخل الكامل = (y + h) / 2
        return acc / wsum

    changed = 0
    new_tiles = {}
    for f, d in tiles.items():
        mod = False
        for D in d.get('decks') or []:
            p = D['p']
            for i in range(3, len(p) - 3, 3):  # (أول/آخر نقطة: لازقة في شارع أرضي — ثابتة)
                ny = round(target(D['edge'], p[i], p[i + 1], p[i + 2]), 2)
                if abs(ny - p[i + 1]) >= 0.01: p[i + 1] = ny; mod = True; changed += 1
        if mod: new_tiles[f] = d
    gch = 0
    for idx, e in enumerate(G['edges']):
        if not e[11] or idx not in segs: continue
        pts = e[10]
        for k in range(1, len(e[11]) - 1):  # (الأطراف = تقاطعات مع شوارع تانية: ثابتة)
            ny = round(target(idx, pts[2 * k], e[11][k], pts[2 * k + 1]), 2)
            if abs(ny - e[11][k]) >= 0.01: e[11][k] = ny; gch += 1
    # آخر خطوة: الميل الطولي مايزيدش عن 8% (الأطراف ثابتة على الأرض؛ رفع النقط اللي جنبها كان بيعمل حتة حادة)
    def clamp(xs, zs, ys):
        n = len(ys)
        for rng_ in (range(1, n), range(n - 2, -1, -1)):
            for k in rng_:
                j = k - 1 if rng_.step == 1 else k + 1
                L = math.hypot(xs[k] - xs[j], zs[k] - zs[j])
                ys[k] = round(min(ys[k], ys[j] + MAXG * L), 2)
    for f, d in tiles.items():
        for D in d.get('decks') or []:
            p = D['p']; ys = p[1::3]; old = list(ys)
            clamp(p[0::3], p[2::3], ys)
            if ys != old:
                for k, y in enumerate(ys): p[3 * k + 1] = y
                new_tiles[f] = d
    for idx, e in enumerate(G['edges']):
        if e[11]: clamp(e[10][0::2], e[10][1::2], e[11])
    for f, d in new_tiles.items():
        json.dump(d, open(f, 'w'), ensure_ascii=False, separators=(',', ':'))
    json.dump(G, open(os.path.join(DATA, 'navigation', 'graph.json'), 'w'), ensure_ascii=False, separators=(',', ':'))
    print(json.dumps({'deck_points_changed': changed, 'graph_points_changed': gch, 'tiles': len(new_tiles)}))


if __name__ == '__main__':
    main()
