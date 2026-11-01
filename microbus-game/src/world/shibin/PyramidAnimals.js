// =====================================================================
//  جمال وأحصنة منطقة الأهرامات (MAJOR UPDATE — STAGE 5): بس لو الخريطة فيها أهرامات حقيقية (landmarks: pyramid).
//  - الجمال: مجموعات (2–3) واقفة حوالين الهضبة، كل جمل بيتمايل/بيلف راسه شوية (الموديل من غير أنيميشن — حركة إجرائية خفيفة).
//  - الأحصنة: موديل متحرك (أنيميشن المشي من الملف)، بتلف ببطء في دواير واسعة على الرمل جنب الأهرامات.
//  - كلهم برّه الطرق (≥ 8م من أي طريق) وبرّه جسم الهرم نفسه. الموديلات: CC BY 4.0 (modelCredits.json).
//  - بيتحدّثوا بس لو الكاميرا قريبة (< 450م) — بعيد: مابيتحرّكوش (توفير).
// =====================================================================
import * as THREE from 'three';

export class PyramidAnimals {
  constructor(scene, world, assets, { mobile = false } = {}) {
    this.group = new THREE.Group(); this.group.name = 'pyramid-animals';
    this.items = []; this.t = 0;
    const P = (world?.landmarks?.confirmed || []).filter((l) => l.kind === 'pyramid' && l.inside_region !== false);
    const camel = assets?.get('camel'), horse = assets?.get('horse_saddle');
    if (!P.length || (!camel && !horse)) return;
    let seed = 7; const R = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    const roadD = (x, z) => { const r = world.roadPose?.(x, z); return r ? Math.hypot(r.x - x, r.z - z) : 1e9; };
    const inPyr = (x, z) => P.some((p) => { let r = 0; for (const [a, b] of p.footprint || []) r = Math.max(r, Math.hypot(a - p.x, b - p.z)); return Math.hypot(x - p.x, z - p.z) < r * 0.8 + 6; });
    const okAt = (x, z) => roadD(x, z) > 8 && !inPyr(x, z);
    // مكان حوالين هرم: على بعد (نص قطره + 15–60م) في اتجاه عشوائي
    const spotNear = (p) => {
      let r0 = 0; for (const [a, b] of p.footprint || []) r0 = Math.max(r0, Math.hypot(a - p.x, b - p.z));
      for (let k = 0; k < 30; k++) {
        const a = R() * Math.PI * 2, d = r0 * 0.75 + 15 + R() * 45, x = p.x + Math.sin(a) * d, z = p.z + Math.cos(a) * d;
        if (okAt(x, z)) return { x, z };
      }
      return null;
    };
    const nCamelGroups = mobile ? 3 : 5, nHorses = mobile ? 2 : 4;
    if (camel) for (let g = 0; g < nCamelGroups; g++) {
      const c = spotNear(P[g % P.length]); if (!c) continue;
      const n = 2 + (R() < 0.5 ? 1 : 0);
      for (let i = 0; i < n; i++) {
        const x = c.x + (i - 1) * 3.4 + (R() - 0.5), z = c.z + (R() - 0.5) * 2.5;
        if (!okAt(x, z)) continue;
        const { root } = camel.instantiate(R);
        root.position.set(x, world.height?.(x, z) ?? 0, z); root.rotation.y = R() * Math.PI * 2;
        this.group.add(root);
        this.items.push({ kind: 'camel', root, yaw0: root.rotation.y, ph: R() * 10 });
      }
    }
    if (horse) for (let h = 0; h < nHorses; h++) {
      const c = spotNear(P[(h + 1) % P.length]); if (!c) continue;
      const { root, mixer } = horse.instantiate(R);
      const rad = 10 + R() * 12, dir = R() < 0.5 ? 1 : -1;
      this.group.add(root);
      this.items.push({ kind: 'horse', root, mixer, cx: c.x, cz: c.z, rad, dir, a: R() * Math.PI * 2, w: dir * 1.1 / rad }); // ~1.1 م/ث (مشي حصان)
    }
    this.world = world;
    scene.add(this.group);
  }

  update(dt, cam) {
    if (!this.items.length) return;
    this.t += dt;
    for (const it of this.items) {
      const r = it.root;
      if (cam && Math.abs(r.position.x - cam.x) + Math.abs(r.position.z - cam.z) > 450) continue;
      if (it.kind === 'camel') {
        // الجمل واقف: بيتمايل ويلف شوية (من غير ما يتزحلق)
        r.rotation.y = it.yaw0 + Math.sin(this.t * 0.25 + it.ph) * 0.25;
        r.rotation.z = Math.sin(this.t * 0.9 + it.ph) * 0.012;
      } else {
        // الحصان: دايرة ببطء — لو الخطوة الجاية على طريق بيلف للناحية التانية
        let a = it.a + it.w * dt;
        let x = it.cx + Math.sin(a) * it.rad, z = it.cz + Math.cos(a) * it.rad;
        const rp = this.world.roadPose?.(x, z);
        if (rp && Math.hypot(rp.x - x, rp.z - z) < 7) { it.w = -it.w; it.dir = -it.dir; a = it.a; x = r.position.x; z = r.position.z; }
        it.a = a;
        r.position.set(x, this.world.height?.(x, z) ?? 0, z);
        r.rotation.y = a + (it.dir > 0 ? Math.PI / 2 : -Math.PI / 2);
        it.mixer?.update(dt);
      }
    }
  }

  stats() { return { camels: this.items.filter((i) => i.kind === 'camel').length, horses: this.items.filter((i) => i.kind === 'horse').length }; }
}
