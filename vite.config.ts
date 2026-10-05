import { defineConfig } from 'vite';

export default defineConfig({
  base: '/edward-stitchhands/',
  worker: { format: 'es' },
  optimizeDeps: { exclude: ['pyodide', 'mupdf'] },
  build: { target: 'es2022' },
});
