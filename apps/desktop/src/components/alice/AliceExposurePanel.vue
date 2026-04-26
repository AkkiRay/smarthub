<template>
  <section class="exposure" data-tour="alice-exposure">
    <header class="exposure__head">
      <div class="exposure__head-copy">
        <h3 class="exposure__title">Что видит Алиса</h3>
        <p class="exposure__sub">
          Тумблер «выдан» делает устройство доступным для голоса и приложения «Дом с Алисой». Имя и
          комнату можно переопределить — Алиса любит короткие названия.
        </p>
      </div>
      <div class="exposure__head-actions">
        <span class="exposure__counter">
          <strong>{{ exposedDeviceCount }}</strong>
          <span>из {{ alice.previews.length }} устройств</span>
        </span>
        <span class="exposure__counter">
          <strong>{{ exposedSceneCount }}</strong>
          <span>из {{ scenes.scenes.length }} сценариев</span>
        </span>
        <BaseButton
          variant="ghost"
          size="sm"
          icon-left="refresh"
          :disabled="!alice.isLinked"
          @click="onTriggerDiscovery"
        >
          Обновить у Алисы
        </BaseButton>
      </div>
    </header>

    <BaseSegmented v-model="activeTab" :options="tabs" class="exposure__tabs" />

    <!-- ============ Devices ============ -->
    <div v-if="activeTab === 'devices'" class="exposure__list">
      <article
        v-for="preview in alice.previews"
        :key="preview.yandexDeviceId"
        class="exposure-row"
        :class="{
          'is-disabled': !isDeviceEnabled(preview.yandexDeviceId),
          'is-yandex': isYandexImported(preview),
        }"
      >
        <div class="exposure-row__icon">
          <BaseIcon :name="iconForType(preview.type)" :size="18" />
        </div>
        <div class="exposure-row__main">
          <div class="exposure-row__head">
            <strong class="exposure-row__name">{{ preview.name }}</strong>
            <span class="exposure-row__type">{{ formatType(preview.type) }}</span>
            <span
              v-if="isYandexImported(preview)"
              class="exposure-row__badge"
              title="Это устройство уже видно Алисе через «Дом с Алисой» — повторно экспозить через навык не нужно."
            >
              <BaseIcon name="alice" :size="11" />
              уже у Алисы
            </span>
          </div>
          <p class="exposure-row__caps">
            <span v-for="cap in preview.capabilitiesSummary" :key="cap" class="exposure-row__cap">
              {{ cap }}
            </span>
            <span v-if="preview.propertiesCount > 0" class="exposure-row__cap">
              {{ preview.propertiesCount }} {{ pluralizeProps(preview.propertiesCount) }}
            </span>
            <span
              v-if="!preview.capabilitiesSummary.length && preview.propertiesCount === 0"
              class="exposure-row__cap exposure-row__cap--muted"
            >
              нет доступных capabilities
            </span>
          </p>
        </div>
        <BaseSwitch
          v-if="!isYandexImported(preview)"
          :model-value="isDeviceEnabled(preview.yandexDeviceId)"
          @update:model-value="(v) => onToggleDevice(preview.yandexDeviceId, v)"
        />
        <span v-else class="exposure-row__locked" title="Управляется Я.Домом">
          <BaseIcon name="check" :size="14" />
        </span>
      </article>

      <p v-if="!alice.previewsLoading && !alice.previews.length" class="exposure__empty">
        Устройств ещё нет — добавьте через раздел «Поиск устройств».
      </p>
    </div>

    <!-- ============ Scenes ============ -->
    <div v-else class="exposure__list">
      <article
        v-for="scene in scenes.scenes"
        :key="scene.id"
        class="exposure-row"
        :class="{ 'is-disabled': !isSceneEnabled(scene) }"
      >
        <div
          class="exposure-row__icon exposure-row__icon--scene"
          :style="{ '--accent': scene.accent }"
        >
          <span v-safe-html="scene.icon" />
        </div>
        <div class="exposure-row__main">
          <div class="exposure-row__head">
            <strong class="exposure-row__name">{{ scene.name }}</strong>
            <span class="exposure-row__type">сценарий</span>
          </div>
          <p class="exposure-row__caps">
            <span class="exposure-row__cap">
              {{ scene.actions.length }} {{ pluralizeActions(scene.actions.length) }}
            </span>
            <span class="exposure-row__cap exposure-row__cap--muted">
              голос: «Алиса, включи {{ scene.name.toLowerCase() }}»
            </span>
          </p>
        </div>
        <BaseSwitch
          :model-value="isSceneEnabled(scene)"
          @update:model-value="(v) => onToggleScene(scene.id, v)"
        />
      </article>

      <p v-if="!scenes.scenes.length" class="exposure__empty">
        Сценариев ещё нет — создайте в разделе «Сценарии».
      </p>
    </div>
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue';
import type { AliceDevicePreview, Scene } from '@smarthome/shared';
import { useAliceStore } from '@/stores/alice';
import { useScenesStore } from '@/stores/scenes';
import { useDevicesStore } from '@/stores/devices';
import {
  BaseButton,
  BaseIcon,
  BaseSegmented,
  BaseSwitch,
  type IconName,
  type SegmentedOption,
} from '@/components/base';

