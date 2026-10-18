// فيديو السبورة البيضاء: إيد ماسكة قلم بترسم وتكتب خطوة خطوة.
// - الرسومات والأيقونات بتترسم خط بخط (stroke-dashoffset)، وسن القلم ماشي على نفس الخط (getPointAtLength)، والألوان بتتملا بعد الحدود.
// - الكلام بيتكتب من اليمين للشمال (قص تدريجي) والإيد ماشية على السطر.
// - الأسهم والخطوط تحت الكلام والدواير بتترسم بخط إيد متعرّج شوية.
// كل حاجة محسوبة من t (حتمية) زي باقي المشغّل.
const clamp = (x, a = 0, b = 1) => Math.min(b, Math.max(a, x));
const lerp = (a, b, p) => a + (b - a) * p;
const ease = (x) => (x = clamp(x), x < 0.5 ? 2 * x * x : 1 - Math.pow(-2 * x + 2, 2) / 2);
// تسارع/تباطؤ ناعم لنقل الإيد: أعلى سرعة 1.57× المتوسط (بدل 2×)
const easeMove = (x) => (1 - Math.cos(Math.PI * clamp(x))) / 2;
const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const NS = "http://www.w3.org/2000/svg";
const svgEl = (tag, attrs = {}) => { const e = document.createElementNS(NS, tag); for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v); return e; };
const cache = {};
const text = async (url) => (cache[url] ??= await (await fetch(url)).text());

// ---------- الإيد ----------
const HAND_W = 780, HAND_SRC_W = 1040, TIP = [20, 170]; // سن القلم جوه الرسمة الأصلية
let hand;
export async function handLayer(stage) {
  if (hand) return hand;
  const el = document.createElement("div");
  el.id = "hand";
  el.innerHTML = await text("/player/hand.svg");
  const sv = el.querySelector("svg"); const k = HAND_W / HAND_SRC_W;
  sv.setAttribute("width", HAND_W); sv.setAttribute("height", 360 * k);
  el.style.cssText = `position:absolute;left:0;top:0;width:${HAND_W}px;transform-origin:${TIP[0] * k}px ${TIP[1] * k}px;z-index:7;pointer-events:none;will-change:transform`;
  stage.appendChild(el);
  hand = { el, k };
  return hand;
}
// بيحط سن القلم عند (x, y). الزاوية بتتغيّر شوية مع المكان علشان الحركة تبان طبيعية
export function placeHand(st) {
  if (!hand) return;
  if (!st || !st.visible) { hand.el.style.opacity = 0; return; }
  const k = hand.k, ang = 36 + (st.x - 540) / 60 + (st.y - 900) / 90;
  hand.el.style.opacity = 1;
  hand.el.style.transform = `translate(${st.x - TIP[0] * k}px, ${st.y - TIP[1] * k}px) rotate(${ang}deg)`;
}

// ---------- أماكن العناصر على السبورة ----------
// ليه: قبل كده الأماكن كانت ثابتة على عدد العناصر (عنصرين = نص فوق ونص تحت) واتحسبت قبل ما الوقت يشيل الزيادة، فلما عنصر يتشال
// الرسمة الباقية كانت بتفضل في النص اللي فوق ونص السبورة فاضي (فراغ لحد 600 بكسل). كمان الرسومات كان حواليها فراغ جوه ملفها نفسه.
// دلوقتي: كل عنصر بيتقاس شكله الحقيقي (الرسمة على قد حدودها، والكلام على قد سطوره)، وبنجرّب كل تقسيمات الصفوف (عنصر أو اتنين أو تلاتة
// في الصف، بنفس ترتيب الرسم) وبنختار اللي بيملا المساحة أكتر من غير ما حاجة تصغر قوي، وبعدين المجموعة كلها بتتوسّط في المنطقة.
// والتوزيع بيتعاد على العناصر اللي فضلت بعد ما الوقت يشيل الزيادة.
export const REGION = { x: 64, y: 180, w: 952, h: 1050 };   // فوق الترجمة (بتبدأ عند 1270)
const GAP = { x: 44, y: 56 }, ARROW_GAP = 150;   // لو فيه سهم بين العناصر: مسافة كفاية إن السهم يبان سهم
function partitions(n) { // كل تقسيمات n عنصر (بالترتيب) لصفوف، كل صف 1–3
  if (!n) return [[]];
  const out = [];
  for (let k = 1; k <= Math.min(3, n); k++) for (const rest of partitions(n - k)) out.push([k, ...rest]);
  return out;
}
// items: [{opts: [{a: العرض/الارتفاع, hmax, lines?}], art: bool, minH}] ← [{x, y, w, h, opt}] بنفس الترتيب
export function layoutBoard(items, R = REGION, arrows = false) {
  const n = items.length, GAP_X = arrows ? ARROW_GAP : GAP.x, GAP_Y = arrows ? ARROW_GAP : GAP.y;
  if (!n) return [];
  let best = null;
  const combos = (i) => (i === n ? [[]] : combos(i + 1).flatMap((c) => items[i].opts.map((_, k) => [k, ...c])));
  const allOpts = combos(0);
  for (const parts of partitions(n)) {
    for (const oc of allOpts) {
      let i = 0;
      const rows = parts.map((k) => { const its = []; for (let j = 0; j < k; j++, i++) its.push({ i, o: items[i].opts[oc[i]] }); return its; });
      // ارتفاع كل صف: العناصر بتملا العرض، ومحدودة بأقصى ارتفاع لكل عنصر (الكلام ما يكبرش عن حد معيّن)
      rows.forEach((r) => {
        const sumA = r.reduce((s, x) => s + x.o.a, 0), h = (R.w - GAP_X * (r.length - 1)) / sumA;
        r.forEach((x) => (x.h = Math.min(h, x.o.hmax)));
        r.h = Math.max(...r.map((x) => x.h));
      });
      const gaps = GAP_Y * (rows.length - 1), tot = rows.reduce((s, r) => s + r.h, 0);
      const k = Math.min(1, (R.h - gaps) / tot);
      let area = 0, minRel = Infinity, pen = 0;
      rows.forEach((r) => r.forEach((x) => {
        x.h *= k; x.w = x.h * x.o.a;
        const it = items[x.i], ar = x.w * x.h;
        area += ar * (it.art ? 1.25 : 1);
        minRel = Math.min(minRel, ar / ((R.w * R.h) / n));
        if (x.h < it.minH) pen += (it.minH - x.h) / it.minH;
        if (it.art && x.o.a > 0 && (x.w < 260 || x.h < 220)) pen += 0.5;   // رسمة أصغر من إنها تتشاف
      }));
      rows.forEach((r) => (r.h *= k));
      const score = area / (R.w * R.h) + 0.3 * Math.min(1, minRel) - 1.2 * pen - 0.02 * rows.length;
      if (!best || score > best.score) best = { score, rows: rows.map((r) => r.map((x) => ({ ...x }))), rh: rows.map((r) => r.h) };
    }
  }
  // المكان الفعلي: الصفوف متوسّطة رأسيًا (الزيادة بتتوزّع على المسافات بين الصفوف لحد حد معيّن والباقي فوق وتحت)،
  // وجوه الصف أول عنصر على اليمين (قراية عربي) والمسافة الزيادة بتتوزّع بين العناصر
  const rows = best.rows, rh = best.rh;
  const used = rh.reduce((s, h) => s + h, 0) + GAP_Y * (rows.length - 1);
  const extra = R.h - used, grow = rows.length > 1 ? Math.min(90, (extra * 0.5) / (rows.length - 1)) : 0;
  let y = R.y + (extra - grow * (rows.length - 1)) / 2;
  const out = new Array(n);
  rows.forEach((r, ri) => {
    const wsum = r.reduce((s, x) => s + x.w, 0), free = R.w - wsum, g = r.length > 1 ? Math.min(free / (r.length - 1), Math.max(GAP_X, free / (r.length + 1))) : 0;
    let x = R.x + R.w - (R.w - wsum - g * (r.length - 1)) / 2;
    r.forEach((it) => { x -= it.w; out[it.i] = { x, y: y + (rh[ri] - it.h) / 2, w: it.w, h: it.h, opt: it.o }; x -= g; });
    y += rh[ri] + GAP_Y + grow;
  });
  return out;
}

