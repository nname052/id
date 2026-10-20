// منطق التايملاين في الاستوديو (من غير واجهة، بيتعمله اختبار في tests/studio_core.mjs):
// الأجزاء (من/لـ في الملف الأصلي) ← وقت الفيديو النهائي، القصّ عند المؤشر، الحذف، تنسيق الوقت، والرجوع/الإعادة.
(function (root) {
  const EPS = 1e-6;
  let n = 0;
  const newId = () => "u" + Date.now().toString(36) + (++n).toString(36);

  // طول الفيديو النهائي = مجموع الأجزاء
  const total = (segs) => segs.reduce((s, x) => s + (x.end - x.start), 0);
  // بداية كل جزء في الفيديو النهائي
  const offsets = (segs) => { let t = 0; return segs.map((x) => { const o = t; t += x.end - x.start; return o; }); };

  // وقت في الفيديو النهائي ← {الجزء، والوقت في الملف الأصلي}
  function at(segs, tOut) {
    const off = offsets(segs);
    for (let i = 0; i < segs.length; i++) {
      const d = segs[i].end - segs[i].start;
      if (tOut < off[i] + d - EPS || i === segs.length - 1) return { i, src: segs[i].source, t: segs[i].start + Math.max(0, Math.min(d, tOut - off[i])), off: off[i] };
    }
    return null;
  }
  // وقت في الملف الأصلي ← وقت في الفيديو النهائي (أو null لو الحتة دي اتشالت)
  function toOut(segs, source, tSrc) {
    const off = offsets(segs);
    for (let i = 0; i < segs.length; i++) {
      const s = segs[i];
      if (s.source === source && tSrc >= s.start - EPS && tSrc <= s.end + EPS) return off[i] + (tSrc - s.start);
    }
    return null;
  }
  // القصّ عند المؤشر: الجزء بيتقسم اتنين بالظبط عند الوقت ده (أقل من 0.05 ث من الطرف = مفيش قصّ)
  function split(segs, tOut, minLen = 0.05) {
    const a = at(segs, tOut);
    if (!a) return segs;
    const s = segs[a.i];
    if (a.t - s.start < minLen || s.end - a.t < minLen) return segs;
    const left = { ...s, end: round(a.t) }, right = { ...s, id: newId(), start: round(a.t) };
    return [...segs.slice(0, a.i), left, right, ...segs.slice(a.i + 1)];
  }
  const remove = (segs, id) => (segs.length > 1 ? segs.filter((x) => x.id !== id) : segs);
  const round = (x) => Math.round(x * 1000) / 1000;

  // HH:MM:SS.mmm
  function timecode(t) {
    const ms = Math.max(0, Math.round(t * 1000));
    const h = Math.floor(ms / 3600000), m = Math.floor(ms / 60000) % 60, s = Math.floor(ms / 1000) % 60, r = ms % 1000;
    const p = (x, k = 2) => String(x).padStart(k, "0");
    return `${p(h)}:${p(m)}:${p(s)}.${p(r, 3)}`;
  }

  // الكلمات (بوقتها في الملف الأصلي) ← سطور الترجمة بوقت الفيديو النهائي بعد القصّ (الكلمة اللي اتشالت بتختفي)
  function mapCues(cueWords, segs) {
    const out = [];
    for (const c of cueWords) {
      const ws = [];
      for (const w of c.words) {
        const a = toOut(segs, w.source, w.start), b = toOut(segs, w.source, w.end);
        if (a == null) continue;
        ws.push({ word: w.word, start: a, end: b == null ? a + (w.end - w.start) : b });
      }
      if (ws.length) out.push({ id: c.id, start: ws[0].start - 0.05, end: ws[ws.length - 1].end + 0.25, words: ws });
    }
    for (let i = 0; i + 1 < out.length; i++) out[i].end = Math.min(out[i].end, out[i + 1].start);
    return out;
  }

  // الرجوع/الإعادة: نسخ من الحالة كلها (JSON)
  class History {
    constructor(state, max = 100) { this.stack = [JSON.stringify(state)]; this.i = 0; this.max = max; }
    push(state) { const s = JSON.stringify(state); if (s === this.stack[this.i]) return; this.stack = this.stack.slice(0, this.i + 1); this.stack.push(s);
      if (this.stack.length > this.max) this.stack.shift(); this.i = this.stack.length - 1; }
    undo() { if (this.i > 0) this.i--; return JSON.parse(this.stack[this.i]); }
    redo() { if (this.i < this.stack.length - 1) this.i++; return JSON.parse(this.stack[this.i]); }
    get canUndo() { return this.i > 0; }
    get canRedo() { return this.i < this.stack.length - 1; }
  }

  const api = { newId, total, offsets, at, toOut, split, remove, timecode, mapCues, History };
  if (typeof module !== "undefined" && module.exports) module.exports = api; else root.StudioCore = api;
})(typeof window !== "undefined" ? window : globalThis);
