// =====================================================================
//  شبكة الطرق للـ GPS: كل الطرق (الشارع الرئيسي + الدائري + الشوارع العرضية + الطرق الفرعية وشوارع شبين)
//  بتتحول لجراف: العُقد = التقاطعات وأطراف الطرق، والوصلات = حتت الطريق بينهم (بالنقط عشان نرسمها).
//  بيتبني مرة واحدة وقت التحميل (من غير Three.js). البحث: Dijkstra على ~50 عقدة → أقل من مللي ثانية.
// =====================================================================
import { ROUTE, ZONE_LABEL } from '../world/Route.js';
import { ROADS } from '../world/RoadNetwork.js';
import { ROAD, CROSSINGS } from '../world/layout.js';

const SNAP = 16;      // طرف طريق قريب من طريق تاني بالمسافة دي = متوصلين
const MERGE = 4;      // عقدتين أقرب من كده = عقدة واحدة

function polyline(id, name, pts, closed = false) {
  const cum = [0];
  for (let i = 1; i < pts.length; i++) cum.push(cum[i - 1] + Math.hypot(pts[i].x - pts[i - 1].x, pts[i].z - pts[i - 1].z));
  const L = cum[cum.length - 1] + (closed ? Math.hypot(pts[0].x - pts[pts.length - 1].x, pts[0].z - pts[pts.length - 1].z) : 0);
  return { id, name, pts, cum, closed, length: L, splits: [] };
}

/** أقرب نقطة على خط: { i (بداية القطعة), t, s, x, z, d } */
function projectOn(line, x, z) {
  const P = line.pts, n = P.length, segs = line.closed ? n : n - 1;
  let best = null;
  for (let i = 0; i < segs; i++) {
    const a = P[i], b = P[(i + 1) % n];
    const ex = b.x - a.x, ez = b.z - a.z, l2 = ex * ex + ez * ez || 1e-9;
    let t = ((x - a.x) * ex + (z - a.z) * ez) / l2; t = Math.max(0, Math.min(1, t));
    const px = a.x + ex * t, pz = a.z + ez * t, d = Math.hypot(x - px, z - pz);
    if (!best || d < best.d) best = { i, t, x: px, z: pz, d, s: line.cum[i] + Math.sqrt(l2) * t };
  }
  return best;
}

function segIntersect(a, b, c, d) {
  const r1 = b.x - a.x, r2 = b.z - a.z, s1 = d.x - c.x, s2 = d.z - c.z;
  const den = r1 * s2 - r2 * s1;
  if (Math.abs(den) < 1e-9) return null;
  const t = ((c.x - a.x) * s2 - (c.z - a.z) * s1) / den, u = ((c.x - a.x) * r2 - (c.z - a.z) * r1) / den;
  if (t < 0 || t > 1 || u < 0 || u > 1) return null;
  return { t, u, x: a.x + r1 * t, z: a.z + r2 * t };
}

