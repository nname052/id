// تصادم صناديق موجّهة (OBB) في المستوى الأفقي باستخدام Separating Axis Theorem
// box = { cx, cz, hx (نص العرض), hz (نص الطول), angle (yaw) }

function axes(b) {
  const c = Math.cos(b.angle), s = Math.sin(b.angle);
  return { rx: c, rz: -s, fx: -s, fz: -c };
}

export function boxCorners(b) {
  const a = axes(b);
  const out = [];
  for (const [sx, sf] of [[1, 1], [1, -1], [-1, -1], [-1, 1]]) {
    out.push([b.cx + a.rx * b.hx * sx + a.fx * b.hz * sf, b.cz + a.rz * b.hx * sx + a.fz * b.hz * sf]);
  }
  return out;
}

function inside(b, a, x, z) {
  const dx = x - b.cx, dz = z - b.cz;
  return Math.abs(dx * a.rx + dz * a.rz) <= b.hx + 1e-4 && Math.abs(dx * a.fx + dz * a.fz) <= b.hz + 1e-4;
}

export function boundingRadius(b) { return Math.hypot(b.hx, b.hz); }

// نتيجة واحدة بيتعاد استخدامها (اللي بينادي بياخد القيم على طول) → مفيش garbage جوه حلقة الفيزيا
const _hit = { nx: 0, nz: 0, depth: 0, px: 0, pz: 0 };
const _ax = new Float64Array(8);

/** يرجع null أو { nx, nz (من A إلى B), depth, px, pz (نقطة التلامس) } — الـ object نفسه بيتعاد استخدامه */
export function obbOverlap(A, B) {
  const dxC = B.cx - A.cx, dzC = B.cz - A.cz;
  const rr = Math.hypot(A.hx, A.hz) + Math.hypot(B.hx, B.hz);
  if (dxC * dxC + dzC * dzC > rr * rr) return null;
  const ca = Math.cos(A.angle), sa = Math.sin(A.angle), cb = Math.cos(B.angle), sb = Math.sin(B.angle);
  // محاور A و B: يمين (c, -s) وقدام (-s, -c)
  const arx = ca, arz = -sa, afx = -sa, afz = -ca, brx = cb, brz = -sb, bfx = -sb, bfz = -cb;
  _ax[0] = arx; _ax[1] = arz; _ax[2] = afx; _ax[3] = afz; _ax[4] = brx; _ax[5] = brz; _ax[6] = bfx; _ax[7] = bfz;
  let best = Infinity, bnx = 0, bnz = 0;
  for (let k = 0; k < 8; k += 2) {
    const nx = _ax[k], nz = _ax[k + 1];
    const ra = A.hx * Math.abs(arx * nx + arz * nz) + A.hz * Math.abs(afx * nx + afz * nz);
    const rb = B.hx * Math.abs(brx * nx + brz * nz) + B.hz * Math.abs(bfx * nx + bfz * nz);
    const d = dxC * nx + dzC * nz;
    const o = ra + rb - Math.abs(d);
    if (o <= 0) return null;
    if (o < best) { best = o; const sg = d >= 0 ? 1 : -1; bnx = nx * sg; bnz = nz * sg; }
  }
  // نقطة التلامس: متوسط الأركان اللي داخل الصندوق التاني
  let px = 0, pz = 0, n = 0;
  for (let i = 0; i < 4; i++) {
    const sx = i < 2 ? 1 : -1, sf = i === 0 || i === 3 ? 1 : -1;
    const x = A.cx + arx * A.hx * sx + afx * A.hz * sf, z = A.cz + arz * A.hx * sx + afz * A.hz * sf;
    const dx = x - B.cx, dz = z - B.cz;
    if (Math.abs(dx * brx + dz * brz) <= B.hx + 1e-4 && Math.abs(dx * bfx + dz * bfz) <= B.hz + 1e-4) { px += x; pz += z; n++; }
    const x2 = B.cx + brx * B.hx * sx + bfx * B.hz * sf, z2 = B.cz + brz * B.hx * sx + bfz * B.hz * sf;
    const ex = x2 - A.cx, ez = z2 - A.cz;
    if (Math.abs(ex * arx + ez * arz) <= A.hx + 1e-4 && Math.abs(ex * afx + ez * afz) <= A.hz + 1e-4) { px += x2; pz += z2; n++; }
  }
  if (n) { px /= n; pz /= n; } else { px = (A.cx + B.cx) / 2; pz = (A.cz + B.cz) / 2; }
  _hit.nx = bnx; _hit.nz = bnz; _hit.depth = best; _hit.px = px; _hit.pz = pz;
  return _hit;
}
