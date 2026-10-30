// =====================================================================
//  موديلات حقيقية من Objaverse (allenai/objaverse على Hugging Face: نسخة عامة من موديلات Sketchfab
//  بنفس رخصها) — من غير حساب ولا توكن. → assets/models/<key>.glb
//  - الرخصة بتتقري من جوه الملف نفسه (asset.extras.license) ومن الـ metadata: أي حاجة غير CC0 / CC BY بتترفض
//  - بعد التحميل: gltf-transform (تقليل المثلثات + الخامات ≤ 1024)، والأصل في ../data/models/objaverse/ (مش في git)
//  - src/config/modelCredits.json بيتحدّث (العنوان، الفنان، الرخصة، اللينك الأصلي على Sketchfab)
//   node tools/models/objaverse.mjs [key ...]
// =====================================================================
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '../..');
const RAW = path.resolve(ROOT, '../data/models/objaverse');
const HF = 'https://huggingface.co/datasets/allenai/objaverse/resolve/main/';

// اختيار يدوي بعد ما صورة كل موديل اتشافت (2026-10-30). tris = الحد الأقصى بعد التبسيط
export const MODELS = [
  { key: 'truck_canter', path: 'glbs/000-063/2b58376d6aaf4641adf30d4c9044de74.glb', role: 'ميتسوبيشي فوسو كانتر (نقل خفيف "جامبو")', tris: 20000, err: 0.04 },
  { key: 'car_corolla_ke80', path: 'glbs/000-066/2b30faa611e64177a94a69098d27d1fb.glb', role: 'تويوتا كورولا KE80 (ملاكي قديم منتشر)', tris: 18000 },
  { key: 'car_corolla_e70', path: 'glbs/000-066/c4d66d21968c41da89114e2300578bc5.glb', role: 'تويوتا كورولا E70 (ملاكي قديم)', tris: 18000, err: 0.03 },
  { key: 'pickup_90s', path: 'glbs/000-089/6c48c94be8974dc7a5932f697c0ba68f.glb', role: 'بيك أب كابينة واحدة (التسعينات) — ربع نقل', tris: 16000, tex: 256 },
  { key: 'pickup_toyota', path: 'glbs/000-103/cad83751a295463bbb8b823c11a181ea.glb', role: 'تويوتا بيك أب (هايلكس قديم) — ربع نقل', tris: 18000, err: 0.03 },
  { key: 'bus_karosa', path: 'glbs/000-106/21262813724e401b88333d381c4626f7.glb', role: 'أتوبيس (كاروسا C734) — المدن غير القاهرة', tris: 16000 },
];

const OK = /^(CC-BY-4\.0|CC-BY-3\.0|CC0)/i;
function glbJson(file) {
  const b = fs.readFileSync(file), n = b.readUInt32LE(12);
  return JSON.parse(b.subarray(20, 20 + n).toString('utf8'));
}
function tris(J) {
  let t = 0;
  for (const m of J.meshes || []) for (const p of m.primitives) t += Math.floor(J.accessors[p.indices ?? p.attributes.POSITION].count / 3);
  return t;
}

const want = process.argv.slice(2);
const credFile = path.join(ROOT, 'src/config/modelCredits.json');
const credits = fs.existsSync(credFile) ? JSON.parse(fs.readFileSync(credFile, 'utf8')) : {};
fs.mkdirSync(RAW, { recursive: true });
for (const M of MODELS) {
  if (want.length && !want.includes(M.key)) continue;
  const src = path.join(RAW, M.key + '.glb');
  if (!fs.existsSync(src)) {
    const r = await fetch(HF + M.path);
    if (!r.ok) { console.log(`FAIL ${M.key}: ${r.status}`); continue; }
    fs.writeFileSync(src, Buffer.from(await r.arrayBuffer()));
  }
  const J = glbJson(src), ex = J.asset?.extras || {};
  if (!OK.test(ex.license || '')) { console.log(`SKIP ${M.key}: license "${ex.license}"`); continue; }
  const out = path.join(ROOT, 'assets/models', `${M.key}.glb`);
  const ratio = Math.min(1, M.tris / tris(J));
  // (من غير --join: أسامي القطع زي العجل لازم تفضل عشان اللعبة تلفّها)
  execFileSync('npx', ['gltf-transform', 'optimize', src, out, '--compress', 'meshopt', '--texture-compress', 'webp', '--texture-size', String(M.tex ?? 512), '--palette', 'false', '--join', 'false', '--instance', 'false', '--flatten', 'false',
    '--simplify', ratio < 1 ? 'true' : 'false', '--simplify-ratio', String(ratio.toFixed(4)), '--simplify-error', String(M.err ?? 0.012)], { stdio: 'inherit', cwd: ROOT });
  credits[M.key] = { name: ex.title, author: (ex.author || '').replace(/\s*\(.*$/, ''), authorUrl: (ex.author || '').match(/\((.*)\)/)?.[1], url: ex.source, license: ex.license, role: M.role, via: 'Objaverse (allenai/objaverse, Hugging Face)', fetched: new Date().toISOString().slice(0, 10) };
  console.log(`OK ${M.key}: ${ex.title} — ${credits[M.key].author} (${ex.license}) ${(fs.statSync(out).size / 1e6).toFixed(2)} MB, ${tris(J)} → ~${Math.round(tris(J) * ratio)} tris`);
}
fs.writeFileSync(credFile, JSON.stringify(credits, null, 1));
