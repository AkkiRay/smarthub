import { defineStore } from 'pinia';
import { ref } from 'vue';

export type ToastKind = 'success' | 'error' | 'info' | 'pending';

export interface Toast {
  id: number;
  kind: ToastKind;
  message: string;
  /** Sub-line: имя драйвера, текущий шаг и т.п. */
  detail?: string;
  /** Auto-dismiss через N ms. `pending` по умолчанию не закрывается. */
  ttlMs?: number;
}

export interface RunToastOptions {
  /** Сообщение при успехе. Если не задано — toast не показываем при success. */
  success?: string;
  /** Префикс ошибки. `${error}: ${e.message}`. По умолчанию — только error.message. */
  error?: string;
  /** Pending-toast пока promise не разрешён. */
  pending?: string;
}

export const useToasterStore = defineStore('toaster', () => {
  const toasts = ref<Toast[]>([]);
  let nextId = 1;
  // Live-таймеры — чтобы `update()` со сменой kind переставил TTL.
  const timers = new Map<number, ReturnType<typeof setTimeout>>();

  function scheduleDismiss(toast: Toast): void {
    const existing = timers.get(toast.id);
    if (existing) clearTimeout(existing);
    if (toast.kind === 'pending') return;
    const ttl = toast.ttlMs ?? 4000;
    timers.set(
      toast.id,
      setTimeout(() => dismiss(toast.id), ttl),
    );
  }

  /** Возвращает id для последующего update/dismiss. */
  function push(input: Omit<Toast, 'id'>): number {
    const toast: Toast = { id: nextId++, ...input };
    toasts.value = [...toasts.value, toast];
    scheduleDismiss(toast);
    return toast.id;
  }

  /** `pending` → `success`/`error` для long-running операций (pair, scan, command). */
  function update(id: number, patch: Partial<Omit<Toast, 'id'>>): void {
    const idx = toasts.value.findIndex((t) => t.id === id);
    if (idx === -1) return;
    const merged: Toast = { ...toasts.value[idx]!, ...patch };
    toasts.value.splice(idx, 1, merged);
    scheduleDismiss(merged);
  }

  function dismiss(id: number): void {
    const t = timers.get(id);
    if (t) {
      clearTimeout(t);
      timers.delete(id);
    }
    toasts.value = toasts.value.filter((t) => t.id !== id);
  }

  /**
   * Запустить async-операцию и автоматически показать pending → success/error toast'ы.
   * Использовать вместо ручных `try { await ...; toaster.push(success) } catch { toaster.push(error) }`.
   */
  async function run<T>(
    promise: Promise<T> | (() => Promise<T>),
    opts: RunToastOptions,
  ): Promise<T> {
    const p = typeof promise === 'function' ? promise() : promise;
    const id = opts.pending ? push({ kind: 'pending', message: opts.pending }) : null;
    try {
      const result = await p;
      if (opts.success) {
        if (id !== null) update(id, { kind: 'success', message: opts.success });
        else push({ kind: 'success', message: opts.success });
      } else if (id !== null) {
        dismiss(id);
      }
      return result;
    } catch (e) {
      const msg = (e as Error).message ?? 'Неизвестная ошибка';
      const text = opts.error ? `${opts.error}: ${msg}` : msg;
      if (id !== null) update(id, { kind: 'error', message: text });
      else push({ kind: 'error', message: text });
      throw e;
    }
  }

  return { toasts, push, update, dismiss, run };
});
