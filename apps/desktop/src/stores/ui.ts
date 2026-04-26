/**
 * @fileoverview Renderer-only UI prefs: theme / motionLevel, persist в localStorage.
 *
 * Motion — 4-уровневая шкала `'off' | 'reduced' | 'standard' | 'full'`.
 * `data-motion` + `--motion-scale` ставятся на <html>; CSS-токены и useGsap
 * читают их и масштабируют длительности / блокируют декоративные анимации.
 */

import { defineStore } from 'pinia';
import { computed, ref, watch } from 'vue';
import type { Platform } from '@smarthome/shared';

const LS_KEY = 'smarthome.ui';

export type UiTheme = 'alice-dark' | 'alice-midnight';

/**
 * Шкала анимаций.
 *
 * - `off`      — отключает CSS transition + GSAP tween/loop. Авто-выставляется
 *                при системном `prefers-reduced-motion: reduce`.
 * - `reduced`  — только opacity-fade'ы (без translate/scale/rotate), без
 *                background-loop'ов. Длительности × 0.6.
 * - `standard` — default: stagger, springs, page-header accent, aura drift.
 * - `full`     — все декорации, длительности × 1.15.
 */
export type MotionLevel = 'off' | 'reduced' | 'standard' | 'full';

interface PersistedUi {
  theme: UiTheme;
  /** @deprecated читается только для миграции в `motionLevel`. */
  reduceMotion?: boolean;
  motionLevel: MotionLevel;
  /** Welcome-flow на `/welcome` пройден. */
  hasSeenOnboarding: boolean;
  /** Coachmark-тур по `HomeView` пройден. */
  tourCompleted: boolean;
}

const MOTION_SCALE: Record<MotionLevel, number> = {
  off: 0,
  reduced: 0.6,
  standard: 1,
  full: 1.15,
};

const loadPersisted = (): Partial<PersistedUi> => {
  try {
    const raw = localStorage.getItem(LS_KEY);
    return raw ? (JSON.parse(raw) as Partial<PersistedUi>) : {};
  } catch {
    return {};
  }
};

const persist = (state: PersistedUi): void => {
  try {
    localStorage.setItem(LS_KEY, JSON.stringify(state));
  } catch {
    /* localStorage недоступен */
  }
};

export const useUiStore = defineStore('ui', () => {
  const persisted = loadPersisted();
  const theme = ref<UiTheme>(persisted.theme ?? 'alice-dark');

  // Migration legacy boolean `reduceMotion` → enum `motionLevel`.
  const initialLevel: MotionLevel =
    persisted.motionLevel ??
    (persisted.reduceMotion === true
      ? 'reduced'
      : persisted.reduceMotion === false
        ? 'standard'
        : 'standard');
  const motionLevel = ref<MotionLevel>(initialLevel);

  // Boolean view над `motionLevel` для legacy callsite'ов.
  const reduceMotion = computed<boolean>(() => motionLevel.value !== 'standard' && motionLevel.value !== 'full');
  const motionScale = computed<number>(() => MOTION_SCALE[motionLevel.value]);

  const hasSeenOnboarding = ref<boolean>(persisted.hasSeenOnboarding ?? false);
  const tourCompleted = ref<boolean>(persisted.tourCompleted ?? false);
  const sidebarCollapsed = ref(false);
  const platform = ref<Platform | 'browser'>('browser');
  const version = ref('');

  // theme — `data-theme` атрибут на <body>, CSS-токены каскадом на :root.
  const applyTheme = (next: UiTheme): void => {
    if (typeof document !== 'undefined') {
      document.body.dataset['theme'] = next;
    }
  };

  // `data-motion` + `--motion-scale` на <html> — каскад охватывает body, modal,
  // toast, drawer и portal-узлы за пределами #app.
  const applyMotion = (level: MotionLevel): void => {
    if (typeof document === 'undefined') return;
    const el = document.documentElement;
    el.dataset['motion'] = level;
    el.style.setProperty('--motion-scale', String(MOTION_SCALE[level]));
  };

  applyTheme(theme.value);
  applyMotion(motionLevel.value);

  // HMR-guard: bootstrap идемпотентен, matchMedia-listener регистрируется один раз.
  let subscribed = false;

  async function bootstrap(): Promise<void> {
    [platform.value, version.value] = await Promise.all([
      window.smarthome.app.getPlatform(),
      window.smarthome.app.getVersion(),
    ]);
    if (subscribed) return;
    subscribed = true;
    // Системный `prefers-reduced-motion` применяется только если пользователь
    // не выставлял motionLevel вручную.
    const userSetMotion =
      persisted.motionLevel !== undefined || persisted.reduceMotion !== undefined;
    if (!userSetMotion && typeof window !== 'undefined' && window.matchMedia) {
      const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
      if (mq.matches) motionLevel.value = 'reduced';
      mq.addEventListener('change', (e) => {
        const cur = loadPersisted();
        const stillUnset = cur.motionLevel === undefined && cur.reduceMotion === undefined;
        if (stillUnset) motionLevel.value = e.matches ? 'reduced' : 'standard';
      });
    }
  }

  function toggleSidebar(): void {
    sidebarCollapsed.value = !sidebarCollapsed.value;
  }

  function setTheme(next: UiTheme): void {
    theme.value = next;
    applyTheme(next);
  }

  function setReduceMotion(next: boolean): void {
    // Boolean-bridge для legacy callsite'ов: true → 'reduced', false → 'standard'.
    motionLevel.value = next ? 'reduced' : 'standard';
  }

  function setMotionLevel(next: MotionLevel): void {
    motionLevel.value = next;
    applyMotion(next);
  }

  function completeOnboarding(): void {
    hasSeenOnboarding.value = true;
  }

  function completeTour(): void {
    tourCompleted.value = true;
  }

  function resetOnboarding(): void {
    hasSeenOnboarding.value = false;
    tourCompleted.value = false;
  }

  // Sync motionLevel в DOM: компоненты и portal'ы видят изменение в одном кадре
  // через `var(--motion-scale)`.
  watch(motionLevel, (lvl) => applyMotion(lvl));

  watch(
    [theme, motionLevel, hasSeenOnboarding, tourCompleted],
    ([t, ml, hso, tc]) =>
      persist({
        theme: t,
        motionLevel: ml,
        hasSeenOnboarding: hso,
        tourCompleted: tc,
      }),
    { deep: false },
  );

  return {
    theme,
    motionLevel,
    motionScale,
    reduceMotion,
    hasSeenOnboarding,
    tourCompleted,
    sidebarCollapsed,
    platform,
    version,
    bootstrap,
    toggleSidebar,
    setTheme,
    setReduceMotion,
    setMotionLevel,
    completeOnboarding,
    completeTour,
    resetOnboarding,
  };
});
