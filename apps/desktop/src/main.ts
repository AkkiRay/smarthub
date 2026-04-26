/**
 * @fileoverview
 * Renderer entrypoint: Pinia + Router + global error-handler'ы → toast + main-process.
 */

import { createApp } from 'vue';
import { createPinia } from 'pinia';
import { gsap } from 'gsap';
import App from './App.vue';
import { router } from './router/index';

// Variable-fonts локально — CSP запрещает CDN.
import '@fontsource-variable/inter';
import '@fontsource-variable/manrope';
import '@fontsource-variable/jetbrains-mono';

import './styles/main.scss';

gsap.config({ nullTargetWarn: false });

const app = createApp(App);
const pinia = createPinia();

app.use(pinia);
app.use(router);

// Дублируем все renderer-ошибки в main process — иначе теряются между
// перезагрузками DevTools и не попадают в log-файлы.
function reportToMain(source: string, err: unknown): void {
  const e = err as Error | undefined;
  const message = e?.message ?? String(err ?? 'unknown error');
  const stack = e?.stack;
  try {
    window.smarthome?.app?.reportError?.({ source, message, stack });
  } catch {
    /* preload ещё не привязан — silent. */
  }
}

app.config.errorHandler = (err, _instance, info) => {
  console.error('[Vue error]', info, err);
  reportToMain(`vue:${info}`, err);
  void notifyToaster((err as Error).message ?? String(err));
};

window.addEventListener('error', (e) => {
  console.error('[window error]', e.error ?? e.message);
  reportToMain('window', e.error ?? new Error(e.message));
  void notifyToaster(e.error?.message ?? e.message ?? 'Renderer error');
});
window.addEventListener('unhandledrejection', (e) => {
  console.error('[unhandledrejection]', e.reason);
  reportToMain('unhandledrejection', e.reason);
  void notifyToaster((e.reason as Error)?.message ?? String(e.reason));
});

// Lazy-import — не циклим зависимости с pinia.
async function notifyToaster(message: string): Promise<void> {
  try {
    const { useToasterStore } = await import('./stores/toaster');
    useToasterStore().push({ kind: 'error', message });
  } catch {
    /* toaster не готов — fallback в console уже выше. */
  }
}

app.mount('#app');
