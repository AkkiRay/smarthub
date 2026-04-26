/**
 * @fileoverview
 * Pure-renderer UI prefs: theme/reduceMotion живут только тут (без IPC), persisted в localStorage.
 */

import { defineStore } from 'pinia';
import { ref, watch } from 'vue';
import type { Platform } from '@smarthome/shared';

const LS_KEY = 'smarthome.ui';

export type UiTheme = 'alice-dark' | 'alice-midnight';

interface PersistedUi {
  theme: UiTheme;
  reduceMotion: boolean;
  /** Welcome-flow на `/welcome` пройден. */
  hasSeenOnboarding: boolean;
  /** Coachmark-тур по `HomeView` пройден. */
  tourCompleted: boolean;
}

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
    /* localStorage full / disabled — silent */
  }
};

export const useUiStore = defineStore('ui', () => {
  const persisted = loadPersisted();
  const theme = ref<UiTheme>(persisted.theme ?? 'alice-dark');
  const reduceMotion = ref<boolean>(persisted.reduceMotion ?? false);
  const hasSeenOnboarding = ref<boolean>(persisted.hasSeenOnboarding ?? false);
  const tourCompleted = ref<boolean>(persisted.tourCompleted ?? false);
  const sidebarCollapsed = ref(false);
  // Slide-in sidebar для <720px, открывается hamburger в titlebar.
  const mobileDrawerOpen = ref(false);
  const platform = ref<Platform | 'browser'>('browser');
  const version = ref('');

  // theme как data-attr на body, дальше CSS-токены на :root.
  const applyTheme = (next: UiTheme): void => {
    if (typeof document !== 'undefined') {
      document.body.dataset['theme'] = next;
    }
  };

  applyTheme(theme.value);

  // HMR-safe: bootstrap может дёрнуться повторно — без guard'а каждый
  // matchMedia-listener стакается и реагирует N раз.
  let subscribed = false;

  async function bootstrap(): Promise<void> {
    [platform.value, version.value] = await Promise.all([
      window.smarthome.app.getPlatform(),
      window.smarthome.app.getVersion(),
    ]);
    if (subscribed) return;
    subscribed = true;
    // Системный prefers-reduced-motion — только когда пользователь не выставил вручную.
    if (
      persisted.reduceMotion === undefined &&
      typeof window !== 'undefined' &&
      window.matchMedia
    ) {
      const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
      reduceMotion.value = mq.matches;
      mq.addEventListener('change', (e) => {
        const cur = loadPersisted();
        if (cur.reduceMotion === undefined) reduceMotion.value = e.matches;
      });
    }
  }

  function toggleSidebar(): void {
    sidebarCollapsed.value = !sidebarCollapsed.value;
  }

  function toggleMobileDrawer(): void {
    mobileDrawerOpen.value = !mobileDrawerOpen.value;
  }
  function closeMobileDrawer(): void {
    mobileDrawerOpen.value = false;
  }

  function setTheme(next: UiTheme): void {
    theme.value = next;
    applyTheme(next);
  }

  function setReduceMotion(next: boolean): void {
    reduceMotion.value = next;
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

  watch(
    [theme, reduceMotion, hasSeenOnboarding, tourCompleted],
    ([t, rm, hso, tc]) =>
      persist({
        theme: t,
        reduceMotion: rm,
        hasSeenOnboarding: hso,
        tourCompleted: tc,
      }),
    { deep: false },
  );

  return {
    theme,
    reduceMotion,
    hasSeenOnboarding,
    tourCompleted,
    sidebarCollapsed,
    mobileDrawerOpen,
    platform,
    version,
    bootstrap,
    toggleSidebar,
    toggleMobileDrawer,
    closeMobileDrawer,
    setTheme,
    setReduceMotion,
    completeOnboarding,
    completeTour,
    resetOnboarding,
  };
});