function build() {
  const lines = [];
  // 1) الحلقة الكبيرة: الشارع الرئيسي في وسط البلد (من الشمال للجنوب) وبعده الطريق الدائري لحد ما يرجع
  const loop = [];
  for (let z = ROAD.zMax; z > ROAD.zMin; z -= 2) loop.push({ x: 0, z, y: 0, name: 'الشارع الرئيسي' });
  for (const p of ROUTE.samples) loop.push({ x: p.x, z: p.z, y: p.y, name: ZONE_LABEL[p.zone] || 'الطريق الدائري' });
  lines.push(polyline('LOOP', 'الطريق الدائري', loop, true));
  // 2) الشوارع العرضية في وسط البلد (لحد أطراف الطرق الفرعية)
  for (const c of CROSSINGS) {
    const pts = [], x0 = c.xMin - 4, x1 = c.xMax + 4;
    for (let x = x0; x <= x1 + 0.01; x += 2) pts.push({ x, z: c.z, y: 0 });
    lines.push(polyline(`X${c.id}`, c.narrow ? 'شارع السوق' : 'الشارع العرضي', pts));
  }
  // 3) الطرق الفرعية وشوارع شبين
  for (const r of ROADS) lines.push(polyline(r.id, r.name, r.samples.map((p) => ({ x: p.x, z: p.z, y: p.y }))));

  const nodes = [];
  const nodeAt = (x, z) => {
    for (const n of nodes) if (Math.hypot(n.x - x, n.z - z) < MERGE) return n;
    const n = { id: nodes.length, x, z, edges: [] };
    nodes.push(n);
    return n;
  };
  const split = (line, s, node) => { if (!line.splits.some((p) => Math.abs(p.s - s) < 0.5 && p.node === node)) line.splits.push({ s, node }); };
  // تقاطعات حقيقية (خطين بيعدّوا على بعض في نفس الارتفاع)
  for (let a = 0; a < lines.length; a++) for (let b = a + 1; b < lines.length; b++) {
    const A = lines[a], B = lines[b];
    const nA = A.closed ? A.pts.length : A.pts.length - 1, nB = B.closed ? B.pts.length : B.pts.length - 1;
    for (let i = 0; i < nA; i++) {
      const p0 = A.pts[i], p1 = A.pts[(i + 1) % A.pts.length];
      const minx = Math.min(p0.x, p1.x), maxx = Math.max(p0.x, p1.x), minz = Math.min(p0.z, p1.z), maxz = Math.max(p0.z, p1.z);
      for (let j = 0; j < nB; j++) {
        const q0 = B.pts[j], q1 = B.pts[(j + 1) % B.pts.length];
        if (Math.max(q0.x, q1.x) < minx || Math.min(q0.x, q1.x) > maxx || Math.max(q0.z, q1.z) < minz || Math.min(q0.z, q1.z) > maxz) continue;
        const h = segIntersect(p0, p1, q0, q1);
        if (!h) continue;
        const yA = p0.y + (p1.y - p0.y) * h.t, yB = q0.y + (q1.y - q0.y) * h.u;
        if (Math.abs(yA - yB) > 2.5) continue; // كوبري/نفق: مش تقاطع
        const node = nodeAt(h.x, h.z);
        split(A, A.cum[i] + Math.hypot(p1.x - p0.x, p1.z - p0.z) * h.t, node);
        split(B, B.cum[j] + Math.hypot(q1.x - q0.x, q1.z - q0.z) * h.u, node);
      }
    }
  }
  // أطراف الطرق: لو قريبة من طريق تاني → وصلة قصيرة للنقطة اللي عليه، غير كده طرف مقفول
  const connectors = [];
  for (const L of lines) {
    if (L.closed) continue;
    for (const end of [0, L.pts.length - 1]) {
      const p = L.pts[end];
      let best = null;
      for (const M of lines) {
        if (M === L) continue;
        const pr = projectOn(M, p.x, p.z);
        if (pr && pr.d < SNAP && (!best || pr.d < best.pr.d)) best = { M, pr };
      }
      const endNode = nodeAt(p.x, p.z);
      split(L, end === 0 ? 0 : L.cum[end], endNode);
      if (best) {
        const node = best.pr.d < MERGE ? endNode : nodeAt(best.pr.x, best.pr.z);
        split(best.M, best.pr.s, node);
        if (node !== endNode) connectors.push([endNode, node, best.pr.d]);
      }
    }
  }
  // الوصلات: كل خط بيتقسم عند نقط التقسيم بتاعته
  const edges = [];
  const addEdge = (from, to, pts, length, line) => {
    if (from === to && length < 1) return;
    const e = { id: edges.length, from, to, pts, length, line: line.id, name: pts[Math.floor(pts.length / 2)]?.name || line.name };
    edges.push(e);
    from.edges.push(e); if (to !== from) to.edges.push(e);
  };
  const ptAt = (line, s) => {
    const P = line.pts, n = P.length;
    s = line.closed ? ((s % line.length) + line.length) % line.length : Math.max(0, Math.min(line.length, s));
    let i = 0;
    while (i < n - 1 && line.cum[i + 1] < s) i++;
    const a = P[i], b = line.closed ? P[(i + 1) % n] : P[Math.min(n - 1, i + 1)];
    const segL = Math.hypot(b.x - a.x, b.z - a.z) || 1, t = Math.max(0, Math.min(1, (s - line.cum[i]) / segL));
    return { x: a.x + (b.x - a.x) * t, z: a.z + (b.z - a.z) * t, name: a.name || line.name };
  };
  const slice = (line, s0, s1) => {
    // النقط بين s0 و s1 (بالترتيب)، مع اللف للخط المقفول
    const out = [ptAt(line, s0)];
    const n = line.pts.length;
    if (line.closed && s1 < s0) s1 += line.length;
    for (let k = 0; k < (line.closed ? 2 : 1); k++) {
      for (let i = 0; i < n; i++) {
        const s = line.cum[i] + k * line.length;
        if (s > s0 + 0.2 && s < s1 - 0.2) out.push({ x: line.pts[i].x, z: line.pts[i].z, name: line.pts[i].name || line.name });
      }
    }
    out.push(ptAt(line, s1));
    return out;
  };
  for (const L of lines) {
    const sp = L.splits.sort((a, b) => a.s - b.s);
    if (!sp.length) continue;
    for (let k = 0; k < sp.length - 1; k++) {
      const a = sp[k], b = sp[k + 1];
      if (b.s - a.s < 0.5 && a.node === b.node) continue;
      addEdge(a.node, b.node, slice(L, a.s, b.s), b.s - a.s, L);
    }
    if (L.closed) { const a = sp[sp.length - 1], b = sp[0]; addEdge(a.node, b.node, slice(L, a.s, b.s + L.length), b.s + L.length - a.s, L); }
  }
  for (const [a, b, d] of connectors) addEdge(a, b, [{ x: a.x, z: a.z, name: '' }, { x: b.x, z: b.z, name: '' }], d, { id: 'link', name: '' });
  // شبكة بحث للإسقاط السريع
  const CELL = 40, grid = new Map();
  const key = (cx, cz) => `${cx},${cz}`;
  for (const e of edges) for (let i = 0; i < e.pts.length - 1; i++) {
    const a = e.pts[i], b = e.pts[i + 1];
    const cx0 = Math.floor(Math.min(a.x, b.x) / CELL), cx1 = Math.floor(Math.max(a.x, b.x) / CELL);
    const cz0 = Math.floor(Math.min(a.z, b.z) / CELL), cz1 = Math.floor(Math.max(a.z, b.z) / CELL);
    for (let cx = cx0; cx <= cx1; cx++) for (let cz = cz0; cz <= cz1; cz++) { const k = key(cx, cz); let arr = grid.get(k); if (!arr) grid.set(k, (arr = [])); arr.push(e, i); }
  }
  for (const e of edges) { e.cum = [0]; for (let i = 1; i < e.pts.length; i++) e.cum.push(e.cum[i - 1] + Math.hypot(e.pts[i].x - e.pts[i - 1].x, e.pts[i].z - e.pts[i - 1].z)); e.length = e.cum[e.cum.length - 1]; }
  return { nodes, edges, grid, CELL, key, lines };
}

