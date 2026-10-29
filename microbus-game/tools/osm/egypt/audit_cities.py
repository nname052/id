#!/usr/bin/env python3
"""
مراجعة كل المدن (من البيانات اللي اللعبة بتقراها فعلًا — الـ packs): إيه الموجود في كل خريطة
المساحة، الشوارع، المباني، المية (نيل/بحر/ترع)، الكباري، الميادين، والمعالم الأساسية:
أهرامات، متاحف، آثار، مواقف/محطات أتوبيس، محطات قطر، مترو، مطارات (+ ممرات)، مستشفيات، جامعات، استادات،
مساجد، كنايس، قهاوي، مباني حكومية.
تشغيل:  python3 tools/osm/egypt/audit_cities.py [--md out.md] [--json out.json]
"""
import base64, collections, glob, gzip, json, math, os, sys

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(os.path.dirname(os.path.dirname(HERE)))


def load_pack(rid):
    d = os.path.join(ROOT, 'public', 'packs', rid)
    if not os.path.isdir(d):  # شبين: ملفات عادية
        base = os.path.join(ROOT, 'public', 'data', rid)
        out = {}
        for f in glob.glob(os.path.join(base, '*', '*.json')):
            out[os.path.relpath(f, base).replace(os.sep, '/')] = json.load(open(f))
        return out
    out = {}
    for f in sorted(glob.glob(os.path.join(d, '*.txt'))):
        obj = json.loads(gzip.decompress(base64.b64decode(open(f, 'rb').read())))
        for k, v in obj.items():
            out[k] = json.loads(v) if isinstance(v, str) else v
    return out


def tri_area(T):
    if not T: return 0.0
    v, I = T['v'], T['i']; s = 0.0
    for k in range(0, len(I), 3):
        a, b, c = [(v[2 * I[k + j]], v[2 * I[k + j] + 1]) for j in range(3)]
        s += abs((b[0] - a[0]) * (c[1] - a[1]) - (c[0] - a[0]) * (b[1] - a[1])) / 2
    return s


def main():
    maps = json.load(open(os.path.join(HERE, 'cities.json')))
    ids = ['shibin'] + [c['id'] for c in maps]
    names = {c['id']: c['name'] for c in maps}; names['shibin'] = 'شبين الكوم'
    rows = []
    for rid in ids:
        D = load_pack(rid)
        if not D: rows.append({'id': rid, 'missing': True}); continue
        meta = D.get('metadata/metadata.json', {}); lm = D.get('landmarks/landmarks.json', {}); F = D.get('landmarks/features.json', {})
        x0, z0, x1, z1 = meta.get('bbox_local', [0, 0, 0, 0])
        conf = lm.get('confirmed', [])
        K = collections.defaultdict(list)
        for l in conf: K[l['kind']].append(l['name'])
        pois = F.get('pois', [])
        rel = collections.Counter((p.get('tags') or {}).get('religion') for p in pois if p['kind'] == 'place_of_worship')
        water = sum(tri_area(v.get('water')) for k, v in D.items() if k.startswith('water/'))
        bld = sum(len(v.get('gen') or []) + len(v.get('real') or []) for k, v in D.items() if k.startswith('buildings/'))
        g = meta.get('generated', {})
        stations = sorted(set([s['name'] for s in F.get('transit_stops', []) if s.get('name') and (s.get('tags') or {}).get('amenity') == 'bus_station'] + K['bus_station']))
        rows.append(dict(
            id=rid, name=names.get(rid, rid), km2=round((x1 - x0) * (z1 - z0) / 1e6, 1),
            road_km=meta.get('counts', {}).get('road_km'), buildings=bld, water_km2=round(water / 1e6, 2),
            bridges=meta.get('counts', {}).get('bridges'), roundabouts=len(F.get('roundabouts', [])),
            pyramids=K['pyramid'], museums=K['museum'], historic=K['historic'], bus_stations=stations[:12], n_bus_stations=len(stations),
            rail=K['rail_station'], metro=K['metro'], airport=K['airport'], runways=len([a for a in F.get('aero', []) if a['kind'] == 'runway']),
            hospitals=len([p for p in pois if p['kind'] == 'hospital']) + len(K['hospital']), universities=K['university'], stadiums=K['stadium'],
            government=K['government'], library=K['library'],
            mosques=rel.get('muslim', 0), churches=rel.get('christian', 0), cafes=len([p for p in pois if p['kind'] == 'cafe']),
            shops=len([p for p in pois if p['kind'] == 'shop']), stops=len(F.get('transit_stops', [])),
        ))
        print(rid, 'ok', file=sys.stderr)
    args = sys.argv[1:]
    if '--json' in args: json.dump(rows, open(args[args.index('--json') + 1], 'w'), ensure_ascii=False, indent=1)
    if '--md' in args:
        L = ['| المدينة | المساحة كم² | مباني | مية كم² | كباري | ميادين | أهرامات | متاحف | آثار | مواقف | قطر | مترو | مطار | مستشفيات | مساجد | كنايس | قهاوي |', '|' + '---|' * 17]
        for r in rows:
            if r.get('missing'): L.append(f"| {r['id']} | (مش متبنية) |" + ' |' * 15); continue
            L.append(f"| {r['name']} | {r['km2']} | {r['buildings']:,} | {r['water_km2']} | {r['bridges']} | {r['roundabouts']} | {len(r['pyramids'])} | {len(r['museums'])} | {len(r['historic'])} | {r['n_bus_stations']} | {len(r['rail'])} | {len(r['metro'])} | {'✓' if r['airport'] else '—'}{' (' + str(r['runways']) + ' ممر)' if r['runways'] else ''} | {r['hospitals']} | {r['mosques']} | {r['churches']} | {r['cafes']} |")
        open(args[args.index('--md') + 1], 'w').write('\n'.join(L) + '\n')


if __name__ == '__main__':
    main()
