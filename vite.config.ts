import { defineConfig } from 'vitest/config';
import { readFileSync } from 'node:fs';
export default defineConfig({
  base: './',
  plugins: [
    {
      name: 'extension-manifest',
      generateBundle() {
        this.emitFile({
          type: 'asset',
          fileName: 'manifest.json',
          source: readFileSync('manifest.json', 'utf8'),
        });
        this.emitFile({
          type: 'asset',
          fileName: 'LICENSE.txt',
          source: readFileSync('LICENSE', 'utf8'),
        });
        for (const file of ['Paper-Mono-LICENSE.txt', 'Paper-Mono-OFL.txt']) {
          this.emitFile({
            type: 'asset',
            fileName: `licences/${file}`,
            source: readFileSync(`assets/licences/${file}`, 'utf8'),
          });
        }
      },
    },
  ],
  build: {
    target: 'chrome120',
    rollupOptions: {
      input: {
        switcher: 'src/switcher/index.html',
        settings: 'src/settings/index.html',
        background: 'src/background/service-worker.ts',
      },
      output: {
        entryFileNames: (chunk) =>
          chunk.name === 'background' ? 'background.js' : 'assets/[name]-[hash].js',
      },
    },
  },
  test: { include: ['tests/**/*.test.ts'], environment: 'node' },
});
