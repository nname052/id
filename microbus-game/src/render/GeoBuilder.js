import * as THREE from 'three';

// أداة لتجميع هندسة كتيرة (مباني، أرصفة، ...) في Mesh واحد لكل خامة
// ده بيقلل الـ draw calls جدًا ويحسن الأداء.
const _v = new THREE.Vector3();
const _n = new THREE.Vector3();
const _a = new THREE.Vector3(), _b = new THREE.Vector3(), _c = new THREE.Vector3();

export class GeoBuilder {
  constructor() {
    this.pos = []; this.nrm = []; this.uv = []; this.col = [];
    this.m = new THREE.Matrix4();
    this.nm = new THREE.Matrix3();
    this.color = [1, 1, 1];
  }

  setTransform(m) { this.m.copy(m); this.nm.getNormalMatrix(m); return this; }
  identity() { this.m.identity(); this.nm.identity(); return this; }
  setColor(c) { this.color = Array.isArray(c) ? c : [c.r, c.g, c.b]; return this; }

  _push(p, n, uv) {
    _v.set(p[0], p[1], p[2]).applyMatrix4(this.m);
    this.pos.push(_v.x, _v.y, _v.z);
    this.nrm.push(n.x, n.y, n.z);
    this.uv.push(uv[0], uv[1]);
    this.col.push(this.color[0], this.color[1], this.color[2]);
  }

  /** مربع بأربع نقاط (عكس عقارب الساعة من ناحية الوش) */
  quad(a, b, c, d, uvs = [[0, 0], [1, 0], [1, 1], [0, 1]]) {
    _a.set(...a); _b.set(...b); _c.set(...c);
    _n.subVectors(_b, _a).cross(_c.sub(_a)).normalize().applyMatrix3(this.nm).normalize();
    this._push(a, _n, uvs[0]); this._push(b, _n, uvs[1]); this._push(c, _n, uvs[2]);
    this._push(a, _n, uvs[0]); this._push(c, _n, uvs[2]); this._push(d, _n, uvs[3]);
  }

  /** صندوق محاذي للمحاور. uvScale: كام متر لكل وحدة UV (للخامات المتكررة) */
  box(x0, y0, z0, x1, y1, z1, { uvScale = 1, skip = '' } = {}) {
    const u = (v) => v / uvScale;
    const W = x1 - x0, H = y1 - y0, D = z1 - z0;
    if (!skip.includes('pz')) this.quad([x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1], [[0, 0], [u(W), 0], [u(W), u(H)], [0, u(H)]]);
    if (!skip.includes('nz')) this.quad([x1, y0, z0], [x0, y0, z0], [x0, y1, z0], [x1, y1, z0], [[0, 0], [u(W), 0], [u(W), u(H)], [0, u(H)]]);
    if (!skip.includes('px')) this.quad([x1, y0, z1], [x1, y0, z0], [x1, y1, z0], [x1, y1, z1], [[0, 0], [u(D), 0], [u(D), u(H)], [0, u(H)]]);
    if (!skip.includes('nx')) this.quad([x0, y0, z0], [x0, y0, z1], [x0, y1, z1], [x0, y1, z0], [[0, 0], [u(D), 0], [u(D), u(H)], [0, u(H)]]);
    if (!skip.includes('py')) this.quad([x0, y1, z1], [x1, y1, z1], [x1, y1, z0], [x0, y1, z0], [[u(x0), u(z1)], [u(x1), u(z1)], [u(x1), u(z0)], [u(x0), u(z0)]]);
    if (!skip.includes('ny')) this.quad([x0, y0, z0], [x1, y0, z0], [x1, y0, z1], [x0, y0, z1], [[0, 0], [u(W), 0], [u(W), u(D)], [0, u(D)]]);
  }

  /** إضافة BufferGeometry جاهزة (Cylinder, Sphere ...) مع تحويل */
  addGeometry(geom, matrix) {
    const g = geom.index ? geom.toNonIndexed() : geom;
    const p = g.attributes.position, n = g.attributes.normal, t = g.attributes.uv, c = g.attributes.color;
    const m = new THREE.Matrix4().multiplyMatrices(this.m, matrix || new THREE.Matrix4());
    const nm = new THREE.Matrix3().getNormalMatrix(m);
    for (let i = 0; i < p.count; i++) {
      _v.fromBufferAttribute(p, i).applyMatrix4(m);
      this.pos.push(_v.x, _v.y, _v.z);
      _n.fromBufferAttribute(n, i).applyMatrix3(nm).normalize();
      this.nrm.push(_n.x, _n.y, _n.z);
      this.uv.push(t ? t.getX(i) : 0, t ? t.getY(i) : 0);
      if (c) this.col.push(this.color[0] * c.getX(i), this.color[1] * c.getY(i), this.color[2] * c.getZ(i));
      else this.col.push(this.color[0], this.color[1], this.color[2]);
    }
    if (g !== geom) g.dispose();
  }

  get empty() { return this.pos.length === 0; }

  build() {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.nrm, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(this.uv, 2));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.col, 3));
    g.computeBoundingSphere();
    g.computeBoundingBox();
    return g;
  }
}

/** مجموعة builders حسب اسم الخامة */
export class Buckets {
  constructor() { this.map = new Map(); }
  get(name) {
    if (!this.map.has(name)) this.map.set(name, new GeoBuilder());
    return this.map.get(name);
  }
  /** يبني Meshes ويحطها في group. materials: { name: Material } */
  toMeshes(materials, group, { castShadow = true, receiveShadow = true, chunk = false } = {}) {
    for (const [name, b] of this.map) {
      if (b.empty) continue;
      const mat = materials[name];
      if (!mat) { console.warn('missing material', name); continue; }
      const mesh = new THREE.Mesh(b.build(), mat);
      mesh.name = name;
      mesh.castShadow = castShadow && mat.userData.castShadow !== false;
      mesh.receiveShadow = receiveShadow;
      group.add(mesh);
    }
  }
}
