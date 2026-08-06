import { defineConfig } from 'vite';
import { fileURLToPath, URL } from 'node:url';

const root = fileURLToPath(new URL('.', import.meta.url));

export default defineConfig({
  base: './',
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    target: 'chrome110',
    rollupOptions: {
      input: {
        'service-worker': `${root}src/background/service-worker.ts`,
        popup: `${root}src/popup/popup.html`,
        options: `${root}src/options/options.html`,
      },
      output: {
        entryFileNames: (chunkInfo) => {
          if (chunkInfo.name === 'service-worker') {
            return 'service-worker.js';
          }
          return 'assets/[name]-[hash].js';
        },
        chunkFileNames: 'assets/[name]-[hash].js',
        assetFileNames: 'assets/[name]-[hash][extname]',
      },
    },
  },
});
