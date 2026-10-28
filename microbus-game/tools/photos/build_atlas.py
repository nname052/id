#!/usr/bin/env python3
"""
أطلس الصور الحقيقية لشبين الكوم (واجهات طوب/محارة، محلات، أسفلت، رصيف)
-----------------------------------------------------------------------
- المصدر: tools/photos/sources.json (صور Wikimedia Commons برخص حرة + المربعات اللي بتتقص منها)
- الصور بتتنزل مرة واحدة في tools/photos/cache (مش في git)
- الناتج:
    public/textures/shibin-photo-atlas.jpg   (ملف واحد مضغوط، بيتحمل مرة واحدة)
    src/render/photoAtlas.json               (أماكن الخانات + الشبابيك + متوسط الألوان + المصادر)
تشغيل:  python3 tools/photos/build_atlas.py [--sheet out.jpg]
"""
import json, os, sys, time, urllib.parse, urllib.request
from PIL import Image, ImageFilter, ImageOps, ImageStat, ImageDraw

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(os.path.dirname(HERE))
CACHE = os.path.join(HERE, 'cache')
UA = 'MicrobusGame-atlas/1.0 (https://github.com/nname052/id)'

CELL = 256                     # خانة الواجهة/المحل
W, H = 2048, 1792              # 3 صفوف خانات (768) + أسفلت 1024x1024 + رصيف 512x512
ASPH = (0, 768, 1024)          # x, y, size
SIDE = (1024, 768, 512)


def fetch(key, meta):
    os.makedirs(CACHE, exist_ok=True)
    fn = os.path.join(CACHE, key + '.jpg')
    if os.path.exists(fn):
        return fn
    q = urllib.parse.urlencode({'action': 'query', 'prop': 'imageinfo', 'iiprop': 'url', 'iiurlwidth': meta['w'], 'titles': meta['file'], 'format': 'json'})
    api = 'https://commons.wikimedia.org/w/api.php?' + q
    for k in range(6):
        try:
            info = json.load(urllib.request.urlopen(urllib.request.Request(api, headers={'User-Agent': UA})))
            ii = next(iter(info['query']['pages'].values()))['imageinfo'][0]
            url = (ii.get('thumburl') or ii['url']).split('?')[0]
            data = urllib.request.urlopen(urllib.request.Request(url, headers={'User-Agent': UA})).read()
            open(fn, 'wb').write(data)
            return fn
        except Exception as e:  # Commons بيحدد عدد الطلبات (429): نستنى ونعيد
            print('retry', key, e, file=sys.stderr)
            time.sleep(5 * 2 ** k)
    raise SystemExit('download failed: ' + key)


def rectify(img, quad, w, h):
    """يعدّل منظور المربع الرباعي (TL,TR,BR,BL) لمستطيل w×h"""
    (x0, y0), (x1, y1), (x2, y2), (x3, y3) = quad
    # PIL QUAD: TL, BL, BR, TR
    return img.transform((w, h), Image.QUAD, (x0, y0, x3, y3, x2, y2, x1, y1), Image.BICUBIC)


def level(im, target=None, sat=1.0):
    """تظبيط بسيط: شيل الضباب (auto contrast خفيف) + تشبع + متوسط إضاءة"""
    im = ImageOps.autocontrast(im, cutoff=1)
    if sat != 1.0:
        from PIL import ImageEnhance
        im = ImageEnhance.Color(im).enhance(sat)
    if target:
        m = sum(ImageStat.Stat(im.convert('L')).mean) / 255
        from PIL import ImageEnhance
        im = ImageEnhance.Brightness(im).enhance(target / max(m, 0.05))
    return im


