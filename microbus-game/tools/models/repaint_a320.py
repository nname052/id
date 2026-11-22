"""طلاء الـ A320 من جديد (طيارة اللعبة): الموديل الأصلي (CC BY 4.0) عليه ألوان وشعار شركة طيران حقيقية
(Aer Lingus) ورقم تسجيل حقيقي (EI-DVE). اللعبة مش بتقلّد شركة حقيقية: بنمسح الاسم والشعار والتسجيل
ونلوّن طلاء خيالي محايد (جسم أبيض، خط كحلي ودهبي، ديل كحلي) — من غير أي كلام أو شعار.
  python3 tools/models/repaint_a320.py <in.glb> <out.glb>
"""
import io, json, struct, sys
import numpy as np
from PIL import Image

src, dst = sys.argv[1], sys.argv[2]
b = open(src, 'rb').read()
jl = struct.unpack('<I', b[12:16])[0]
J = json.loads(b[20:20 + jl])
binoff = 20 + jl + 8
views = J['bufferViews']

def img(i):
    bv = views[J['images'][i]['bufferView']]; o = binoff + bv.get('byteOffset', 0)
    return Image.open(io.BytesIO(b[o:o + bv['byteLength']])).convert('RGB')

WHITE = np.array([236, 236, 232]); NAVY = np.array([24, 42, 92]); GOLD = np.array([206, 164, 72]); GREY = np.array([150, 150, 150])
new = {}

# 0: الجسم — الأخضر الغامق (الجسم + الاسم الكريمي عليه) → أبيض، الشريط الأخضر الفاتح → كحلي، الخط الأزرق → دهبي
a = np.asarray(img(0)).astype(int); r, g, bl = a[..., 0], a[..., 1], a[..., 2]
teal = (g > r + 40) & (bl > r + 30) & (g < 140)
light = (g > r + 60) & (g > bl + 25) & (g >= 140)
blue = (bl > g + 25) & (bl > r + 60)
a[teal] = WHITE; a[light] = NAVY; a[blue] = GOLD
# الاسم (كريمي) كان فوق الأخضر: أي بكسل فاتح جوه حزام الاسم → أبيض
band = np.zeros(a.shape[:2], bool); band[214:406, 150:330] = True
a[band & (a.sum(-1) > 240)] = WHITE
# رقم التسجيل + العلم + أسامي الطيارة + "AIRBUS" الصغيرة → لون الجسم
for x0, y0, x1, y1 in [(670, 150, 790, 185), (670, 428, 790, 460), (30, 150, 125, 180), (30, 432, 125, 462), (160, 155, 240, 180), (160, 432, 240, 458)]:
    a[y0:y1, x0:x1] = WHITE
new[0] = a

# 1: الديل — كله كحلي (الأخضر + الشعار + الحروف)
a = np.asarray(img(1)).astype(int); r, g, bl = a[..., 0], a[..., 1], a[..., 2]
dark_lines = (r < 60) & (g < 60) & (bl < 60)
a[~dark_lines] = NAVY
new[1] = a

# 3 + 17: الجناح — رقم التسجيل
for i, box in [(3, (430, 580, 660, 720)), (17, (430, 300, 660, 430))]:
    a = np.asarray(img(i)).astype(int); x0, y0, x1, y1 = box
    ref = np.median(a[y0:y1, x0:x1].reshape(-1, 3), axis=0)
    blk = a[y0:y1, x0:x1]; m = blk.sum(-1) < ref.sum() - 60; blk[m] = ref; new[i] = a

# 5 + 13: الشعار الصغير (نفلة) والنقط الخضرا
for i in (5, 13):
    a = np.asarray(img(i)).astype(int); r, g, bl = a[..., 0], a[..., 1], a[..., 2]
    a[(g > r + 15) & (g > bl + 5)] = GREY; new[i] = a

# إعادة بناء الـ BIN chunk
blobs = {}
for i, arr in new.items():
    out = io.BytesIO(); Image.fromarray(arr.clip(0, 255).astype('uint8')).save(out, 'JPEG', quality=90)
    blobs[J['images'][i]['bufferView']] = out.getvalue()
binbuf = bytearray()
for k, bv in enumerate(views):
    o = binoff + bv.get('byteOffset', 0)
    data = blobs.get(k, b[o:o + bv['byteLength']])
    while len(binbuf) % 4: binbuf.append(0)
    bv['byteOffset'] = len(binbuf); bv['byteLength'] = len(data); binbuf += data
while len(binbuf) % 4: binbuf.append(0)
J['buffers'][0]['byteLength'] = len(binbuf)
J['asset'].setdefault('extras', {})['note'] = 'Repainted for the game: original airline name, logo and registration removed (fictional neutral livery).'
js = json.dumps(J).encode()
while len(js) % 4: js += b' '
out = struct.pack('<III', 0x46546C67, 2, 12 + 8 + len(js) + 8 + len(binbuf)) + struct.pack('<II', len(js), 0x4E4F534A) + js + struct.pack('<II', len(binbuf), 0x004E4942) + bytes(binbuf)
open(dst, 'wb').write(out)
print('repainted', dst, len(out))
