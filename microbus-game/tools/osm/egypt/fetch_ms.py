#!/usr/bin/env python3
"""
بصمات المباني (Microsoft Global ML Building Footprints, ODbL) لكل مدينة في cities.json:
بيجيب ملفات الـ quadkey (zoom 9) اللي بتغطي حدود المدينة من dataset-links.csv، ويفلترها على مربع المدينة
(±2.6 كم) → tools/osm/egypt/ms/<id>.json.gz  (نفس شكل shibin_ms_footprints.json.gz: قايمة GeoJSON features)
تشغيل:  python3 tools/osm/egypt/fetch_ms.py [id ...]   (الملفات الخام بتتخزن في ../data/ms/raw)
"""
import csv, gzip, json, math, os, sys, urllib.request

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(os.path.dirname(os.path.dirname(HERE)))
RAW = os.path.join(os.path.dirname(ROOT), 'data', 'ms', 'raw')
LINKS = os.path.join(os.path.dirname(ROOT), 'data', 'ms', 'dataset-links.csv')
HALF = 2600.0


def quadkey(lon, lat, z=9):
    s = math.sin(math.radians(lat))
    x = int((lon + 180) / 360 * (1 << z)); y = int((0.5 - math.log((1 + s) / (1 - s)) / (4 * math.pi)) * (1 << z))
    q = ''
    for i in range(z, 0, -1):
        d = 0; m = 1 << (i - 1)
        if x & m: d += 1
        if y & m: d += 2
        q += str(d)
    return q


def bbox(c):
    if c.get('bbox'):  # المدن الكبيرة: حدودها الأوسع (cities.json) + 600م هامش
        m = 0.006; w, s, e, n = c['bbox']; return w - m, s - m, e + m, n + m
    dlat = HALF / 111320; dlon = HALF / (111320 * math.cos(math.radians(c['lat'])))
    return c['lon'] - dlon, c['lat'] - dlat, c['lon'] + dlon, c['lat'] + dlat


def main():
    cities = json.load(open(os.path.join(HERE, 'cities.json')))
    want = set(sys.argv[1:])
    links = {}
    for row in csv.reader(open(LINKS)):
        if row and row[0] == 'Egypt': links.setdefault(row[1], []).append(row[2])
    os.makedirs(RAW, exist_ok=True); os.makedirs(os.path.join(HERE, 'ms'), exist_ok=True)
    for c in cities:
        if want and c['id'] not in want: continue
        w, s, e, n = bbox(c)
        qks = sorted({quadkey(x, y) for x in (w, e) for y in (s, n)})
        feats = []
        for q in qks:
            for url in links.get(q, []):
                fn = os.path.join(RAW, q + '_' + os.path.basename(url))
                if not os.path.exists(fn):
                    print('download', q, url[-60:], flush=True)
                    urllib.request.urlretrieve(url, fn + '.part'); os.replace(fn + '.part', fn)
                for line in gzip.open(fn, 'rt'):
                    f = json.loads(line)
                    co = f['geometry']['coordinates'][0]
                    lo = sum(p[0] for p in co) / len(co); la = sum(p[1] for p in co) / len(co)
                    if w <= lo <= e and s <= la <= n: feats.append(f)
        json.dump(feats, gzip.open(os.path.join(HERE, 'ms', c['id'] + '.json.gz'), 'wt'), separators=(',', ':'))
        print(c['id'], 'quadkeys', qks, 'footprints', len(feats), flush=True)


if __name__ == '__main__':
    main()
