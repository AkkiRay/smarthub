<template>
  <section class="rooms" ref="root">
    <BasePageHeader
      eyebrow="Группировка"
      title="Комнаты"
      description="Группируйте устройства по комнатам — это ускоряет навигацию и даёт Алисе контекст («включи свет в спальне»)."
    >
      <template #actions>
        <BaseButton variant="primary" icon-left="plus" @click="creating = true">
          Новая комната
        </BaseButton>
      </template>
    </BasePageHeader>

    <Transition name="list-fade" mode="out-in">
      <SkeletonGrid
        v-if="showSkeleton"
        key="skeleton"
        :count="4"
        cell-min="280px"
        cell-height="200px"
        class="rooms__grid"
      />

      <div v-else-if="rooms.rooms.length" key="grid" class="rooms__grid bento-grid">
        <article
        v-for="room in roomsWithStats"
        :key="room.id"
        class="room"
        :class="{
          'room--yandex': room.origin === 'yandex',
          'room--active': room.activeCount > 0,
          'room--empty': room.deviceCount === 0,
        }"
      >
        <!-- ============== Hero: icon + name + meta ============== -->
        <header class="room__hero">
          <span class="room__icon" v-safe-html="room.icon" />
          <div class="room__hero-copy">
            <h3 class="room__name">{{ room.name }}</h3>
            <p class="room__meta">
              <span v-if="room.deviceCount > 0">
                {{ room.deviceCount }} {{ pluralizeDevice(room.deviceCount) }}
              </span>
              <span v-else class="room__meta--muted">Пусто</span>
              <span
                v-if="room.onlineCount < room.deviceCount && room.deviceCount > 0"
                class="room__meta--warn"
              >
                · {{ room.deviceCount - room.onlineCount }} офлайн
              </span>
            </p>
          </div>

          <!-- Top-right action chips — компактные icon-кнопки. -->
          <div class="room__hero-actions">
            <span
              v-if="room.origin === 'yandex'"
              class="room__yandex-badge"
              title="Импортировано из «Дома с Алисой»"
            >
              <BaseIcon name="alice" :size="12" />
            </span>
            <button
              v-else
              type="button"
              class="room__icon-btn"
              aria-label="Редактировать"
              title="Редактировать"
              @click.stop="onEdit(room)"
            >
              <BaseIcon name="edit" :size="14" />
            </button>
            <button
              v-if="room.origin !== 'yandex'"
              type="button"
              class="room__icon-btn room__icon-btn--danger"
              aria-label="Удалить"
              title="Удалить"
              @click.stop="onRemove(room.id, room.name)"
            >
              <BaseIcon name="trash" :size="14" />
            </button>
          </div>
        </header>

        <!-- ====== Smart toggle: счётчик-кнопка. Клик — на/выкл всех вместе ====== -->
        <button
          v-if="room.toggleableCount > 0"
          type="button"
          class="room__toggle"
          :class="{
            'is-all-on': room.activeCount === room.toggleableCount,
            'is-partial': room.activeCount > 0 && room.activeCount < room.toggleableCount,
            'is-all-off': room.activeCount === 0,
          }"
          :disabled="!!bulkBusy[room.id]"
          :data-loading="!!bulkBusy[room.id]"
          :title="room.activeCount === room.toggleableCount ? 'Выключить всё' : 'Включить всё'"
          :aria-label="room.activeCount === room.toggleableCount ? 'Выключить всё' : 'Включить всё'"
          @click.stop="onBulkToggle(room.id, room.activeCount !== room.toggleableCount)"
        >
          <span class="room__toggle-icon" aria-hidden="true">
            <svg viewBox="0 0 24 24">
              <!-- Лампочка с лучами в ON-state. -->
              <path
                v-if="room.activeCount > 0"
                d="M12 3a6 6 0 0 1 6 6c0 2.4-1.4 4.4-3 5.4V17H9v-2.6C7.4 13.4 6 11.4 6 9a6 6 0 0 1 6-6zM9 18h6M10 21h4"
                fill="none"
                stroke="currentColor"
                stroke-width="1.8"
                stroke-linejoin="round"
                stroke-linecap="round"
              />
              <!-- Power-icon в OFF-state. -->
              <path
                v-else
                d="M12 3v9M5.6 7.4a8 8 0 1 0 12.8 0"
                fill="none"
                stroke="currentColor"
                stroke-width="1.8"
                stroke-linecap="round"
              />
            </svg>
          </span>
          <span class="room__toggle-meta">
            <strong class="room__toggle-num">
              {{ room.activeCount }}<span class="room__toggle-sep">/</span
              >{{ room.toggleableCount }}
            </strong>
            <span class="room__toggle-caption">
              {{
                room.activeCount === room.toggleableCount
                  ? 'всё включено'
                  : room.activeCount === 0
                    ? 'всё выключено'
                    : pluralizeWith(room.activeCount, ['включена', 'включены', 'включено'])
              }}
            </span>
          </span>
          <span class="room__toggle-hint" aria-hidden="true">
            <BaseIcon
              :name="room.activeCount === room.toggleableCount ? 'close' : 'check'"
              :size="12"
            />
          </span>
        </button>

        <!-- ============== Preview-чипы устройств ============== -->
        <div v-if="room.previewDevices.length" class="room__chips">
          <RouterLink
            v-for="d in room.previewDevices"
            :key="d.id"
            :to="`/devices/${d.id}`"
            class="room__chip"
            :class="{ 'is-on': isDeviceOn(d) }"
            @click.stop
          >
            {{ d.name }}
          </RouterLink>
          <span v-if="room.deviceCount > room.previewDevices.length" class="room__chip-more">
            +{{ room.deviceCount - room.previewDevices.length }}
          </span>
        </div>

        <!-- ============== Inline brightness slider ============== -->
        <label v-if="room.dimmableCount > 0" class="room__bulk-bright" @click.stop>
          <span class="room__bulk-label">
            <BaseIcon name="light" :size="11" />
            Яркость · {{ room.dimmableCount }} {{ pluralizeLamp(room.dimmableCount) }}
          </span>
          <input
            type="range"
            min="1"
            max="100"
            step="1"
            class="room__bulk-slider"
            @input="
              onBrightnessSliderInput(room.id, ($event.target as HTMLInputElement).valueAsNumber)
            "
          />
        </label>

        <!-- ============== Color palette ============== -->
        <div v-if="room.colorableCount > 0" class="room__bulk-palette" @click.stop>
          <span class="room__bulk-label">
            <BaseIcon name="color" :size="11" />
            Цвет · {{ room.colorableCount }} {{ pluralizeLamp(room.colorableCount) }}
          </span>
          <div class="room__bulk-palette-grid">
            <button
              v-for="p in COLOR_PRESETS"
              :key="p.hex"
              type="button"
              class="room__bulk-swatch"
              :style="{ '--swatch': p.hex }"
              :title="p.name"
              :aria-label="`Цвет: ${p.name}`"
              @click="onBulkColor(room.id, p)"
            />
            <!-- Кастом-пипетка: native input type="color" в swatch UI.
                 Input-events дебаунсятся через onCustomColorChange;
                 финальный цвет — через onBulkCustomColor (тот же builder,
                 что и для пресетов). -->
            <label
              class="room__bulk-swatch room__bulk-swatch--custom"
              :title="'Свой цвет'"
              :aria-label="'Выбрать свой цвет'"
            >
              <BaseIcon name="plus" :size="14" />
              <input
                type="color"
                class="room__bulk-swatch-input"
                :value="lastCustomColor.get(room.id) ?? '#a961ff'"
                @input="onCustomColorChange(room.id, ($event.target as HTMLInputElement).value)"
                @change="onCustomColorChange(room.id, ($event.target as HTMLInputElement).value)"
              />
            </label>
          </div>
        </div>

        <p v-if="room.origin === 'yandex'" class="room__hint">
          Управляется «Домом с Алисой» — изменяйте в приложении Яндекс
        </p>
      </article>
      </div>

      <BaseEmpty
        v-else
        key="empty"
        title="У вас ещё нет комнат"
        text="Добавьте «Гостиную», «Спальню», «Кухню» — и закрепите за ними устройства."
        data-anim="block"
      >
        <template #glyph>
          <BaseIcon name="rooms" :size="64" />
        </template>
        <template #actions>
          <BaseButton variant="primary" icon-left="plus" @click="creating = true">
            Создать первую комнату
          </BaseButton>
        </template>
      </BaseEmpty>
    </Transition>

    <BaseModal
      :model-value="creating"
      :title="editingId ? 'Редактировать комнату' : 'Новая комната'"
      size="md"
      @update:model-value="(v) => v || cancel()"
    >
      <div class="rooms__form">
        <BaseInput v-model="form.name" label="Название" placeholder="Гостиная" />
        <div class="rooms__icons">
          <span class="text--small">Иконка</span>
          <div class="rooms__icons-grid">
            <button
              v-for="(svg, key) in iconCatalog"
              :key="key"
              type="button"
              class="rooms__icon-btn"
              :class="{ 'is-selected': form.icon === svg }"
              v-safe-html="svg"
              @click="form.icon = svg"
            />
          </div>
        </div>
      </div>

      <template #footer>
        <BaseButton variant="ghost" @click="cancel">Отмена</BaseButton>
        <BaseButton variant="primary" icon-left="check" :disabled="!form.name.trim()" @click="save">
          {{ editingId ? 'Сохранить' : 'Создать' }}
        </BaseButton>
      </template>
    </BaseModal>

    <ConfirmDialog
      v-model="removeTarget.open"
      title="Удалить комнату?"
      :message="`Комната «${removeTarget.name}» будет удалена. Устройства останутся, но без привязки к комнате.`"
      confirm-label="Удалить"
      confirm-icon="trash"
      tone="danger"
      @confirm="performRemove"
    />
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, reactive, ref, useTemplateRef } from 'vue';
import { RouterLink } from 'vue-router';
import type { Device, DeviceCommand, Room } from '@smarthome/shared';
import { useRoomsStore } from '@/stores/rooms';
import { useDevicesStore } from '@/stores/devices';
import { useToasterStore } from '@/stores/toaster';
import { useViewMount } from '@/composables/useViewMount';
import { useBootstrapGate } from '@/composables/useBootstrapGate';
import {
  BaseButton,
  BaseInput,
  BaseModal,
  BaseIcon,
  BasePageHeader,
  BaseEmpty,
  ConfirmDialog,
  SkeletonGrid,
} from '@/components/base';

