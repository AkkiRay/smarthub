<template>
  <aside class="sidebar" ref="root" aria-labelledby="sidebar-heading">
    <!-- Eyebrow `<h2>`: метка nav-секции для screen-readers, скрывается в compact. -->
    <h2 id="sidebar-heading" class="sidebar__heading">
      <span class="sidebar__heading-mark" aria-hidden="true" />
      <span class="sidebar__heading-label text--micro">Меню</span>
      <span class="sidebar__heading-line" aria-hidden="true" />
    </h2>
    <nav class="sidebar__nav" ref="navEl">
      <!-- Sliding rail: один elem, geometry из активного item'а. На route change top / height пересчитываются. -->
      <span
        class="sidebar__rail"
        :class="{ 'is-ready': railReady, 'is-active': railActive }"
        :style="railStyle"
        aria-hidden="true"
      />
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
          <span class="sidebar__hub-orb">
            <JarvisOrb
              size="sm"
              :state="stationOrbState"
              :detail="2"
              voice-mode
              :voice-state="station.voiceState"
            />
          </span>
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
      <RouterLink
        to="/settings#updates"
        class="sidebar__version text--micro"
        :class="{ 'sidebar__version--has-update': hasUpdate }"
        :title="versionTitle"
      >
        <span class="sidebar__version-label">SmartHome Hub v{{ ui.version || '1.0.0' }}</span>
        <span v-if="hasUpdate" class="sidebar__version-pip" aria-hidden="true" />
      </RouterLink>
    </div>
  </aside>
</template>

<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, useTemplateRef, watch } from 'vue';
import { useRoute } from 'vue-router';
import { useYandexStationStore } from '@/stores/yandexStation';
import { useAliceStore } from '@/stores/alice';
import { useUiStore } from '@/stores/ui';
import { useUpdaterStore } from '@/stores/updater';
import { useGsap } from '@/composables/useGsap';
import { useSpeakerNavigation } from '@/composables/useSpeakerNavigation';
import { useNavItems } from '@/composables/useNavItems';
import BaseIcon from '@/components/base/BaseIcon.vue';
import JarvisOrb from '@/components/visuals/JarvisOrb.vue';

const station = useYandexStationStore();
const alice = useAliceStore();
const ui = useUiStore();
const updater = useUpdaterStore();
const speakerNav = useSpeakerNavigation();

const hasUpdate = computed(
  () => updater.isAvailable || updater.isDownloading || updater.isDownloaded,
);
const versionTitle = computed(() => {
  if (updater.isDownloaded)
    return `Обновление ${updater.newVersion} готово — нажмите для установки`;
  if (updater.isDownloading) return `Скачивается ${updater.newVersion ?? 'обновление'}…`;
  if (updater.isAvailable) return `Доступно обновление ${updater.newVersion}`;
  return 'Открыть настройки и проверить обновления';
});
const root = useTemplateRef<HTMLElement>('root');

/** Hub-card → пульт колонки. Lookup / sync инкапсулирован в useSpeakerNavigation. */
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

/** Skill bridge status chip под station-label. */
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

// Items + badge counters: shared composable между sidebar и bottom-nav.
const items = useNavItems();

const { from } = useGsap(root);
const route = useRoute();
const navEl = useTemplateRef<HTMLElement>('navEl');

// Sliding rail: top / height активного item'а в inline-style, transition по ним.
// `is-ready` включает transition после первого syncRail.
const railStyle = ref<Record<string, string>>({});
const railReady = ref(false);
const railActive = ref(false);
let railResize: ResizeObserver | null = null;

async function syncRail(): Promise<void> {
  await nextTick();
  if (!navEl.value) return;
  const active = navEl.value.querySelector<HTMLElement>('.sidebar__item.is-active');
  if (!active) {
    railActive.value = false;
    return;
  }
  const navRect = navEl.value.getBoundingClientRect();
  const itemRect = active.getBoundingClientRect();
  // Pill 26px по центру item'а с поправкой на scrollTop nav-контейнера.
  const railHeight = 26;
  const top =
    itemRect.top - navRect.top + navEl.value.scrollTop + (itemRect.height - railHeight) / 2;
  railStyle.value = {
    top: `${Math.round(top)}px`,
    height: `${railHeight}px`,
  };
  railActive.value = true;
  if (!railReady.value) {
    requestAnimationFrame(() => {
      railReady.value = true;
    });
  }
}

watch(
  () => route.path,
  () => syncRail(),
);

onMounted(() => {
  void syncRail();
  if (navEl.value) {
    railResize = new ResizeObserver(() => {
      void syncRail();
    });
    railResize.observe(navEl.value);
  }
  // СИНХРОННО: gsap.from(immediateRender:true) ставит FROM-state ДО paint'а
  // первого фрейма — sidebar items видно с opacity:0 без flash'а.
  from('.sidebar__item', {
    opacity: 0,
    x: -16,
    stagger: 0.05,
    duration: 0.5,
    ease: 'power3.out',
    clearProps: 'opacity,transform',
  });
});

onBeforeUnmount(() => {
  railResize?.disconnect();
  railResize = null;
});
</script>

<style scoped lang="scss">
@use '@/styles/abstracts/mixins' as *;

