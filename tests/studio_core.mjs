// اختبار منطق التايملاين في الاستوديو (app/web/static/studio/core.js):
// القصّ عند المؤشر بالظبط، والحذف بيقفل الفراغ، وتنسيق الوقت HH:MM:SS.mmm، وتحويل الوقت، والترجمة بعد القصّ، والرجوع/الإعادة.
// الاستخدام: node tests/studio_core.mjs
import { createRequire } from "module";
const require = createRequire(import.meta.url);
const C = require("../app/web/static/studio/core.js");

const fails = [];
const eq = (a, b, msg) => { if (JSON.stringify(a) !== JSON.stringify(b)) fails.push(`${msg}: ${JSON.stringify(a)} ≠ ${JSON.stringify(b)}`); };
const near = (a, b, msg, e = 1e-3) => { if (Math.abs(a - b) > e) fails.push(`${msg}: ${a} ≠ ${b}`); };

let segs = [{ id: "a", source: "s1", start: 1.0, end: 4.0 }, { id: "b", source: "s1", start: 6.0, end: 10.0 }];
near(C.total(segs), 7, "total");
eq(C.at(segs, 3.5), { i: 1, src: "s1", t: 6.5, off: 3 }, "output → source");
near(C.toOut(segs, "s1", 7.25), 4.25, "source → output");
eq(C.toOut(segs, "s1", 5.0), null, "removed source time");

// القصّ عند 4.123 ث في الفيديو النهائي ← 7.123 في الأصل بالظبط
const s2 = C.split(segs, 4.123);
eq(s2.length, 3, "split count");
near(s2[1].end, 7.123, "split left end (ms exact)");
near(s2[2].start, 7.123, "split right start (ms exact)");
near(C.total(s2), 7, "split keeps total");
eq(C.split(segs, 3.02).length, 2, "no split within 50 ms of an edge");

// حذف الجزء ← الفيديو بيقصر بطوله والباقي بيقرّب
const s3 = C.remove(s2, s2[1].id);
near(C.total(s3), 7 - (7.123 - 6.0), "delete shortens");
eq(C.remove([segs[0]], "a").length, 1, "can't delete the last segment");

// الوقت
eq(C.timecode(0), "00:00:00.000", "timecode 0");
eq(C.timecode(3725.0456), "01:02:05.046", "timecode hours/ms rounding");
eq(C.timecode(59.9996), "00:01:00.000", "timecode carry");

// الترجمة بعد القصّ: الكلمة اللي في الحتة المحذوفة بتختفي، والباقي بوقت الفيديو الجديد
const cw = [{ id: "c1", words: [{ word: "انا", source: "s1", start: 1.2, end: 1.5 }, { word: "مبسوط", source: "s1", start: 6.2, end: 6.6 }, { word: "جدا", source: "s1", start: 7.3, end: 7.6 }] }];
const mc = C.mapCues(cw, s3);
// الجزء المحذوف كان 6.0–7.123 في الأصل، فـ«مبسوط» (6.2) اتشالت و«جدا» (7.3) بقت عند 3 + 0.177
eq(mc[0].words.map((w) => w.word), ["انا", "جدا"], "cue words after delete");
near(mc[0].words[1].start, 3.177, "cue word mapped to output time");

// الرجوع/الإعادة
const h = new C.History({ segs });
h.push({ segs: s2 }); h.push({ segs: s3 });
eq(h.undo().segs.length, 3, "undo 1");
eq(h.undo().segs.length, 2, "undo 2");
eq(h.redo().segs.length, 3, "redo");
h.push({ segs: segs.slice(0, 1) });
eq(h.canRedo, false, "new edit clears redo");

console.log(fails.length ? "FAIL:\n  " + fails.join("\n  ") : "PASS");
process.exit(fails.length ? 1 : 0);