/** الشبكة الحالية (الخريطة القديمة افتراضيًا). خريطة تانية (شبين الحقيقية) بتبدّلها بـ setGraph بنفس الشكل:
 *  { nodes:[{id,x,z,edges}], edges:[{id,from,to,pts:[{x,z,name}],cum,length,name, oneway?, closed?}], grid, CELL, key } */
export let GRAPH = build();
export function setGraph(g) { GRAPH = g; }

/** طابور أولويات بسيط (binary heap) للبحث في الشبكات الكبيرة */
class Heap {
  constructor() { this.k = []; this.v = []; }
  get size() { return this.k.length; }
  push(key, val) {
    const K = this.k, V = this.v; let i = K.length; K.push(key); V.push(val);
    while (i > 0) { const p = (i - 1) >> 1; if (K[p] <= key) break; K[i] = K[p]; V[i] = V[p]; i = p; }
    K[i] = key; V[i] = val;
  }
  pop() {
    const K = this.k, V = this.v, top = V[0], lk = K.pop(), lv = V.pop(), n = K.length;
    if (n) {
      let i = 0;
      for (;;) {
        let c = 2 * i + 1; if (c >= n) break;
        if (c + 1 < n && K[c + 1] < K[c]) c++;
        if (K[c] >= lk) break;
        K[i] = K[c]; V[i] = V[c]; i = c;
      }
      K[i] = lk; V[i] = lv;
    }
    return top;
  }
}