.sidebar {
  display: flex;
  flex-direction: column;
  // Width — у parent `.app__sidebar`, rail full-fill.
  width: 100%;
  height: 100%;
  min-height: 0;
  // 14px вертикальный ритм: items / hub-card / version.
  padding: 14px;
  position: relative;
  border-radius: 0;
  // Glass без border / bevel.
  @include glass(var(--glass-alpha-medium), var(--glass-blur-strong));
  @include glass-noise();
  background: var(--sidebar-surface);
  border: 0;
  box-shadow: none;

  // Heading: eyebrow «Меню» = dot + label + hairline.
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
    // Wider tracking для eyebrow на blur-фоне.
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

    // Hover (non-active): brand tint + subtle background.
    &:hover:not(.is-active) {
      color: var(--color-text-primary);
      background: rgba(255, 255, 255, 0.04);

      .sidebar__icon {
        color: var(--color-text-primary);
      }
    }

    // Active: brand tint + brand-purple на иконке. Pill rail рендерится отдельно.
    &.is-active {
      color: var(--color-text-primary);
      background: var(--gradient-brand-soft);

      .sidebar__icon {
        color: var(--color-brand-purple);
      }
    }
  }

  // Icon slot: clean SVG, transition по color.
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

  // Sliding rail: один pill, top / height inline через JS, transition по ним.
  // `left: -14px` компенсирует sidebar padding и кладёт rail на внешнюю кромку.
  // `will-change` намеренно опущен: top/height — layout-свойства, GPU-hint
  // на них не помогает, только поддерживает лишний composite-layer постоянно.
  &__rail {
    position: absolute;
    left: -14px;
    width: 3px;
    border-radius: 0 3px 3px 0;
    background: var(--gradient-brand);
    box-shadow: 0 0 12px rgba(var(--color-brand-purple-rgb), 0.55);
    opacity: 0;
    pointer-events: none;
    transform: scaleX(1);

    // is-ready: включает transition после первого позиционирования.
    &.is-ready {
      transition:
        top 360ms cubic-bezier(0.34, 1.56, 0.64, 1),
        height 280ms var(--ease-out),
        opacity 220ms var(--ease-out);
    }

    &.is-active {
      opacity: 1;
    }
  }

  &__bottom {
    // Whitespace вместо hairline'а: sidebar background уже разделяет.
    margin-top: 18px;
    flex-shrink: 0;
    display: flex;
    flex-direction: column;
    gap: 12px;
  }

  // Hub-card: кликабельный row в стиле sidebar__item, без glass.
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
    flex-shrink: 0;
    // Без overflow:hidden: pip torчит за периметр, halo клипуется на `__hub-orb`.
  }

  &__hub-orb {
    position: absolute;
    inset: 0;
    border-radius: 50%;
    overflow: hidden;
    background: color-mix(in srgb, var(--color-brand-purple) 14%, transparent);
    color: var(--color-brand-purple);
    display: grid;
    place-items: center;
    transition: background-color 200ms var(--ease-out);

    // JarvisOrb sized для 38px avatar.
    :deep(.orb) {
      --orb-size: 38px;
    }
    :deep(.orb__halo) {
      // Halo внутрь avatar clip-зоны.
      transform: scale(0.8);
    }

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
    // Pip поверх орба без клипа.
    z-index: 2;

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
    // Tint-fill вместо border'а отделяет чип от soft-bg карточки.
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
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 6px;
    text-align: center;
    text-decoration: none;
    color: var(--color-text-muted);
    opacity: 0.7;
    padding: 4px 8px;
    border-radius: 999px;
    transition:
      color 200ms var(--ease-out),
      opacity 200ms var(--ease-out),
      background-color 200ms var(--ease-out);

    &:hover {
      opacity: 1;
      color: var(--color-text-primary);
      background: rgba(255, 255, 255, 0.04);
    }

    &:focus-visible {
      outline: 2px solid color-mix(in srgb, var(--color-brand-purple) 70%, transparent);
      outline-offset: 2px;
    }

    &--has-update {
      opacity: 1;
      color: transparent;
      background: linear-gradient(90deg, var(--color-brand-purple), var(--color-brand-pink));
      -webkit-background-clip: text;
      background-clip: text;
    }
  }

  &__version-pip {
    width: 6px;
    height: 6px;
    border-radius: 50%;
    background: var(--color-brand-pink);
    box-shadow: 0 0 10px rgba(255, 97, 230, 0.7);
    animation: sidebar-pip-pulse 1.8s ease-in-out infinite;
    flex-shrink: 0;
  }
}

@keyframes sidebar-pip-pulse {
  0%,
  100% {
    transform: scale(1);
    opacity: 0.85;
  }
  50% {
    transform: scale(1.3);
    opacity: 1;
  }
}

// Tablet 720–1100px: compact-режим (icon-only), иконки по центру column.
// Track на всю ширину (`1fr`) + `justify-items: center`.
@media (min-width: 721px) and (max-width: 1100px) {
  .sidebar {
    padding: 12px 8px;

    &__nav {
      align-items: stretch;
    }

    &__item {
      grid-template-columns: minmax(0, 1fr);
      padding: 0;
      justify-items: center;
      justify-self: stretch;
    }

    &__icon {
      // 38×38, justify-self: center.
      justify-self: center;
    }

    // Compact heading: только dot-маркер, без label / hairline.
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
      grid-template-columns: minmax(0, 1fr);
      padding: 6px;
      justify-items: center;
    }

    &__hub-avatar {
      justify-self: center;
    }

    &__rail {
      // Compact: pill у внешней кромки (padding 8px → -8px).
      left: -8px;
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
