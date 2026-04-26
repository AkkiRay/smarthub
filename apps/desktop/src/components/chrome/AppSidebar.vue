<template>
  <aside class="sidebar" ref="root" aria-labelledby="sidebar-heading">
    <!-- Eyebrow `<h2>` — метка nav-секции для screen-readers, в compact скрывается. -->
    <h2 id="sidebar-heading" class="sidebar__heading">
      <span class="sidebar__heading-mark" aria-hidden="true" />
      <span class="sidebar__heading-label text--micro">Меню</span>
      <span class="sidebar__heading-line" aria-hidden="true" />
    </h2>
    <nav class="sidebar__nav">
      <RouterLink
        v-for="item in items"
        :key="item.to"
        :to="item.to"
        class="sidebar__item"
        active-class="is-active"
        :data-tour="item.tour"
      >
        <BaseIcon :name="item.icon" :size="22" class="sidebar__icon" :aria-hidden="true" />
        <span class="sidebar__label">{{ item.label }}</span>
        <span v-if="item.badge" class="sidebar__badge">{{ item.badge }}</span>
        <span class="sidebar__indicator" />
      </RouterLink>
    </nav>

    <div class="sidebar__bottom">
      <button
        type="button"
        class="sidebar__hub-card"
        :class="`is-${stationOrbState}`"
        :aria-label="hubAriaLabel"
        data-tour="sidebar-hub-card"
        @click="onHubCardClick"
      >
        <span class="sidebar__hub-avatar">
          <BaseIcon name="alice" :size="20" aria-hidden="true" />
          <span class="sidebar__hub-pip" />
        </span>
        <span class="sidebar__hub-info">
          <span class="sidebar__hub-name">Алиса</span>
          <span class="sidebar__hub-state">{{ stationLabel }}</span>
          <span v-if="skillBadge" class="sidebar__hub-skill" :class="`is-${skillBadge.tone}`">
            <span class="sidebar__hub-skill-dot" />
            {{ skillBadge.label }}
          </span>
        </span>
        <BaseIcon
          :name="stationConnected ? 'arrow-right' : 'plus'"
          :size="14"
          class="sidebar__hub-cta"
          aria-hidden="true"
        />
      </button>
      <span class="text--micro sidebar__version">SmartHome Hub v{{ ui.version || '1.0.0' }}</span>
    </div>
  </aside>
</template>

<script setup lang="ts">
import { computed, onMounted, useTemplateRef } from 'vue';
import { useDevicesStore } from '@/stores/devices';
import { useYandexStationStore } from '@/stores/yandexStation';
import { useAliceStore } from '@/stores/alice';
import { useUiStore } from '@/stores/ui';
import { useGsap } from '@/composables/useGsap';
import { useSpeakerNavigation } from '@/composables/useSpeakerNavigation';
import BaseIcon, { type IconName } from '@/components/base/BaseIcon.vue';

const devices = useDevicesStore();
const station = useYandexStationStore();
const alice = useAliceStore();
const ui = useUiStore();
const speakerNav = useSpeakerNavigation();
const root = useTemplateRef<HTMLElement>('root');

/**
 * Hub-card в одно касание открывает пульт колонки. Логика «найти Device-запись или
 * запустить sync» инкапсулирована в `useSpeakerNavigation` — используется и здесь,
 * и в AliceView (две CTA на странице подключения).
 */
function onHubCardClick(): void {
  void speakerNav.openSpeaker();
}

const stationConnected = computed(() => station.status?.connection === 'connected');
const stationLabel = computed(() => {
  const c = station.status?.connection;
  if (c === 'connected') return 'В сети';
  if (c === 'connecting' || c === 'authenticating') return 'Подключение…';
  if (c === 'error') return 'Ошибка';
  return 'Не подключена';
});
const stationOrbState = computed<'idle' | 'active' | 'error'>(() => {
  const c = station.status?.connection;
  if (c === 'connected') return 'active';
  if (c === 'error') return 'error';
  return 'idle';
});

