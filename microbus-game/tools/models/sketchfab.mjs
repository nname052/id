// =====================================================================
//  موديلات حقيقية من Sketchfab (CC0 / CC BY بس) → assets/models/<key>.glb
//  - الرخصة بتتشيك تاني من الـ API وقت التحميل: أي رخصة غير CC0/CC-BY (NonCommercial, Standard…) بتترفض
//  - التحميل محتاج توكن: متغير البيئة SKETCHFAB_API_TOKEN (sketchfab.com → Settings → Password & API)
//  - بعد التحميل: gltf-transform (تقليل المثلثات للعدد المطلوب + الخامات ≤ 1024 بكسل + دمج/تنضيف)
//    والأصل بيتحفظ في ../data/models/sketchfab/<key>/ (مش في git)
//  - CREDITS.md + src/config/modelCredits.json بيتحدّثوا (اسم الموديل، الفنان، الرخصة، اللينك)
//   NODE_USE_ENV_PROXY=1 node tools/models/sketchfab.mjs [key ...]   (البروكسي بتاع البيئة دي: Node fetch مابيستخدموش من غيرها)
// =====================================================================
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '../..');
const RAW = path.resolve(ROOT, '../data/models/sketchfab');
const OK_LICENSES = ['CC0 Public Domain', 'CC Attribution'];

// اختيار يدوي بعد فحص الصورة والرخصة والمثلثات (2026-10-29). tris = الحد الأقصى بعد التبسيط.
export const MODELS = [
  { key: 'tuktuk_real', uid: '5775d012693741008acff9dad410e92d', role: 'التوكتوك (باجاج — نفس شكل توكتوك مصر)', tris: 12000, length: 2.65 },
  { key: 'car_lanos', uid: '537cf27c1f354cd79c4d990759d2da4c', role: 'شيفروليه لانوس (مرور)', tris: 15000, length: 4.24 },
  { key: 'car_verna', uid: '132840063af24357900df22baeefe5fb', role: 'هيونداي فيرنا/أكسنت (مرور)', tris: 15000, length: 4.37 },
  { key: 'car_sunny', uid: '6f4866d9cfe24dc7a0a60a4214f18d2c', role: 'نيسان صني N16 (مرور/تاكسي)', tris: 15000, length: 4.34 },
  // المعالم (فوتوجرامتري/موديلات حقيقية) — بتاخد مكان الشكل المبني بالكود في Monuments.js لو موجودة
  { key: 'mon_sphinx', uid: 'f169dbe7974648babe327179091e0ee3', role: 'أبو الهول (الجيزة)', tris: 30000 },
  { key: 'mon_cairo_tower', uid: 'ef1d34efdcb54d22a3b3a0748b1eca0d', role: 'برج القاهرة', tris: 25000 },
  { key: 'mon_ali_mosque', uid: '7cf1e084720d4058a9f96a4ed2a1eb35', role: 'جامع محمد علي (قلعة صلاح الدين)', tris: 30000 },
];

const token = process.env.SKETCHFAB_API_TOKEN;
async function api(p, auth = false) {
  const r = await fetch(`https://api.sketchfab.com/v3/${p}`, { headers: auth ? { Authorization: `Token ${token}` } : {} });
  if (!r.ok) throw new Error(`${r.status} ${p}`);
  return r.json();
}

const want = process.argv.slice(2);
const credits = fs.existsSync(path.join(ROOT, 'src/config/modelCredits.json')) ? JSON.parse(fs.readFileSync(path.join(ROOT, 'src/config/modelCredits.json'), 'utf8')) : {};
for (const M of MODELS) {
  if (want.length && !want.includes(M.key)) continue;
  const info = await api(`models/${M.uid}`);
  const lic = info.license?.label;
  if (!OK_LICENSES.includes(lic) || !info.isDownloadable) { console.log(`SKIP ${M.key}: license "${lic}" downloadable=${info.isDownloadable}`); continue; }
  if (!token) { console.log(`NEED TOKEN ${M.key} (${info.name} — ${lic}) — set SKETCHFAB_API_TOKEN`); continue; }
  const dir = path.join(RAW, M.key); fs.mkdirSync(dir, { recursive: true });
  const dl = await api(`models/${M.uid}/download`, true);
  const g = dl.glb || dl.gltf;
  const buf = Buffer.from(await (await fetch(g.url)).arrayBuffer());
  const src = path.join(dir, dl.glb ? 'source.glb' : 'source.zip');
  fs.writeFileSync(src, buf);
  let input = src;
  if (!dl.glb) { execFileSync('python3', ['-I', '-c', `import zipfile;zipfile.ZipFile(${JSON.stringify(src)}).extractall(${JSON.stringify(dir)})`]); input = fs.readdirSync(dir).map((f) => path.join(dir, f)).find((f) => f.endsWith('.gltf')); }
  const out = path.join(ROOT, 'assets/models', `${M.key}.glb`);
  // تبسيط للعدد المطلوب + خامات ≤1024 (jpeg/png زي ما هي) + دمج القطع والخامات الساده في palette = draw calls أقل
  // (القطع اللي ليها اسم زي العجل مابتندمجش: اللعبة بتلفّها)
  const tri = info.faceCount || M.tris, ratio = Math.min(1, M.tris / tri);
  execFileSync('npx', ['gltf-transform', 'optimize', input, out, '--compress', 'false', '--texture-compress', 'false', '--texture-size', '1024', '--palette', 'true', '--join', 'true',
    '--simplify', ratio < 1 ? 'true' : 'false', '--simplify-ratio', String(ratio.toFixed(4)), '--simplify-error', '0.002'], { stdio: 'inherit', cwd: ROOT });
  credits[M.key] = { name: info.name, author: info.user.displayName || info.user.username, authorUrl: info.user.profileUrl, url: info.viewerUrl, license: lic, role: M.role, uid: M.uid, fetched: new Date().toISOString().slice(0, 10) };
  console.log(`OK ${M.key}: ${info.name} — ${credits[M.key].author} (${lic}) ${(fs.statSync(out).size / 1e6).toFixed(2)} MB`);
}
fs.writeFileSync(path.join(ROOT, 'src/config/modelCredits.json'), JSON.stringify(credits, null, 1));
