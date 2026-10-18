// اختبار توزيع عناصر السبورة (layoutBoard في player_wb.js) من غير متصفح:
// - مفيش عنصرين متداخلين، وكل حاجة جوه المنطقة (فوق الترجمة).
// - المجموعة متوسّطة رأسيًا (الفرق بين الفراغ فوق وتحت ≤ 40 بكسل).
// - رسمة لوحدها بتملا ≥ 85% من العرض أو الارتفاع (مفيش «رسمة صغيرة في نص سبورة فاضية»).
// - الكلام ما يصغرش عن الحد الأدنى، ولو فيه سهم المسافة بين العناصر تكفّي سهم (≥ 110 بكسل).
// الاستخدام: node tests/wb_layout.mjs
import { layoutBoard, REGION as R } from "../app/player/player_wb.js";

const art = (a, kind = "illustration") => ({ opts: [{ a, hmax: kind === "illustration" ? 1e9 : 640 }], art: true, minH: kind === "illustration" ? 300 : 200 });
const txt = (chars, words = 2) => { const w1 = chars * 55; const o = [{ a: w1 / 130, hmax: 1.3 * 168 }];
  if (words > 1) o.push({ a: (w1 / 2 + 30) / 260, hmax: 2 * 1.3 * 168 }); return { opts: o, art: false, minH: 54 * 1.3 }; };
const num = (chars) => ({ opts: [{ a: (chars * 170) / 130, hmax: 1.3 * 320 }], art: false, minH: 70 });
const CASES = {
  "رسمة عريضة لوحدها": [art(2.6)], "رسمة طولية لوحدها": [art(0.6)], "أيقونة لوحدها": [art(1, "icon")],
  "رسمة + كلمة": [art(1.3), txt(9)], "رسمة + أيقونة + كلام": [art(1.5), art(1, "icon"), txt(16, 3)],
  "أيقونتين + رقم": [art(1, "icon"), art(1, "icon"), num(4)], "4 عناصر": [art(1.2), art(1, "icon"), txt(8), num(3)],
  "رقم + كلام طويل": [num(9), txt(28, 5)], "كلمة لوحدها": [txt(6, 1)],
};
const fails = [];
for (const [name, items] of Object.entries(CASES)) {
  for (const arrows of [false, true]) {
    const z = layoutBoard(items, R, arrows);
    for (const [i, a] of z.entries()) {
      if (a.x < R.x - 1 || a.y < R.y - 1 || a.x + a.w > R.x + R.w + 1 || a.y + a.h > R.y + R.h + 1) fails.push(`${name}: عنصر ${i} بره المنطقة ${JSON.stringify(a)}`);
      if (!items[i].art && a.h < items[i].minH - 1) fails.push(`${name}: كلام أصغر من الحد (${a.h.toFixed(0)})`);
      for (const [j, b] of z.entries()) if (j > i) {
        const gx = Math.max(b.x - (a.x + a.w), a.x - (b.x + b.w)), gy = Math.max(b.y - (a.y + a.h), a.y - (b.y + b.h));
        if (gx < 0 && gy < 0) fails.push(`${name}: ${i} و ${j} متداخلين`);
        if (arrows && j === i + 1 && Math.max(gx, gy) < 110) fails.push(`${name}: مسافة السهم بين ${i} و ${j} = ${Math.max(gx, gy).toFixed(0)}`);
      }
    }
    const top = Math.min(...z.map((a) => a.y)) - R.y, bot = R.y + R.h - Math.max(...z.map((a) => a.y + a.h));
    if (Math.abs(top - bot) > 40) fails.push(`${name}: مش متوسّطة (فوق ${top.toFixed(0)} / تحت ${bot.toFixed(0)})`);
    if (items.length === 1 && items[0].art && items[0].opts[0].hmax > 1e6 && z[0].w / R.w < 0.85 && z[0].h / R.h < 0.85) fails.push(`${name}: الرسمة صغيرة ${z[0].w.toFixed(0)}×${z[0].h.toFixed(0)}`);
    if (!arrows) console.log(name.padEnd(22), z.map((a) => `${a.w.toFixed(0)}×${a.h.toFixed(0)}@${a.x.toFixed(0)},${a.y.toFixed(0)}`).join("  "));
  }
}
console.log(fails.length ? "FAIL:\n  " + fails.join("\n  ") : "PASS");
process.exit(fails.length ? 1 : 0);
