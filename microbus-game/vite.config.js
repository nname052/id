import { defineConfig } from 'vite';

export default defineConfig({
  base: './',
  server: { host: true, port: 5173 },
  preview: { port: 4173 },
  build: {
    target: 'es2020',
    chunkSizeWarningLimit: 3000,
    // الموديلات (GLB) بتتدمج جوه الـ JS عشان اللعبة تشتغل على أي استضافة (حتى لو مبتقدمش ملفات .glb)
    assetsInlineLimit: (file) => (/\.glb$/i.test(file) ? true : undefined),
  },
});