/** أقرب نقطة على أي طريق: { e, i, t, s (من أول الوصلة), x, z, d } */
export function projectToGraph(x, z, maxR = 200) {
  const { grid, CELL, key } = GRAPH;
  let best = null;
  for (let r = 0; r <= Math.ceil(maxR / CELL); r++) {
    const cx = Math.floor(x / CELL), cz = Math.floor(z / CELL);
    for (let ox = -r; ox <= r; ox++) for (let oz = -r; oz <= r; oz++) {
      if (Math.max(Math.abs(ox), Math.abs(oz)) !== r) continue;
      const arr = grid.get(key(cx + ox, cz + oz));
      if (!arr) continue;
      for (let k = 0; k < arr.length; k += 2) {
        const e = arr[k], i = arr[k + 1];
        if (e.closed) continue;
        const a = e.pts[i], b = e.pts[i + 1];
        const ex = b.x - a.x, ez = b.z - a.z, l2 = ex * ex + ez * ez || 1e-9;
        let t = ((x - a.x) * ex + (z - a.z) * ez) / l2; t = Math.max(0, Math.min(1, t));
        const px = a.x + ex * t, pz = a.z + ez * t, d = Math.hypot(x - px, z - pz);
        if (!best || d < best.d) best = { e, i, t, x: px, z: pz, d, s: e.cum[i] + Math.sqrt(l2) * t, dx: ex / Math.sqrt(l2), dz: ez / Math.sqrt(l2) };
      }
    }
    if (best && best.d < (r + 0.5) * CELL) break; // اللي جاي أبعد أكيد
  }
  return best;
}

/** نقط وصلة من s0 لـ s1 (ممكن بالعكس) */
function edgePart(e, s0, s1) {
  const out = [];
  const at = (s) => {
    let i = 0; while (i < e.pts.length - 2 && e.cum[i + 1] < s) i++;
    const a = e.pts[i], b = e.pts[i + 1], l = (e.cum[i + 1] - e.cum[i]) || 1, t = Math.max(0, Math.min(1, (s - e.cum[i]) / l));
    return { x: a.x + (b.x - a.x) * t, z: a.z + (b.z - a.z) * t, name: a.name || e.name };
  };
  out.push(at(s0));
  if (s1 >= s0) { for (let i = 0; i < e.pts.length; i++) if (e.cum[i] > s0 + 0.2 && e.cum[i] < s1 - 0.2) out.push(e.pts[i]); }
  else { for (let i = e.pts.length - 1; i >= 0; i--) if (e.cum[i] < s0 - 0.2 && e.cum[i] > s1 + 0.2) out.push(e.pts[i]); }
  out.push(at(s1));
  return out;
}

/**
 * أقصر طريق من (x,z) [واتجاه العربية fx,fz اختياري] لـ (tx,tz).
 * بيرجّع { pts:[{x,z,name}], cum:[], length, steps:[{s, turn:'left'|'right'|'uturn', name}] } أو null
 */