const alice = useAliceStore();
const scenes = useScenesStore();
const devices = useDevicesStore();

const activeTab = ref<'devices' | 'scenes'>('devices');
const tabs = computed<SegmentedOption[]>(() => [
  { value: 'devices', label: 'Устройства', count: alice.previews.length },
  { value: 'scenes', label: 'Сценарии', count: scenes.scenes.length },
]);

onMounted(async () => {
  await alice.loadPreviews();
});

// При появлении/удалении устройств в основном списке — рефрешим preview'ы.
watch(
  () => devices.devices.length,
  () => {
    void alice.loadPreviews();
  },
);

const exposedDeviceCount = computed(() => alice.status?.exposedDeviceCount ?? 0);
const exposedSceneCount = computed(() => alice.status?.exposedSceneCount ?? 0);

function isDeviceEnabled(yandexDeviceId: string): boolean {
  // Default: устройство выдано (true), пока юзер явно не отключил (enabled === false).
  const exp = alice.deviceExposureById.get(yandexDeviceId);
  return exp?.enabled !== false;
}

/** Устройства из «Дома с Алисой» уже видны Алисе нативно — повторно экспозить не нужно. */
function isYandexImported(p: AliceDevicePreview): boolean {
  return p.source.driver === 'yandex-iot';
}

function isSceneEnabled(scene: Scene): boolean {
  // Default: следуем флагу exposeToStation на самой сцене.
  const exp = alice.sceneExposureById.get(scene.id);
  return exp?.enabled ?? scene.exposeToStation;
}

async function onToggleDevice(deviceId: string, enabled: boolean): Promise<void> {
  await alice.setDeviceExposure({ deviceId, enabled });
}

async function onToggleScene(sceneId: string, enabled: boolean): Promise<void> {
  await alice.setSceneExposure({ sceneId, enabled });
}

async function onTriggerDiscovery(): Promise<void> {
  await alice.triggerDiscoveryCallback();
}

// Маппинг yandex device-types → наша библиотека иконок (упрощённо, fallback к 'devices').
function iconForType(type: string): IconName {
  if (type.startsWith('devices.types.light')) return 'light';
  if (type.startsWith('devices.types.socket')) return 'socket';
  if (type.startsWith('devices.types.switch')) return 'switch';
  if (type.startsWith('devices.types.sensor')) return 'sensor';
  if (type.startsWith('devices.types.thermostat')) return 'thermostat';
  if (type.startsWith('devices.types.media_device')) return 'media';
  return 'devices';
}

function formatType(type: string): string {
  // 'devices.types.light.lamp' → 'light · lamp'
  return type.replace(/^devices\.types\./, '').replace(/\./g, ' · ');
}

function pluralizeProps(n: number): string {
  const m10 = n % 10;
  if (n % 100 >= 11 && n % 100 <= 14) return 'параметров';
  if (m10 === 1) return 'параметр';
  if (m10 >= 2 && m10 <= 4) return 'параметра';
  return 'параметров';
}

function pluralizeActions(n: number): string {
  const m10 = n % 10;
  if (n % 100 >= 11 && n % 100 <= 14) return 'действий';
  if (m10 === 1) return 'действие';
  if (m10 >= 2 && m10 <= 4) return 'действия';
  return 'действий';
}
</script>

<style scoped lang="scss">
.exposure {
  display: flex;
  flex-direction: column;
  gap: 18px;

  &__head {
    display: flex;
    flex-wrap: wrap;
    align-items: flex-start;
    justify-content: space-between;
    gap: 16px;
  }

  &__head-copy {
    flex: 1 1 320px;
    min-width: 0;
  }

  &__title {
    margin: 0 0 6px;
    font-family: var(--font-family-display);
    font-size: 18px;
    font-weight: 700;
    color: var(--color-text-primary);
  }

  &__sub {
    margin: 0;
    font-size: 13px;
    line-height: 1.5;
    color: var(--color-text-secondary);
  }

  &__head-actions {
    display: flex;
    align-items: center;
    gap: 12px;
    flex-wrap: wrap;
  }

  &__counter {
    display: inline-flex;
    align-items: baseline;
    gap: 6px;
    padding: 4px 10px;
    border-radius: 999px;
    background: rgba(255, 255, 255, 0.03);
    border: 1px solid rgba(255, 255, 255, 0.05);
    font-size: 12px;
    color: var(--color-text-muted);

    strong {
      font-family: var(--font-family-display);
      font-size: 14px;
      font-weight: 700;
      color: var(--color-text-primary);
    }
  }

  &__tabs {
    align-self: flex-start;
  }

  &__list {
    display: flex;
    flex-direction: column;
    gap: 8px;
  }

  &__empty {
    margin: 0;
    padding: 24px;
    text-align: center;
    color: var(--color-text-muted);
    font-size: 14px;
    border-radius: var(--radius-lg);
    border: 1px dashed rgba(255, 255, 255, 0.08);
    background: rgba(255, 255, 255, 0.015);
  }
}

