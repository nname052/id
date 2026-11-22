"""الهليكوبتر (heli_206): الموديل الأصلي 3 قطع ملزوقة (الريش جزء من الجسم). بنفصل الريشة الكبيرة (rotor_main)
والريشة الصغيرة اللي في الديل (rotor_tail) لقطع لوحدها عشان اللعبة تلفّهم. الإحداثيات هنا = إحداثيات الملف
(z لفوق، x لورا، الصاري عند x≈45، الديل عند x≈470 جنب y≈14).
  python3 tools/models/split_heli.py <in.glb> <out.glb>
"""
import json, struct, sys
import numpy as np

src, dst = sys.argv[1], sys.argv[2]
b = open(src, 'rb').read()
jl = struct.unpack('<I', b[12:16])[0]
J = json.loads(b[20:20 + jl]); B = 20 + jl + 8
binbuf = bytearray(b[B:B + struct.unpack('<I', b[20 + jl:24 + jl])[0]])

def acc(i):
    a = J['accessors'][i]; bv = J['bufferViews'][a['bufferView']]; o = bv.get('byteOffset', 0) + a.get('byteOffset', 0)
    dt = {5126: np.float32, 5125: np.uint32, 5123: np.uint16}[a['componentType']]; c = {'SCALAR': 1, 'VEC3': 3, 'VEC2': 2}[a['type']]
    arr = np.frombuffer(bytes(binbuf), dt, a['count'] * c, o)
    return arr.reshape(-1, c) if c > 1 else arr

def add_indices(idx):
    idx = idx.astype(np.uint32).ravel()
    while len(binbuf) % 4: binbuf.append(0)
    off = len(binbuf); binbuf.extend(idx.tobytes())
    J['bufferViews'].append({'buffer': 0, 'byteOffset': off, 'byteLength': idx.nbytes, 'target': 34963})
    J['accessors'].append({'bufferView': len(J['bufferViews']) - 1, 'componentType': 5125, 'count': int(idx.size), 'type': 'SCALAR', 'min': [int(idx.min())], 'max': [int(idx.max())]})
    return len(J['accessors']) - 1

parent = next(i for i, n in enumerate(J['nodes']) if 'Copter' in (n.get('name') or ''))
groups = {'rotor_main': [], 'rotor_tail': []}
counts = {}
for mi, m in enumerate(J['meshes']):
    newprims = []
    for p in m['primitives']:
        v = acc(p['attributes']['POSITION']); tri = acc(p['indices']).reshape(-1, 3); T = v[tri]
        x, y, z = T[..., 0], T[..., 1], T[..., 2]
        main = (z.min(1) >= 176) & (x.max(1) < 420)
        tail = (x.min(1) > 425) & (y.min(1) > 10) & (z.min(1) > 85)
        body = ~(main | tail)
        counts[mi] = (int(body.sum()), int(main.sum()), int(tail.sum()))
        for key, mask in (('rotor_main', main), ('rotor_tail', tail)):
            if mask.any(): groups[key].append({**p, 'indices': add_indices(tri[mask])})
        newprims.append({**p, 'indices': add_indices(tri[body])})
    m['primitives'] = newprims
for key, prims in groups.items():
    J['meshes'].append({'name': key, 'primitives': prims})
    J['nodes'].append({'name': key, 'mesh': len(J['meshes']) - 1})
    J['nodes'][parent].setdefault('children', []).append(len(J['nodes']) - 1)
print('body/main/tail tris per mesh:', counts)
while len(binbuf) % 4: binbuf.append(0)
J['buffers'][0]['byteLength'] = len(binbuf)
js = json.dumps(J).encode()
while len(js) % 4: js += b' '
open(dst, 'wb').write(struct.pack('<III', 0x46546C67, 2, 28 + len(js) + len(binbuf)) + struct.pack('<II', len(js), 0x4E4F534A) + js + struct.pack('<II', len(binbuf), 0x004E4942) + bytes(binbuf))