export function findRoute(x, z, tx, tz, fx = 0, fz = 0) {
  const A = projectToGraph(x, z), B = projectToGraph(tx, tz);
  if (!A || !B) return null;
  const { nodes } = GRAPH;
  // تكلفة اللفة للخلف في الأول (لو الطريق عكس اتجاهك): الدائري/الرئيسي فيه جزيرة → أغلى
  const back = (dirx, dirz) => (fx || fz) && dirx * fx + dirz * fz < -0.3 ? (A.e.line === 'LOOP' ? 160 : 35) : 0;
  const dist = new Float64Array(nodes.length).fill(Infinity), prev = new Array(nodes.length).fill(null), done = new Uint8Array(nodes.length);
  // الاتجاه الواحد: على وصلة one-way مينفعش تمشي ناحية from
  const start = A.e.oneway ? [[A.e.to, A.e.length - A.s]] : [[A.e.from, A.s + back(-A.dx, -A.dz)], [A.e.to, A.e.length - A.s + back(A.dx, A.dz)]];
  const H = new Heap();
  for (const [n, c] of start) if (c < dist[n.id]) { dist[n.id] = c; prev[n.id] = { start: true }; H.push(c, n.id); }
  while (H.size) {
    const u = H.pop();
    if (done[u]) continue;
    done[u] = 1;
    const du = dist[u];
    for (const e of nodes[u].edges) {
      if (e.closed) continue;
      if (e.oneway && e.from.id !== u) continue;
      const v = e.from.id === u ? e.to : e.from;
      const nd = du + (e.cost ?? e.length);
      if (nd < dist[v.id]) { dist[v.id] = nd; prev[v.id] = { e, from: nodes[u] }; H.push(nd, v.id); }
    }
  }
  // النهاية: من طرفين الوصلة اللي فيها الوجهة
  let best = null;
  for (const [n, extra] of B.e.oneway ? [[B.e.from, B.s]] : [[B.e.from, B.s], [B.e.to, B.e.length - B.s]]) {
    const c = dist[n.id] + extra;
    if (!best || c < best.c) best = { c, n };
  }
  // نفس الوصلة: يمكن الأقصر نمشي عليها على طول
  if (A.e === B.e && !(A.e.oneway && B.s < A.s)) {
    const dir = B.s >= A.s ? 1 : -1, c = Math.abs(B.s - A.s) + back(A.dx * dir, A.dz * dir);
    if (!best || c <= best.c) return finish(edgePart(A.e, A.s, B.s), fx, fz);
  }
  if (!best || !isFinite(best.c)) return null;
  // نرجع من آخر عقدة لحد البداية
  const chain = [];
  for (let n = best.n; prev[n.id] && !prev[n.id].start; n = prev[n.id].from) chain.unshift({ e: prev[n.id].e, to: n });
  const firstNode = chain.length ? chain[0].e.from === chain[0].to ? chain[0].e.to : chain[0].e.from : best.n;
  let pts = edgePart(A.e, A.s, firstNode === A.e.from ? 0 : A.e.length);
  for (const { e, to } of chain) {
    const part = to === e.to ? edgePart(e, 0, e.length) : edgePart(e, e.length, 0);
    pts = pts.concat(part.slice(1));
  }
  const tail = edgePart(B.e, best.n === B.e.from ? 0 : B.e.length, B.s);
  pts = pts.concat(tail.slice(1));
  return finish(pts, fx, fz);
}

