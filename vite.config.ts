import tailwindcss from '@tailwindcss/vite';
import {fileURLToPath} from 'node:url';
import {existsSync, readdirSync, readFileSync, statSync, utimesSync} from 'node:fs';
import {join, resolve} from 'node:path';
import type {Plugin} from 'vite';
import {defineConfig} from 'vitest/config';
import react from '@vitejs/plugin-react';
// Cargo watches embedded assets by modification time. Keep fresh builds while
// avoiding a native relink when Vite emits exactly the same bytes again.
function preserveUnchangedAssetTimes(): Plugin {
  let output = '';
  const previous = new Map<string, {bytes: Buffer; atime: Date; mtime: Date}>();
  return {
    name: 'preserve-unchanged-asset-times',
    apply: 'build',
    configResolved(config) { output = resolve(config.root, config.build.outDir); },
    buildStart() {
      previous.clear();
      if (!existsSync(output)) return;
      for (const relative of readdirSync(output, {recursive: true})) {
        const path = join(output, String(relative));
        const stat = statSync(path);
        if (stat.isFile()) previous.set(path, {bytes: readFileSync(path), atime: stat.atime, mtime: stat.mtime});
      }
    },
    closeBundle() {
      for (const [path, old] of previous) {
        if (existsSync(path) && readFileSync(path).equals(old.bytes)) utimesSync(path, old.atime, old.mtime);
      }
      previous.clear();
    },
  };
}

// The app always plays its animations: drop every prefers-reduced-motion block, including HeroUI's own.
function ignoreReducedMotion(): Plugin {
  const start = /@media[^{]*prefers-reduced-motion\s*:\s*reduce[^{]*\{/g;
  return {
    name: 'ignore-reduced-motion',
    transform(code, id) {
      if (!/\.css(\?|$)/.test(id) || !code.includes('prefers-reduced-motion')) return null;
      let result = '', last = 0, match: RegExpExecArray | null;
      start.lastIndex = 0;
      while ((match = start.exec(code))) {
        let depth = 1, index = match.index + match[0].length;
        while (depth > 0 && index < code.length) {
          const char = code[index++];
          if (char === '{') depth++; else if (char === '}') depth--;
        }
        result += code.slice(last, match.index);
        last = index;
        start.lastIndex = index;
      }
      return {code: result + code.slice(last), map: null};
    },
  };
}

export default defineConfig({plugins: [react(), tailwindcss(), ignoreReducedMotion(), preserveUnchangedAssetTimes()], test: {include: ['src/**/*.test.{js,ts,jsx,tsx}']}, base: './', server: {host: '127.0.0.1', port: 1420, strictPort: true, watch: {ignored: ['**/src-tauri/**', fileURLToPath(new URL('./.private/', import.meta.url)).replace(/\\/g, '/') + '**']}}, build: {target: 'chrome105', rolldownOptions: {output: {comments: {legal: true}}}}});
