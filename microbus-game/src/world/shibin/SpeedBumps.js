// =====================================================================
//  المطبات: من OSM (traffic_calming) + مطب قدام المدارس/المستشفيات (مستنتج، متعلّم في البيانات)
//  مش رسمة على الأسفلت: ارتفاعها داخل في ارتفاع الأرض (world.height) → العجل بيطلع عليها والمساعدين بيشتغلوا
//  والكاميرا بتتهز على قد السرعة. العربيات التانية بتهدّي قبلها.
//  الأنواع: 0 مطب مصري عادي (قصير وعالي) · 1 مطب عريض/مطب مسطّح (hump/table) · 2 شريط اهتزاز (خطوط رفيعة)
// =====================================================================
import * as THREE from 'three';

// [طول المطب على اتجاه الشارع (م)، الارتفاع (م)، طول الجزء المسطّح فوق]
const SHAPE = [[1.5, 0.095, 0], [4.2, 0.085, 1.6], [0.32, 0.022, 0]];
const STRIPS = [-2.4, -1.6, -0.8, 0, 0.8, 1.6, 2.4]; // شريط الاهتزاز: 7 خطوط
const CELL = 16;

function profile(kind, a) {
  const [L, H, top] = SHAPE[kind], h = L / 2;
  if (kind === 2) {
    for (const o of STRIPS) { const u = Math.abs(a - o); if (u < h) return H * Math.cos((u / h) * Math.PI / 2) ** 2; }
    return 0;
  }
  const u = Math.abs(a); if (u >= h) return 0;
  if (u <= top / 2) return H;
  const t = (u - top / 2) / (h - top / 2);
  return H * Math.cos(t * Math.PI / 2) ** 2; // جانبه ناعم (مش عتبة) — العجلة بتطلع عليه
}

export class SpeedBumps {
  constructor(W, list) {
    this.list = [];
    this.grid = new Map();
    for (const r of list || []) {
      const [x, z, dx, dz, hw, kind, src, ei] = r;
      const b = { x, z, dx, dz, hw: hw + 0.25, kind, src, reach: (kind === 2 ? 3 : SHAPE[kind][0] / 2) + 0.05 };
      // المكان على الشارع (للعربيات اللي ماشية عليه): أقرب نقطة على الوصلة اللي اتبنت من نفس الطريق
      let best = null, bd = 9;
      for (const e of W.graph.edges) {
        if (e.src !== ei) continue;
        for (let i = 1; i < e.pts.length; i++) {
          const p = e.pts[i - 1], q = e.pts[i], ex = q.x - p.x, ez = q.z - p.z, l2 = ex * ex + ez * ez || 1e-9;
          const t = Math.max(0, Math.min(1, ((x - p.x) * ex + (z - p.z) * ez) / l2));
          const d = Math.hypot(x - p.x - ex * t, z - p.z - ez * t);
          if (d < bd) { bd = d; best = { e, s: e.cum[i - 1] + t * Math.sqrt(l2) }; }
        }
      }
      if (best) { (best.e.bumps ||= []).push(best.s); b.edge = best.e; }
      this.list.push(b);
      const R = Math.max(b.hw, b.reach);
      for (let i = Math.floor((x - R) / CELL); i <= Math.floor((x + R) / CELL); i++)
        for (let j = Math.floor((z - R) / CELL); j <= Math.floor((z + R) / CELL); j++) {
          const k = i * 100003 + j; let a = this.grid.get(k); if (!a) this.grid.set(k, (a = [])); a.push(b);
        }
    }
    this.mesh = this.list.length ? this._mesh() : null;
  }

  /** ارتفاع المطب فوق الأسفلت عند (x,z) */
  h(x, z) {
    const a = this.grid.get(Math.floor(x / CELL) * 100003 + Math.floor(z / CELL));
    if (!a) return 0;
    let y = 0;
    for (const b of a) {
      const rx = x - b.x, rz = z - b.z, al = rx * b.dx + rz * b.dz;
      if (Math.abs(al) > b.reach) continue;
      const ac = Math.abs(-rx * b.dz + rz * b.dx);
      if (ac > b.hw) continue;
      const edge = Math.min(1, (b.hw - ac) / 0.3); // طرفه بينزل للأسفلت (مش حيطة على الجنب)
      y = Math.max(y, profile(b.kind, al) * edge);
    }
    return y;
  }

  /** شكل المطبات كلها في mesh واحد (ألوان على الرءوس: أصفر/أسود، أبيض، أو أسفلت من غير دهان) */
  _mesh() {
    const pos = [], col = [], idx = [];
    const asphalt = new THREE.Color(0x3b3b3c), yellow = new THREE.Color(0xd9b21c), black = new THREE.Color(0x1d1d1d), white = new THREE.Color(0xd8d8d2);
    const c = new THREE.Color();
    let n = 0;
    for (const b of this.list) {
      // الدهان: نص المطبات العادية متدهنة أصفر وأسود (زي اللي في الشوارع)، شريط الاهتزاز أبيض، والباقي أسفلت
      const seed = Math.abs(Math.round(b.x * 7 + b.z * 13)) % 3, paint = b.kind === 2 ? 'w' : seed === 0 ? 'n' : seed === 1 ? 'y' : 'w';
      const NA = b.kind === 2 ? 64 : b.kind === 1 ? 14 : 10, NC = Math.max(4, Math.round(b.hw * 2 / 0.5));
      const a0 = -b.reach, a1 = b.reach;
      for (let i = 0; i <= NA; i++) {
        const al = a0 + (a1 - a0) * (i / NA);
        for (let j = 0; j <= NC; j++) {
          const ac = -b.hw + 2 * b.hw * (j / NC);
          const x = b.x + b.dx * al - b.dz * ac, z = b.z + b.dz * al + b.dx * ac;
          const y = 0.012 + profile(b.kind, al) * Math.min(1, (b.hw - Math.abs(ac)) / 0.3);
          pos.push(x, y, z);
          const raised = profile(b.kind, al) > 0.01;
          if (paint === 'y' && raised) c.copy(Math.floor((ac + b.hw) / 0.6) % 2 ? black : yellow);
          else if (paint === 'w' && raised) c.copy(b.kind === 2 ? white : Math.floor((ac + b.hw) / 0.6) % 2 ? asphalt : white);
          else c.copy(asphalt);
          col.push(c.r, c.g, c.b);
        }
      }
      for (let i = 0; i < NA; i++) for (let j = 0; j < NC; j++) {
        const a = n + i * (NC + 1) + j, d = a + NC + 1;
        idx.push(a, a + 1, d, a + 1, d + 1, d);
      }
      n += (NA + 1) * (NC + 1);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    g.setIndex(idx);
    g.computeVertexNormals();
    // (لو اللفّة طلعت معكوسة الوش بيبقى لتحت: DoubleSide أرخص من إننا نحسبها لكل مطب)
    const m = new THREE.Mesh(g, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.92, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 }));
    m.name = 'speed-bumps'; m.receiveShadow = true; m.renderOrder = 1;
    m.matrixAutoUpdate = false; m.updateMatrix();
    return m;
  }
}
