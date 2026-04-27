/**
 * @fileoverview Pinia store toast-уведомлений. Single source of truth для
 * top-right notification stack'а.
 *
 * API:
 *   - `push({ kind, message, ttlMs? })` — поставить toast в очередь.
 *     `kind`: `'success' | 'error' | 'info' | 'pending'`.
 *   - `update(id, patch)` — поменять kind/message существующего toast'а.
 *   - `dismiss(id)` — снять toast руками.
 *   - `run(promise, opts)` — async-обёртка: pending → success/error.
 */

import { defineStore } from 'pinia';
import { ref } from 'vue';

export type ToastKind = 'success' | 'error' | 'info' | 'pending';

export interface Toast {
  id: number;
  kind: ToastKind;
  message: string;
  /** Sub-line под основным сообщением. */
  detail?: string;
  /** Auto-dismiss через N ms. `pending` не закрывается автоматически. */
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

// Stack cap: max одновременных toast'ов. При превышении старейший non-pending
// dismiss'ится, чтобы стек не разрастался при retry-loop'е ошибок.
const MAX_TOASTS = 5;
// Default TTL по kind. Errors дольше — у пользователя время прочитать.
const TTL_DEFAULT: Record<ToastKind, number> = {
  success: 3500,
  info: 4000,
  error: 7000,
  pending: Infinity,
};

export const useToasterStore = defineStore('toaster', () => {
  const toasts = ref<Toast[]>([]);
  let nextId = 1;
  const timers = new Map<number, ReturnType<typeof setTimeout>>();
  // Pause/resume: при hover toast'а сохраняем remaining ms, при leave — schedule
  // с этим остатком вместо полного TTL.
  const remainingOnPause = new Map<number, number>();
  // Time когда таймер был set'ан — для расчёта остатка при pause.
  const scheduledAt = new Map<number, { startMs: number; ttl: number }>();

  function scheduleDismiss(toast: Toast): void {
    const existing = timers.get(toast.id);
    if (existing) clearTimeout(existing);
    if (toast.kind === 'pending') return;
    const ttl = remainingOnPause.get(toast.id) ?? toast.ttlMs ?? TTL_DEFAULT[toast.kind];
    remainingOnPause.delete(toast.id);
    if (!Number.isFinite(ttl)) return;
    scheduledAt.set(toast.id, { startMs: Date.now(), ttl });
    timers.set(
      toast.id,
      setTimeout(() => dismiss(toast.id), ttl),
    );
  }

  /**
   * Ставит toast в очередь, возвращает id для update/dismiss.
   * Dedupe по `kind+message`: повторный push продлевает TTL и возвращает тот же id.
   * Stack cap: при `length >= MAX_TOASTS` старейший non-pending удаляется.
   */
  function push(input: Omit<Toast, 'id'>): number {
    const existing = toasts.value.find(
      (t) => t.kind === input.kind && t.message === input.message,
    );
    if (existing) {
      const merged: Toast = { ...existing, ...input, id: existing.id };
      const idx = toasts.value.findIndex((t) => t.id === existing.id);
      if (idx !== -1) toasts.value.splice(idx, 1, merged);
      scheduleDismiss(merged);
      return existing.id;
    }
    if (toasts.value.length >= MAX_TOASTS) {
      const oldest = toasts.value.find((t) => t.kind !== 'pending');
      if (oldest) dismiss(oldest.id);
    }
    const toast: Toast = { id: nextId++, ...input };
    toasts.value = [...toasts.value, toast];
    scheduleDismiss(toast);
    return toast.id;
  }

  /** Меняет kind/message существующего toast'а. Pending → success/error. */
  function update(id: number, patch: Partial<Omit<Toast, 'id'>>): void {
    const idx = toasts.value.findIndex((t) => t.id === id);
    if (idx === -1) return;
    const merged: Toast = { ...toasts.value[idx]!, ...patch };
    toasts.value.splice(idx, 1, merged);
    remainingOnPause.delete(id);
    scheduleDismiss(merged);
  }

  function dismiss(id: number): void {
    const t = timers.get(id);
    if (t) {
      clearTimeout(t);
      timers.delete(id);
    }
    scheduledAt.delete(id);
    remainingOnPause.delete(id);
    toasts.value = toasts.value.filter((t) => t.id !== id);
  }

  /** Hover pause: clear timer, сохранить remaining ms для resume. */
  function pause(id: number): void {
    const t = timers.get(id);
    if (!t) return;
    clearTimeout(t);
    timers.delete(id);
    const sched = scheduledAt.get(id);
    if (sched) {
      const elapsed = Date.now() - sched.startMs;
      remainingOnPause.set(id, Math.max(800, sched.ttl - elapsed));
      scheduledAt.delete(id);
    }
  }

  /** Hover end: schedule с remaining ms (или fresh TTL если не было pause). */
  function resume(id: number): void {
    if (timers.has(id)) return;
    const toast = toasts.value.find((tt) => tt.id === id);
    if (!toast || toast.kind === 'pending') return;
    scheduleDismiss(toast);
  }

  /** Снимает все non-pending toast'ы. Вызывается на route change. */
  function clearTransient(): void {
    const stayingPending = toasts.value.filter((t) => t.kind === 'pending');
    for (const t of toasts.value) {
      if (t.kind === 'pending') continue;
      const tm = timers.get(t.id);
      if (tm) clearTimeout(tm);
      timers.delete(t.id);
      scheduledAt.delete(t.id);
      remainingOnPause.delete(t.id);
    }
    toasts.value = stayingPending;
  }

  /**
   * Выполняет promise и показывает pending → success/error toast'ы по результату.
   * Re-throw'ит исключение promise'а наружу.
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

  return { toasts, push, update, dismiss, pause, resume, clearTransient, run };
});
