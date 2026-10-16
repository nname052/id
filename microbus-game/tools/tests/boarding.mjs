// =====================================================================
//  ركوب/نزول الركاب (شبين) لكل عربية: مستني → يمشي للباب → يلف ناحية جوه → يركب → يقعد (كرسي لكل واحد)
//  والعكس في النزول. بيفشل لو حد اتعلق، أو دخل/خرج وضهره للباب، أو اتنين على نفس الكرسي.
//   node tools/tests/boarding.mjs [baseUrl]     (صور في tools/tests/out/board_*.jpg)
// =====================================================================
import fs from 'fs';
import path from 'path';
const PW = process.env.PLAYWRIGHT || '/opt/node22/lib/node_modules/playwright/index.mjs';
const { chromium } = await import(PW);
const BASE = process.argv[2] || 'http://localhost:5173/';
const OUT = path.join(path.dirname(new URL(import.meta.url).pathname), 'out');
fs.mkdirSync(OUT, { recursive: true });
const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: 640, height: 400 } });
page.setDefaultTimeout(1800000);
const errors = []; page.on('pageerror', (e) => errors.push(e.message));
await page.goto(`${BASE}?map=shibin`);
await page.waitForFunction(() => !document.getElementById('go').disabled);
await page.click('#go'); await page.waitForTimeout(1500);
let allPass = !errors.length;
for (const kind of ['microbus', 'taxi', 'tuktuk']) {
  const r = await page.evaluate(async (kind) => {
    const g = game, P = g.passengers, THREE = window.__THREE;
    g.renderer.setAnimationLoop(null);
    g.setVehicle(kind);
    const ph = g.player.physics;
    const shots = [];
    const shot = () => {
      const c = new THREE.Vector3(); g.player.rig.root.getWorldPosition(c);
      const [fx, fz] = ph.forward, rx = -fz, rz = fx;
      const cam = new THREE.PerspectiveCamera(45, 640 / 400, 0.1, 300);
      cam.position.set(c.x + rx * 6 - fx * 3, c.y + 2.6, c.z + rz * 6 - fz * 3); cam.lookAt(c.x, c.y + 0.8, c.z); cam.updateMatrixWorld();
      g.renderer.render(g.scene, cam); shots.push(g.renderer.domElement.toDataURL('image/jpeg', 0.8));
    };
    const step = (n) => { for (let i = 0; i < n; i++) { g.debugSim(1 / 30); P.update(1 / 30, ph); } };
    // محطة فيها ناس مستنيين (على خط الميكروباص لو ميكروباص)
    let st = null;
    for (let tries = 0; tries < 40 && !st; tries++) {
      for (const s of P.stops) if (!s.waiting.length && (P.mode !== 'line' || P.lineStops.includes(s))) P._spawnWaiting(s);
      st = P.stops.find((s) => s.waiting.some((w) => w.state === 'wait' && (P.mode !== 'line' || w.dest)) && (P.mode !== 'line' || P.lineStops.includes(s)) && s.kind !== 'terminal');
      if (!st) step(15);
    }
    if (!st) return { kind, error: 'no stop with people', mode: P.mode };
    for (const sgn of [1, -1]) {
      ph.reset(st.mx, st.mz, Math.atan2(-st.ax * sgn, -st.az * sgn)); g.player._savePrev();
      const [fx, fz] = ph.forward; if ((st.x - ph.x) * -fz + (st.z - ph.z) * fx > 0.5) break;
    }
    g.debugSim(0.5);
    const seen = new Map(); let badFacing = 0, enterSamples = 0, maxT = 0, shotEnter = false;
    // اتجاه "لجوه" عند الباب: من نقطة برا الباب لنقطة جوه
    const inward = () => { const a = P._doorPoint(new THREE.Vector3(), 0.5), b = P._doorPoint(new THREE.Vector3(), -0.45); const l = Math.hypot(b.x - a.x, b.z - a.z) || 1; return [(b.x - a.x) / l, (b.z - a.z) / l]; };
    const facing = (w) => { const [ix, iz] = inward(); return (Math.sin(w.heading) * ix + Math.cos(w.heading) * iz) * (w.state === 'exit' ? -1 : 1); };
    for (let t = 0; t < 40 * 30; t++) {
      step(1);
      for (const w of P.walkers) {
        if (!seen.has(w)) seen.set(w, []);
        const h = seen.get(w); if (h[h.length - 1] !== w.state) h.push(w.state);
        if ((w.state === 'enter' && w.moving) || w.state === 'exit') {
          enterSamples++; if (facing(w) < 0.7) badFacing++;
          if (!shotEnter && w.state === 'enter' && w.enterT > 0.7) { shotEnter = true; shot(); }
        }
      }
      if (P.onboard.length && !P.walkers.some((w) => w.state === 'toDoor' || w.state === 'enter')) { maxT = t / 30; break; }
    }
    const boarded = P.onboard.length;
    const seats = new Set(P.onboard.map((o) => o.seat)); const dupSeats = boarded - seats.size;
    const stuck = P.walkers.filter((w) => w.state === 'toDoor' || w.state === 'enter').length;
    step(10); shot();
    // النزول في نفس المكان
    P.onboard.forEach((o, i) => { o.leaving = true; o.leaveDelay = 0.3 + i * 0.8; o.leaveStop = st; });
    let exitStates = 0, shotExit = false;
    for (let t = 0; t < 25 * 30 && (P.onboard.length || P.walkers.some((w) => w.state === 'exit')); t++) {
      step(1);
      for (const w of P.walkers) if (w.state === 'exit') { exitStates++; enterSamples++; if (facing(w) < 0.7) badFacing++; if (!shotExit && w.enterT > 0.5) { shotExit = true; shot(); } }
    }
    const left = P.onboard.length;
    P.reset?.();
    const flows = [...seen.values()].filter((h) => h.includes('enter') || h.includes('exit')).slice(0, 3).map((h) => h.join('>'));
    return { kind, mode: P.mode, stop: st.name, boarded, dupSeats, stuck, secondsToBoard: maxT, badFacing, facingSamples: enterSamples, exitSamples: exitStates, notAlighted: left, flows, shots };
  }, kind);
  const shots = r.shots || []; delete r.shots;
  shots.forEach((d, i) => fs.writeFileSync(path.join(OUT, `board_${kind}_${i}.jpg`), Buffer.from(d.split(',')[1], 'base64')));
  const pass = !r.error && r.boarded > 0 && r.dupSeats === 0 && r.stuck === 0 && r.badFacing === 0 && r.notAlighted === 0 && r.exitSamples > 0;
  allPass &&= pass;
  console.log(`${pass ? 'PASS' : 'FAIL'} ${kind}`, JSON.stringify(r));
}
console.log(errors.length ? 'errors: ' + errors.join(' | ') : 'no page errors');
await browser.close();
process.exit(allPass ? 0 : 1);
