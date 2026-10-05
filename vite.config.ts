/// <reference types="vitest/config" />
import { defineConfig } from 'vite';

export default defineConfig({
  base: '/edward-stitchhands/',
  worker: { format: 'es' },
  optimizeDeps: { exclude: ['pyodide', 'mupdf'] },
  build: { target: 'es2022' },
  test: { exclude: ['**/node_modules/**', '**/.git/**', '.claude/**', 'vendor/**', 'dist/**'] },
});
