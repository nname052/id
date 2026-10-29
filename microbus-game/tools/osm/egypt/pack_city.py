#!/usr/bin/env python3
"""
بيانات مدينة (مئات الملفات الصغيرة) → كام ملف مضغوط (gzip، متخزن base64 نص) في public/packs/<id>/:
  base.txt      = metadata + region + landmarks + graph + features   (بيتحمل أول ما الخريطة تفتح)
  p_<gi>_<gj>.txt = كل طبقات المربعات (roads/buildings/water/railways) لكل 7×7 مربعات (2.8 كم): gi = floor((i + off) / 7)
الصفحة على Claude ليها حد لعدد الملفات (511) — كده كل مدينة = ~5 ملفات بدل ~300.
اللعبة بتفك الضغط بنفسها (DecompressionStream) — ShibinData.loadJSON.
تشغيل:  python3 tools/osm/egypt/pack_city.py <id>   (DATA_ROOT = مكان البيانات الخام، الافتراضي ../data/cities)
"""
import base64, glob, gzip, json, os, re, sys

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(os.path.dirname(os.path.dirname(HERE)))
GROUP = 7


def main():
    rid = sys.argv[1]
    src = os.path.join(os.environ.get('DATA_ROOT') or os.path.join(os.path.dirname(ROOT), 'data', 'cities'), rid)
    out = os.path.join(ROOT, 'public', 'packs', rid)
    os.makedirs(out, exist_ok=True)
    for f in glob.glob(os.path.join(out, '*.bin')) + glob.glob(os.path.join(out, '*.txt')): os.remove(f)
    base, packs = {}, {}
    # الإزاحة من أصغر رقم مربع (-6 أو -7 حسب المدينة) → المربعات من الطرف للطرف = 2×2 ملف
    idx = [int(v) for f in glob.glob(os.path.join(src, '*', 't_*.json')) for v in re.findall(r'-?\d+', os.path.basename(f))]
    OFF = -min(idx + [0])
    for f in sorted(glob.glob(os.path.join(src, '*', '*.json'))):
        rel = os.path.relpath(f, src).replace(os.sep, '/')
        d = json.load(open(f, encoding='utf-8'))
        m = re.match(r'^(\w+)/t_(-?\d+)_(-?\d+)\.json$', rel)
        if m:
            k = f'p_{(int(m.group(2)) + OFF) // GROUP}_{(int(m.group(3)) + OFF) // GROUP}'
            # المربع = نص JSON (مش object): اللعبة بتفكه وقت ما تبني المربع وترميه بعدها → الذاكرة = حجم النص بس
            packs.setdefault(k, {})[rel] = json.dumps(d, ensure_ascii=False, separators=(',', ':'))
        else:
            base[rel] = d
    base['pack'] = dict(group=GROUP, off=OFF, packs=sorted(packs))
    sizes = {}
    for name, obj in [('base', base)] + sorted(packs.items()):
        raw = json.dumps(obj, ensure_ascii=False, separators=(',', ':')).encode('utf-8')
        # gzip → base64 نص (.txt): صفحة Claude بتقدّم أنواع ملفات معيّنة بس (مفيش ملفات binary عامة)
        fn = os.path.join(out, name + '.txt')
        with open(fn, 'wb') as fh: fh.write(base64.b64encode(gzip.compress(raw, 9, mtime=0)))
        sizes[name] = round(os.path.getsize(fn) / 1e6, 2)
    print(json.dumps({'region': rid, 'files': len(sizes), 'MB': round(sum(sizes.values()), 2), 'sizes': sizes}))


if __name__ == '__main__':
    main()