// خط إيد متعرّج شوية (ثابت لنفس البذرة)
function wobble(points, seed, amp = 4) {
  let s = seed;
  const r = () => ((s = (s * 16807) % 2147483647) / 2147483647 - 0.5) * 2 * amp;
  return points.map(([x, y], i) => [x + (i && i < points.length - 1 ? r() : 0), y + (i && i < points.length - 1 ? r() : 0)]);
}
const pathD = (pts) => pts.map(([x, y], i) => `${i ? "L" : "M"}${x.toFixed(1)} ${y.toFixed(1)}`).join(" ");
function smoothD(pts) { // منحنى ناعم بيعدّي على النقط
  let d = `M${pts[0][0]} ${pts[0][1]}`;
  for (let i = 1; i < pts.length - 1; i++) { const [x, y] = pts[i], [nx, ny] = pts[i + 1]; d += ` Q${x} ${y} ${(x + nx) / 2} ${(y + ny) / 2}`; }
  const [lx, ly] = pts[pts.length - 1]; return d + ` L${lx} ${ly}`;
}

// ---------- مشهد سبورة ----------
// sc.board = [{kind, text, value, visual, target, from, to, color, cue_word}] ، و sc.visuals متوصّلة بالترتيب للعناصر اللي فيها صورة
const TEXT_FS = 168, NUM_FS = 320, MIN_FS = 54;
export async function createBoard(sc, el, ctx) {
  const P = ctx.palette, ink = P.ink || "#1d1d1f", colorOf = (c) => (c === "accent" ? P.accent : c === "accent2" ? P.accent2 : ink);
  const font = ctx.font || "Marhey", PACE = ctx.pace || 1;
  el.classList.add("board");
  const items = sc.board || [];
  const under = svgEl("svg", { width: 1080, height: 1920, viewBox: "0 0 1080 1920", class: "wb-marks wb-under" });   // تحت العناصر: الهايلايتر والضل
  el.appendChild(under);
  const svgLayer = svgEl("svg", { width: 1080, height: 1920, viewBox: "0 0 1080 1920", class: "wb-marks" });
  const els = [];
  for (const [i, it] of items.entries()) {
    const e = { it, i, kind: it.kind, color: colorOf(it.color) };
    if (["illustration", "icon", "emoji"].includes(it.kind) && it.visual) {
      const box = document.createElement("div");
      box.className = `wb-art ${it.kind}`;
      box.style.cssText = `left:0;top:0;width:400px;height:400px;color:${e.color}`;
      box.innerHTML = await text(`/assets/${it.visual.asset}`);
      const sv = box.querySelector("svg");
      sv.setAttribute("width", 400); sv.setAttribute("height", 400); sv.setAttribute("preserveAspectRatio", "xMidYMid meet");
      el.appendChild(box);
      const shapes = [...sv.querySelectorAll("path, circle, line, polyline, polygon, rect, ellipse")].filter((s) => !s.closest("defs, clipPath, mask"));
      // الرسمة على قد حدودها الحقيقية (من غير الفراغ اللي جوه ملفها): viewBox جديد على حدود الأشكال
      const vb0 = sv.viewBox.baseVal && sv.viewBox.baseVal.width ? sv.viewBox.baseVal : { x: 0, y: 0, width: 400, height: 400 };
      if (!sv.getAttribute("viewBox")) sv.setAttribute("viewBox", `0 0 ${vb0.width} ${vb0.height}`);
      const sr = sv.getBoundingClientRect(), kk = Math.min(sr.width / vb0.width, sr.height / vb0.height);
      const ox = sr.left + (sr.width - vb0.width * kk) / 2, oy = sr.top + (sr.height - vb0.height * kk) / 2;
      let u = null;
      for (const s of shapes) { const r = s.getBoundingClientRect(); if (r.width + r.height < 0.5) continue;
        const q = { l: (r.left - ox) / kk + vb0.x, t: (r.top - oy) / kk + vb0.y, r: (r.right - ox) / kk + vb0.x, b: (r.bottom - oy) / kk + vb0.y };
        u = u ? { l: Math.min(u.l, q.l), t: Math.min(u.t, q.t), r: Math.max(u.r, q.r), b: Math.max(u.b, q.b) } : q; }
      if (u && u.r - u.l > 1 && u.b - u.t > 1) {
        const pad = Math.max(u.r - u.l, u.b - u.t) * (it.kind === "icon" ? 0.08 : 0.03);   // مكان لسُمك خط الأيقونة
        u = { l: Math.max(vb0.x, u.l - pad), t: Math.max(vb0.y, u.t - pad), r: Math.min(vb0.x + vb0.width, u.r + pad), b: Math.min(vb0.y + vb0.height, u.b + pad) };
        sv.setAttribute("viewBox", `${u.l} ${u.t} ${u.r - u.l} ${u.b - u.t}`);
        e.aspect = (u.r - u.l) / (u.b - u.t);
      } else e.aspect = vb0.width / vb0.height;
      e.aspect = clamp(e.aspect, 0.35, 3.2);
      // كل الأشكال اللي هتترسم: حدود بالحبر، والألوان بتظهر بعد ما الحدود تخلص
      e.shapes = shapes.map((s) => {
        const cs = getComputedStyle(s), fill = s.getAttribute("fill") || cs.fill;
        const L = (() => { try { return s.getTotalLength(); } catch { return 0; } })();
        // لون الرسمة الأساسي (بنفسجي unDraw) بيبقى لون القلم
        if (/6c63ff/i.test(fill)) s.setAttribute("fill", P.accent);
        s.style.vectorEffect = "non-scaling-stroke";
        // أيقونة متملية (من مجموعة مش خطوط): الحدود بالقلم وبعدين الملي، زي الرسمة (مش ظاهرة كاملة قبل ما القلم يرسمها)
        const solid = it.kind === "icon" && fill && fill !== "none" && !/^rgba\(0, 0, 0, 0\)$/.test(fill);
        // الملي بلون التأكيد وشفاف (زي قلم فسفوري) بدل بقعة سودا: أيقونة النحلة المتملية كانت بتبان كتلة
        if (it.kind === "icon") { s.style.stroke = e.color; s.style.strokeWidth = solid ? "4.5px" : "7px"; if (solid) { s.style.fill = e.color === ink ? P.accent : e.color; s.style.fillOpacity = 0; } }
        else { s._fill = s.getAttribute("fill") || cs.fill; s.style.stroke = ink; s.style.strokeWidth = "2.6px"; s.style.fillOpacity = 0; }
        return { s, L, solid };
      }).filter((x) => x.L > 0.5);
      e.total = e.shapes.reduce((n, x) => n + x.L, 0);
      e.box = box; e.svg = sv; e.dur = (it.kind === "illustration" ? 2.8 : it.kind === "emoji" ? 1.6 : 1.4) * PACE;
      // أيقونة لوحدها ما تكبرش لحد ما تبقى خطوط رفيعة في مساحة فاضية؛ الرسمة الكبيرة مالهاش حد
      e.opts = [{ a: e.aspect, hmax: it.kind === "illustration" ? 1e9 : 640 }]; e.art = true; e.minH = it.kind === "illustration" ? 300 : 200;
    } else if (["text", "number"].includes(it.kind)) {
      const t = it.kind === "number" ? String(it.value || it.text || "") : String(it.text || "");
      const words = t.split(/\s+/).filter(Boolean);
      const wrap = document.createElement("div");
      wrap.className = `wb-text ${it.kind}`;
      wrap.style.cssText = `left:0;top:0;width:auto;height:auto;color:${e.color};font-family:"${font}";font-size:100px`;
      el.appendChild(wrap);
      // تقسيمات السطور الممكنة (سطر، سطرين متوازنين، 3 لو الكلام طويل)، وكل تقسيمة ليها شكل (عرض/ارتفاع) بيدخل في التوزيع
      const splits = [[t]];
      if (it.kind === "text" && words.length > 1) {
        let b2 = null; for (let k = 1; k < words.length; k++) { const a = words.slice(0, k).join(" "), b = words.slice(k).join(" "), d = Math.abs(a.length - b.length); if (!b2 || d < b2.d) b2 = { d, l: [a, b] }; }
        splits.push(b2.l);
        if (words.length >= 5) { const k1 = Math.round(words.length / 3), k2 = Math.round((2 * words.length) / 3); splits.push([words.slice(0, k1), words.slice(k1, k2), words.slice(k2)].map((w) => w.join(" "))); }
        if (words.length > 3) splits.shift();   // كلام طويل على سطر واحد بيبقى رفيع وصغير
      }
      const FS = it.kind === "number" ? NUM_FS : TEXT_FS;
      e.opts = splits.map((lines) => { wrap.innerHTML = lines.map((l) => `<div class="ln"><span>${esc(l)}</span></div>`).join("");
        const wmax = Math.max(...[...wrap.querySelectorAll("span")].map((s) => s.offsetWidth)) + 24;
        return { lines, a: wmax / (lines.length * 130), hmax: lines.length * 1.3 * FS }; });
      e.minH = MIN_FS * 1.3;
      // الأرقام والكلام اللاتيني بيتكتبوا من الشمال لليمين، والعربي من اليمين للشمال. «رقم» فيه كلام عربي («أقل من ¼») عربي:
      // قبل كده أي number كان LTR فالكلام كان بيتقلب
      e.ltr = !/[\u0600-\u06FF]/.test(t);
      wrap.style.direction = e.ltr ? "ltr" : "rtl";
      e.box = wrap; e.txt = t;
      e.dur = clamp((0.3 + 0.085 * t.length) * PACE, 0.8, 2.4);
    } else {
      e.mark = true; e.dur = (it.kind === "circle" ? 0.9 : 0.7) * PACE;
    }
    els.push(e);
  }
  el.appendChild(svgLayer);

  // تحطيط عنصر في مكانه (وأي حاجة اتحسبت على المكان القديم بتتمسح وتتحسب تاني)
  const place = (e, z) => {
    e.zone = z;
    e.box.style.left = z.x + "px"; e.box.style.top = z.y + "px"; e.box.style.width = z.w + "px"; e.box.style.height = z.h + "px";
    if (e.shapes) {
      e.svg.setAttribute("width", z.w); e.svg.setAttribute("height", z.h);
      // مع non-scaling-stroke الشرطة بتتقاس ببكسل الشاشة، والطول من getTotalLength بوحدات الرسمة: بنحوّله لطول على الشاشة
      e.shapes.forEach((x) => { const m = x.s.getCTM(); x.Ls = x.L * (m ? Math.hypot(m.a, m.b) : 1);
        x.s.style.strokeDasharray = `${x.Ls} ${x.Ls}`; x.s.style.strokeDashoffset = x.Ls; delete x.p0; delete x.p1; delete x.pieces; });
      delete e.tl;
    } else {
      const lines = z.opt.lines;
      e.box.innerHTML = lines.map((l) => `<div class="ln"><span>${esc(l)}</span></div>`).join("");
      let fs = Math.min(e.kind === "number" ? NUM_FS : TEXT_FS, z.h / (lines.length * 1.3));
      e.box.style.fontSize = fs + "px";
      while (fs > 44 && ([...e.box.querySelectorAll("span")].some((s) => s.offsetWidth > z.w + 4) || e.box.scrollHeight > z.h + 4)) { fs *= 0.95; e.box.style.fontSize = fs + "px"; }
      e.lines = [...e.box.querySelectorAll(".ln span")]; e.fs = fs;
    }
  };
  const relayout = (live) => { const content = live.filter((e) => !e.mark), arrows = live.some((e) => e.kind === "arrow");
    const zs = layoutBoard(content.map((e) => ({ opts: e.opts, art: !!e.art, minH: e.minH })), REGION, arrows);
    content.forEach((e, k) => place(e, zs[k])); };

  // العلامات (سهم / خط تحت / دايرة) واللمسات: بتتبني بعد ما مكان العناصر اتعرف (وبتتعاد لو التوزيع اتغيّر)
  const rectOf = (idx) => { const t = els[idx]; if (!t || !t.box || t.dropped) return null;
    if (t.lines) { const r = t.lines.map((s) => ({ x: s.offsetLeft + t.box.offsetLeft, y: s.offsetTop + t.box.offsetTop, w: s.offsetWidth, h: s.offsetHeight }));
      const x0 = Math.min(...r.map((q) => q.x)), y0 = Math.min(...r.map((q) => q.y)), x1 = Math.max(...r.map((q) => q.x + q.w)), y1 = Math.max(...r.map((q) => q.y + q.h));
      return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 }; }
    return { x: t.zone.x + t.zone.w * 0.04, y: t.zone.y + t.zone.h * 0.04, w: t.zone.w * 0.92, h: t.zone.h * 0.92 }; };
  const buildMarks = (live) => {
    svgLayer.replaceChildren(); under.replaceChildren();
    const contentIdx = live.filter((x) => !x.mark).map((x) => x.i);
    for (const e of live.filter((x) => x.mark)) {
      const it = e.it, seed = 31 + e.i * 7;
      delete e.path; delete e.head; e.skip = false;
      const tgt = rectOf(Number.isInteger(it.target) ? it.target : contentIdx[contentIdx.length - 1]);
      let d = null, head = null;
      if (it.kind === "underline" && tgt) {
        const y = tgt.y + tgt.h * 0.96;
        d = smoothD(wobble([[tgt.x + tgt.w + 10, y], [tgt.x + tgt.w * 0.66, y + 6], [tgt.x + tgt.w * 0.33, y + 2], [tgt.x - 10, y + 8]], seed, 3));
      } else if (it.kind === "circle" && tgt) {
        const cx = tgt.x + tgt.w / 2, cy = tgt.y + tgt.h / 2, rx = Math.min(tgt.w / 2 + 34, 530), ry = Math.min(tgt.h / 2 + 26, 600), pts = [];
        for (let a = 0; a <= 1.08; a += 0.04) pts.push([cx + Math.cos(-Math.PI / 2 + a * Math.PI * 2) * rx * (1 + 0.03 * Math.sin(a * 9)), cy + Math.sin(-Math.PI / 2 + a * Math.PI * 2) * ry]);
        d = smoothD(pts);
      } else if (it.kind === "arrow") {
        const a = rectOf(Number.isInteger(it.from) ? it.from : contentIdx[0]), b = rectOf(Number.isInteger(it.to) ? it.to : contentIdx[contentIdx.length - 1]);
        if (a && b && a !== b) {
          const ac = [a.x + a.w / 2, a.y + a.h / 2], bc = [b.x + b.w / 2, b.y + b.h / 2];
          const edge = (r, from, to) => { const dx = to[0] - from[0], dy = to[1] - from[1]; const s = Math.min(Math.abs((r.w / 2 + 20) / (dx || 1e-6)), Math.abs((r.h / 2 + 20) / (dy || 1e-6)), 1);
            return [from[0] + dx * s, from[1] + dy * s]; };
          const p0 = edge(a, ac, bc), p1 = edge(b, bc, ac), mid = [(p0[0] + p1[0]) / 2 + (p1[1] - p0[1]) * 0.15, (p0[1] + p1[1]) / 2 - (p1[0] - p0[0]) * 0.15];
          // سهم أقصر من 70 بكسل (العنصرين لازقين) ما بيبانش سهم: بيتشال
          if (Math.hypot(p1[0] - p0[0], p1[1] - p0[1]) > 70) {
            d = smoothD([p0, mid, p1]);
            const ang = Math.atan2(p1[1] - mid[1], p1[0] - mid[0]), L = 34;
            head = pathD([[p1[0] - L * Math.cos(ang - 0.45), p1[1] - L * Math.sin(ang - 0.45)], p1, [p1[0] - L * Math.cos(ang + 0.45), p1[1] - L * Math.sin(ang + 0.45)]]);
          }
        }
      }
      if (!d) { e.skip = true; continue; }
      const path = svgEl("path", { d, fill: "none", stroke: e.color === ink ? P.accent : e.color, "stroke-width": 9, "stroke-linecap": "round", "stroke-linejoin": "round" });
      svgLayer.appendChild(path);
      e.path = path; e.L = path.getTotalLength(); path.style.strokeDasharray = e.L; path.style.strokeDashoffset = e.L;
      if (head) { e.head = svgEl("path", { d: head, fill: "none", stroke: path.getAttribute("stroke"), "stroke-width": 9, "stroke-linecap": "round", opacity: 0 }); svgLayer.appendChild(e.head); }
    }
    buildTouches(live);
  };

  // ---------- لمسات احترافية (من غير الإيد، وكل واحدة مربوطة بعنصر) ----------
  // 1) هايلايتر: الكلمة المهمة (لون التأكيد) بيتعلّم وراها بقلم فسفوري بعد ما تتكتب، إلا لو عليها خط أو دايرة من الخطة.
  // 2) ضل خفيف تحت الرسمة الكبيرة (بيظهر مع التلوين) علشان ما تبانش طايرة في الهوا.
  // 3) شرطتين تلاتة «لمعة» جنب أول رسمة/رقم (بقلم التأكيد) بعد ما يخلص، لو جنبه مكان فاضي.
  let touches = [];
  const buildTouches = (live) => {
    touches = [];
    const marked = new Set(live.filter((x) => x.mark && !x.skip).map((x) => x.it.target).filter(Number.isInteger));
    const key = live.find((x) => x.lines && x.kind === "text" && x.it.color === "accent" && !marked.has(x.i));
    if (key) {
      const r = rectOf(key.i), seed = 91 + key.i * 13, h = Math.min(r.h * 0.42, 70), y = r.y + r.h * 0.62;
      const pts = wobble([[r.x + r.w + 14, y], [r.x + r.w * 0.5, y + 3], [r.x - 14, y - 2]], seed, 2);
      const p = svgEl("path", { d: smoothD(pts), fill: "none", stroke: key.color === ink ? P.accent : key.color, "stroke-width": h, "stroke-linecap": "round", opacity: 0.2 });
      under.appendChild(p); const L = p.getTotalLength(); p.style.strokeDasharray = L; p.style.strokeDashoffset = L;
      touches.push({ kind: "hl", el: p, L, of: key, d: 0.45 });
    }
    for (const a of live.filter((x) => x.kind === "illustration" && x.zone)) {
      const z = a.zone, s = svgEl("ellipse", { cx: z.x + z.w / 2, cy: z.y + z.h + 10, rx: z.w * 0.36, ry: Math.max(10, z.w * 0.025), fill: ink, opacity: 0 });
      under.appendChild(s); touches.push({ kind: "shadow", el: s, of: a });
    }
    // اللمسة بتتغيّر من مشهد للتاني (شرط / نجمة صغيرة / مفيش) علشان ما تبقاش نفس العلامة في كل سبورة
    const deco = ["ticks", "star", "none"][[...String(sc.id)].reduce((h, c) => h + c.charCodeAt(0), 0) % 3];
    const hero = deco !== "none" && live.find((x) => (x.art || x.kind === "number") && x.zone);
    if (hero) {
      // عند الركن اللي فوق (ناحية المكان الفاضي)، ومش لازقة في عنصر تاني
      const z = hero.kind === "number" ? rectOf(hero.i) : hero.zone, right = z.x + z.w + 90 < 1060;
      const cx = right ? z.x + z.w - z.w * 0.04 : z.x + z.w * 0.04, cy = z.y + z.h * 0.04, dir = right ? 1 : -1;
      const others = live.filter((x) => x !== hero && x.zone && !x.mark);
      const clash = others.some((o) => cx + dir * 80 > o.zone.x - 10 && cx + dir * 80 < o.zone.x + o.zone.w + 10 && cy - 90 < o.zone.y + o.zone.h && cy + 20 > o.zone.y);
      if (!clash && cx > 30 && cx < 1050 && cy > 150) {
        const add = (d, k) => { const p = svgEl("path", { d, fill: "none", stroke: P.accent, "stroke-width": 8, "stroke-linecap": "round", "stroke-linejoin": "round" });
          svgLayer.appendChild(p); const L = p.getTotalLength(); p.style.strokeDasharray = L; p.style.strokeDashoffset = L;
          touches.push({ kind: "tick", el: p, L, of: hero, k, d: 0.16 }); };
        if (deco === "ticks") {
          // 3 شرط قصيرة متفرّقة حوالين نقطة (مش لازقة في بعض، علشان ما تبانش سهم)
          [[8, 34], [46, 44], [84, 34]].forEach(([deg, len], k) => {
            const vx = Math.cos((deg * Math.PI) / 180) * dir, vy = -Math.sin((deg * Math.PI) / 180), r0 = 40;
            add(pathD([[cx + vx * r0, cy + vy * r0], [cx + vx * (r0 + len), cy + vy * (r0 + len)]]), k); });
        } else {
          // نجمة 4 أطراف بخط إيد
          const sx = cx + dir * 62, sy = cy - 58, R1 = 30, R2 = 9, pts = [];
          for (let k = 0; k <= 8; k++) { const a = -Math.PI / 2 + (k * Math.PI) / 4, r = k % 2 ? R2 : R1; pts.push([sx + Math.cos(a) * r, sy + Math.sin(a) * r]); }
          add(pathD(wobble(pts, 77, 1.5)), 0);
        }
      }
    }
  };

  // ---------- طريق القلم جوه الرسمة ----------
  // الإيد الحقيقية ما بتنطّش من خط لخط: بترسم الخط اللي أقرب لمكانها، وبعدين ترفع القلم وتتنقل للي بعده بسرعة محدودة.
  // فكل رسمة ليها خطة (مرة واحدة، ثابتة): ترتيب الخطوط بالأقرب، ووقت رسم لكل خط حسب طوله، ووقت نقل بين الخطوط حسب المسافة.
  const ptAt = (e, x, len) => { const pt = x.s.getPointAtLength(clamp(len, 0, x.L)), m = x.s.getCTM();
    const q = m ? new DOMPoint(pt.x, pt.y).matrixTransform(m) : pt; return { x: e.zone.x + q.x, y: e.zone.y + q.y }; };
  const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
  const MOVE_SPEED = 1800; // متوسط سرعة الإيد وهي رافعة القلم (بكسل/ثانية)؛ أعلى سرعة لحظية حوالي الضعف مع التسارع والتباطؤ
  const DRAW_SPEED = 2400; // أقصى سرعة رسم بالقلم (بكسل/ثانية على مسرح 1080×1920)
  const strokePlan = (e) => {
    if (e.tl) return e.tl;
    // كل خط ممكن يكون فيه كذا حتة منفصلة (path بأكتر من M): بنلاقي أماكن القطع بالعيّنات، والقلم بيرسم حتة حتة
    // وبيرفع ويتنقل بين الحتت (ترتيب الحتت جوه الخط زي ما هو، علشان الظهور يمشي على الخط صح)
    e.shapes.forEach((x) => {
      // العيّنات كل ~8 بكسل على الشاشة (مش بوحدات ملف الرسمة): أيقونة 24 وحدة مرسومة 600 بكسل كانت بتتقسم كل عيّنة لحتة لوحدها والإيد بتنط
      const n = Math.min(400, Math.max(2, Math.ceil((x.Ls || x.L) / 8))), step = x.L / n, stepPx = (x.Ls || x.L) / n, pcs = [];
      let l0 = 0, prev = ptAt(e, x, 0);
      for (let i = 1; i <= n; i++) {
        const q = ptAt(e, x, i * step);
        if (dist(prev, q) > Math.max(25, stepPx * 3)) { pcs.push({ l0, l1: (i - 1) * step }); l0 = i * step; }
        prev = q;
      }
      pcs.push({ l0, l1: x.L });
      x.pieces = pcs.filter((g) => g.l1 - g.l0 > 0.5).map((g) => ({ ...g, p0: ptAt(e, x, g.l0), p1: ptAt(e, x, g.l1) }));
      if (!x.pieces.length) x.pieces = [{ l0: 0, l1: x.L, p0: ptAt(e, x, 0), p1: ptAt(e, x, x.L) }];
      x.p0 = x.pieces[0].p0; x.p1 = x.pieces[x.pieces.length - 1].p1;
      x.inner = x.pieces.slice(1).reduce((m, g, i) => m + Math.max(0.03, dist(x.pieces[i].p1, g.p0) / MOVE_SPEED), 0);
    });
    // رسمة معقدة (خطوطها أطول من اللي إيد تلحق ترسمه في وقتها): القلم بيرسم الخطوط الأساسية (الأطول) بس،
    // والتفاصيل الصغيرة بتظهر مع التلوين، زي فيديوهات السبورة الحقيقية
    // كل الأطوال هنا ببكسل الشاشة (Ls)، مش بوحدات ملف الرسمة: أيقونة 100 وحدة معروضة 640 بكسل كان القلم بيجري فيها 4200 بكسل/ث
    const px = (x) => x.Ls || x.L;
    const budget = DRAW_SPEED * e.dur * 0.7;
    let acc = 0;
    [...e.shapes].sort((a, b) => px(b) - px(a)).forEach((x) => { x.noHand = acc + px(x) > budget && acc > 0; if (!x.noHand) acc += px(x); });
    const nnOrder = (list) => { const rest = [...list], out = []; if (!rest.length) return out;
      let cur = rest.reduce((b, x) => (x.p0.x - x.p0.y * 0.3 > b.p0.x - b.p0.y * 0.3 ? x : b), rest[0]).p0;
      while (rest.length) { let bi = 0; for (let i = 1; i < rest.length; i++) if (dist(cur, rest[i].p0) < dist(cur, rest[bi].p0)) bi = i;
        const x = rest.splice(bi, 1)[0]; out.push(x); cur = x.p1; }
      return out; };
    // وقت النقل (بين الخطوط وبين حتت الخط الواحد) على قد المسافة، عمره ما بيتضغط. لو كتير على وقت الرسمة،
    // القلم بيرسم خطوط أقل (الأصغر بيظهر مع التلوين) بدل ما يتنقل أسرع من إيد حقيقية
    let order, mv;
    for (;;) {
      order = nnOrder(e.shapes.filter((x) => !x.noHand));
      mv = order.reduce((m, x, i) => m + x.inner + (i ? Math.max(0.03, dist(order[i - 1].p1, x.p0) / MOVE_SPEED) : 0), 0);
      if (mv <= e.dur * 0.4 || order.length <= 1) break;
      order.reduce((m, x) => (px(x) < px(m) ? x : m), order[0]).noHand = true;
    }
    const drawT = Math.max(0.1, e.dur - mv), tot = order.reduce((n, x) => n + Math.max(px(x), 4), 0);
    e.drawSpeed = order.length ? tot / drawT : 0; e.handShapes = order.length; e.allShapes = e.shapes.length;
    let t = 0; e.tl = [];
    const moveTo = (a, b) => { const d = Math.max(0.03, dist(a, b) / MOVE_SPEED); e.tl.push({ move: true, a, b, t0: t, t1: t + d }); t += d; };
    order.forEach((x, i) => {
      if (i) moveTo(order[i - 1].p1, x.p0);
      x.pieces.forEach((g, k) => {
        if (k) moveTo(x.pieces[k - 1].p1, g.p0);
        const d = drawT * Math.max(((g.l1 - g.l0) * px(x)) / x.L, 4 / x.pieces.length) / tot;
        e.tl.push({ x, l0: g.l0, l1: g.l1, t0: t, t1: t + d }); t += d;
      });
    });
    return e.tl;
  };
  // تقسيم وقت الكتابة: كل سطر ليه وقت، وبين كل سطرين 15% من الوقت لرجوع القلم
  const lineSeg = (e, p) => {
    const n = e.lines.length, R = n > 1 ? 0.15 : 0, w = (1 - R * (n - 1)) / n;
    let t = clamp(p);
    for (let li = 0; li < n; li++) {
      if (t <= w || li === n - 1) return { li, q: clamp(t / w), ret: false };
      t -= w;
      if (t <= R) return { li, q: clamp(t / R), ret: true };
      t -= R;
    }
    return { li: n - 1, q: 1, ret: false };
  };
  // نقطة سن القلم وهو بيرسم عنصر عند تقدّم p (إحداثيات المسرح)
  const pen = (e, p) => {
    if (e.shapes) {
      if (!e.shapes.length) return null;
      const tl = strokePlan(e), tt = clamp(p) * e.dur;
      if (!tl.length) return null; // كل خطوطها بتظهر مع التلوين (مفيش حاجة للقلم يرسمها)
      const sg = tl.find((g) => tt <= g.t1) || tl[tl.length - 1], q = clamp((tt - sg.t0) / Math.max(1e-6, sg.t1 - sg.t0));
      if (sg.move) { const u = easeMove(q); return { x: lerp(sg.a.x, sg.b.x, u), y: lerp(sg.a.y, sg.b.y, u) - Math.sin(u * Math.PI) * Math.min(18, dist(sg.a, sg.b) * 0.15), lifted: true }; }
      return ptAt(e, sg.x, sg.l0 + (sg.l1 - sg.l0) * q);
    }
    if (e.lines) {
      // سطر سطر، وبين السطرين القلم بيرجع لأول السطر اللي تحته (مش بينط في لحظة)
      const n = e.lines.length, g = lineSeg(e, p), s = e.lines[g.li];
      const ptLine = (sp, q) => ({ x: e.box.offsetLeft + sp.offsetLeft + sp.offsetWidth * (e.ltr ? q : 1 - q), y: e.box.offsetTop + sp.offsetTop + sp.offsetHeight * 0.72 });
      if (g.ret) { const a = ptLine(e.lines[g.li], 1), b = ptLine(e.lines[g.li + 1], 0), u = easeMove(g.q); return { x: lerp(a.x, b.x, u), y: lerp(a.y, b.y, u) - Math.sin(u * Math.PI) * 20, lifted: true }; }
      const pt = ptLine(s, g.q); return { x: pt.x, y: pt.y + Math.sin(p * 60) * 6 };
    }
    if (e.path) { const pt = e.path.getPointAtLength(e.L * p); return { x: pt.x, y: pt.y }; }
    return null;
  };

  // أول وآخر نقطة للقلم في كل عنصر (هندسة بس، من غير توقيت): للرسمة البداية من فوق-يمين والنهاية في نصها تقريبًا
  const topRight = (e) => { e.shapes.forEach((x) => { if (!x.p0) { x.p0 = ptAt(e, x, 0); x.p1 = ptAt(e, x, x.L); } });
    return e.shapes.reduce((b, x) => (x.p0.x - x.p0.y * 0.3 > b.p0.x - b.p0.y * 0.3 ? x : b), e.shapes[0]).p0; };
  const beginPt = (e) => (e.shapes ? (e.shapes.length ? topRight(e) : null) : pen(e, 0.001));
  const endPt = (e) => (e.shapes ? { x: e.zone.x + e.zone.w / 2, y: e.zone.y + e.zone.h / 2 } : pen(e, 0.999));
  // التوقيت: كل عنصر مع كلمته، ومن غير ما عنصرين يترسموا في نفس الوقت.
  // لو الوقت مش مكفي: الرسم يسرع لحد 70% بس (مش لربع السرعة)، والزيادة (العلامات الأول، وبعدين آخر العناصر) بتتشال بدل ما كله يجري،
  // وبعد كل عنصر بيتشال، التوزيع بيتعاد على اللي فاضل (علشان ما يفضلش مكانه فاضي)
  let live = els.slice();
  const avail = ctx.duration - 0.45;
  // وقت نقل الإيد بين عنصرين (حسب المسافة، بسرعة محدودة): العنصر اللي بعده بيستنى الإيد توصل
  // تقدير مأمون: من أبعد ركن في مكان العنصر اللي قبله (القلم ممكن يخلص في أي حتة فيه)
  const farFrom = (a, pb) => { const r = a.zone || (a.path ? a.path.getBBox() : null); if (!r) return endPt(a) || pb;
    const cs = [[r.x, r.y], [r.x + (r.w ?? r.width), r.y], [r.x, r.y + (r.h ?? r.height)], [r.x + (r.w ?? r.width), r.y + (r.h ?? r.height)]];
    return cs.map(([x, y]) => ({ x, y })).reduce((m, c) => (Math.hypot(c.x - pb.x, c.y - pb.y) > Math.hypot(m.x - pb.x, m.y - pb.y) ? c : m)); };
  const travel = (a, b) => { const pb = beginPt(b); if (!pb) return 0.3; const pa = a ? farFrom(a, pb) : { x: 1250, y: 1750 };
    return clamp(Math.hypot(pa.x - pb.x, pa.y - pb.y) / MOVE_SPEED, 0.2, 0.8); };
  // 4 محاولات قبل ما نشيل أي حاجة: مع الكلام بسرعته ← مع الكلام أسرع شوية (70%) ← ورا بعض من غير الكلام ← نشيل الزيادة
  const timeIt = (k, cues) => { let tc = 0.25, prev = null;
    for (const e of live) { e.dur = e.dur0 * k; const cue = cues && e.it.cue_word ? ctx.cue(e.it.cue_word) : 0;
      const earliest = tc + (prev ? travel(prev, e) : 0.25);
      e.start = Math.max(earliest, Math.min(cue > 0 ? cue - 0.1 : earliest, avail - e.dur)); tc = e.start + e.dur; prev = e; } return tc; };
  els.forEach((e) => (e.dur0 = e.dur));
  const kFit = () => clamp((avail - 0.25 - 0.35 * live.length) / live.reduce((n, e) => n + e.dur0, 0), 0.7, 1);
  for (let guard = 0; guard < 12; guard++) {
    relayout(live);
    buildMarks(live);
    live = live.filter((e) => !e.skip);
    let end = timeIt(1, true);
    if (end > avail) end = timeIt(kFit(), true);
    if (end > avail) end = timeIt(kFit(), false);
    if (end <= avail || live.length <= 1) break;
    const drop = [...live].reverse().find((e) => e.mark) || live[live.length - 1];
    drop.dropped = true; if (drop.box) drop.box.style.display = "none";
    live = live.filter((e) => e !== drop);
  }
  el.dataset.dropped = els.filter((e) => e.dropped).length;
  // للفحص بس (قراية): كل عنصر بيترسم امتى وبياخد قد إيه (بالنسبة لبداية المشهد) ومكانه
  (window.__wbDebug ??= []).push({ scene: sc.id, items: live.map((e) => ({ kind: e.kind, start: +e.start.toFixed(3), dur: +e.dur.toFixed(3),
    zone: e.zone ? [e.zone.x, e.zone.y, e.zone.w, e.zone.h].map(Math.round) : null, fs: e.fs ? Math.round(e.fs) : undefined })), dropped: +el.dataset.dropped,
    touches: touches.map((x) => x.kind) });
  (window.__wbStats ??= []).push(() => ({ scene: sc.id, items: live.map((e) => ({ kind: e.kind, drawSpeed: e.drawSpeed ? Math.round(e.drawSpeed) : null, handShapes: e.handShapes ?? null, allShapes: e.allShapes ?? null })) }));

  let last = { x: 1200, y: 1700 };
  return (t) => {
    let handSt = null;
    for (const e of live) {
      const p = clamp((t - e.start) / e.dur);
      if (e.shapes) {
        // كل خط بيترسم في وقته من خطة القلم (بالترتيب الأقرب، مش ترتيب الملف)
        const tl = e.shapes.length ? strokePlan(e) : [], tt = p * e.dur;
        e.shapes.forEach((x) => (x._rev = 0));
        for (const g of tl) if (!g.move && tt >= g.t0) g.x._rev = g.l0 + (g.l1 - g.l0) * clamp((tt - g.t0) / Math.max(1e-6, g.t1 - g.t0));
        e.shapes.forEach((x) => { if (!x.noHand) x.s.style.strokeDashoffset = x.Ls * (1 - x._rev / x.L); });
        // الألوان بتتملا في آخر جزء من الرسم وبعده
        const fp = clamp((t - e.start - e.dur * 0.7) / (e.dur * 0.6));
        e.shapes.forEach((x) => { if (e.kind !== "icon") x.s.style.fillOpacity = fp; else if (x.solid) x.s.style.fillOpacity = 0.22 * fp; });
        e.shapes.forEach((x) => { if (x.noHand) { x.s.style.strokeDashoffset = 0; x.s.style.strokeOpacity = fp; } }); // التفاصيل مع التلوين
      } else if (e.lines) {
        const g = lineSeg(e, p);
        e.lines.forEach((s, li) => { const lp = li < g.li ? 1 : li > g.li ? 0 : g.ret ? 1 : g.q, hide = `${(1 - lp) * 100}%`;
          s.style.clipPath = e.ltr ? `inset(-20% ${hide} -20% 0)` : `inset(-20% 0 -20% ${hide})`; });
      } else if (e.path) {
        e.path.style.strokeDashoffset = e.L * (1 - p);
        if (e.head) e.head.setAttribute("opacity", p >= 0.98 ? 1 : 0);
      }
      // من أول لحظة في العنصر (p = 0 بالظبط كانت بتتحسب «بين عنصرين» والإيد كانت بتنط لنقطة الدخول فريم واحد)
      if (t >= e.start && p < 1) { const pt = pen(e, p); if (pt) { handSt = { ...pt, visible: true }; last = pt; } }
    }
    // اللمسات: بعد العنصر بتاعها ما يخلص
    for (const x of touches) {
      const o = x.of, done = o.start + o.dur;
      if (x.kind === "hl") x.el.style.strokeDashoffset = x.L * (1 - ease(clamp((t - done - 0.05) / (x.d * PACE))));
      else if (x.kind === "shadow") x.el.setAttribute("opacity", 0.07 * clamp((t - o.start - o.dur * 0.7) / (o.dur * 0.6)));
      else if (x.kind === "tick") x.el.style.strokeDashoffset = x.L * (1 - ease(clamp((t - done - 0.1 - x.k * 0.1) / (x.d * PACE))));
    }
    // بين عنصرين: الإيد بتتنقل من آخر نقطة لأول نقطة في اللي بعده. وفي الآخر بتمشي بره السبورة
    if (!handSt) {
      const next = live.find((e) => t < e.start), prev = [...live].reverse().find((e) => t >= e.start + e.dur);
      if (next) {
        // النقل للعنصر اللي بعده: بيبدأ قبله بوقت كفاية للمسافة (بسرعة محدودة)، مش في لحظة
        const a = prev ? pen(prev, 0.999) || last : { x: 1250, y: 1750 }, b = pen(next, 0.001) || a;
        const gap = next.start - (prev ? prev.start + prev.dur : 0);
        const need = Math.max(0.2, Math.hypot(a.x - b.x, a.y - b.y) / MOVE_SPEED), d = Math.min(Math.max(gap, 0.2), need);
        const p = easeMove(1 - (next.start - t) / d);
        handSt = { x: lerp(a.x, b.x, p), y: lerp(a.y, b.y, p) - Math.sin(p * Math.PI) * 40, visible: true };
      } else if (prev) {
        const a = pen(prev, 0.999) || last, d = clamp(Math.hypot(a.x - 1300, a.y - 1900) / MOVE_SPEED, 0.6, 1.4), p = easeMove((t - prev.start - prev.dur) / d);
        handSt = { x: lerp(a.x, 1300, p), y: lerp(a.y, 1900, p), visible: p < 1 };
      }
    }
    return handSt;
  };
}
