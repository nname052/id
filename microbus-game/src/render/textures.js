import * as THREE from 'three';

// كل الخامات (Textures) بتتولد بالكود على Canvas عشان المشروع يشتغل من غير ملفات خارجية.
// تقدر تستبدل أي خامة بصورة حقيقية (شوف ASSETS.md).

export function rng(seed = 1) {
  let s = seed >>> 0 || 1;
  return () => {
    s ^= s << 13; s >>>= 0; s ^= s >> 17; s ^= s << 5; s >>>= 0;
    return s / 4294967296;
  };
}

export function canvas(w, h) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  c.getContext('2d', { willReadFrequently: true });
  return c;
}

/** ضوضاء قابلة للتكرار (tileable value noise + fbm) */
export function tileNoise(size, periods, rand, weights) {
  const out = new Float32Array(size * size);
  let wsum = 0;
  periods.forEach((p, k) => {
    const w = weights ? weights[k] : 1 / (k + 1);
    wsum += w;
    const grid = new Float32Array(p * p);
    for (let i = 0; i < grid.length; i++) grid[i] = rand();
    const cell = size / p;
    for (let y = 0; y < size; y++) {
      const gy = y / cell, y0 = Math.floor(gy), fy = gy - y0;
      const sy = fy * fy * (3 - 2 * fy);
      const r0 = (y0 % p) * p, r1 = ((y0 + 1) % p) * p;
      for (let x = 0; x < size; x++) {
        const gx = x / cell, x0 = Math.floor(gx), fx = gx - x0;
        const sx = fx * fx * (3 - 2 * fx);
        const a = grid[r0 + (x0 % p)], b = grid[r0 + ((x0 + 1) % p)];
        const c = grid[r1 + (x0 % p)], d = grid[r1 + ((x0 + 1) % p)];
        out[y * size + x] += w * ((a + (b - a) * sx) * (1 - sy) + (c + (d - c) * sx) * sy);
      }
    }
  });
  for (let i = 0; i < out.length; i++) out[i] /= wsum;
  return out;
}