const rooms = useRoomsStore();
const devices = useDevicesStore();
const toaster = useToasterStore();
const root = useTemplateRef<HTMLElement>('root');

/** Skeleton, пока rooms-store впервые грузится. */
const gate = useBootstrapGate({
  minDuration: 500,
  tasks: [() => (rooms.rooms.length ? Promise.resolve() : rooms.bootstrap())],
});

const showSkeleton = computed(
  () => !gate.ready.value || (rooms.isLoading && rooms.rooms.length === 0),
);

const creating = ref(false);
const editingId = ref<string | null>(null);

// Preset, чтобы пользователь не вводил SVG руками.
const iconCatalog: Record<string, string> = {
  livingRoom:
    '<svg viewBox="0 0 24 24" fill="none"><path d="M3 11V8a2 2 0 012-2h14a2 2 0 012 2v3M2 17a2 2 0 012-2h16a2 2 0 012 2v3h-2v-1H4v1H2v-3z" stroke="currentColor" stroke-width="1.6"/></svg>',
  bedroom:
    '<svg viewBox="0 0 24 24" fill="none"><path d="M2 18V8h4v3h12V8h4v10M2 14h20" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>',
  kitchen:
    '<svg viewBox="0 0 24 24" fill="none"><rect x="4" y="3" width="16" height="18" rx="2" stroke="currentColor" stroke-width="1.6"/><path d="M4 9h16M9 6h.01" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>',
  bathroom:
    '<svg viewBox="0 0 24 24" fill="none"><path d="M3 12V5a2 2 0 014 0v1M3 12h18M5 12v6a3 3 0 003 3h8a3 3 0 003-3v-6" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>',
  office:
    '<svg viewBox="0 0 24 24" fill="none"><rect x="3" y="6" width="18" height="11" rx="2" stroke="currentColor" stroke-width="1.6"/><path d="M3 17l3 4M21 17l-3 4" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>',
  hallway:
    '<svg viewBox="0 0 24 24" fill="none"><path d="M5 21V5a2 2 0 012-2h10a2 2 0 012 2v16M9 21V11h6v10" stroke="currentColor" stroke-width="1.6"/></svg>',
  outdoor:
    '<svg viewBox="0 0 24 24" fill="none"><circle cx="12" cy="8" r="4" stroke="currentColor" stroke-width="1.6"/><path d="M3 21l9-13 9 13" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>',
  garage:
    '<svg viewBox="0 0 24 24" fill="none"><path d="M3 21V9l9-6 9 6v12M3 21h18M7 13h10v8H7z" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/></svg>',
};

