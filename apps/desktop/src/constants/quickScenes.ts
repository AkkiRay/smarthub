// Конфиг плиток быстрого доступа на HomeView.

import type { IconName } from '@/components/base/BaseIcon.vue';

export type QuickSceneId = 'all-on' | 'all-off' | 'movie' | 'sleep';

export interface QuickScene {
  id: QuickSceneId;
  name: string;
  hint: string;
  icon: IconName;
  /** Зеркало одного из --color-brand-* токенов. */
  accent: string;
}

export const QUICK_SCENES: QuickScene[] = [
  {
    id: 'all-on',
    name: 'Включить всё',
    hint: 'Свет + розетки',
    icon: 'scene-all-on',
    accent: '#B85DFF', // === --color-brand-purple
  },
  {
    id: 'all-off',
    name: 'Выключить всё',
    hint: 'Свет + розетки',
    icon: 'scene-all-off',
    accent: '#7C5BFF', // === --color-brand-violet
  },
  {
    id: 'movie',
    name: 'Кино',
    hint: 'Приглушённый свет',
    icon: 'scene-movie',
    accent: '#FF5B9E', // === --color-brand-pink (coral)
  },
  {
    id: 'sleep',
    name: 'Сон',
    hint: 'Ночной режим',
    icon: 'scene-sleep',
    accent: '#FFB866', // === --color-brand-amber
  },
];