/** Чип под station-label со статусом skill-моста. */
const skillBadge = computed<{ label: string; tone: 'success' | 'warn' | 'idle' } | null>(() => {
  const stage = alice.status?.skill.stage;
  if (!stage || stage === 'idle') return null;
  if (stage === 'linked') return { label: 'Skill активен', tone: 'success' };
  if (stage === 'tunnel-up') return { label: 'Ожидает привязки', tone: 'warn' };
  if (stage === 'configured') return { label: 'Skill настроен', tone: 'idle' };
  if (stage === 'error') return { label: 'Skill: ошибка', tone: 'warn' };
  return null;
});

const hubAriaLabel = computed(() => {
  if (stationConnected.value) return 'Управление колонкой';
  if (alice.isLinked) return 'Алиса подключена через skill';
  return 'Подключить колонку Алисы';
});

// `icon` — registry-key из `src/assets/icons/*.svg`.
interface NavItem {
  to: string;
  label: string;
  icon: IconName;
  badge?: number;
  tour?: string;
}
const items = computed<NavItem[]>(() => [
  { to: '/home', label: 'Главная', icon: 'home' },
  {
    to: '/devices',
    label: 'Устройства',
    icon: 'devices',
    badge: devices.devices.length || undefined,
    tour: 'sidebar-devices',
  },
  { to: '/rooms', label: 'Комнаты', icon: 'rooms', tour: 'sidebar-rooms' },
  { to: '/scenes', label: 'Сценарии', icon: 'scenes', tour: 'sidebar-scenes' },
  {
    to: '/discovery',
    label: 'Поиск',
    icon: 'search',
    // Только НЕпривязанные — иначе badge «Поиск» зеркалит «Устройства»
    // (один и тот же физический девайс остаётся в `candidates` и после pair'а).
    badge: devices.unpairedCandidates.length || undefined,
    tour: 'sidebar-discovery',
  },
  { to: '/alice', label: 'Подключение Алисы', icon: 'alice', tour: 'sidebar-alice' },
  { to: '/settings', label: 'Настройки', icon: 'settings', tour: 'sidebar-settings' },
]);

const { from } = useGsap(root.value);

onMounted(() => {
  from('.sidebar__item', {
    opacity: 0,
    x: -16,
    stagger: 0.05,
    duration: 0.5,
    ease: 'power3.out',
  });
});
</script>

<style scoped lang="scss">
@use '@/styles/abstracts/mixins' as *;