const form = reactive({
  name: '',
  icon: iconCatalog['livingRoom']!,
});

/**
 * `toggleableCount` — устройства комнаты с capability `on_off`. Нужен для bulk-actions:
 * датчики/термостаты без on_off в счётчике не учитываются — иначе «4 устройства, 0 вкл»
 * вводит в заблуждение если 3 из 4 — это датчики.
 */
/** Безопасный доступ к `device.capabilities` — legacy-записи в SQLite могут не иметь поля. */
const capsOf = (d: Device): Device['capabilities'] =>
  Array.isArray(d.capabilities) ? d.capabilities : [];

/** Считаем устройство «вкл», если у него on_off-cap имеет truthy state.value. */
function isDeviceOn(d: Device): boolean {
  return capsOf(d).some((c) => c.type === 'devices.capabilities.on_off' && Boolean(c.state?.value));
}

const roomsWithStats = computed(() =>
  rooms.rooms.map((r) => {
    const inRoom = devices.devices.filter((d) => d.room === r.id);
    const toggleable = inRoom.filter((d) =>
      capsOf(d).some((c) => c.type === 'devices.capabilities.on_off'),
    );
    const active = toggleable.filter((d) =>
      capsOf(d).some((c) => c.type === 'devices.capabilities.on_off' && Boolean(c.state?.value)),
    );
    const dimmable = inRoom.filter((d) =>
      capsOf(d).some(
        (c) =>
          c.type === 'devices.capabilities.range' && c.parameters?.['instance'] === 'brightness',
      ),
    );
    const colorable = inRoom.filter((d) => acceptsRgbOrHsv(d));
    return {
      ...r,
      deviceCount: inRoom.length,
      onlineCount: inRoom.filter((d) => d.status === 'online').length,
      toggleableCount: toggleable.length,
      activeCount: active.length,
      dimmableCount: dimmable.length,
      colorableCount: colorable.length,
      previewDevices: inRoom.slice(0, 3),
    };
  }),
);

/** roomId → 'on'|'off' пока bulk-команда в полёте. Блокирует обе кнопки чтобы юзер не дабл-клик'ал. */
const bulkBusy = reactive<Record<string, 'on' | 'off' | undefined>>({});

/**
 * Считает реальные fail'ы из массива `Promise.allSettled` результатов:
 * учитывает и rejected promise'ы, и resolved с `result.status === 'ERROR'`,
 * и `undefined` value. Возвращает `{ ok, failed, firstError }` для UI-toast'а.
 */
function summarizeBulk(
  results: PromiseSettledResult<{ status?: string; errorMessage?: string } | undefined>[],
): { ok: number; failed: number; firstError: string | null } {
  let ok = 0;
  let failed = 0;
  let firstError: string | null = null;
  for (const r of results) {
    if (r.status === 'rejected') {
      failed++;
      if (!firstError) firstError = (r.reason as Error)?.message ?? 'rejected';
      continue;
    }
    // `undefined` value трактуется как failure (пустой ответ от IPC).
    const v = r.value;
    if (!v) {
      failed++;
      if (!firstError) firstError = 'пустой ответ хаба';
      continue;
    }
    if (v.status === 'ERROR') {
      failed++;
      if (!firstError) firstError = v.errorMessage ?? 'driver-error';
    } else {
      ok++;
    }
  }
  return { ok, failed, firstError };
}

async function onBulkToggle(roomId: string, value: boolean): Promise<void> {
  if (bulkBusy[roomId]) return;
  bulkBusy[roomId] = value ? 'on' : 'off';
  try {
    const targets = devices.devices.filter(
      (d) =>
        d.room === roomId &&
        d.status === 'online' &&
        capsOf(d).some((c) => c.type === 'devices.capabilities.on_off'),
    );
    if (!targets.length) {
      toaster.push({ kind: 'info', message: 'В комнате нет онлайн-устройств для переключения' });
      return;
    }
    // executeSilent — иначе store-уровень шлёт по toast'у на каждую ошибку (10 ламп = 10 toast'ов).
    const results = await Promise.allSettled(
      targets.map((d) =>
        devices.executeSilent({
          deviceId: d.id,
          capability: 'devices.capabilities.on_off',
          instance: 'on',
          value,
        }),
      ),
    );
    const { ok, failed, firstError } = summarizeBulk(results);
    const verb = value ? 'включено' : 'выключено';
    if (failed === 0) {
      toaster.push({ kind: 'success', message: `${verb} ${ok} ${pluralizeDevice(ok)}` });
    } else if (ok === 0) {
      toaster.push({
        kind: 'error',
        message: `Ничего не ${verb}. Причина: ${firstError ?? 'неизвестная ошибка'}`,
      });
    } else {
      toaster.push({
        kind: 'info',
        message: `${verb} ${ok} из ${targets.length} · ${failed} ${pluralizeWith(failed, ['с ошибкой', 'с ошибкой', 'с ошибкой'])}: ${firstError ?? '?'}`,
      });
    }
  } finally {
    delete bulkBusy[roomId];
  }
}

