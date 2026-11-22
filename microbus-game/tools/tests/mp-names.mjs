// اللعب الجماعي: لاعبين (صفحتين) في أوضة واحدة — كل واحد بيكتب اسمه ويختار رقمه ويبدأ.
// أوضة Claude متقلّدة بـ BroadcastChannel بنفس قواعد room.d.ts (presence بيتدمج، peers فيها isMe/sameTab/kind).
// بنشوف: اسم صاحبك ورقمه صح فوق عربيته وعلى الخريطة واللوبي، ومفيش نسخة تانية منك، ومفيش "لاعب undefined"،
// والاسم بيفضل ثابت طول السواقة (مايتقلبش مع رسايل المكان)، ولو غيّر اسمه بيتحدّث.
//   node tools/tests/mp-names.mjs [url]
const { chromium } = await import('/opt/node22/lib/node_modules/playwright/index.mjs');
const BASE = process.argv[2] || 'http://localhost:5173/';
const b = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const ctx = await b.newContext({ viewport: { width: 640, height: 360 } });
// أوضة متقلّدة (نفس الـ API بتاع claude.use("room"))
await ctx.addInitScript(() => {
  const peer = 'p' + Math.random().toString(36).slice(2, 8);
  const bc = new BroadcastChannel('fake-room');
  const mine = {}; const others = new Map(); const pfns = [];
  let frozen = null;
  const snap = () => (frozen ||= Object.freeze([{ peer, by: 'u-' + peer, isMe: true, sameTab: true, kind: 'viewer', guest: false, presence: Object.freeze({ ...mine }), updatedAt: Date.now() }, ...[...others.values()]]));
  const fire = () => { frozen = null; const s = snap(); for (const f of pfns) try { f({ peers: s, joined: [], left: [], updated: [] }); } catch (e) { console.error(e); } };
  bc.onmessage = (ev) => { const m = ev.data; if (m.t === 'p') { others.set(m.peer, Object.freeze({ peer: m.peer, by: 'u-' + m.peer, isMe: false, sameTab: false, kind: 'viewer', guest: false, presence: Object.freeze(m.presence), updatedAt: Date.now() })); fire(); } if (m.t === 'hello') bc.postMessage({ t: 'p', peer, presence: { ...mine } }); };
  const room = {
    presence: async (patch) => { for (const [k, v] of Object.entries(patch)) { if (v === null) delete mine[k]; else mine[k] = v; } bc.postMessage({ t: 'p', peer, presence: { ...mine } }); fire(); },
    peers: () => snap(), onPeers: (fn) => { pfns.push(fn); return () => {}; }, connected: () => true, onConnection: () => () => {},
    emit: async () => {}, on: () => () => {},
  };
  setTimeout(() => bc.postMessage({ t: 'hello' }), 50);
  window.claude = { use: async (n) => (n === 'room' ? room : null) };
});
const errs = [];
const open = async (name, seat) => {
  const p = await ctx.newPage(); p.setDefaultTimeout(900000); p.on('pageerror', (e) => errs.push(name + ': ' + e.message));
  await p.goto(`${BASE}?map=shibin`); await p.waitForFunction(() => !document.getElementById('go').disabled && game.mp?.available);
  await p.evaluate(() => { game.renderer.render = () => {}; if (game.postfx) game.postfx.render = () => {}; }); // (المنطق بس — صفحتين بترسموا على كارت سوفتوير بطيء جدًا)
  await p.fill('#pname', name);
  await p.click(`#seats button[data-seat="${seat}"]`);
  return p;
};
const A = await open('أحمد', 2);
const B = await open('صاحبي', 2); // (نفس الرقم: لازم واحد ياخده والتاني يتنقل لرقم فاضي — من غير ما الاسمين يتلخبطوا)
await A.waitForTimeout(1500);
const lobby = async (p) => p.evaluate(() => [...document.querySelectorAll('#seats button')].map((b) => b.dataset.seat + ':' + b.className.trim() + ':' + b.querySelector('small').textContent));
const lobbyA = await lobby(A), lobbyB = await lobby(B);
for (const p of [A, B]) await p.evaluate(() => document.getElementById('go').click());
await A.waitForTimeout(4000);
const view = async (p) => p.evaluate(() => {
  const mp = game.mp; document.querySelector('#linepick .lp-close')?.click();
  const R = [...mp.remotes.values()];
  return { me: { ...mp.me }, remotes: R.map((r) => ({ seat: r.seat, name: r.name, label: !!r.label?.parent, drawn: r.label?.userData?.lbl })), mapDots: (mp.positions?.() || []).map((o) => `${o.seat} ${o.name}`) };
});
// سواقة شوية (رسايل المكان رايحة جاية) — الاسم لازم يفضل زي ما هو
const names = { A: new Set(), B: new Set() };
for (let k = 0; k < 8; k++) {
  for (const [key, p] of [['A', A], ['B', B]]) { await p.evaluate(() => game.debugSim(0.3, { throttle: 0.5 })); const v = await view(p); for (const r of v.remotes) names[key].add(`${r.seat}|${r.name}`); }
  await A.waitForTimeout(400);
}
const vA = await view(A), vB = await view(B);
// تغيير الاسم وهو بيلعب
await B.evaluate(() => game.mp.setMe({ name: 'محمد' })); await A.waitForTimeout(1200);
const vA2 = await view(A);
await b.close();
const out = { lobbyA, lobbyB, vA, vB, seenByA: [...names.A], seenByB: [...names.B], afterRename: vA2.remotes, errs };
console.log(JSON.stringify(out, null, 1));
const ok = vA.me.seat !== vB.me.seat && vA.remotes.length === 1 && vB.remotes.length === 1 &&
  vA.remotes[0].name === 'صاحبي' && vB.remotes[0].name === 'أحمد' && vA.remotes[0].seat === vB.me.seat && vB.remotes[0].seat === vA.me.seat &&
  names.A.size === 1 && names.B.size === 1 && vA2.remotes[0]?.name === 'محمد' && vA.mapDots.length === 1 && !errs.length;
console.log(ok ? 'PASS mp-names' : 'FAIL mp-names'); process.exit(ok ? 0 : 1);
