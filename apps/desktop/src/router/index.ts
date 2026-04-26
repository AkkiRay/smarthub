/**
 * @fileoverview Vue Router config — hash-based history (Electron file://
 * не работает с HTML5 history, нужен hash).
 *
 * Маршруты: Welcome (онбординг) → Home → Devices / DeviceDetail / Discovery /
 * Rooms / Scenes / Alice / Settings.
 *
 * Beforeach guard:
 *   - Перенаправляет на `/welcome` если онбординг не пройден (UI store).
 *   - Перенаправляет на `/discovery` если в хабе нет ни одного сопряжённого
 *     устройства (kick-start UX flow).
 */

import { createRouter, createWebHashHistory } from 'vue-router';
import { useUiStore } from '@/stores/ui';
import { useDevicesStore } from '@/stores/devices';
import { useYandexStationStore } from '@/stores/yandexStation';

export const router = createRouter({
  history: createWebHashHistory(),
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
      // Legacy alias: пульт колонки переехал в /devices/<id>. Логика:
      //   - есть Device-запись для активной колонки → /devices/<id>
      //   - станция не подключена → /alice (онбординг)
      //   - станция подключена, но Device ещё не sync'нут → /devices с инфо-toast'ом
      //     (а НЕ /alice — иначе кнопка из AliceView возвращает на ту же страницу).
      // Sync лучше дёргать в `useSpeakerNavigation` — там есть toaster для feedback'а;
      // здесь redirect синхронный и безопасных async-точек нет.
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

// Onboarding-guard: до hasSeenOnboarding гоним на /welcome. uiStore читает LS sync.
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
