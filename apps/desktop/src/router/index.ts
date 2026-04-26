/**
 * @fileoverview Vue Router config — hash-history для Electron `file://` шеллa.
 *
 * Routes: Welcome → Home / Devices / DeviceDetail / Discovery / Rooms /
 * Scenes / Alice / Settings.
 *
 * `beforeEach` guard перенаправляет на `/welcome` при неоконченном онбординге
 * и обратно на `/home` после его завершения.
 */

import { createRouter, createWebHashHistory } from 'vue-router';
import { useUiStore } from '@/stores/ui';
import { useDevicesStore } from '@/stores/devices';
import { useYandexStationStore } from '@/stores/yandexStation';

export const router = createRouter({
  history: createWebHashHistory(),
  // `scrollBehavior` не задан: window — `overflow: hidden`, scroll-target —
  // `.app__content`. Scroll-to-top реализован программно в App.vue.
  routes: [
    {
      path: '/',
      redirect: '/home',
    },
    {
      path: '/welcome',
      name: 'welcome',
      component: () => import('@/views/WelcomeView.vue'),
      meta: { title: 'Добро пожаловать', chrome: false },
    },
    {
      path: '/home',
      name: 'home',
      component: () => import('@/views/HomeView.vue'),
      meta: { title: 'Главная' },
    },
    {
      path: '/devices',
      name: 'devices',
      component: () => import('@/views/DevicesView.vue'),
      meta: { title: 'Устройства' },
    },
    {
      path: '/devices/:id',
      name: 'device',
      component: () => import('@/views/DeviceDetailView.vue'),
      meta: { title: 'Устройство' },
      props: true,
    },
    {
      path: '/scenes',
      name: 'scenes',
      component: () => import('@/views/ScenesView.vue'),
      meta: { title: 'Сценарии' },
    },
    {
      path: '/discovery',
      name: 'discovery',
      component: () => import('@/views/DiscoveryView.vue'),
      meta: { title: 'Поиск устройств' },
    },
    {
      path: '/alice',
      name: 'alice',
      component: () => import('@/views/AliceView.vue'),
      meta: { title: 'Подключение Алисы' },
    },
    {
      // Legacy alias `/speaker` → `/devices/<id>` для активной колонки.
      // Sync с feedback-тостом — в `useSpeakerNavigation`; здесь только
      // sync-redirect: Device есть → device, не подключена → alice, иначе devices.
      path: '/speaker',
      name: 'speaker',
      redirect: () => {
        const station = useYandexStationStore();
        const devices = useDevicesStore();
        const stationDeviceId = station.status?.station?.deviceId;
        if (stationDeviceId) {
          const found = devices.devices.find(
            (d) => d.driver === 'yandex-iot' && d.externalId === stationDeviceId,
          );
          if (found) return { name: 'device', params: { id: found.id } };
        }
        if (station.status?.connection !== 'connected') return { name: 'alice' };
        return { name: 'devices' };
      },
    },
    {
      path: '/rooms',
      name: 'rooms',
      component: () => import('@/views/RoomsView.vue'),
      meta: { title: 'Комнаты' },
    },
    {
      path: '/settings',
      name: 'settings',
      component: () => import('@/views/SettingsView.vue'),
      meta: { title: 'Настройки' },
    },
  ],
});

// Onboarding-guard: до `hasSeenOnboarding` все маршруты идут на `/welcome`.
router.beforeEach((to) => {
  const ui = useUiStore();
  if (!ui.hasSeenOnboarding && to.name !== 'welcome') {
    return { name: 'welcome' };
  }
  if (ui.hasSeenOnboarding && to.name === 'welcome') {
    return { name: 'home' };
  }
  return true;
});
