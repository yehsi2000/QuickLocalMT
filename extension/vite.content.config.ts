import { defineConfig } from 'vite';
import { fileURLToPath, URL } from 'node:url';

const root = fileURLToPath(new URL('.', import.meta.url));

export default defineConfig({
  publicDir: false,
  build: {
    outDir: 'dist',
    emptyOutDir: false,
    target: 'chrome110',
    lib: {
      entry: `${root}src/content/content-script.ts`,
      name: 'LocalSelectorTranslatorContent',
      formats: ['iife'],
      fileName: () => 'content-script.js',
    },
  },
});