function finish(raw, fx = 0, fz = 0) {
  // نشيل النقط المكررة
  const pts = [raw[0]];
  for (let i = 1; i < raw.length; i++) if (Math.hypot(raw[i].x - pts[pts.length - 1].x, raw[i].z - pts[pts.length - 1].z) > 0.3) pts.push(raw[i]);
  const cum = [0];
  for (let i = 1; i < pts.length; i++) cum.push(cum[i - 1] + Math.hypot(pts[i].x - pts[i - 1].x, pts[i].z - pts[i - 1].z));
  const length = cum[cum.length - 1];
  // اللفات: نقارن الاتجاه قبل وبعد كل نقطة (على مسافة 8م عشان المنحنيات الناعمة ماتتحسبش لفة)
  const steps = [];
  const dirAt = (i, sgn) => {
    let j = i;
    do { j += sgn; } while (j + sgn >= 0 && j + sgn < pts.length && Math.abs(cum[j] - cum[i]) < 9);
    if (j < 0 || j >= pts.length) return null;
    const dx = sgn > 0 ? pts[j].x - pts[i].x : pts[i].x - pts[j].x, dz = sgn > 0 ? pts[j].z - pts[i].z : pts[i].z - pts[j].z, l = Math.hypot(dx, dz) || 1;
    return [dx / l, dz / l];
  };
  let lastS = -50;
  for (let i = 1; i < pts.length - 1; i++) {
    if (cum[i] - lastS < 25) continue;
    const a = dirAt(i, -1), b = dirAt(i, 1);
    if (!a || !b) continue;
    const cross = a[0] * b[1] - a[1] * b[0], dot = a[0] * b[0] + a[1] * b[1];
    const ang = Math.atan2(cross, dot);
    if (Math.abs(ang) < 0.6) continue;
    const turn = Math.abs(ang) > 2.6 ? 'uturn' : ang > 0 ? 'right' : 'left';
    // اسم الطريق اللي هتدخله
    const nm = pts[Math.min(pts.length - 1, i + 4)].name || '';
    steps.push({ s: cum[i], turn, name: nm, x: pts[i].x, z: pts[i].z });
    lastS = cum[i];
  }
  // الطريق بيبدأ ورا العربية: أول تعليمة "لف وارجع"
  if ((fx || fz) && pts.length > 2) {
    let j = 1; while (j < pts.length - 1 && cum[j] < 8) j++;
    const dx = pts[j].x - pts[0].x, dz = pts[j].z - pts[0].z, l = Math.hypot(dx, dz) || 1;
    if ((dx * fx + dz * fz) / l < -0.5) steps.unshift({ s: 0, turn: 'uturn', name: pts[j].name || '', x: pts[0].x, z: pts[0].z, start: true });
  }
  return { pts, cum, length, steps };
}

/** متابعة التقدم على طريق: بيرجّع { s, off, remain, next } — idx بيتحفظ في state عشان البحث يبقى قريب */
export function trackRoute(route, x, z, state) {
  const P = route.pts, n = P.length;
  const scan = (i0, i1) => {
    let best = null;
    for (let i = i0; i <= i1; i++) {
      const a = P[i], b = P[i + 1], ex = b.x - a.x, ez = b.z - a.z, l2 = ex * ex + ez * ez || 1e-9;
      let t = ((x - a.x) * ex + (z - a.z) * ez) / l2; t = Math.max(0, Math.min(1, t));
      const d = Math.hypot(x - (a.x + ex * t), z - (a.z + ez * t));
      if (!best || d < best.d) best = { i, d, s: route.cum[i] + Math.sqrt(l2) * t };
    }
    return best;
  };
  // البحث جنب آخر مكان (سريع)، ولو بعيد عنه (اترجعت للطريق/نطّيت) → بحث في الطريق كله
  let best = state.i === undefined ? scan(0, n - 2) : scan(Math.max(0, state.i - 15), Math.min(n - 2, state.i + 60));
  if (best && best.d > 30 && state.i !== undefined) { const g = scan(0, n - 2); if (g && g.d < best.d) best = g; }
  if (!best) return null;
  state.i = best.i;
  const next = route.steps.find((st) => st.s > best.s + 2 || (st.start && best.s < 6)) || null;
  return { s: best.s, off: best.d, remain: Math.max(0, route.length - best.s), next, nextDist: next ? next.s - best.s : null };
}
