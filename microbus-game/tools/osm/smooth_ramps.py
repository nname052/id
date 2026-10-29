#!/usr/bin/env python3
"""
مطالع الكباري: من غير مطبات وهي طالعة
-----------------------------------------
توحيد الاتجاهين (unify_ramps) والقص على 8% كانوا سايبين "سنّة منشار" في أول/آخر المطلع:
الميل بيروح 6% → 0% → 3% → -4% في كام متر = العربية بتتنطط وهي طالعة (عجلة لفوق 4.5 م/ث² عند 50 كم/س).
هنا لكل وصلة كوبري في الشبكة (الارتفاعات اللي الفيزيا والمرور ماشيين عليها) — وبعدين سطح الكوبري المرسوم بياخدها:
1. المطلع (طرف على الأرض والتاني فوق): الارتفاع لازم يطلع على طول (من غير ما ينزل ويطلع تاني)
   — انحدار متساوي (isotonic / PAVA) بيشيل المطبات من غير ما يغيّر الارتفاع الكلي.
2. تنعيم (متوسط الجيران كذا مرة، الأطراف ثابتة) = منحنى رأسي بدل كوع حاد في القعر وفوق —
   وفي نفس اللفة توحيد مع الاتجاه التاني اللي متداخل معاه (نفس أوزان unify_ramps) عشان مايرجعش "عالي وواطي".
3. الميل الطولي مايزيدش عن 8% (زي unify_ramps).
تشغيل:  python3 tools/osm/smooth_ramps.py   (بعد unify_ramps.py وقبل audit_buildings.py — الأسطح المرسومة بتاخد ارتفاع الشبكة)
"""
import glob, json, math, os

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
DATA = os.path.join(os.environ.get('DATA_ROOT') or os.path.join(ROOT, 'public', 'data'), os.environ.get('REGION', 'shibin'))  # (REGION=alex DATA_ROOT=... لمدينة تانية)
MAXG = 0.08
ITER = 30
BLEND = 3.0


def pava(ys, inc):
    """أقرب سلسلة مش نازلة (أو مش طالعة) للارتفاعات"""
    v = ys if inc else [-y for y in ys]
    blocks = []  # [مجموع, عدد]
    for y in v:
        blocks.append([y, 1])
        while len(blocks) > 1 and blocks[-2][0] / blocks[-2][1] > blocks[-1][0] / blocks[-1][1]:
            s, c = blocks.pop(); blocks[-1][0] += s; blocks[-1][1] += c
    out = []
    for s, c in blocks: out += [s / c] * c
    return out if inc else [-y for y in out]


def prep(lines):
    """lines: {id: [xs, zs, ys, width]} → لكل نقطة: الجيران من الوصلات المتداخلة (وزن + قطعة + t) زي unify_ramps"""
    segs = {o: [((xs[k], zs[k]), (xs[k + 1], zs[k + 1]), k) for k in range(len(xs) - 1)] for o, (xs, zs, ys, w) in lines.items()}
    nb = {}
    for e, (xs, zs, ys, w) in lines.items():
        if max(ys) < 0.3: continue
        x0, x1, z0, z1 = min(xs) - 30, max(xs) + 30, min(zs) - 30, max(zs) + 30
        near = [o for o, (oxs, ozs, oys, ow) in lines.items() if o != e and max(oys) >= 0.3
                and min(oxs) < x1 and max(oxs) > x0 and min(ozs) < z1 and max(ozs) > z0]
        L = []
        for k in range(len(xs)):
            lst = []
            for o in near:
                best = None
                for (ax, az), (bx, bz), j in segs[o]:
                    ex, ez = bx - ax, bz - az; l2 = ex * ex + ez * ez or 1e-9
                    t = max(0.0, min(1.0, ((xs[k] - ax) * ex + (zs[k] - az) * ez) / l2))
                    d = math.hypot(xs[k] - ax - ex * t, zs[k] - az - ez * t)
                    if best is None or d < best[0]: best = (d, j, t)
                lim = (w + lines[o][3]) / 2
                wt = max(0.0, min(1.0, (lim + BLEND - best[0]) / BLEND))
                oy = lines[o][2][best[1]] + (lines[o][2][best[1] + 1] - lines[o][2][best[1]]) * best[2]
                wt *= max(0.0, min(1.0, (max(oy, ys[k]) - 0.1) / 0.4))
                # قريب من الأرض (آخر 1م): كل اتجاه بينزل لشارعه — التوحيد هناك كان بيعمل كوع في آخر المطلع
                wt *= max(0.0, min(1.0, (min(oy, ys[k]) - 0.2) / 0.8))
                if wt > 0 and abs(oy - ys[k]) < 1.5: lst.append((o, best[1], best[2], wt))
            L.append(lst)
        nb[e] = L
    return nb