/** تحويل خريطة ارتفاع إلى Normal map */
export function heightToNormal(height, w, h, strength = 2, wrap = true) {
  const c = canvas(w, h);
  const ctx = c.getContext('2d');
  const img = ctx.createImageData(w, h);
  // نفس الحساب بالظبط، بس لفة واحدة سريعة (من غير closure/باقي قسمة/Math.hypot لكل بكسل): ~6 مرات أسرع
  const d = img.data;
  for (let y = 0; y < h; y++) {
    const ym = y > 0 ? y - 1 : wrap ? h - 1 : 0, yp = y < h - 1 ? y + 1 : wrap ? 0 : h - 1;
    const row = y * w, rowM = ym * w, rowP = yp * w;
    for (let x = 0; x < w; x++) {
      const xm = x > 0 ? x - 1 : wrap ? w - 1 : 0, xp = x < w - 1 ? x + 1 : wrap ? 0 : w - 1;
      const dx = (height[row + xp] - height[row + xm]) * strength;
      const dy = (height[rowP + x] - height[rowM + x]) * strength;
      const inv = 1 / Math.sqrt(dx * dx + dy * dy + 1);
      const i = (row + x) * 4;
      d[i] = (-dx * inv * 0.5 + 0.5) * 255;
      d[i + 1] = (dy * inv * 0.5 + 0.5) * 255;
      d[i + 2] = inv * 255;
      d[i + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  return c;
}

/** ارتفاع من إضاءة صورة canvas */
export function canvasLuminance(c) {
  const ctx = c.getContext('2d');
  const d = ctx.getImageData(0, 0, c.width, c.height).data;
  const out = new Float32Array(c.width * c.height);
  for (let i = 0; i < out.length; i++) out[i] = (d[i * 4] * 0.3 + d[i * 4 + 1] * 0.59 + d[i * 4 + 2] * 0.11) / 255;
  return out;
}

/** يصغّر الخط لحد ما الكلام ييجي جوه العرض (اليافطات: الاسم كله باين ومش مقصوص) */
export function fitFont(ctx, text, maxW, size, family = 'Cairo', weight = 'bold') {
  ctx.font = `${weight} ${size}px "${family}", "Cairo", sans-serif`;
  while (ctx.measureText(text).width > maxW && size > 10) { size -= 2; ctx.font = `${weight} ${size}px "${family}", "Cairo", sans-serif`; }
  return size;
}

export function tex(c, { srgb = true, repeat = true, aniso = 8 } = {}) {
  const t = new THREE.CanvasTexture(c);
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  if (repeat) t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = aniso;
  t.generateMipmaps = true;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  return t;
}

function grayCanvas(values, w, h, map) {
  const c = canvas(w, h);
  const ctx = c.getContext('2d');
  const img = ctx.createImageData(w, h);
  for (let i = 0; i < w * h; i++) {
    const v = Math.max(0, Math.min(255, map(values[i], i) * 255));
    img.data[i * 4] = img.data[i * 4 + 1] = img.data[i * 4 + 2] = v;
    img.data[i * 4 + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
  return c;
}

// ============ الأسفلت ============
export function makeAsphalt(size = 1024) {
  const R = rng(7);
  const low = tileNoise(size, [4, 8], R, [1, 0.6]);
  const mid = tileNoise(size, [32, 64, 128], R, [1, 0.7, 0.5]);
  const height = new Float32Array(size * size);
  const c = canvas(size, size);
  const ctx = c.getContext('2d');
  const img = ctx.createImageData(size, size);
  const rough = new Float32Array(size * size);
  for (let i = 0; i < size * size; i++) {
    const grain = R();
    let stone = 0;
    if (grain > 0.93) stone = (grain - 0.93) / 0.07;
    const stain = Math.max(0, low[i] - 0.55) * 2.2;
    let v = 70 + mid[i] * 26 + (grain - 0.5) * 22 + stone * 55 - stain * 26;
    v = Math.max(20, Math.min(200, v));
    img.data[i * 4] = v + 3;
    img.data[i * 4 + 1] = v + 1;
    img.data[i * 4 + 2] = v - 2;
    img.data[i * 4 + 3] = 255;
    height[i] = mid[i] * 0.5 + grain * 0.35 + stone * 0.6;
    rough[i] = 0.88 + (grain - 0.5) * 0.12 - stain * 0.25 - stone * 0.1;
  }
  ctx.putImageData(img, 0, 0);
  // شروخ
  ctx.strokeStyle = 'rgba(25,25,25,0.55)';
  for (let k = 0; k < 7; k++) {
    ctx.lineWidth = 1 + R() * 1.5;
    ctx.beginPath();
    let x = R() * size, y = R() * size;
    ctx.moveTo(x, y);
    for (let j = 0; j < 14; j++) { x += (R() - 0.5) * 40; y += (R() - 0.3) * 30; ctx.lineTo(x, y); }
    ctx.stroke();
  }
  return {
    map: tex(c),
    normalMap: tex(heightToNormal(height, size, size, 3.5), { srgb: false }),
    roughnessMap: tex(grayCanvas(rough, size, size, (v) => v), { srgb: false }),
  };
}

// ============ بلاط الرصيف ============
export function makeSidewalk(size = 512) {
  const R = rng(21);
  const c = canvas(size, size);
  const ctx = c.getContext('2d');
  const n = 4, cs = size / n; // 4 بلاطات في 2 متر
  const palettes = [[150, 146, 138], [160, 150, 140], [128, 120, 112], [170, 160, 150], [146, 110, 96]];
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
    const p = palettes[Math.floor(R() * palettes.length)];
    const d = (R() - 0.5) * 20;
    ctx.fillStyle = `rgb(${p[0] + d},${p[1] + d},${p[2] + d})`;
    ctx.fillRect(x * cs, y * cs, cs, cs);
    // نقش البلاط
    ctx.strokeStyle = 'rgba(0,0,0,0.12)';
    ctx.lineWidth = 2;
    for (let k = 1; k < 4; k++) {
      ctx.beginPath(); ctx.moveTo(x * cs + (k * cs) / 4, y * cs + 4); ctx.lineTo(x * cs + (k * cs) / 4, y * cs + cs - 4); ctx.stroke();
    }
    if (R() < 0.15) { // بلاطة مكسورة
      ctx.fillStyle = 'rgba(60,55,50,0.6)';
      ctx.beginPath(); ctx.moveTo(x * cs + R() * cs, y * cs); ctx.lineTo(x * cs + cs, y * cs + R() * cs); ctx.lineTo(x * cs + cs * 0.6, y * cs + cs * 0.7); ctx.fill();
    }
  }
  const noise = tileNoise(size, [16, 64], R);
  const img = ctx.getImageData(0, 0, size, size);
  for (let i = 0; i < size * size; i++) {
    const v = (noise[i] - 0.5) * 40 + (R() - 0.5) * 18;
    img.data[i * 4] += v; img.data[i * 4 + 1] += v; img.data[i * 4 + 2] += v * 0.9;
  }
  ctx.putImageData(img, 0, 0);
  ctx.strokeStyle = 'rgba(40,36,32,0.9)';
  ctx.lineWidth = 3;
  for (let k = 0; k <= n; k++) {
    ctx.beginPath(); ctx.moveTo(k * cs, 0); ctx.lineTo(k * cs, size); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(0, k * cs); ctx.lineTo(size, k * cs); ctx.stroke();
  }
  const h = canvasLuminance(c);
  return { map: tex(c), normalMap: tex(heightToNormal(h, size, size, 4), { srgb: false }) };
}

// ============ حرف الرصيف (أبيض وأسود) ============
export function makeCurb(colors = ['#e8e4d8', '#1d1d1d']) {
  const w = 512, h = 64;
  const R = rng(5);
  const c = canvas(w, h);
  const ctx = c.getContext('2d');
  for (let i = 0; i < 2; i++) { ctx.fillStyle = colors[i]; ctx.fillRect((i * w) / 2, 0, w / 2, h); }
  const img = ctx.getImageData(0, 0, w, h);
  for (let i = 0; i < w * h; i++) {
    const y = Math.floor(i / w);
    const dirt = (R() - 0.5) * 30 - (y > h * 0.7 ? 35 * R() : 0);
    img.data[i * 4] += dirt; img.data[i * 4 + 1] += dirt; img.data[i * 4 + 2] += dirt;
  }
  ctx.putImageData(img, 0, 0);
  ctx.fillStyle = 'rgba(90,80,60,0.35)';
  for (let k = 0; k < 40; k++) ctx.fillRect(R() * w, R() * h, 4 + R() * 20, 2 + R() * 6);
  return tex(c);
}

// ============ تراب + زرع للجزيرة ============
export function makeDirt(size = 256) {
  const R = rng(9);
  const n = tileNoise(size, [8, 32, 64], R);
  const c = canvas(size, size);
  const ctx = c.getContext('2d');
  const img = ctx.createImageData(size, size);
  for (let i = 0; i < size * size; i++) {
    const g = n[i] > 0.55;
    const v = (R() - 0.5) * 20;
    img.data[i * 4] = (g ? 70 : 125) + v;
    img.data[i * 4 + 1] = (g ? 92 : 105) + v;
    img.data[i * 4 + 2] = (g ? 45 : 80) + v;
    img.data[i * 4 + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
  return tex(c);
}

// ============ حيطان بلاستر وطوب (تتكرر) ============
export function makePlasterWall(size = 512) {
  const R = rng(31);
  const n = tileNoise(size, [8, 32, 128], R, [1, 0.5, 0.3]);
  const c = canvas(size, size);
  const ctx = c.getContext('2d');
  const img = ctx.createImageData(size, size);
  for (let i = 0; i < size * size; i++) {
    const y = Math.floor(i / size);
    const streak = Math.sin((i % size) * 0.11 + n[i] * 6) > 0.92 ? 18 * (y / size) : 0;
    const v = 210 + (n[i] - 0.5) * 50 + (R() - 0.5) * 14 - streak;
    img.data[i * 4] = v; img.data[i * 4 + 1] = v; img.data[i * 4 + 2] = v; img.data[i * 4 + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
  const h = canvasLuminance(c);
  return { map: tex(c), normalMap: tex(heightToNormal(h, size, size, 1.5), { srgb: false }) };
}

function drawBricks(ctx, x0, y0, w, h, R, brickH = 10) {
  const brickW = brickH * 2.6;
  ctx.fillStyle = '#7a6a5c';
  ctx.fillRect(x0, y0, w, h);
  for (let y = y0, row = 0; y < y0 + h; y += brickH, row++) {
    for (let x = x0 - (row % 2) * brickW * 0.5; x < x0 + w; x += brickW) {
      const r = 150 + R() * 45, g = 70 + R() * 30, b = 50 + R() * 22;
      ctx.fillStyle = `rgb(${r},${g},${b})`;
      ctx.fillRect(Math.max(x0, x + 1), y + 1, Math.min(brickW - 2, x0 + w - x - 1), brickH - 2);
    }
  }
}

export function makeBrickWall(size = 512) {
  const R = rng(41);
  const c = canvas(size, size);
  const ctx = c.getContext('2d');
  drawBricks(ctx, 0, 0, size, size, R, 16);
  // عمود وكمرة خرسانة
  const img = ctx.getImageData(0, 0, size, size);
  for (let i = 0; i < size * size; i++) { const v = (R() - 0.5) * 18; img.data[i * 4] += v; img.data[i * 4 + 1] += v; img.data[i * 4 + 2] += v; }
  ctx.putImageData(img, 0, 0);
  const h = canvasLuminance(c);
  return { map: tex(c), normalMap: tex(heightToNormal(h, size, size, 3), { srgb: false }) };
}

export function makeConcrete(size = 256) {
  const R = rng(51);
  const n = tileNoise(size, [8, 32], R);
  const c = canvas(size, size);
  const ctx = c.getContext('2d');
  const img = ctx.createImageData(size, size);
  for (let i = 0; i < size * size; i++) {
    const v = 150 + (n[i] - 0.5) * 60 + (R() - 0.5) * 25;
    img.data[i * 4] = v; img.data[i * 4 + 1] = v * 0.98; img.data[i * 4 + 2] = v * 0.94; img.data[i * 4 + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
  return tex(c);
}

// ============ أطلس الشبابيك (واجهات العمارات) ============
// 8 خلايا (4×2)، كل خلية = "باكية" دور واحد
export const FACADE_CELLS = { SHUTTER_CLOSED: 0, SHUTTER_OPEN: 1, ALU: 2, GREEN_HALF: 3, BALCONY_DOOR: 4, SMALL: 5, GRILL: 6, BALCONY_DOOR2: 7 };

function drawWindow(ctx, mctx, ectx, cx, cy, cw, ch, type, R, lit) {
  const ww = cw * 0.46, wh = ch * 0.5;
  const isDoor = type === 4 || type === 7;
  const w = isDoor ? cw * 0.5 : type === 5 ? cw * 0.22 : ww;
  const h = isDoor ? ch * 0.74 : type === 5 ? ch * 0.22 : wh;
  const x = cx + (cw - w) / 2;
  const y = isDoor ? cy + ch - h - ch * 0.02 : cy + ch * 0.2;
  // برواز وعتب
  ctx.fillStyle = 'rgba(0,0,0,0.18)';
  ctx.fillRect(x - 10, y - 10, w + 20, h + 20);
  ctx.fillStyle = '#d9d2c4';
  ctx.fillRect(x - 7, y - 7, w + 14, h + 14);
  if (!isDoor) { ctx.fillStyle = '#bfb6a6'; ctx.fillRect(x - 12, y + h + 4, w + 24, 10); }
  // زجاج غامق
  const glass = (gx, gy, gw, gh) => {
    const grd = ctx.createLinearGradient(gx, gy, gx + gw, gy + gh);
    grd.addColorStop(0, '#3a4652'); grd.addColorStop(0.5, '#6b7c8a'); grd.addColorStop(1, '#2a323a');
    ctx.fillStyle = grd; ctx.fillRect(gx, gy, gw, gh);
    mctx.fillStyle = '#fff'; mctx.fillRect(gx, gy, gw, gh);
    if (lit) { ectx.fillStyle = lit; ectx.fillRect(gx, gy, gw, gh); }
  };
  const shutter = (sx, sy, sw, sh, col) => {
    ctx.fillStyle = col; ctx.fillRect(sx, sy, sw, sh);
    ctx.fillStyle = 'rgba(0,0,0,0.28)';
    for (let k = sy + 4; k < sy + sh; k += 7) ctx.fillRect(sx + 3, k, sw - 6, 2.5);
    ctx.strokeStyle = 'rgba(0,0,0,0.5)'; ctx.lineWidth = 2; ctx.strokeRect(sx + 1, sy + 1, sw - 2, sh - 2);
  };
  const browns = ['#6b4a2e', '#7a5634', '#5a3d27', '#8a6a48'];
  switch (type) {
    case 0: shutter(x, y, w / 2, h, browns[Math.floor(R() * 4)]); shutter(x + w / 2, y, w / 2, h, browns[Math.floor(R() * 4)]); break;
    case 1: glass(x, y, w, h); ctx.fillStyle = '#c9b48a'; ctx.fillRect(x + w * 0.1, y, w * 0.25, h); // ستارة
      shutter(x - w * 0.42, y, w * 0.38, h, '#6b4a2e'); shutter(x + w + w * 0.04, y, w * 0.38, h, '#6b4a2e'); break;
    case 2: glass(x, y, w, h); ctx.strokeStyle = '#b8bcc0'; ctx.lineWidth = 6; ctx.strokeRect(x, y, w, h);
      ctx.beginPath(); ctx.moveTo(x + w / 2, y); ctx.lineTo(x + w / 2, y + h); ctx.stroke(); break;
    case 3: glass(x, y, w, h); shutter(x, y, w / 2, h, '#3f6b4a'); shutter(x + w * 0.5, y, w / 2, h * 0.5, '#3f6b4a'); break;
    case 4: glass(x, y, w, h); shutter(x, y, w / 2, h, browns[1]); ctx.fillStyle = '#d8cfb8'; ctx.fillRect(x + w * 0.55, y, w * 0.3, h); break;
    case 5: glass(x, y, w, h); ctx.strokeStyle = '#444'; ctx.lineWidth = 3; for (let k = 1; k < 4; k++) { ctx.beginPath(); ctx.moveTo(x + (k * w) / 4, y); ctx.lineTo(x + (k * w) / 4, y + h); ctx.stroke(); } break;
    case 6: glass(x, y, w, h); ctx.strokeStyle = '#2a2a2a'; ctx.lineWidth = 4;
      for (let k = 1; k < 6; k++) { ctx.beginPath(); ctx.moveTo(x + (k * w) / 6, y); ctx.lineTo(x + (k * w) / 6, y + h); ctx.stroke(); }
      for (let k = 1; k < 4; k++) { ctx.beginPath(); ctx.moveTo(x, y + (k * h) / 4); ctx.lineTo(x + w, y + (k * h) / 4); ctx.stroke(); } break;
    case 7: shutter(x, y, w / 2, h, '#7a5634'); shutter(x + w / 2, y, w / 2, h, '#7a5634'); break;
    default: break;
  }
  // آثار مية/تراب تحت الشباك (من التكييفات)
  if (!isDoor && R() < 0.7) {
    const g = ctx.createLinearGradient(0, y + h + 14, 0, cy + ch);
    g.addColorStop(0, 'rgba(80,70,55,0.35)'); g.addColorStop(1, 'rgba(80,70,55,0)');
    ctx.fillStyle = g; ctx.fillRect(x + R() * w * 0.5, y + h + 14, w * 0.25, ch * 0.3);
  }
}

export function makeFacadeAtlas(kind = 'plaster') {
  const W = 2048, H = 1024, cw = 512, ch = 512;
  const R = rng(kind === 'plaster' ? 101 : 202);
  const c = canvas(W, H), m = canvas(W, H), e = canvas(W, H);
  const ctx = c.getContext('2d'), mctx = m.getContext('2d'), ectx = e.getContext('2d');
  mctx.fillStyle = '#000'; mctx.fillRect(0, 0, W, H);
  ectx.fillStyle = '#000'; ectx.fillRect(0, 0, W, H);
  if (kind === 'plaster') {
    const n = tileNoise(512, [8, 32, 128], R, [1, 0.5, 0.3]);
    const img = ctx.createImageData(W, H);
    for (let i = 0; i < W * H; i++) {
      const x = i % W, y = Math.floor(i / W);
      const v = 222 + (n[(y % 512) * 512 + (x % 512)] - 0.5) * 46 + (R() - 0.5) * 10;
      img.data[i * 4] = v; img.data[i * 4 + 1] = v - 2; img.data[i * 4 + 2] = v - 6; img.data[i * 4 + 3] = 255;
    }
    ctx.putImageData(img, 0, 0);
  } else {
    drawBricks(ctx, 0, 0, W, H, R, 14);
  }
  const lights = ['#ffcf8a', '#fff1d0', null, '#ffd9a0', null, '#e8f0ff', null, '#ffc070'];
  for (let k = 0; k < 8; k++) {
    const cx = (k % 4) * cw, cy = Math.floor(k / 4) * ch;
    if (kind === 'brick') {
      // هيكل خرساني: كمرة فوق وأعمدة على الجناب
      ctx.fillStyle = '#9d9a92'; ctx.fillRect(cx, cy, cw, 34); ctx.fillRect(cx, cy, 26, ch); ctx.fillRect(cx + cw - 26, cy, 26, ch);
      ctx.fillStyle = 'rgba(0,0,0,0.15)'; ctx.fillRect(cx, cy + 34, cw, 4);
    } else {
      ctx.fillStyle = 'rgba(0,0,0,0.06)'; ctx.fillRect(cx, cy, cw, 20);
    }
    drawWindow(ctx, mctx, ectx, cx, cy, cw, ch, k, R, lights[k]);
  }
  const h = canvasLuminance(c);
  // roughness: الزجاج ناعم
  const md = mctx.getImageData(0, 0, W, H).data;
  const rough = new Float32Array(W * H);
  for (let i = 0; i < W * H; i++) rough[i] = md[i * 4] > 128 ? 0.12 : 0.92;
  const map = tex(c, { repeat: false });
  return {
    map,
    normalMap: tex(heightToNormal(h, W, H, 2.2, false), { srgb: false, repeat: false }),
    roughnessMap: tex(grayCanvas(rough, W, H, (v) => v), { srgb: false, repeat: false }),
    emissiveMap: tex(e, { repeat: false }),
  };
}

export function atlasUV(cell, cols = 4, rows = 2, inset = 0.002) {
  const u0 = (cell % cols) / cols + inset, u1 = (cell % cols + 1) / cols - inset;
  const v1 = 1 - Math.floor(cell / cols) / rows - inset, v0 = 1 - (Math.floor(cell / cols) + 1) / rows + inset;
  return [[u0, v0], [u1, v0], [u1, v1], [u0, v1]];
}

// ============ أطلس واجهات المحلات ============
// 8 خلايا (4x2) كل خلية = محل بعرض ~3.4م وارتفاع ~3.6م
export function makeShopAtlas() {
  const W = 2048, H = 1024, cw = 512, ch = 512;
  const R = rng(303);
  const c = canvas(W, H), e = canvas(W, H);
  const ctx = c.getContext('2d'), ectx = e.getContext('2d');
  ectx.fillStyle = '#000'; ectx.fillRect(0, 0, W, H);
  const products = ['#c8382c', '#e0b030', '#2e6fb0', '#3a9a52', '#f0f0f0', '#e07a20', '#8a3aa0', '#20a0a0'];
  for (let k = 0; k < 8; k++) {
    const cx = (k % 4) * cw, cy = Math.floor(k / 4) * ch;
    ctx.fillStyle = '#8a8478'; ctx.fillRect(cx, cy, cw, ch);
    const ox = cx + 24, oy = cy + 18, ow = cw - 48, oh = ch - 18;
    if (k === 0 || k === 5) {
      // باب صاج مقفول (سكينة)
      ctx.fillStyle = k === 0 ? '#8d9196' : '#6f7a6a'; ctx.fillRect(ox, oy, ow, oh);
      for (let y = oy; y < oy + oh; y += 9) { ctx.fillStyle = 'rgba(0,0,0,0.25)'; ctx.fillRect(ox, y, ow, 2); ctx.fillStyle = 'rgba(255,255,255,0.12)'; ctx.fillRect(ox, y + 3, ow, 2); }
      ctx.fillStyle = 'rgba(120,70,40,0.35)'; for (let i = 0; i < 30; i++) ctx.fillRect(ox + R() * ow, oy + oh * 0.6 + R() * oh * 0.4, 6 + R() * 30, 3 + R() * 8);
      ctx.fillStyle = '#333'; ctx.fillRect(ox + ow / 2 - 15, oy + oh - 14, 30, 8);
    } else if (k === 7) {
      // مدخل عمارة: باب حديد وزجاج
      ctx.fillStyle = '#b4ad9e'; ctx.fillRect(ox, oy, ow, oh);
      ctx.fillStyle = '#2b2b2b'; ctx.fillRect(ox + ow * 0.2, oy + oh * 0.12, ow * 0.6, oh * 0.88);
      ctx.fillStyle = '#4a5560'; ctx.fillRect(ox + ow * 0.25, oy + oh * 0.18, ow * 0.22, oh * 0.5); ctx.fillRect(ox + ow * 0.53, oy + oh * 0.18, ow * 0.22, oh * 0.5);
      ctx.strokeStyle = '#1a1a1a'; ctx.lineWidth = 5;
      for (let i = 0; i < 6; i++) { ctx.beginPath(); ctx.arc(ox + ow * (0.3 + (i % 3) * 0.2), oy + oh * (0.3 + Math.floor(i / 3) * 0.25), 18, 0, Math.PI * 2); ctx.stroke(); }
      ectx.fillStyle = '#806040'; ectx.fillRect(ox + ow * 0.25, oy + oh * 0.18, ow * 0.5, oh * 0.5);
    } else {
      // محل مفتوح: جوه غامق، رفوف، بضاعة
      const g = ctx.createLinearGradient(0, oy, 0, oy + oh);
      g.addColorStop(0, '#2a2622'); g.addColorStop(1, '#4a443c');
      ctx.fillStyle = g; ctx.fillRect(ox, oy, ow, oh);
      ectx.fillStyle = '#ffe6b0'; ectx.fillRect(ox, oy, ow, oh * 0.15);
      ectx.fillStyle = '#5a4a30'; ectx.fillRect(ox, oy + oh * 0.15, ow, oh * 0.85);
      const shelves = 4;
      for (let s = 0; s < shelves; s++) {
        const sy = oy + 40 + s * (oh * 0.62 / shelves);
        ctx.fillStyle = '#6a5a48'; ctx.fillRect(ox + 8, sy + 46, ow - 16, 6);
        for (let x = ox + 12; x < ox + ow - 26; x += 14 + R() * 12) {
          ctx.fillStyle = products[Math.floor(R() * products.length)];
          const ph = 20 + R() * 24;
          ctx.fillRect(x, sy + 46 - ph, 10 + R() * 10, ph);
        }
      }
      // ترابيزة / تلاجة قدام
      if (k === 2 || k === 6) { ctx.fillStyle = '#d0d4d8'; ctx.fillRect(ox + ow * 0.6, oy + oh * 0.55, ow * 0.35, oh * 0.45); ctx.fillStyle = '#a0c8e8'; ctx.fillRect(ox + ow * 0.63, oy + oh * 0.58, ow * 0.29, oh * 0.3); ectx.fillStyle = '#90b0d0'; ectx.fillRect(ox + ow * 0.63, oy + oh * 0.58, ow * 0.29, oh * 0.3); }
      if (k === 3) { ctx.fillStyle = '#2f8a3a'; ctx.fillRect(ox + ow / 2 - 20, oy + 30, 40, 120); ctx.fillRect(ox + ow / 2 - 60, oy + 70, 120, 40); ectx.fillStyle = '#30c040'; ectx.fillRect(ox + ow / 2 - 20, oy + 30, 40, 120); ectx.fillRect(ox + ow / 2 - 60, oy + 70, 120, 40); }
      // سكينة نصها مرفوع
      ctx.fillStyle = '#8d9196'; ctx.fillRect(ox, oy, ow, 26);
      ctx.fillStyle = 'rgba(0,0,0,0.3)'; for (let y = oy; y < oy + 26; y += 6) ctx.fillRect(ox, y, ow, 2);
    }
    // أعمدة جانبية
    ctx.fillStyle = '#a49c8c'; ctx.fillRect(cx, cy, 24, ch); ctx.fillRect(cx + cw - 24, cy, 24, ch); ctx.fillRect(cx, cy, cw, 18);
  }
  const h = canvasLuminance(c);
  return {
    map: tex(c, { repeat: false }),
    normalMap: tex(heightToNormal(h, W, H, 1.5, false), { srgb: false, repeat: false }),
    emissiveMap: tex(e, { repeat: false }),
  };
}

// ============ أطلس اللافتات العربي ============
export const SIGN_TEXTS = [
  ['سوبر ماركت الأمانة', 'كل طلبات البيت'], ['صيدلية الشفاء', 'خدمة ٢٤ ساعة'], ['فول وطعمية أبو محمد', 'فطار مصري أصيل'],
  ['كشري الزعيم', 'كشري - مكرونة - أرز بلبن'], ['عصير قصب الحرية', 'فريش ١٠٠٪'], ['مكتبة النور', 'أدوات مكتبية - تصوير'],
  ['حلاق الأناقة', 'للرجال والأطفال'], ['موبايلات النجم', 'صيانة - إكسسوارات'], ['مخبز العيش البلدي', 'عيش طازة كل يوم'],
  ['بقالة الخير', 'جملة وقطاعي'], ['مشويات الكبابجي', 'كباب - كفتة - طرب'], ['كاوتش الأمل', 'ترصيص - ميزان'],
  ['أدوات كهربائية', 'لمبات - أسلاك - مفاتيح'], ['مكوجي الهنا', 'غسيل ومكوى بالبخار'], ['حلواني السعادة', 'بسبوسة - كنافة - جاتوه'],
  ['عطارة الشيخ', 'بهارات وأعشاب'], ['جزارة الإيمان', 'لحوم بلدي طازة'], ['كافيه الأصدقاء', 'شاي - قهوة - شيشة'],
  ['خردوات وأدوات منزلية', 'أسعار الجملة'], ['معرض الأثاث الحديث', 'غرف نوم - صالونات'], ['نظارات النور', 'كشف نظر بالكمبيوتر'],
  ['محمصة البن الذهبي', 'بن - مكسرات'], ['أحذية الفرسان', 'جلد طبيعي'], ['ملابس الأطفال', 'تشكيلة جديدة'],
  ['ستوديو الذكريات', 'تصوير - فيديو'], ['مغسلة سيارات', 'غسيل وتلميع'], ['سباكة ونقاشة', 'تشطيبات'],
  ['منظفات الهدى', 'منظفات بالكيلو'], ['فطاطري الشرق', 'فطير مشلتت - حلو وحادق'], ['سنترال الاتصالات', 'شحن كروت'],
  ['ألوميتال الصفا', 'شبابيك - مطابخ'], ['دواجن الريف', 'فراخ بلدي'],
];

export function makeSignAtlas() {
  const W = 2048, H = 2048, cw = 512, ch = 128;
  const R = rng(404);
  const c = canvas(W, H);
  const ctx = c.getContext('2d');
  const styles = [
    ['#0f6a3c', '#ffffff', '#ffe066'], ['#b3201c', '#ffffff', '#ffe066'], ['#123e8c', '#ffffff', '#9fd0ff'],
    ['#f2c230', '#1a1a1a', '#b3201c'], ['#ffffff', '#b3201c', '#123e8c'], ['#1c1c1c', '#ffd23f', '#ffffff'],
    ['#e66a1e', '#ffffff', '#1c1c1c'], ['#2a8fb8', '#ffffff', '#ffe066'],
  ];
  const fonts = ['Lalezar', 'Rakkas', 'Lemonada', 'El Messiri', 'Aref Ruqaa', 'Cairo'];
  ctx.direction = 'rtl';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  for (let k = 0; k < 64; k++) {
    const cx = (k % 4) * cw, cy = Math.floor(k / 4) * ch;
    const [title, sub] = SIGN_TEXTS[k % SIGN_TEXTS.length];
    const [bg, fg, accent] = styles[Math.floor(R() * styles.length)];
    const g = ctx.createLinearGradient(0, cy, 0, cy + ch);
    g.addColorStop(0, bg); g.addColorStop(1, shade(bg, -0.25));
    ctx.fillStyle = g; ctx.fillRect(cx, cy, cw, ch);
    ctx.strokeStyle = accent; ctx.lineWidth = 6; ctx.strokeRect(cx + 5, cy + 5, cw - 10, ch - 10);
    const font = fonts[k % fonts.length];
    ctx.fillStyle = fg;
    let size = 54;
    ctx.font = `${size}px "${font}", "Cairo", sans-serif`;
    while (ctx.measureText(title).width > cw - 50 && size > 24) { size -= 2; ctx.font = `${size}px "${font}", "Cairo", sans-serif`; }
    ctx.fillText(title, cx + cw / 2, cy + ch * 0.42);
    ctx.font = `22px "Cairo", sans-serif`;
    ctx.fillStyle = accent;
    ctx.fillText(sub, cx + cw / 2, cy + ch * 0.8);
    // اتساخ
    ctx.fillStyle = 'rgba(60,50,30,0.12)';
    for (let i = 0; i < 6; i++) ctx.fillRect(cx + R() * cw, cy + ch * 0.75, 30 + R() * 80, ch * 0.25);
  }
  const t = tex(c, { repeat: false });
  return { map: t, emissiveMap: t };
}

export function signUV(k) {
  const cols = 4, rows = 16;
  const u0 = (k % cols) / cols, u1 = (k % cols + 1) / cols;
  const v1 = 1 - Math.floor(k / cols) / rows, v0 = 1 - (Math.floor(k / cols) + 1) / rows;
  return [[u0, v0], [u1, v0], [u1, v1], [u0, v1]];
}

export function shade(hex, amt) {
  const n = parseInt(hex.slice(1), 16);
  const f = (v) => Math.max(0, Math.min(255, Math.round(v * (1 + amt))));
  return `rgb(${f(n >> 16)},${f((n >> 8) & 255)},${f(n & 255)})`;
}

// ============ لافتات عيادات (عمودية على البلكونات) ============
export const CLINIC_TEXTS = [
  ['د. محمود سالم', 'أخصائي أطفال'], ['د. منى عبد الله', 'نساء وتوليد'], ['د. أحمد فؤاد', 'أسنان وتجميل'],
  ['د. هاني رزق', 'باطنة وقلب'], ['مكتب محاماة', 'أ. سامي الشريف'], ['د. سارة كمال', 'جلدية وليزر'],
  ['معمل تحاليل', 'الحياة'], ['د. خالد مراد', 'عظام ومفاصل'],
];
export function makeClinicAtlas() {
  const W = 1024, H = 512, cw = 256, ch = 256;
  const c = canvas(W, H);
  const ctx = c.getContext('2d');
  ctx.direction = 'rtl'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  CLINIC_TEXTS.forEach(([a, b], k) => {
    const cx = (k % 4) * cw, cy = Math.floor(k / 4) * ch;
    ctx.fillStyle = '#f7f7f2'; ctx.fillRect(cx, cy, cw, ch);
    ctx.fillStyle = k % 2 ? '#1a4e9c' : '#b0221d'; ctx.fillRect(cx, cy, cw, 40); ctx.fillRect(cx, cy + ch - 28, cw, 28);
    ctx.fillStyle = k % 2 ? '#1a4e9c' : '#b0221d';
    fitFont(ctx, a, cw - 16, 34); ctx.fillText(a, cx + cw / 2, cy + ch * 0.4);
    ctx.fillStyle = '#222'; fitFont(ctx, b, cw - 16, 26, 'Cairo', 'normal'); ctx.fillText(b, cx + cw / 2, cy + ch * 0.62);
    ctx.fillStyle = '#fff'; ctx.font = '18px "Cairo", sans-serif'; ctx.fillText('ت: ٠١٠٠٠٠٠٠٠٠٠', cx + cw / 2, cy + ch - 14);
  });
  return tex(c, { repeat: false });
}

// ============ تكييف ============
export function makeACTexture() {
  const c = canvas(128, 96);
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#d8d6cf'; ctx.fillRect(0, 0, 128, 96);
  ctx.fillStyle = '#9a9890';
  for (let y = 10; y < 86; y += 6) ctx.fillRect(10, y, 70, 3);
  ctx.strokeStyle = '#8a8880'; ctx.lineWidth = 3;
  ctx.beginPath(); ctx.arc(102, 48, 18, 0, Math.PI * 2); ctx.stroke();
  for (let a = 0; a < 6; a++) { ctx.beginPath(); ctx.moveTo(102, 48); ctx.lineTo(102 + Math.cos(a) * 16, 48 + Math.sin(a) * 16); ctx.stroke(); }
  ctx.fillStyle = 'rgba(100,80,50,0.25)'; ctx.fillRect(0, 70, 128, 26);
  return tex(c, { repeat: false });
}

// ============ إطار (ترس الكاوتش) ============
export function makeTireTread() {
  const w = 256, h = 64;
  const c = canvas(w, h);
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#808080'; ctx.fillRect(0, 0, w, h);
  ctx.fillStyle = '#202020';
  for (let x = 0; x < w; x += 16) {
    ctx.beginPath(); ctx.moveTo(x, 8); ctx.lineTo(x + 10, 30); ctx.lineTo(x + 4, 30); ctx.lineTo(x - 6, 8); ctx.fill();
    ctx.beginPath(); ctx.moveTo(x + 8, h - 8); ctx.lineTo(x - 2, h - 30); ctx.lineTo(x + 4, h - 30); ctx.lineTo(x + 14, h - 8); ctx.fill();
  }
  ctx.fillRect(0, h / 2 - 2, w, 4);
  const hgt = canvasLuminance(c);
  const t = tex(heightToNormal(hgt, w, h, 4), { srgb: false });
  return t;
}

// ============ بقع (زيت، رقع أسفلت) ============
export function makeStain() {
  const s = 256;
  const R = rng(77);
  const c = canvas(s, s);
  const ctx = c.getContext('2d');
  const n = tileNoise(s, [4, 8, 16, 32], R);
  const img = ctx.createImageData(s, s);
  for (let i = 0; i < s * s; i++) {
    const x = (i % s) / s - 0.5, y = Math.floor(i / s) / s - 0.5;
    const d = Math.hypot(x, y) * 2;
    const a = Math.max(0, Math.min(1, (1 - d) * 2.2 + (n[i] - 0.5) * 1.6));
    img.data[i * 4] = img.data[i * 4 + 1] = img.data[i * 4 + 2] = 255;
    img.data[i * 4 + 3] = a * 255;
  }
  ctx.putImageData(img, 0, 0);
  return tex(c, { repeat: false });
}

/** تآكل الدهان (للخطوط) */
export function makePaintWear() {
  const s = 256;
  const R = rng(88);
  const n = tileNoise(s, [8, 32, 64], R);
  const c = grayCanvas(n, s, s, (v) => (v > 0.42 ? 0.9 : v * 1.2) * (0.7 + R() * 0.3));
  return tex(c, { srgb: false });
}

// ============ غطا بلاعة ============
export function makeManhole() {
  const s = 256;
  const c = canvas(s, s);
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#3a3836'; ctx.fillRect(0, 0, s, s);
  ctx.strokeStyle = '#262422'; ctx.lineWidth = 10;
  ctx.beginPath(); ctx.arc(s / 2, s / 2, s * 0.46, 0, Math.PI * 2); ctx.stroke();
  ctx.lineWidth = 5;
  for (let r = 30; r < s * 0.42; r += 18) { ctx.beginPath(); ctx.arc(s / 2, s / 2, r, 0, Math.PI * 2); ctx.stroke(); }
  for (let a = 0; a < 8; a++) { ctx.beginPath(); ctx.moveTo(s / 2, s / 2); ctx.lineTo(s / 2 + Math.cos(a * 0.785) * s * 0.44, s / 2 + Math.sin(a * 0.785) * s * 0.44); ctx.stroke(); }
  const h = canvasLuminance(c);
  return { map: tex(c, { repeat: false }), normalMap: tex(heightToNormal(h, s, s, 5, false), { srgb: false, repeat: false }) };
}

// ============ قماش الكراسي (ميكروباص) ============
export function makeSeatFabric() {
  const s = 256;
  const R = rng(66);
  const c = canvas(s, s);
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#5a2430'; ctx.fillRect(0, 0, s, s);
  for (let y = 0; y < s; y += 32) for (let x = 0; x < s; x += 32) {
    ctx.fillStyle = (x + y) % 64 === 0 ? '#7a3442' : '#4a1c28';
    ctx.beginPath(); ctx.moveTo(x + 16, y); ctx.lineTo(x + 32, y + 16); ctx.lineTo(x + 16, y + 32); ctx.lineTo(x, y + 16); ctx.fill();
    ctx.fillStyle = '#c9a04a'; ctx.fillRect(x + 14, y + 14, 4, 4);
  }
  const img = ctx.getImageData(0, 0, s, s);
  for (let i = 0; i < s * s; i++) { const v = (R() - 0.5) * 22; img.data[i * 4] += v; img.data[i * 4 + 1] += v; img.data[i * 4 + 2] += v; }
  ctx.putImageData(img, 0, 0);
  return tex(c);
}

// ============ عدادات التابلوه ============
export function makeGauge(kind) {
  const s = 256;
  const c = canvas(s, s);
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#0d0d0f'; ctx.fillRect(0, 0, s, s);
  ctx.translate(s / 2, s / 2);
  ctx.strokeStyle = '#555'; ctx.lineWidth = 6; ctx.beginPath(); ctx.arc(0, 0, s * 0.47, 0, Math.PI * 2); ctx.stroke();
  const max = kind === 'speed' ? 160 : 5;
  const steps = kind === 'speed' ? 16 : 10;
  const a0 = Math.PI * 0.75, a1 = Math.PI * 2.25;
  ctx.fillStyle = '#eee'; ctx.strokeStyle = '#eee';
  ctx.font = 'bold 20px Arial'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  for (let i = 0; i <= steps; i++) {
    const a = a0 + ((a1 - a0) * i) / steps;
    const major = kind === 'speed' ? i % 2 === 0 : i % 2 === 0;
    ctx.lineWidth = major ? 4 : 2;
    if (kind === 'rpm' && i >= 9) ctx.strokeStyle = '#e03030';
    ctx.beginPath(); ctx.moveTo(Math.cos(a) * s * 0.42, Math.sin(a) * s * 0.42); ctx.lineTo(Math.cos(a) * s * (major ? 0.34 : 0.38), Math.sin(a) * s * (major ? 0.34 : 0.38)); ctx.stroke();
    if (major) ctx.fillText(String(kind === 'speed' ? (i * max) / steps : i / 2), Math.cos(a) * s * 0.26, Math.sin(a) * s * 0.26);
  }
  ctx.font = '16px Arial'; ctx.fillStyle = '#aaa';
  ctx.fillText(kind === 'speed' ? 'km/h' : 'x1000 rpm', 0, s * 0.22);
  return tex(c, { repeat: false });
}

// ============ لوحة الأرقام ============
export function makePlate(text = 'ب ص ر ٤٧٢١') {
  const c = canvas(256, 128);
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#f4f4f0'; ctx.fillRect(0, 0, 256, 128);
  ctx.fillStyle = '#c84a1a'; ctx.fillRect(0, 0, 256, 36);
  ctx.fillStyle = '#fff'; ctx.font = 'bold 22px "Cairo", sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillText('مصر     EGYPT', 128, 18);
  ctx.fillStyle = '#111'; ctx.font = 'bold 46px "Cairo", sans-serif'; ctx.direction = 'rtl';
  ctx.fillText(text, 128, 84);
  ctx.strokeStyle = '#111'; ctx.lineWidth = 4; ctx.strokeRect(2, 2, 252, 124);
  return tex(c, { repeat: false });
}

/** ملصق نصي (للميكروباص) */
export function makeTextDecal(text, { w = 512, h = 128, color = '#1a4e9c', font = 'Aref Ruqaa', size = 70 } = {}) {
  const c = canvas(w, h);
  const ctx = c.getContext('2d');
  ctx.clearRect(0, 0, w, h);
  ctx.direction = 'rtl'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.font = `${size}px "${font}", "Cairo", sans-serif`;
  ctx.lineWidth = 8; ctx.strokeStyle = 'rgba(255,255,255,0.9)'; ctx.strokeText(text, w / 2, h / 2);
  ctx.fillStyle = color; ctx.fillText(text, w / 2, h / 2);
  return tex(c, { repeat: false });
}

/** ورقة شجر بخلفية شفافة */
export function makeLeaves() {
  const s = 512;
  const R = rng(99);
  const c = canvas(s, s);
  const ctx = c.getContext('2d');
  ctx.clearRect(0, 0, s, s);
  for (let i = 0; i < 520; i++) {
    const x = s * 0.5 + (R() - 0.5) * s * 0.9 * Math.sqrt(R()), y = s * 0.5 + (R() - 0.5) * s * 0.9 * Math.sqrt(R());
    const g = 70 + R() * 70, r = 30 + R() * 40;
    ctx.fillStyle = `rgb(${r},${g},${25 + R() * 25})`;
    ctx.save(); ctx.translate(x, y); ctx.rotate(R() * Math.PI * 2);
    ctx.beginPath(); ctx.ellipse(0, 0, 9 + R() * 6, 4 + R() * 3, 0, 0, Math.PI * 2); ctx.fill();
    ctx.restore();
  }
  // فروع
  ctx.strokeStyle = 'rgba(70,50,30,0.9)'; ctx.lineWidth = 3;
  for (let i = 0; i < 8; i++) { ctx.beginPath(); ctx.moveTo(s / 2, s / 2); ctx.lineTo(s / 2 + (R() - 0.5) * s * 0.8, s / 2 + (R() - 0.5) * s * 0.8); ctx.stroke(); }
  return tex(c, { repeat: false });
}

export function makePalmFrond() {
  const w = 128, h = 512;
  const c = canvas(w, h);
  const ctx = c.getContext('2d');
  ctx.clearRect(0, 0, w, h);
  ctx.strokeStyle = '#5a6a2a'; ctx.lineWidth = 4;
  ctx.beginPath(); ctx.moveTo(w / 2, 0); ctx.lineTo(w / 2, h); ctx.stroke();
  for (let y = 10; y < h; y += 7) {
    const len = (w / 2 - 4) * Math.sin((y / h) * Math.PI) + 6;
    ctx.strokeStyle = `rgb(${60 + (y % 20)},${100 + (y % 30)},40)`; ctx.lineWidth = 3;
    ctx.beginPath(); ctx.moveTo(w / 2, y); ctx.lineTo(w / 2 - len, y + 22); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(w / 2, y); ctx.lineTo(w / 2 + len, y + 22); ctx.stroke();
  }
  return tex(c, { repeat: false });
}

// ============ جنط ألومنيوم 6 أذرع (زي الصورة المرجعية) ============
export function makeRimTexture(spokes = 6) {
  const s = 256, c = canvas(s, s), ctx = c.getContext('2d');
  ctx.translate(s / 2, s / 2);
  // الشفة الخارجية
  let g = ctx.createRadialGradient(0, 0, 90, 0, 0, 128);
  g.addColorStop(0, '#9da2a6'); g.addColorStop(0.6, '#e6e9eb'); g.addColorStop(1, '#7d8286');
  ctx.fillStyle = g; ctx.beginPath(); ctx.arc(0, 0, 128, 0, Math.PI * 2); ctx.fill();
  // الفراغات بين الأذرع (بيبان منها الديسك)
  ctx.fillStyle = '#121314';
  ctx.beginPath(); ctx.arc(0, 0, 108, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = '#3a3b3d'; ctx.beginPath(); ctx.arc(0, 0, 80, 0, Math.PI * 2); ctx.fill(); // ديسك الفرامل
  ctx.fillStyle = '#121314'; ctx.beginPath(); ctx.arc(0, 0, 50, 0, Math.PI * 2); ctx.fill();
  // الأذرع
  for (let i = 0; i < spokes; i++) {
    ctx.save(); ctx.rotate((i / spokes) * Math.PI * 2);
    g = ctx.createLinearGradient(-14, 0, 14, 0);
    g.addColorStop(0, '#8e9397'); g.addColorStop(0.5, '#f1f3f4'); g.addColorStop(1, '#9ca1a5');
    ctx.fillStyle = g;
    ctx.beginPath(); ctx.moveTo(-15, -30); ctx.lineTo(15, -30); ctx.lineTo(22, -110); ctx.lineTo(-22, -110); ctx.closePath(); ctx.fill();
    ctx.restore();
  }
  // الوش والصواميل
  g = ctx.createRadialGradient(-8, -8, 4, 0, 0, 40);
  g.addColorStop(0, '#ffffff'); g.addColorStop(1, '#8f9498');
  ctx.fillStyle = g; ctx.beginPath(); ctx.arc(0, 0, 38, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = '#5d6165';
  for (let i = 0; i < 6; i++) { const a = (i / 6) * Math.PI * 2 + 0.5; ctx.beginPath(); ctx.arc(Math.cos(a) * 26, Math.sin(a) * 26, 4.5, 0, Math.PI * 2); ctx.fill(); }
  ctx.fillStyle = '#c9ccce'; ctx.beginPath(); ctx.arc(0, 0, 12, 0, Math.PI * 2); ctx.fill();
  ctx.strokeStyle = 'rgba(0,0,0,0.35)'; ctx.lineWidth = 3; ctx.beginPath(); ctx.arc(0, 0, 108, 0, Math.PI * 2); ctx.stroke();
  return tex(c, { repeat: false });
}

// ============ فانوس أمامي كبير شفاف بعاكسات كروم ============
export function makeHeadlightTexture() {
  const w = 256, h = 128, c = canvas(w, h), ctx = c.getContext('2d');
  let g = ctx.createLinearGradient(0, 0, 0, h);
  g.addColorStop(0, '#4c545a'); g.addColorStop(1, '#262b2f');
  ctx.fillStyle = g; ctx.fillRect(0, 0, w, h);
  // عاكسات دائرية
  for (const [x, r] of [[78, 44], [170, 36]]) {
    g = ctx.createRadialGradient(x - 8, h / 2 - 8, 2, x, h / 2, r);
    g.addColorStop(0, '#ffffff'); g.addColorStop(0.35, '#c8cfd3'); g.addColorStop(0.7, '#8e979c'); g.addColorStop(1, '#eef2f4');
    ctx.fillStyle = g; ctx.beginPath(); ctx.arc(x, h / 2, r, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,0.9)'; ctx.lineWidth = 3; ctx.beginPath(); ctx.arc(x, h / 2, r * 0.45, 0, Math.PI * 2); ctx.stroke();
  }
  // شريط إشارة برتقالي على الطرف
  ctx.fillStyle = '#f0a020'; ctx.fillRect(w - 38, 14, 30, h - 28);
  ctx.strokeStyle = '#111'; ctx.lineWidth = 6; ctx.strokeRect(3, 3, w - 6, h - 6);
  ctx.fillStyle = 'rgba(255,255,255,0.18)'; ctx.fillRect(8, 8, w - 16, 14);
  return tex(c, { repeat: false });
}

// ============ فانوس خلفي رأسي ============
export function makeTaillightTexture() {
  const w = 64, h = 256, c = canvas(w, h), ctx = c.getContext('2d');
  ctx.fillStyle = '#9a1010'; ctx.fillRect(0, 0, w, h);
  ctx.fillStyle = '#d02020'; ctx.fillRect(6, 6, w - 12, h * 0.5);
  ctx.fillStyle = '#e09020'; ctx.fillRect(6, h * 0.55, w - 12, h * 0.18);
  ctx.fillStyle = '#e8e8e8'; ctx.fillRect(6, h * 0.76, w - 12, h * 0.18);
  ctx.strokeStyle = 'rgba(0,0,0,0.3)';
  for (let y = 10; y < h; y += 8) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(w, y); ctx.stroke(); }
  return tex(c, { repeat: false });
}

// ============ ستارة ميكروباص (بيضا متكسرة) ============
export function makeCurtain() {
  const w = 64, h = 256, c = canvas(w, h), ctx = c.getContext('2d');
  ctx.clearRect(0, 0, w, h);
  for (let x = 0; x < w; x += 8) {
    const g = ctx.createLinearGradient(x, 0, x + 8, 0);
    g.addColorStop(0, '#cfcfc8'); g.addColorStop(0.5, '#fbfbf6'); g.addColorStop(1, '#bdbdb6');
    ctx.fillStyle = g;
    ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x + 8, 0);
    // الستارة مربوطة في النص (شكل الساعة الرملية)
    ctx.lineTo(x + 8 - (x - 28) * 0.35, h * 0.55); ctx.lineTo(x + 8, h); ctx.lineTo(x, h); ctx.lineTo(x - (x - 28) * 0.35, h * 0.55); ctx.fill();
  }
  ctx.fillStyle = '#b8b8b0'; ctx.fillRect(14, h * 0.53, 36, 10);
  return tex(c, { repeat: false });
}

// ============ لوحة الفتيس على التابلوه P R N D 3 2 L ============
export function makeShiftGate() {
  const w = 64, h = 256, c = canvas(w, h), ctx = c.getContext('2d');
  ctx.fillStyle = '#1e1f21'; ctx.fillRect(0, 0, w, h);
  ctx.fillStyle = '#0a0a0b'; ctx.fillRect(28, 16, 8, h - 32);
  ctx.font = 'bold 22px Arial'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  'PRND32L'.split('').forEach((ch, i) => { ctx.fillStyle = ch === 'D' ? '#7fe08f' : '#d8d8d8'; ctx.fillText(ch, 14, 26 + i * 33); });
  return tex(c, { repeat: false });
}

// ============ عداد سرعة كبير 0-180 + بنزين/حرارة ============
export function makeGauge2(kind) {
  const s = 256, c = canvas(s, s), ctx = c.getContext('2d');
  ctx.fillStyle = '#08080a'; ctx.fillRect(0, 0, s, s);
  ctx.translate(s / 2, s / 2);
  ctx.strokeStyle = '#3a3a3f'; ctx.lineWidth = 8; ctx.beginPath(); ctx.arc(0, 0, s * 0.47, 0, Math.PI * 2); ctx.stroke();
  ctx.fillStyle = '#eee'; ctx.strokeStyle = '#eee'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  const a0 = Math.PI * 0.75, a1 = Math.PI * 2.25;
  const tick = (t, major, label, red) => {
    const a = a0 + (a1 - a0) * t;
    ctx.strokeStyle = red ? '#e33' : '#eee'; ctx.lineWidth = major ? 4 : 2;
    ctx.beginPath(); ctx.moveTo(Math.cos(a) * s * 0.43, Math.sin(a) * s * 0.43); ctx.lineTo(Math.cos(a) * s * (major ? 0.35 : 0.39), Math.sin(a) * s * (major ? 0.35 : 0.39)); ctx.stroke();
    if (label) { ctx.fillStyle = red ? '#e33' : '#eee'; ctx.fillText(label, Math.cos(a) * s * 0.27, Math.sin(a) * s * 0.27); }
  };
  if (kind === 'speed') {
    ctx.font = 'bold 19px Arial';
    for (let i = 0; i <= 18; i++) tick(i / 18, i % 2 === 0, i % 2 === 0 ? String(i * 10) : null);
    ctx.font = '15px Arial'; ctx.fillStyle = '#9a9a9f'; ctx.fillText('km/h', 0, s * 0.2);
  } else if (kind === 'rpm') {
    ctx.font = 'bold 22px Arial';
    for (let i = 0; i <= 10; i++) tick(i / 10, i % 2 === 0, i % 2 === 0 ? String(i / 2) : null, i >= 9);
    ctx.font = '13px Arial'; ctx.fillStyle = '#9a9a9f'; ctx.fillText('x1000 r/min', 0, s * 0.22);
  } else {
    ctx.font = 'bold 22px Arial';
    for (let i = 0; i <= 4; i++) tick(i / 4, true, i === 0 ? 'E' : i === 4 ? 'F' : null, i === 0);
    ctx.font = '15px Arial'; ctx.fillStyle = '#9a9a9f'; ctx.fillText('FUEL', 0, s * 0.22);
  }
  return tex(c, { repeat: false });
}