def tileable(im, blend=0.22):
    """يخلي الصورة تتكرر من غير خط: نسخة مزاحة بنص المقاس بتغطي الحواف، والأصل في النص"""
    from PIL import ImageChops
    w, h = im.size
    off = ImageChops.offset(im, w // 2, h // 2)
    bw, bh = max(1, int(w * blend)), max(1, int(h * blend))
    mx = [min(1.0, min(x, w - 1 - x) / bw) for x in range(w)]
    my = [min(1.0, min(y, h - 1 - y) / bh) for y in range(h)]
    mask = Image.new('L', (w, h))
    mask.putdata([int(255 * (a * b) ** 0.7) for b in my for a in mx])
    return Image.composite(im, off, mask)


def flatten(im, radius):
    """بيشيل تدرّج الإضاءة الكبير في الصورة (ضل/شمس/بُعد الكاميرا) ويسيب التفاصيل: الخامة لما تتكرر
    ماتطلعش مربعات فاتحة وغامقة (كانت باينة زي رقعة شطرنج على سطح الكوبري)"""
    import numpy as np
    a = np.asarray(im).astype(np.float32)
    low = np.asarray(im.filter(ImageFilter.GaussianBlur(radius))).astype(np.float32)
    out = a / np.maximum(low, 1) * low.reshape(-1, 3).mean(0)
    return Image.fromarray(np.clip(out, 0, 255).astype(np.uint8))


def ground(im, target, sat):
    """أرضيات (أسفلت/رصيف): من غير autocontrast (بيطلّع ألوان غريبة من التشويش) — تنعيم خفيف + تشبع أقل + إضاءة"""
    from PIL import ImageEnhance
    im = flatten(im, im.size[0] / 10)
    im = im.filter(ImageFilter.GaussianBlur(0.8))
    im = ImageEnhance.Color(im).enhance(sat)
    m = sum(ImageStat.Stat(im.convert('L')).mean) / 255
    return ImageEnhance.Brightness(im).enhance(target / max(m, 0.05))


def mean_rgb(im):
    return [round(c / 255, 3) for c in ImageStat.Stat(im).mean[:3]]


def main():
    src = json.load(open(os.path.join(HERE, 'sources.json'), encoding='utf-8'))
    photos = {k: Image.open(fetch(k, m)).convert('RGB') for k, m in src['photos'].items()}
    atlas = Image.new('RGB', (W, H), (128, 128, 128))
    out = {'size': [W, H], 'cell': CELL, 'rows': {}, 'asphalt': list(ASPH), 'sidewalk': list(SIDE), 'sources': []}
    used = set()

    def put_row(name, row, sat, target):
        cells = []
        for i, c in enumerate(src[name]):
            im = level(rectify(photos[c['src']], c['q'], CELL, CELL), target, sat)
            atlas.paste(im, (i * CELL, row * CELL))
            cells.append({'win': c.get('win', [0, 0, 0, 0]), 'mean': mean_rgb(im)})
            used.add(c['src'])
        out['rows'][name] = {'y': row * CELL, 'cells': cells}

    put_row('brick', 0, 1.0, 0.42)
    put_row('plaster', 1, 0.75, 0.55)   # المحارة: تشبع أقل عشان لون العمارة (tint) يبان عليها
    put_row('shop', 2, 1.05, 0.42)

    # لون الحيطة الصمّا (اللي بين الشبابيك وعلى الجناب) من حتة طوب/محارة صافية في الصور — linear عشان الـ shader
    lin = lambda rgb: [round((c) ** 2.2, 3) for c in rgb]
    def region(row, i, box):
        x0, y0, x1, y1 = box
        return atlas.crop((int((i + x0) * CELL), int(row * CELL + y0 * CELL), int((i + x1) * CELL), int(row * CELL + y1 * CELL)))
    out['wall'] = {'brick': lin(mean_rgb(region(0, 1, (0.0, 0.0, 0.22, 1.0)))),
                   'plaster': lin(mean_rgb(region(1, 2, (0.05, 0.0, 0.95, 0.2))))}

    # الأسفلت: شريط أرضي بيتعدل لمربع (~7م) ويتعمل tileable
    a = src['asphalt']
    strip = ground(rectify(photos[a['src']], a['q'], ASPH[2], ASPH[2] // 2), 0.42, 0.45)
    sq = Image.new('RGB', (ASPH[2], ASPH[2]))
    sq.paste(strip, (0, 0)); sq.paste(ImageOps.flip(ImageOps.mirror(strip)), (0, ASPH[2] // 2))
    sq = tileable(sq)
    atlas.paste(sq, (ASPH[0], ASPH[1]))
    out['asphaltMean'] = mean_rgb(sq)
    used.add(a['src'])

    s = src['sidewalk']
    pav = ground(rectify(photos[s['src']], s['q'], SIDE[2], SIDE[2]), 0.6, 0.7)
    pav = tileable(pav)
    atlas.paste(pav, (SIDE[0], SIDE[1]))
    out['sidewalkMean'] = mean_rgb(pav)
    used.add(s['src'])

    for k in sorted(used):
        m = src['photos'][k]
        out['sources'].append({'title': m['file'].replace('File:', ''), 'author': m['author'], 'license': m['license'], 'url': m['url']})

    dst = os.path.join(ROOT, 'public', 'textures')
    os.makedirs(dst, exist_ok=True)
    atlas.save(os.path.join(dst, 'shibin-photo-atlas.jpg'), quality=80, optimize=True, progressive=True)
    json.dump(out, open(os.path.join(ROOT, 'src', 'render', 'photoAtlas.json'), 'w', encoding='utf-8'), ensure_ascii=False, indent=1)
    print('atlas', os.path.getsize(os.path.join(dst, 'shibin-photo-atlas.jpg')) // 1024, 'KB,', len(out['sources']), 'sources')
    if '--sheet' in sys.argv:
        atlas.save(sys.argv[sys.argv.index('--sheet') + 1], quality=85)


if __name__ == '__main__':
    main()
