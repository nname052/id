// =====================================================================
//  خامات من صور حقيقية لشوارع شبين الكوم (Wikimedia Commons، رخص حرة — شوف CREDITS.md)
//  - ملف واحد مضغوط (JPEG ~450KB) بيتحمل مرة واحدة، وبيتقص على نفس الـ canvas بتاعة الخامات المولّدة
//    (نفس المقاسات ونفس الـ mipmaps = نفس تكلفة الكارت بالظبط، مفيش خامات زيادة ولا draw calls)
//  - لو الصورة ماتحملتش (أوفلاين/غلط): اللعبة بتكمل بالخامات المولّدة زي ما هي
//  - الأطلس والإحداثيات بيتولدوا من tools/photos/build_atlas.py
// =====================================================================
import A from './photoAtlas.json';

export const PHOTO_SOURCES = A.sources;

const URL_ = new URL('./textures/shibin-photo-atlas.jpg', document.baseURI).href;

/** بيحمّل الأطلس (مع مهلة: مانعطلش الدخول للعبة لو النت بطيء) */
export function loadPhotoAtlas(timeoutMs = 9000) {
  return new Promise((resolve) => {
    const img = new Image();
    let done = false;
    const end = (v) => { if (!done) { done = true; resolve(v); } };
    img.decoding = 'async';
    img.onload = () => (img.decode ? img.decode().catch(() => {}) : Promise.resolve()).then(() => end(img));
    img.onerror = () => end(null);
    setTimeout(() => end(null), timeoutMs);
    img.src = URL_;
  });
}

// إضاءة الشبابيك بالليل (نفس ألوان الأطلس المولّد)
const LIGHTS = ['#ffcf8a', '#fff1d0', '#ffd9a0', '#ffd9a0', '#ffc070', '#e8f0ff', '#ffcf8a', '#ffc070'];

/** صف من 8 خانات (256) → أطلس اللعبة 4×2 (كل خانة 512) */
function paintRow(img, row, tex, emTex, emissive) {
  const c = tex.image, ctx = c.getContext('2d');
  const cw = c.width / 4, ch = c.height / 2, S = A.cell;
  const ectx = emTex && emTex !== tex ? emTex.image.getContext('2d') : null;
  row.cells.forEach((cell, k) => {
    const x = (k % 4) * cw, y = Math.floor(k / 4) * ch;
    ctx.drawImage(img, k * S, row.y, S, S, x, y, cw, ch);
    if (!ectx) return;
    ectx.fillStyle = '#000'; ectx.fillRect(x, y, cw, ch);
    emissive(ectx, cell, k, x, y, cw, ch, ctx);
  });
  tex.needsUpdate = true;
  if (ectx) emTex.needsUpdate = true;
}

/** بيرسم الصور على خامات الواجهات والمحلات والأسفلت والرصيف */
export function applyPhotoAtlas(M, img) {
  if (!img) return false;
  // شباك منور بالليل: لون النور × غمقان الإزاز في الصورة نفسها (مش مستطيل منور مصمت)
  const win = (ctx, cell, k, x, y, w, h, src) => {
    const [u0, v0, u1, v1] = cell.win;
    if (u1 <= u0 || v1 <= v0) return;
    const rx = Math.round(x + u0 * w), ry = Math.round(y + v0 * h), rw = Math.round((u1 - u0) * w), rh = Math.round((v1 - v0) * h);
    const s = src.getImageData(rx, ry, rw, rh), d = s.data;
    const L = LIGHTS[k], lr = parseInt(L.slice(1, 3), 16), lg = parseInt(L.slice(3, 5), 16), lb = parseInt(L.slice(5, 7), 16);
    for (let i = 0; i < d.length; i += 4) {
      const lum = (d[i] * 0.3 + d[i + 1] * 0.59 + d[i + 2] * 0.11) / 255;
      const f = Math.max(0, Math.min(1, 1.25 - lum * 1.7)) * 0.8;
      d[i] = lr * f; d[i + 1] = lg * f; d[i + 2] = lb * f; d[i + 3] = 255;
    }
    ctx.putImageData(s, rx, ry);
  };
  paintRow(img, A.rows.brick, M.facadeBrick.map, M.facadeBrick.emissiveMap, win);
  paintRow(img, A.rows.plaster, M.facadePlaster.map, M.facadePlaster.emissiveMap, win);
  // المحلات بالليل: نفس الصورة منورة (يافطة + جوه المحل)
  paintRow(img, A.rows.shop, M.shop.map, M.shop.emissiveMap, (ctx, cell, k, x, y, w, h) => {
    ctx.globalAlpha = 0.6; ctx.drawImage(img, k * A.cell, A.rows.shop.y, A.cell, A.cell, x, y, w, h); ctx.globalAlpha = 1;
  });
  // الأسفلت والرصيف: الخامة بتتكرر (repeat) — الصورة اتعملت tileable في الأداة
  const ground = (tex, [sx, sy, s]) => {
    const c = tex.image, ctx = c.getContext('2d');
    ctx.drawImage(img, sx, sy, s, s, 0, 0, c.width, c.height);
    tex.needsUpdate = true;
  };
  ground(M.asphalt.map, A.asphalt);
  ground(M.sidewalkTop.map, A.sidewalk);
  // لون الطوب الصافي (الحيطان الصمّا) من نفس الصور
  M.photoWall = A.wall;
  return true;
}
