/**
 * @fileoverview useNavItems — single source of truth для nav-items в
 * `AppSidebar` (desktop/tablet) и `AppBottomNav` (mobile).
 *
 * Counters читаются из stores'ов → badge'и реактивно синхронны в обоих nav-bar'ах.
 */

import { computed, type ComputedRef } from 'vue';
import { useDevicesStore } from '@/stores/devices';
import type { IconName } from '@/components/base/BaseIcon.vue';

export interface NavItem {
  to: string;
  label: string;
  /** Короткая метка для bottom-nav (ширина item ~50px на 360-dp screen). */
  shortLabel: string;
  icon: IconName;
  badge?: number;
  tour?: string;
  /** Показывать ли элемент в mobile bottom-nav. */
  inBottomNav?: boolean;
}

export function useNavItems(): ComputedRef<NavItem[]> {
  const devices = useDevicesStore();

  return computed<NavItem[]>(() => [
    { to: '/home', label: 'Главная', shortLabel: 'Главная', icon: 'home', inBottomNav: true },
    {
      to: '/devices',
      label: 'Устройства',
      shortLabel: 'Устройства',
      icon: 'devices',
      badge: devices.devices.length || undefined,
      tour: 'sidebar-devices',
      inBottomNav: true,
    },
    { to: '/rooms', label: 'Комнаты', shortLabel: 'Комнаты', icon: 'rooms', tour: 'sidebar-rooms' },
    {
      to: '/scenes',
      label: 'Сценарии',
      shortLabel: 'Сцены',
      icon: 'scenes',
      tour: 'sidebar-scenes',
      inBottomNav: true,
    },
    {
      to: '/discovery',
      label: 'Поиск',
      shortLabel: 'Поиск',
      icon: 'search',
      badge: devices.unpairedCandidates.length || undefined,
      tour: 'sidebar-discovery',
    },
    {
      to: '/alice',
      label: 'Подключение Алисы',
      shortLabel: 'Алиса',
      icon: 'alice',
      tour: 'sidebar-alice',
      inBottomNav: true,
    },
    {
      to: '/settings',
      label: 'Настройки',
      shortLabel: 'Ещё',
      icon: 'settings',
      tour: 'sidebar-settings',
      inBottomNav: true,
    },
  ]);
}