.sidebar {
  display: flex;
  flex-direction: column;
  // Width задаёт parent (`.app__sidebar`); rail full-fill.
  width: 100%;
  height: 100%;
  min-height: 0;
  // 14px ритм по вертикали: items / hub-card / version.
  padding: 14px;
  position: relative;
  border-radius: 0;
  // Glass без border/bevel — full-bleed rail иначе рисовал линию на стыке с titlebar.
  @include glass(var(--glass-alpha-medium), var(--glass-blur-strong));
  @include glass-noise();
  background: var(--sidebar-surface);
  border: 0;
  box-shadow: none;

  // Heading: eyebrow «Меню» — мини-dot + label + hairline.
  &__heading {
    display: flex;
    align-items: center;
    gap: 8px;
    margin: 0 4px 10px;
    padding: 0 6px;
    height: 22px;
    flex-shrink: 0;
    user-select: none;
  }

  &__heading-mark {
    width: 5px;
    height: 5px;
    border-radius: 50%;
    background: var(--gradient-brand);
    flex-shrink: 0;
    box-shadow: 0 0 8px rgba(var(--color-brand-purple-rgb), 0.55);
  }

  &__heading-label {
    color: var(--color-text-muted);
    line-height: 1;
    flex-shrink: 0;
    // Tracking шире text--micro — eyebrow читается на blur-фоне.
    letter-spacing: 0.12em;
  }

  &__heading-line {
    flex: 1;
    height: 1px;
    background: linear-gradient(
      to right,
      color-mix(in srgb, var(--color-brand-purple) 24%, transparent) 0%,
      var(--color-border-subtle) 28%,
      transparent 100%
    );
    border-radius: 1px;
  }

  &__nav {
    display: flex;
    flex-direction: column;
    gap: 2px;
    flex: 1;
    min-height: 0;
    overflow-y: auto;
    overflow-x: hidden;
    margin: 0;
    padding: 0;

    &::-webkit-scrollbar {
      width: 6px;
    }
    &::-webkit-scrollbar-thumb {
      background: rgba(255, 255, 255, 0.06);
      border-radius: 6px;
    }
  }

  // Item: [icon 38] [label] [badge], height 50px.
  &__item {
    position: relative;
    display: grid;
    grid-template-columns: 38px minmax(0, 1fr) auto;
    align-items: center;
    column-gap: 12px;
    height: 50px;
    flex-shrink: 0;
    padding: 0 10px;
    border-radius: 14px;
    color: var(--color-text-secondary);
    font-weight: 500;
    text-decoration: none;
    transition:
      color 180ms var(--ease-out),
      background 180ms var(--ease-out);

    // Hover (non-active): цвет + soft tint, без motion.
    &:hover:not(.is-active) {
      color: var(--color-text-primary);
      background: rgba(255, 255, 255, 0.04);

      .sidebar__icon {
        color: var(--color-text-primary);
      }
    }

    // Active: brand tint + indicator pill слева.
    &.is-active {
      color: var(--color-text-primary);
      background: var(--gradient-brand-soft);

      .sidebar__indicator {
        opacity: 1;
        transform: translateY(-50%) scaleY(1);
      }
      .sidebar__icon {
        color: var(--color-brand-purple);
      }
    }
  }

  // Icon slot — чистый SVG, transition по color.
  &__icon {
    width: 38px;
    height: 38px;
    color: var(--color-text-muted);
    display: grid;
    place-items: center;
    flex-shrink: 0;
    background: transparent;
    border: 0;
    transition: color 180ms var(--ease-out);

    :deep(svg) {
      width: 22px;
      height: 22px;
      display: block;
    }
  }

  &__label {
    font-size: 14px;
    line-height: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    letter-spacing: -0.005em;
  }

  &__badge {
    @include numeric-badge(6px);
    min-width: 20px;
    height: 20px;
    border-radius: var(--radius-pill);
    background: var(--gradient-brand);
    color: #fff;
    font-size: 10.5px;
    font-weight: 700;
  }

  // Indicator pill: `left: -14px` компенсирует sidebar padding, pill ложится на внешнюю кромку.
  &__indicator {
    position: absolute;
    left: -14px;
    top: 50%;
    transform: translateY(-50%) scaleY(0);
    transform-origin: center;
    width: 3px;
    height: 26px;
    border-radius: 0 3px 3px 0;
    background: var(--gradient-brand);
    opacity: 0;
    transition:
      transform 280ms cubic-bezier(0.34, 1.56, 0.64, 1),
      opacity 200ms var(--ease-out);
  }

  &__bottom {
    // Whitespace вместо hairline'а — sidebar background уже даёт разделение.
    margin-top: 18px;
    flex-shrink: 0;
    display: flex;
    flex-direction: column;
    gap: 12px;
  }

  // Hub-card — кликабельный row в стиле sidebar__item, без glass-эффекта.
  &__hub-card {
    --status-color: var(--color-text-muted);
    width: 100%;
    display: grid;
    grid-template-columns: 38px minmax(0, 1fr) auto;
    align-items: center;
    column-gap: 12px;
    height: 50px;
    padding: 0 10px;
    border: 0;
    border-radius: 14px;
    background: rgba(255, 255, 255, 0.025);
    color: var(--color-text-secondary);
    cursor: pointer;
    text-align: left;
    transition:
      background-color 200ms var(--ease-out),
      color 200ms var(--ease-out);

    &:hover {
      background: rgba(255, 255, 255, 0.05);
      color: var(--color-text-primary);

      .sidebar__hub-cta {
        color: var(--color-text-primary);
        transform: translateX(2px);
      }
    }

    &:active {
      background: rgba(255, 255, 255, 0.08);
      transition-duration: 0ms;
    }

    &:focus-visible {
      outline: 2px solid color-mix(in srgb, var(--color-brand-purple) 60%, transparent);
      outline-offset: 2px;
    }

    &.is-active {
      --status-color: var(--color-success);
    }
    &.is-error {
      --status-color: var(--color-danger);
    }
    &.is-idle {
      --status-color: var(--color-text-muted);
    }
  }

  &__hub-avatar {
    position: relative;
    width: 38px;
    height: 38px;
    border-radius: 50%;
    display: grid;
    place-items: center;
    background: color-mix(in srgb, var(--color-brand-purple) 14%, transparent);
    color: var(--color-brand-purple);
    flex-shrink: 0;
    transition: background-color 200ms var(--ease-out);

    .sidebar__hub-card.is-active & {
      background: color-mix(in srgb, var(--color-brand-purple) 22%, transparent);
    }
  }

  &__hub-pip {
    position: absolute;
    right: -1px;
    bottom: -1px;
    width: 11px;
    height: 11px;
    border-radius: 50%;
    background: var(--status-color);
    border: 2px solid var(--color-bg, #0d0d12);
    transition: background-color 200ms var(--ease-out);

    .sidebar__hub-card.is-active & {
      animation: hubPipPulse 2.4s ease-in-out infinite;
    }
  }

  &__hub-info {
    display: flex;
    flex-direction: column;
    gap: 1px;
    min-width: 0;
    line-height: 1.2;
  }

  &__hub-name {
    font-size: 13.5px;
    font-weight: 600;
    color: var(--color-text-primary);
    letter-spacing: -0.005em;
  }

  &__hub-state {
    font-size: 11.5px;
    color: var(--color-text-muted);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;

    .sidebar__hub-card.is-active & {
      color: var(--color-success);
    }
    .sidebar__hub-card.is-error & {
      color: var(--color-danger);
    }
  }

  &__hub-skill {
    // Без border'а — tint-заливка отделяет чип от soft-bg карточки.
    display: inline-flex;
    align-items: center;
    gap: 5px;
    margin-top: 3px;
    padding: 2px 7px;
    border-radius: 999px;
    font-size: 10.5px;
    font-weight: 600;
    letter-spacing: 0.02em;
    align-self: flex-start;
    line-height: 1.2;
    background: rgba(255, 255, 255, 0.05);
    color: var(--color-text-muted);

    &.is-success {
      color: var(--color-success);
      background: rgba(var(--color-success-rgb), 0.14);
    }
    &.is-warn {
      color: var(--color-warning);
      background: rgba(var(--color-warning-rgb), 0.14);
    }
  }

  &__hub-skill-dot {
    width: 5px;
    height: 5px;
    border-radius: 50%;
    background: currentColor;
  }

  &__hub-cta {
    color: var(--color-text-muted);
    flex-shrink: 0;
    transition:
      color 200ms var(--ease-out),
      transform 200ms var(--ease-out);
  }

  &__version {
    text-align: center;
    opacity: 0.65;
  }
}

// Tablet 720–1100px: compact-режим (только иконки). Drawer на мобиле остаётся full-width.
@media (min-width: 721px) and (max-width: 1100px) {
  .app__sidebar:not(.app__sidebar--drawer) {
    .sidebar {
      padding: 12px 8px;

      &__item {
        grid-template-columns: 38px;
        padding: 0;
        justify-items: center;
      }

      // В compact только dot-маркер; label и hairline скрываем (иначе налезли бы на 38px chips).
      &__heading {
        justify-content: center;
        margin: 2px 0 8px;
        padding: 0;
        gap: 0;
      }

      &__heading-label,
      &__heading-line {
        display: none;
      }

      &__label,
      &__badge,
      &__hub-info,
      &__hub-cta,
      &__version {
        display: none;
      }

      &__hub-card {
        grid-template-columns: 38px;
        padding: 6px;
        justify-items: center;
      }

      &__indicator {
        // На compact pill ближе к краю.
        left: -8px;
      }
    }
  }
}

@keyframes hubPipPulse {
  0%,
  100% {
    box-shadow: 0 0 0 0 color-mix(in srgb, var(--status-color) 50%, transparent);
  }
  70% {
    box-shadow: 0 0 0 6px color-mix(in srgb, var(--status-color) 0%, transparent);
  }
}

@media (prefers-reduced-motion: reduce) {
  .sidebar__hub-pip,
  .sidebar__hub-cta,
  .sidebar__hub-card {
    transition: none;
    animation: none;
  }
}
</style>
