"""فحص آلي لكل مدينة (MAJOR UPDATE — STAGE 2): بيطلع FAIL لو فيه مشكلة حرجة.
  - الشبكة: عدد المكونات المتصلة (لازم 1) + نسبة العقد اللي توصلها بالعربية مع احترام الاتجاه الواحد (≥ 97%)
  - عمارات على الأسفلت (audit_buildings) = 0
  - عمارات قافلة تقاطع: مركز عمارة على بعد < نص عرض الشارع + 2م من عقدة فيها 3 شوارع أو أكتر = 0
  - شوارع مسدودة (معلومة)
    python3 tools/osm/egypt/validate_city.py <id> [id ...]      (DATA_ROOT=../data/cities)"""
import glob, json, math, os, subprocess, sys, collections

ROOT = os.environ.get('DATA_ROOT') or os.path.join(os.path.dirname(__file__), '../../../../data/cities')


def check(cid):
    D = os.path.join(ROOT, cid)
    g = json.load(open(os.path.join(D, 'navigation/graph.json')))
    nodes, edges = g['nodes'], g['edges']
    und = collections.defaultdict(set); dirg = collections.defaultdict(set); deg = collections.Counter()
    used = set()
    for e in edges:
        a, b, ow = e[0], e[1], e[5]
        und[a].add(b); und[b].add(a); dirg[a].add(b); used.update((a, b)); deg[a] += 1; deg[b] += 1
        if not ow: dirg[b].add(a)
    # المكونات
    seen, comps = set(), []
    for s in used:
        if s in seen: continue
        st, c = [s], 0; seen.add(s)
        while st:
            n = st.pop(); c += 1
            for m in und[n]:
                if m not in seen: seen.add(m); st.append(m)
        comps.append(c)
    # الوصول بالاتجاه: من أكبر عقدة درجة، كام عقدة نوصلها وكام عقدة توصلنا
    start = max(used, key=lambda n: deg[n]) if used else None
    def reach(G):
        s, st = {start}, [start]
        while st:
            n = st.pop()
            for m in G[n]:
                if m not in s: s.add(m); st.append(m)
        return s
    rev = collections.defaultdict(set)
    for a, bs in dirg.items():
        for b in bs: rev[b].add(a)
    fw, bw = (reach(dirg), reach(rev)) if start is not None else (set(), set())
    strong = len(fw & bw) / max(1, len(used))
    # عمارات على تقاطعات
    junc = [(nodes[n][0], nodes[n][1]) for n in used if deg[n] >= 3]
    jw = collections.defaultdict(float)
    for e in edges:
        for n in (e[0], e[1]): jw[n] = max(jw[n], e[7] / 2)
    jgrid = collections.defaultdict(list)
    for n in used:
        if deg[n] >= 3: jgrid[(int(nodes[n][0] // 20), int(nodes[n][1] // 20))].append((nodes[n][0], nodes[n][1], jw[n]))
    blockJ = 0
    for f in glob.glob(os.path.join(D, 'buildings', 't_*.json')):
        d = json.load(open(f))
        for b in d.get('gen', []):
            for i in (-1, 0, 1):
                for j in (-1, 0, 1):
                    for (x, z, w) in jgrid.get((int(b[0] // 20) + i, int(b[1] // 20) + j), []):
                        # المستطيل نفسه بيلمس دايرة التقاطع (نص عرض الشارع + 1م)؟
                        ca, sa = math.cos(b[4]), math.sin(b[4]); dx, dz = x - b[0], z - b[1]
                        u, v = dx * ca - dz * sa, dx * sa + dz * ca
                        cu, cv = max(-b[2] / 2, min(b[2] / 2, u)), max(-b[3] / 2, min(b[3] / 2, v))
                        if math.hypot(u - cu, v - cv) < w + 1: blockJ += 1
    env = dict(os.environ, DATA_ROOT=ROOT, REGION=cid)
    out = subprocess.run([sys.executable, os.path.join(os.path.dirname(__file__), '../audit_buildings.py')], env=env, capture_output=True, text=True).stdout
    aud = json.loads([l for l in out.splitlines() if l.startswith('{')][-1])
    dead = sum(1 for n in used if deg[n] == 1 and not (nodes[n][2] & 1))
    res = dict(city=cid, edges=len(edges), components=len(comps), strongReach=round(strong, 3), onAsphalt=aud['asphalt'], onDeck=aud['deck'], blockingJunction=blockJ, deadEnds=dead)
    res['ok'] = len(comps) == 1 and strong >= 0.97 and aud['asphalt'] == 0 and aud['deck'] == 0 and blockJ == 0
    return res


if __name__ == '__main__':
    bad = 0
    for c in sys.argv[1:]:
        r = check(c); bad += not r['ok']
        print(('PASS ' if r['ok'] else 'FAIL ') + json.dumps(r, ensure_ascii=False))
    sys.exit(1 if bad else 0)
