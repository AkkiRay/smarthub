/**
 * @fileoverview Pinia-store auto-update flow.
 *
 * Источник правды — main process (electron-updater + GitHub Releases). Renderer
 * только отображает текущий снимок и проксит действия (check/download/install).
 *
 * Lifecycle:
 *   - `bootstrap()` подписывается на push `update:status` и читает текущий снимок.
 *   - `App.vue` вызывает bootstrap один раз на mount.
 *   - На переход в `available` показываем info-toast «Доступно обновление…»;
 *     на `downloaded` — success-toast c кнопкой «Перезапустить».
 */

import { defineStore } from 'pinia';
import { computed, ref } from 'vue';
import type { UpdateStatus } from '@smarthome/shared';
import { useToasterStore } from './toaster';

export const useUpdaterStore = defineStore('updater', () => {
  const status = ref<UpdateStatus | null>(null);
  const lastNotifiedVersion = ref<string | null>(null);
  let unsubscribe: (() => void) | null = null;

  const state = computed(() => status.value?.state ?? 'idle');
  const currentVersion = computed(() => status.value?.currentVersion ?? '');
  const isAvailable = computed(() => status.value?.state === 'available');
  const isDownloading = computed(() => status.value?.state === 'downloading');
  const isDownloaded = computed(() => status.value?.state === 'downloaded');
  const downloadPercent = computed(() =>
    status.value?.state === 'downloading' ? status.value.percent : 0,
  );

  const newVersion = computed(() => {
    const s = status.value;
    if (!s) return null;
    if (s.state === 'available' || s.state === 'downloaded' || s.state === 'up-to-date') {
      return s.version ?? null;
    }
    return null;
  });

  /** Глобальная подписка. Вызывается один раз из App.vue на mount. */
  async function bootstrap(): Promise<void> {
    if (unsubscribe) return;
    const toaster = useToasterStore();

    unsubscribe = window.smarthome.events.on('update:status', (next) => {
      status.value = next;
      handleTransition(next, toaster);
    });

    try {
      status.value = await window.smarthome.updater.getStatus();
    } catch {
      // disabled / dev — оставляем null.
    }
  }

  function handleTransition(next: UpdateStatus, toaster: ReturnType<typeof useToasterStore>): void {
    if (next.state === 'available' && next.version && lastNotifiedVersion.value !== next.version) {
      lastNotifiedVersion.value = next.version;
      toaster.push({
        kind: 'info',
        message: `Доступно обновление ${next.version}`,
        detail: 'Откройте «Настройки → Обновления», чтобы скачать.',
        ttlMs: 8000,
      });
    }

    if (next.state === 'downloaded' && next.version) {
      toaster.push({
        kind: 'success',
        message: `Обновление ${next.version} готово`,
        detail: 'Перезапустите приложение, чтобы применить.',
        ttlMs: 12000,
      });
    }

    if (next.state === 'error') {
      toaster.push({
        kind: 'error',
        message: 'Не удалось проверить обновления',
        detail: next.error,
        ttlMs: 8000,
      });
    }
  }

  async function check(): Promise<void> {
    const toaster = useToasterStore();
    await toaster.run(window.smarthome.updater.check(), {
      pending: 'Проверяем обновления…',
      error: 'Не удалось проверить обновления',
    });
  }

  async function download(): Promise<void> {
    await window.smarthome.updater.download();
  }

  async function install(): Promise<void> {
    await window.smarthome.updater.install();
  }

  function dispose(): void {
    unsubscribe?.();
    unsubscribe = null;
  }

  return {
    status,
    state,
    currentVersion,
    newVersion,
    isAvailable,
    isDownloading,
    isDownloaded,
    downloadPercent,
    bootstrap,
    check,
    download,
    install,
    dispose,
  };
});