/**
 * Bulk-яркость: применяется ко всем on_off-capable + brightness-capable лампам комнаты.
 * Молчаливо проглатываем ошибки яркости — слайдер пользователь двигает интерактивно,
 * spam-toast от каждого drag'а только мешает.
 */
async function onBulkBrightness(roomId: string, percent: number): Promise<void> {
  const targets = devices.devices.filter(
    (d) =>
      d.room === roomId &&
      d.status === 'online' &&
      capsOf(d).some(
        (c) =>
          c.type === 'devices.capabilities.range' && c.parameters?.['instance'] === 'brightness',
      ),
  );
  if (!targets.length) return;
  await Promise.allSettled(
    targets.map((d) =>
      devices.executeSilent({
        deviceId: d.id,
        capability: 'devices.capabilities.range',
        instance: 'brightness',
        value: percent,
      }),
    ),
  );
}

/** Конвертация RGB-int → HSV-объект (Yandex принимает h:0-360, s:0-100, v:0-100). */
function rgbIntToHsv(rgb: number): { h: number; s: number; v: number } {
  const r = ((rgb >> 16) & 0xff) / 255;
  const g = ((rgb >> 8) & 0xff) / 255;
  const b = (rgb & 0xff) / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const d = max - min;
  let h = 0;
  if (d !== 0) {
    if (max === r) h = ((g - b) / d) % 6;
    else if (max === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    h = (h * 60 + 360) % 360;
  }
  const s = max === 0 ? 0 : (d / max) * 100;
  const v = max * 100;
  return { h: Math.round(h), s: Math.round(s), v: Math.round(v) };
}

/**
 * Color preset. `tempK` задан для белых — приоритетно используется `temperature_k`
 * capability, чтобы лампа давала нативный белый без HSV-аппроксимации.
 */
interface ColorPreset {
  name: string;
  hex: string;
  rgbInt: number;
  tempK?: number;
}

interface ColorParams {
  color_model?: 'rgb' | 'hsv';
  temperature_k?: { min: number; max: number };
}

/** Достаёт типизированные `parameters` color_setting'а — `null` если cap отсутствует. */
function colorParamsOf(device: Device): ColorParams | null {
  const caps = Array.isArray(device.capabilities) ? device.capabilities : [];
  const cap = caps.find((c) => c.type === 'devices.capabilities.color_setting');
  if (!cap) return null;
  return (cap.parameters as ColorParams) ?? {};
}

/**
 * Лампа принимает произвольный RGB/HSV (а не только CCT).
 * Yandex Лампочки делятся на: rgb-only, hsv-only, cct-only, rgb+cct, hsv+cct.
 * Кастомный цвет работает только на rgb/hsv-моделях; cct-only лампы должны идти
 * через temperature_k capability отдельным флоу (белый-only). Слепо посылать
 * `instance:'rgb'` CCT-only лампе — Yandex отвечает 400 BAD_REQUEST.
 */
function acceptsRgbOrHsv(device: Device): boolean {
  const p = colorParamsOf(device);
  return p?.color_model === 'rgb' || p?.color_model === 'hsv';
}

/**
 * Строит правильный DeviceCommand под конкретную лампу.
 *
 * Yandex-облачные лампы принимают color_setting только через спецэндпоинт
 * /m/v3/user/custom/group/color/apply (driver сам туда роутит — см.
 * yandex-iot-api.ts:applyColorAction). UI отправляет rgb-int либо
 * temperature_k — драйвер преобразует в нужный body.
 *
 * Приоритеты:
 *   1. White preset (`tempK` задан) + лампа умеет `temperature_k` → CCT.
 *   2. Любой color-cap → `rgb` integer.
 *   3. Иначе → `null` (нет color_setting capability вообще).
 */
function buildColorCommandFor(device: Device, preset: ColorPreset): DeviceCommand | null {
  const params = colorParamsOf(device);
  if (!params) return null;

  if (preset.tempK && params.temperature_k) {
    const { min, max } = params.temperature_k;
    return {
      deviceId: device.id,
      capability: 'devices.capabilities.color_setting',
      instance: 'temperature_k',
      value: Math.max(min, Math.min(max, preset.tempK)),
    };
  }

  // Любой color_model (rgb / hsv / отсутствует) → шлём rgb-int. Yandex сам
  // переведёт во внутреннее представление лампы.
  if (params.color_model === 'hsv' || params.color_model === 'rgb' || !params.color_model) {
    const safe = preset.rgbInt & 0xffffff;
    return {
      deviceId: device.id,
      capability: 'devices.capabilities.color_setting',
      instance: 'rgb',
      value: safe,
    };
  }

  return null;
}

/** HEX `#RRGGBB` (или `RRGGBB`) → 24-битный int. Возвращает -1 если parse failed. */
function hexToRgbInt(hex: string): number {
  const cleaned = hex.replace(/^#/, '').trim();
  if (!/^[0-9a-fA-F]{6}$/.test(cleaned)) return -1;
  return parseInt(cleaned, 16);
}

/**
 * Session-level cache: deviceId → причина почему цвет не принимается.
 *
 * Yandex рапортует `parameters.color_model = 'hsv' | 'rgb'`, но реально лампа
 * может отвергать ВСЕ варианты payload'а с 400 BAD_REQUEST (особенно у Tuya
 * OEM-прошивок и LED-колец у Я.Станций). После первого fail'а не пытаемся
 * больше эту лампу дёргать — она тихо скипается из targets'ов.
 *
 * Кеш живёт в текущей сессии renderer'а; на reload приложения сбрасывается —
 * это намеренно, чтобы юзер мог проверить лампу заново после прошивочного апдейта.
 */
const colorRejectedDevices = new Set<string>();

async function onBulkColor(roomId: string, preset: ColorPreset): Promise<void> {
  // Pre-build команды И одновременно фильтруем кандидатов:
  //   1) Лампы у которых `buildColorCommandFor()` вернул `null` (white-only,
  //      scene-only, etc) — пропускаем заранее.
  //   2) Лампы из session-cache `colorRejectedDevices` — однажды отвергли наш
  //      цвет, не повторяем bad-request.
  const candidates = devices.devices
    .filter((d) => d.room === roomId && d.status === 'online')
    .filter((d) => !colorRejectedDevices.has(d.id))
    .map((d) => ({ device: d, cmd: buildColorCommandFor(d, preset) }))
    .filter((x): x is { device: Device; cmd: DeviceCommand } => x.cmd !== null);

  if (!candidates.length) {
    const hasAnyColorCapable = devices.devices.some(
      (d) =>
        d.room === roomId && capsOf(d).some((c) => c.type === 'devices.capabilities.color_setting'),
    );
    toaster.push({
      kind: 'info',
      message: hasAnyColorCapable
        ? 'Этот цвет не подходит ни одной лампе в комнате'
        : 'В комнате нет цветных ламп',
    });
    return;
  }

  const results = await Promise.allSettled(candidates.map(({ cmd }) => devices.executeSilent(cmd)));

  // Помечаем фейлнувшиеся устройства в session-cache — но ТОЛЬКО для логических
  // отказов лампы (driver вернул конкретный errorCode её отклонения). HTTP-сбои
  // Yandex (`YANDEX_HTTP_ERROR`, 5xx) — transient и не должны навсегда выкидывать
  // лампу из bulk-цели: иначе разовый сбой облака блокирует все следующие клики.
  const TRANSIENT_CODES = new Set(['YANDEX_HTTP_ERROR']);
  for (let i = 0; i < results.length; i++) {
    const r = results[i]!;
    const deviceId = candidates[i]!.device.id;
    if (r.status === 'fulfilled' && r.value.status === 'ERROR') {
      const code = r.value.errorCode ?? '';
      if (!TRANSIENT_CODES.has(code)) colorRejectedDevices.add(deviceId);
    }
  }

  const { ok, failed, firstError } = summarizeBulk(results);
  if (failed === 0) {
    toaster.push({
      kind: 'success',
      message: `«${preset.name}» применён к ${ok} ${pluralizeDevice(ok)}`,
    });
  } else if (ok === 0) {
    // Все упали — лампа(ы) физически не принимают цвет. Один info-toast
    // с подсказкой, и больше не дёргаем (закешировано).
    toaster.push({
      kind: 'info',
      message: `Эта лампа не приняла цвет (${firstError ?? '?'}). Больше пробовать не буду.`,
    });
  } else {
    toaster.push({
      kind: 'info',
      message: `«${preset.name}» применён к ${ok} из ${candidates.length}`,
    });
  }
}

/**
 * Кастомный цвет из <input type="color"> — оборачиваем HEX в синтетический preset
 * и переиспользуем `onBulkColor` (тот же фильтр + builder + toast). Без `tempK` —
 * кастомный пик всегда RGB/HSV, не CCT.
 */
async function onBulkCustomColor(roomId: string, hex: string): Promise<void> {
  const rgbInt = hexToRgbInt(hex);
  if (rgbInt < 0) {
    toaster.push({ kind: 'error', message: `Невалидный HEX: «${hex}»` });
    return;
  }
  await onBulkColor(roomId, {
    name: hex.toUpperCase(),
    hex,
    rgbInt,
  });
}

/** Дебаунс input-events `<input type="color">` (250ms) + dedupe one-color-per-room. */
const customColorDebounce = new Map<string, ReturnType<typeof setTimeout>>();
const lastCustomColor = new Map<string, string>();
function onCustomColorChange(roomId: string, hex: string): void {
  if (lastCustomColor.get(roomId) === hex) return;
  lastCustomColor.set(roomId, hex);
  const existing = customColorDebounce.get(roomId);
  if (existing) clearTimeout(existing);
  customColorDebounce.set(
    roomId,
    setTimeout(() => {
      customColorDebounce.delete(roomId);
      void onBulkCustomColor(roomId, hex);
    }, 250),
  );
}

/**
 * Дебаунсер яркости — слайдер шлёт events на каждый input, не хотим спамить execute().
 * Per-roomId Map: глобальный singleton приводил к тому, что drag в одной комнате
 * отменял запланированный execute другой (видно при быстром переключении).
 */
const brightnessDebounce = new Map<string, ReturnType<typeof setTimeout>>();
function onBrightnessSliderInput(roomId: string, percent: number): void {
  const prev = brightnessDebounce.get(roomId);
  if (prev) clearTimeout(prev);
  brightnessDebounce.set(
    roomId,
    setTimeout(() => {
      brightnessDebounce.delete(roomId);
      void onBulkBrightness(roomId, percent);
    }, 250),
  );
}

const COLOR_PRESETS: ReadonlyArray<ColorPreset> = [
  { name: 'Тёплый белый', hex: '#FFE4B5', rgbInt: 0xffe4b5, tempK: 2700 },
  { name: 'Дневной', hex: '#FFFFFF', rgbInt: 0xffffff, tempK: 4000 },
  { name: 'Холодный', hex: '#CFE8FF', rgbInt: 0xcfe8ff, tempK: 6500 },
  { name: 'Закат', hex: '#FF8A4D', rgbInt: 0xff8a4d },
  { name: 'Лаванда', hex: '#9B7CFF', rgbInt: 0x9b7cff },
  { name: 'Изумруд', hex: '#1FD2A6', rgbInt: 0x1fd2a6 },
  { name: 'Малина', hex: '#FF4D8C', rgbInt: 0xff4d8c },
];

function pluralizeDevice(n: number): string {
  const m10 = n % 10;
  const m100 = n % 100;
  if (m100 >= 11 && m100 <= 14) return 'устройств';
  if (m10 === 1) return 'устройство';
  if (m10 >= 2 && m10 <= 4) return 'устройства';
  return 'устройств';
}

function pluralizeLamp(n: number): string {
  const m10 = n % 10;
  const m100 = n % 100;
  if (m100 >= 11 && m100 <= 14) return 'ламп';
  if (m10 === 1) return 'лампа';
  if (m10 >= 2 && m10 <= 4) return 'лампы';
  return 'ламп';
}

function pluralizeWith(n: number, forms: [string, string, string]): string {
  const m10 = n % 10;
  const m100 = n % 100;
  if (m100 >= 11 && m100 <= 14) return forms[2];
  if (m10 === 1) return forms[0];
  if (m10 >= 2 && m10 <= 4) return forms[1];
  return forms[2];
}

function onEdit(room: Room): void {
  editingId.value = room.id;
  form.name = room.name;
  form.icon = room.icon;
  creating.value = true;
}

async function save(): Promise<void> {
  const name = form.name.trim();
  if (!name) return;
  if (editingId.value) {
    await rooms.update(editingId.value, { name, icon: form.icon });
    toaster.push({ kind: 'success', message: 'Комната обновлена' });
  } else {
    await rooms.create({ name, icon: form.icon });
    toaster.push({ kind: 'success', message: `Комната «${name}» создана` });
  }
  cancel();
}

function cancel(): void {
  creating.value = false;
  editingId.value = null;
  form.name = '';
  form.icon = iconCatalog['livingRoom']!;
}

const removeTarget = reactive<{ open: boolean; id: string; name: string }>({
  open: false,
  id: '',
  name: '',
});

function onRemove(id: string, name: string): void {
  removeTarget.id = id;
  removeTarget.name = name;
  removeTarget.open = true;
}

async function performRemove(): Promise<void> {
  const { id, name } = removeTarget;
  await rooms.remove(id);
  removeTarget.open = false;
  toaster.push({ kind: 'info', message: `Комната «${name}» удалена` });
}

onMounted(async () => {
  // Auto-import yandex-комнат, если юзер залогинен в Яндексе. Ничего не упадёт,
  // если auth отсутствует — backend кинет понятный Error, мы его проглотим.
  try {
    const auth = await window.smarthome.yandexStation.getAuthStatus();
    if (auth.authorized) void devices.syncYandexHome().catch(() => null);
  } catch {
    /* не залогинен — пропускаем */
  }
});

useViewMount({ scope: root, itemsSelector: '.room', defer: gate.whenReady() });
</script>

<style scoped lang="scss">
@use '@/styles/abstracts/mixins' as *;

.list-fade-enter-active,
.list-fade-leave-active {
  transition: opacity 220ms var(--ease-out);
}
.list-fade-enter-from,
.list-fade-leave-to {
  opacity: 0;
}

.rooms {
  display: flex;
  flex-direction: column;
  gap: var(--content-gap);
  width: 100%;
  align-self: start;

  &__grid {
    --bento-tile-min: 240px;

    @media (max-width: 720px) {
      --bento-tile-min: 100%;
    }
  }
}

// =============================================================================
// Room card v2 — hero-up, контролы внизу. Иконка как visual-anchor (большая,
// brand-tinted), counter «X из Y включено» — самый крупный элемент в карточке
// (главная инфа), bulk-actions крупные с явным success/danger differentiation.
// =============================================================================
.room {
  position: relative;
  display: flex;
  flex-direction: column;
  gap: var(--space-3);
  padding: var(--pad-comfort);
  border-radius: var(--radius-lg);
  background: rgba(255, 255, 255, 0.025);
  border: var(--border-thin) solid var(--color-border-subtle);
  transition:
    background-color var(--dur-medium) var(--ease-out),
    border-color var(--dur-medium) var(--ease-out),
    transform var(--dur-medium) var(--ease-out);
  overflow: hidden;
  isolation: isolate;

  // Aura: subtle radial glow появляется когда в комнате что-то включено,
  // тоном — brand-purple/pink. Дает визуальный feedback «свет горит».
  &::before {
    content: '';
    position: absolute;
    inset: -30% -10% auto auto;
    width: 220px;
    height: 220px;
    border-radius: 50%;
    background: radial-gradient(circle, rgba(var(--color-brand-purple-rgb), 0.18), transparent 65%);
    opacity: 0;
    pointer-events: none;
    transition: opacity 320ms var(--ease-out);
    z-index: -1;
  }

  &--active::before {
    opacity: 1;
  }
  &--active {
    border-color: color-mix(in srgb, var(--color-brand-purple) 28%, transparent);
  }

  &--yandex {
    border-color: color-mix(in srgb, var(--color-brand-purple) 32%, transparent);
    background:
      linear-gradient(
        130deg,
        color-mix(in srgb, var(--color-brand-purple) 6%, transparent),
        transparent 50%
      ),
      rgba(255, 255, 255, 0.022);
  }

  &--empty {
    opacity: 0.62;
  }

  &:hover {
    background: rgba(255, 255, 255, 0.04);
    border-color: rgba(255, 255, 255, 0.1);
  }

  // -------- Hero: icon + name + meta + actions ------------------------------
  &__hero {
    display: grid;
    grid-template-columns: var(--icon-box-xl) minmax(0, 1fr) auto;
    gap: var(--space-4);
    align-items: center;
  }

  &__icon {
    width: var(--icon-box-xl);
    height: var(--icon-box-xl);
    border-radius: 14px;
    display: grid;
    place-items: center;
    background: var(--gradient-brand-soft);
    color: #fff;
    flex-shrink: 0;
    box-shadow: 0 4px 16px rgba(var(--color-brand-purple-rgb), 0.22);

    :deep(svg) {
      width: var(--icon-glyph-lg);
      height: var(--icon-glyph-lg);
    }
  }

  &__hero-copy {
    display: flex;
    flex-direction: column;
    gap: 3px;
    min-width: 0;
  }

  &__name {
    font-family: var(--font-family-display);
    font-size: var(--font-size-h2);
    font-weight: 600;
    letter-spacing: var(--tracking-h2);
    color: var(--color-text-primary);
    margin: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  &__meta {
    font-size: var(--font-size-small);
    color: var(--color-text-secondary);
    margin: 0;
    display: flex;
    gap: var(--space-1);
    flex-wrap: wrap;

    &--muted {
      color: var(--color-text-muted);
      font-style: italic;
    }
    &--warn {
      color: var(--color-warning);
    }
  }

  &__hero-actions {
    display: flex;
    gap: var(--space-1);
    flex-shrink: 0;
    align-items: center;
  }

  &__yandex-badge {
    --icon-tone: var(--color-brand-purple);
    --icon-tone-rgb: var(--color-brand-purple-rgb);
    @include icon-box(var(--icon-box-xs), var(--icon-glyph-xs), 50%);
  }

  &__icon-btn {
    all: unset;
    width: 28px;
    height: 28px;
    border-radius: var(--radius-xs);
    display: grid;
    place-items: center;
    background: rgba(255, 255, 255, 0.04);
    color: var(--color-text-muted);
    cursor: pointer;
    opacity: 0.6;
    transition:
      opacity var(--dur-fast) var(--ease-out),
      background-color var(--dur-fast) var(--ease-out),
      color var(--dur-fast) var(--ease-out);

    &:hover {
      opacity: 1;
      background: rgba(255, 255, 255, 0.08);
      color: var(--color-text-primary);
    }

    &--danger:hover {
      background: rgba(var(--color-danger-rgb), 0.16);
      color: var(--color-danger);
    }
  }

  // Скрываем менее частые actions до hover'а, чтобы карточка не была перегружена.
  @media (hover: hover) {
    .room__icon-btn {
      opacity: 0;
    }
    &:hover .room__icon-btn {
      opacity: 0.6;
    }
  }

  // -------- Smart toggle (счётчик-кнопка) -----------------------------------
  &__toggle {
    all: unset;
    display: grid;
    grid-template-columns: 48px minmax(0, 1fr) auto;
    align-items: center;
    gap: 12px;
    padding: 9px 12px;
    border-radius: var(--radius-md);
    background: rgba(0, 0, 0, 0.2);
    border: 1px solid rgba(255, 255, 255, 0.04);
    cursor: pointer;
    transition:
      background 220ms var(--ease-out),
      border-color 220ms var(--ease-out),
      transform 220ms var(--ease-out);

    &:hover:not(:disabled) {
      transform: translate3d(0, var(--lift), 0);
      border-color: rgba(255, 255, 255, 0.1);
    }
    &:disabled,
    &[data-loading='true'] {
      cursor: progress;
    }
    &[data-loading='true'] .room__toggle-icon {
      animation: roomTogglePulse calc(0.9s / max(var(--motion-scale, 1), 0.001)) ease-in-out
        infinite;
    }

    // ON-state: brand glow + filled icon
    &.is-all-on {
      background:
        linear-gradient(
          135deg,
          color-mix(in srgb, var(--color-brand-purple) 22%, transparent),
          color-mix(in srgb, var(--color-brand-pink) 14%, transparent)
        ),
        rgba(0, 0, 0, 0.2);
      border-color: color-mix(in srgb, var(--color-brand-purple) 36%, transparent);

      .room__toggle-icon {
        background: var(--gradient-brand);
        color: #fff;
        box-shadow: 0 0 24px color-mix(in srgb, var(--color-brand-purple) 35%, transparent);
      }
      .room__toggle-num {
        background: var(--gradient-brand);
        -webkit-background-clip: text;
        background-clip: text;
        -webkit-text-fill-color: transparent;
      }
    }

    // PARTIAL: warning-tint
    &.is-partial {
      background:
        linear-gradient(
          135deg,
          color-mix(in srgb, var(--color-warning) 14%, transparent),
          transparent
        ),
        rgba(0, 0, 0, 0.2);
      border-color: color-mix(in srgb, var(--color-warning) 30%, transparent);

      .room__toggle-icon {
        background: color-mix(in srgb, var(--color-warning) 22%, transparent);
        color: var(--color-warning);
      }
      .room__toggle-num {
        color: var(--color-warning);
      }
    }

    // OFF-state: muted
    &.is-all-off {
      .room__toggle-icon {
        background: rgba(255, 255, 255, 0.05);
        color: var(--color-text-muted);
      }
    }
  }

  &__toggle-icon {
    width: 48px;
    height: 48px;
    border-radius: 14px;
    display: grid;
    place-items: center;
    transition:
      background 220ms var(--ease-out),
      color 220ms var(--ease-out),
      box-shadow 240ms var(--ease-out);

    svg {
      width: 26px;
      height: 26px;
    }
  }

  &__toggle-meta {
    display: flex;
    flex-direction: column;
    gap: 1px;
    min-width: 0;
  }

  &__toggle-num {
    font-family: var(--font-family-display);
    font-size: 22px;
    font-weight: 700;
    line-height: 1;
    letter-spacing: -0.02em;
    color: var(--color-text-muted);
    font-variant-numeric: tabular-nums;
    transition: color 220ms var(--ease-out);
  }

  &__toggle-sep {
    margin: 0 2px;
    opacity: 0.45;
    font-weight: 500;
  }

  &__toggle-caption {
    font-size: 11.5px;
    color: var(--color-text-muted);
    line-height: 1.3;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  &__toggle-hint {
    width: 26px;
    height: 26px;
    border-radius: 50%;
    display: grid;
    place-items: center;
    background: rgba(255, 255, 255, 0.06);
    color: var(--color-text-secondary);
    flex-shrink: 0;
  }
  &__toggle.is-all-on &__toggle-hint {
    background: rgba(255, 255, 255, 0.18);
    color: #fff;
  }

  // -------- Device chips (clickable preview) --------------------------------
  &__chips {
    display: flex;
    flex-wrap: wrap;
    gap: 5px;
  }

  &__chip {
    display: inline-flex;
    align-items: center;
    height: 24px;
    padding: 0 10px;
    border-radius: var(--radius-pill);
    background: rgba(255, 255, 255, 0.05);
    color: var(--color-text-secondary);
    font-size: 11.5px;
    font-weight: 500;
    text-decoration: none;
    transition:
      background-color 160ms var(--ease-out),
      color 160ms var(--ease-out);
    max-width: 140px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;

    &:hover {
      background: rgba(255, 255, 255, 0.1);
      color: var(--color-text-primary);
    }

    &.is-on {
      background: color-mix(in srgb, var(--color-brand-amber) 18%, transparent);
      color: var(--color-brand-amber);

      &::before {
        content: '';
        width: 5px;
        height: 5px;
        border-radius: 50%;
        background: currentColor;
        margin-right: 6px;
        box-shadow: 0 0 6px currentColor;
      }
    }
  }

  &__chip-more {
    display: inline-flex;
    align-items: center;
    height: 24px;
    padding: 0 10px;
    border-radius: var(--radius-pill);
    background: rgba(255, 255, 255, 0.025);
    color: var(--color-text-muted);
    font-family: var(--font-family-mono);
    font-size: 11px;
  }

  // -------- Brightness slider -----------------------------------------------
  &__bulk-bright,
  &__bulk-palette {
    display: flex;
    flex-direction: column;
    gap: 6px;
  }

  &__bulk-label {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    font-size: 10.5px;
    font-weight: 600;
    letter-spacing: 0.06em;
    text-transform: uppercase;
    color: var(--color-text-muted);
  }

  &__bulk-slider {
    appearance: none;
    width: 100%;
    height: 6px;
    border-radius: 3px;
    background: linear-gradient(
      to right,
      rgba(255, 255, 255, 0.05),
      var(--color-brand-amber) 50%,
      #fff
    );
    outline: none;
    cursor: pointer;

    &::-webkit-slider-thumb {
      appearance: none;
      width: 18px;
      height: 18px;
      border-radius: 50%;
      background: #fff;
      border: 2px solid var(--color-brand-amber);
      box-shadow: 0 2px 8px rgba(255, 196, 0, 0.4);
      cursor: pointer;
      transition: transform 160ms var(--ease-out);
    }
    &::-webkit-slider-thumb:hover {
      transform: scale(1.15);
    }
  }

  // -------- Color palette ---------------------------------------------------
  &__bulk-palette-grid {
    display: flex;
    gap: 6px;
    flex-wrap: wrap;
  }

  &__bulk-swatch {
    all: unset;
    width: 28px;
    height: 28px;
    border-radius: 50%;
    cursor: pointer;
    background: var(--swatch);
    border: 2px solid rgba(255, 255, 255, 0.15);
    box-shadow:
      0 0 0 1px rgba(0, 0, 0, 0.35),
      0 0 8px color-mix(in srgb, var(--swatch) 50%, transparent);
    transition:
      transform 160ms var(--ease-out),
      box-shadow 200ms var(--ease-out);

    &:hover {
      transform: scale(1.15);
      box-shadow:
        0 0 0 1px rgba(0, 0, 0, 0.35),
        0 0 16px var(--swatch);
    }
    &:focus-visible {
      outline: 2px solid color-mix(in srgb, var(--color-brand-purple) 60%, transparent);
      outline-offset: 2px;
    }

    // Кастом-пипетка: hue-конический градиент как hint, что цвет тут произвольный.
    // Native `<input type="color">` спрятан под label-ом, кликом по swatch'у вызывает
    // системный picker.
    &--custom {
      background: conic-gradient(
        from 0deg,
        #ff4d4d,
        #ffcc4d,
        #4dff80,
        #4dccff,
        #9b5dff,
        #ff4dcc,
        #ff4d4d
      );
      display: grid;
      place-items: center;
      color: rgba(0, 0, 0, 0.55);
      position: relative;

      :deep(svg) {
        width: 12px;
        height: 12px;
        filter: drop-shadow(0 0 1px rgba(255, 255, 255, 0.7));
      }
    }
  }

  &__bulk-swatch-input {
    // Visual: пипетку не видно (используем родительский swatch как trigger),
    // но `pointer-events` остаются, чтобы клик попал в native picker.
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
    opacity: 0;
    cursor: pointer;
    border: 0;
    padding: 0;
  }

  // -------- Yandex hint -----------------------------------------------------
  &__hint {
    margin: 0;
    padding: 8px 12px;
    border-radius: var(--radius-sm);
    background: color-mix(in srgb, var(--color-brand-purple) 8%, transparent);
    border-left: 2px solid var(--color-brand-purple);
    font-size: 11.5px;
    color: var(--color-text-muted);
    font-style: italic;
    line-height: 1.45;
  }
}

@keyframes roomTogglePulse {
  0%,
  100% {
    transform: scale(1);
    opacity: 1;
  }
  50% {
    transform: scale(1.06);
    opacity: 0.85;
  }
}

@media (prefers-reduced-motion: reduce) {
  .room,
  .room__icon-btn,
  .room__toggle,
  .room__chip,
  .room__bulk-swatch {
    transition: none;
  }
  .room__toggle[data-loading='true'] .room__toggle-icon {
    animation: none;
  }
}

.rooms__form {
  display: flex;
  flex-direction: column;
  gap: 14px;
}
/** Icon picker grid. Spec общий с SceneEditor. */
.rooms__icons-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(44px, 52px));
  justify-content: start;
  gap: 8px;
  margin-top: 6px;
}
/** Icon picker cell. Highlights — inset-only. */
.rooms__icon-btn {
  width: 100%;
  aspect-ratio: 1;
  border: 0;
  background: rgba(255, 255, 255, 0.035);
  color: var(--color-text-secondary);
  display: grid;
  place-items: center;
  cursor: pointer;
  position: relative;
  border-radius: 12px;
  padding: 0;
  transition:
    color 180ms var(--ease-out),
    background 180ms var(--ease-out),
    box-shadow 200ms var(--ease-out);
  box-shadow: inset 0 0 0 1px var(--color-border-subtle);

  :deep(svg) {
    width: 22px;
    height: 22px;
  }

  &:hover {
    color: var(--color-text-primary);
    background: rgba(255, 255, 255, 0.07);
    box-shadow: inset 0 0 0 1px var(--color-border-soft);
  }

  &.is-selected {
    color: var(--color-brand-purple);
    background: rgba(var(--color-brand-purple-rgb), 0.18);
    box-shadow:
      inset 0 0 0 1.5px rgba(var(--color-brand-purple-rgb), 0.7),
      inset 0 0 12px rgba(var(--color-brand-purple-rgb), 0.35);
  }

  &:focus-visible {
    outline: none;
    box-shadow: inset 0 0 0 2px rgba(var(--color-brand-purple-rgb), 0.7);
  }
}
</style>