.exposure-row {
  display: grid;
  grid-template-columns: 40px minmax(0, 1fr) auto;
  gap: 14px;
  align-items: center;
  padding: 12px 16px;
  border-radius: var(--radius-md);
  background: rgba(255, 255, 255, 0.022);
  border: 1px solid rgba(255, 255, 255, 0.05);
  transition:
    background-color 160ms var(--ease-out),
    border-color 160ms var(--ease-out),
    opacity 160ms var(--ease-out);

  &:hover {
    background: rgba(255, 255, 255, 0.035);
    border-color: rgba(255, 255, 255, 0.07);
  }

  &.is-disabled {
    opacity: 0.55;
  }

  &__icon {
    width: 36px;
    height: 36px;
    border-radius: 10px;
    display: grid;
    place-items: center;
    background: rgba(var(--color-brand-violet-rgb), 0.12);
    color: var(--color-brand-violet);

    &--scene {
      --accent: var(--color-brand-violet);
      background: color-mix(in srgb, var(--accent) 14%, transparent);
      color: var(--accent);

      :deep(svg) {
        width: 18px;
        height: 18px;
      }
    }
  }

  &__main {
    display: flex;
    flex-direction: column;
    gap: 4px;
    min-width: 0;
  }

  &__head {
    display: flex;
    align-items: baseline;
    gap: 10px;
    flex-wrap: wrap;
  }

  &__name {
    font-size: 14px;
    font-weight: 600;
    color: var(--color-text-primary);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  &__type {
    font-family: var(--font-family-mono);
    font-size: 11px;
    color: var(--color-text-muted);
    letter-spacing: 0.02em;
  }

  &__badge {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    padding: 2px 8px;
    border-radius: 999px;
    font-size: 10.5px;
    font-weight: 500;
    background: rgba(255, 204, 0, 0.14);
    border: 1px solid rgba(255, 204, 0, 0.32);
    color: #ffcc00;
    cursor: help;
  }

  &__locked {
    width: 28px;
    height: 28px;
    border-radius: 50%;
    display: grid;
    place-items: center;
    background: rgba(255, 204, 0, 0.14);
    color: #ffcc00;
    border: 1px solid rgba(255, 204, 0, 0.32);
    flex-shrink: 0;
  }

  &.is-yandex {
    background: rgba(255, 204, 0, 0.04);
    border-color: rgba(255, 204, 0, 0.18);
  }

  &__caps {
    margin: 0;
    display: flex;
    flex-wrap: wrap;
    gap: 4px 8px;
  }

  &__cap {
    font-size: 11.5px;
    color: var(--color-text-secondary);
    padding: 2px 8px;
    border-radius: 6px;
    background: rgba(255, 255, 255, 0.03);
    border: 1px solid rgba(255, 255, 255, 0.04);

    &--muted {
      color: var(--color-text-muted);
      border-style: dashed;
    }
  }
}

// ---- Mobile ----
@media (max-width: 720px) {
  .exposure {
    gap: 14px;

    &__head {
      flex-direction: column;
      align-items: stretch;
      gap: 12px;
    }

    &__head-actions {
      flex-wrap: wrap;
      gap: 8px;
    }

    &__counter {
      flex: 1 1 calc(50% - 4px);
      justify-content: center;
    }
  }

  .exposure-row {
    grid-template-columns: 40px minmax(0, 1fr) auto;
    padding: 10px 12px;
    gap: 10px;

    &__head {
      gap: 6px;
    }

    // Тип-чип на отдельной строке когда имя длинное — иначе обрезается ellipsis-ом.
    &__type {
      flex-basis: 100%;
    }

    &__caps {
      gap: 3px 6px;
    }

    // Cap-чипы на узком: оставляем первые 2, остальные — по wrap.
    &__cap {
      font-size: 11px;
      padding: 1px 6px;
    }
  }
}
</style>