def run(lines):
    """تنعيم كل الوصلات مع بعض: كل لفة = متوسط الجيران على الخط + توحيد مع الاتجاه التاني اللي متداخل"""
    orig = {e: list(v[2]) for e, v in lines.items()}
    for e, (xs, zs, ys, w) in lines.items():
        lo, hi = min(ys[0], ys[-1]), max(ys[0], ys[-1])
        if len(ys) > 2 and lo <= 1.0 and hi - lo > 1.5:  # مطلع: طالع على طول
            y = pava(ys, ys[-1] > ys[0]); y[0], y[-1] = orig[e][0], orig[e][-1]; ys[:] = y
    nb = prep(lines)
    for _ in range(ITER):
        new = {}
        for e, L in nb.items():
            xs, zs, ys, w = lines[e]; n = len(ys); y = list(ys)
            for k in range(1, n - 1):
                a = math.hypot(xs[k] - xs[k - 1], zs[k] - zs[k - 1]) or 0.01
                b = math.hypot(xs[k + 1] - xs[k], zs[k + 1] - zs[k]) or 0.01
                v = ys[k] + 0.5 * ((ys[k - 1] * b + ys[k + 1] * a) / (a + b) - ys[k])
                acc, ws = v, 1.0
                for o, j, t, wt in L[k]:
                    oy = lines[o][2]; acc += wt * (oy[j] + (oy[j + 1] - oy[j]) * t); ws += wt
                y[k] = acc / ws
            new[e] = y
        for e, y in new.items(): lines[e][2][:] = y
    for e, (xs, zs, ys, w) in lines.items():
        n = len(ys)
        for rng in (range(1, n), range(n - 2, -1, -1)):  # الميل ≤ 8%
            for k in rng:
                j = k - 1 if rng.step == 1 else k + 1
                ys[k] = min(ys[k], ys[j] + MAXG * math.hypot(xs[k] - xs[j], zs[k] - zs[j]))
        ys[0], ys[-1] = orig[e][0], orig[e][-1]
        ys[:] = [round(v, 2) for v in ys]
    return sum(1 for e in lines for a, b in zip(lines[e][2], orig[e]) if abs(a - b) >= 0.01)


def main():
    G = json.load(open(os.path.join(DATA, 'navigation', 'graph.json')))
    gl = {i: [e[10][0::2], e[10][1::2], list(e[11]), e[7]] for i, e in enumerate(G['edges']) if e[11]}
    gch = run(gl)
    for i, v in gl.items(): G['edges'][i][11] = v[2]
    json.dump(G, open(os.path.join(DATA, 'navigation', 'graph.json'), 'w'), ensure_ascii=False, separators=(',', ':'))
    # سطح الكوبري المرسوم = نفس ارتفاع الشبكة (الفيزيا) بالظبط — كانوا بيختلفوا لحد 20سم عند رجل المطلع
    dch, ends = 0, []
    for f in glob.glob(os.path.join(DATA, 'roads', 't_*.json')):
        d = json.load(open(f)); mod = False
        for D in d.get('decks') or []:
            e = G['edges'][D['edge']]; q, hh, p = e[10], e[11], D['p']
            for i in range(0, len(p), 3):
                best = None
                for j in range(len(hh) - 1):
                    ax, az, bx, bz = q[2 * j], q[2 * j + 1], q[2 * j + 2], q[2 * j + 3]
                    ex, ez = bx - ax, bz - az; l2 = ex * ex + ez * ez or 1e-9
                    t_ = max(0.0, min(1.0, ((p[i] - ax) * ex + (p[i + 2] - az) * ez) / l2))
                    dd = math.hypot(p[i] - ax - ex * t_, p[i + 2] - az - ez * t_)
                    if best is None or dd < best[0]: best = (dd, hh[j] + (hh[j + 1] - hh[j]) * t_)
                y = round(best[1], 2)
                if abs(y - p[i + 1]) >= 0.01: p[i + 1] = y; mod = True; dch += 1
            ends += [p[1], p[-2]]
        if mod: json.dump(d, open(f, 'w'), ensure_ascii=False, separators=(',', ':'))
    print(json.dumps({'graph_points_changed': gch, 'deck_points_changed': dch, 'lowest_deck_end_above_0_3': max([y for y in ends if y < 2] or [0])}))


if __name__ == '__main__':
    main()
