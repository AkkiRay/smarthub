// Vite + Electron: один процесс собирает main / preload / renderer.
// envDir = корень монорепо → все три entrypoint'а читают один .env.

import { defineConfig, loadEnv } from 'vite';
import vue from '@vitejs/plugin-vue';
import electron from 'vite-plugin-electron';
import renderer from 'vite-plugin-electron-renderer';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ENV_DIR = resolve(__dirname, '../../');

// ELECTRON_RUN_AS_NODE превращает electron.exe в обычный Node: `require('electron')`
// возвращает путь к бинарнику, а не API → main падает на app.whenReady. Снимаем.
delete process.env['ELECTRON_RUN_AS_NODE'];

// Префикс '' = читать ВСЕ ключи (не только VITE_), main-process нужен сырой доступ
// к HUB_ENABLE_MOCK / LOG_LEVEL / HUB_*. vite-plugin-electron наследует env от родителя.
function injectEnv(mode: string): void {
  const env = loadEnv(mode, ENV_DIR, '');
  for (const [k, v] of Object.entries(env)) {
    // Shell-export имеет приоритет над файлом.
    if (process.env[k] === undefined) process.env[k] = v;
  }
}

// Native-модули остаются require()'ами в main и НЕ попадают в bundle:
// better-sqlite3 (N-API), mqtt/ws/bonjour-service (node:net/dgram),
// electron-store v8 (CJS+node:fs), electron-log (init side-effects).
const NATIVE_EXTERNALS = [
  'electron',
  'better-sqlite3',
  'mqtt',
  'bonjour-service',
  'electron-store',
  'electron-log',
  'ws',
];

export default defineConfig(({ mode }) => {
  injectEnv(mode);
  return {
    envDir: ENV_DIR,
    resolve: {
      alias: {
        '@': resolve(__dirname, 'src'),
        '@smarthome/shared': resolve(__dirname, '../../packages/shared/src/index.ts'),
      },
    },
    plugins: [
      vue(),
      electron([
        {
          entry: 'electron/main/index.ts',
          onstart({ startup }) {
            startup();
          },
          vite: {
            envDir: resolve(__dirname, '../../'),
            build: {
              outDir: 'dist-electron/main',
              sourcemap: true,
              minify: process.env['NODE_ENV'] === 'production',
              rollupOptions: {
                external: NATIVE_EXTERNALS,
                output: {
                  format: 'cjs',
                  entryFileNames: '[name].js',
                  chunkFileNames: '[name].js',
                },
              },
            },
            resolve: {
              alias: {
                '@core': resolve(__dirname, 'electron/core'),
                '@main': resolve(__dirname, 'electron/main'),
                '@smarthome/shared': resolve(__dirname, '../../packages/shared/src/index.ts'),
              },
            },
          },
        },
        {
          entry: 'electron/preload/index.ts',
          onstart({ reload }) {
            reload();
          },
          vite: {
            envDir: resolve(__dirname, '../../'),
            build: {
              outDir: 'dist-electron/preload',
              sourcemap: 'inline',
              minify: process.env['NODE_ENV'] === 'production',
              rollupOptions: {
                external: ['electron'],
                output: {
                  format: 'cjs',
                  entryFileNames: '[name].js',
                  chunkFileNames: '[name].js',
                },
              },
            },
            resolve: {
              alias: {
                '@smarthome/shared': resolve(__dirname, '../../packages/shared/src/index.ts'),
              },
            },
          },
        },
      ]),
      renderer(),
    ],
    server: {
      port: 5173,
      strictPort: true,
    },
    css: {
      preprocessorOptions: {
        scss: {
          api: 'modern-compiler',
          // Prelude применяется только к корневому Sass-entry (каждый <style lang="scss"> = entry).
          // Импортируемые через @use .scss-файлы сами @use'ят миксины. CSS-токены — глобально на :root.
          additionalData: `@use "@/styles/abstracts/mixins" as *;`,
        },
      },
    },
    build: {
      outDir: 'dist',
      target: 'es2022',
      sourcemap: false,
      chunkSizeWarningLimit: 1024,
    },
  };
});
