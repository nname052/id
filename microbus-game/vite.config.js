import { defineConfig } from 'vite';

import fs from 'node:fs';
import path from 'node:path';

// البيانات الخام (public/data/<مدينة>: مئات الملفات الصغيرة) للأدوات بس — اللعبة بتقرا النسخة المضغوطة من public/packs.
// بتتشال من الـ build: صفحة Claude ليها حد 511 ملف
const dropRawData = { name: 'drop-raw-data', apply: 'build', closeBundle() { fs.rmSync(path.resolve('dist/data'), { recursive: true, force: true }); } };

export default defineConfig({
  plugins: [dropRawData],
  base: './',
  server: { host: true, port: 5173, hmr: process.env.NOHMR ? false : undefined },
  preview: { port: 4173 },
  build: {
    target: 'es2020',
    chunkSizeWarningLimit: 3000,
    // الموديلات (GLB) بتتدمج جوه الـ JS عشان اللعبة تشتغل على أي استضافة (حتى لو مبتقدمش ملفات .glb)
    assetsInlineLimit: (file) => (/\.glb$/i.test(file) ? true : undefined),
  },
});
