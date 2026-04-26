<template>
  <article class="panel" data-tour="alice-station-panel">
    <!-- ========================== Header ============================== -->
    <!-- Alice-state chip убран отсюда — он уже виден в speaker-hero выше
         (SpeakerControlSurface.vue), иначе одна и та же надпись «Готова слушать»
         появлялась дважды на одном экране. -->
    <header class="panel__head">
      <h3 class="panel__title">Управление колонкой</h3>
      <span class="panel__vol-pct" v-if="volumeKnown">{{ volumePercent }}%</span>
    </header>

    <!-- ========================== Now playing ========================= -->
    <section class="panel__now" :class="{ 'panel__now--idle': !trackTitle }">
      <div class="panel__now-icon" aria-hidden="true">
        <BaseIcon name="music" :size="18" />
      </div>
      <div class="panel__now-copy">
        <strong class="panel__now-title">{{ trackTitle || 'Сейчас ничего не играет' }}</strong>
        <span v-if="aliceText" class="panel__now-sub panel__now-sub--alice">
          Алиса: «{{ truncate(aliceText, 100) }}»
        </span>
        <span v-else-if="userText" class="panel__now-sub">
          Услышала: «{{ truncate(userText, 100) }}»
        </span>
        <span v-else-if="!trackTitle" class="panel__now-sub panel__now-sub--muted">
          Скажите «Алиса…» голосом или используйте быстрые команды ниже.
        </span>
      </div>
    </section>

    <!-- ========================== Volume ============================== -->
    <section class="panel__vol">
      <button
        class="panel__vol-mute"
        :class="[
          `panel__vol-mute--${volumeLevel}`,
          { 'panel__vol-mute--speaking': isSpeaking, 'panel__vol-mute--bump': bump },
        ]"
        type="button"
        :disabled="busy"
        :aria-label="isMuted ? 'Восстановить громкость' : 'Без звука'"
        :title="isMuted ? `Включить (${preMuteVolume ?? 50}%)` : 'Без звука'"
        @click="onToggleMute"
      >
        <svg class="vol-ico" viewBox="0 0 28 24" aria-hidden="true">
          <defs>
            <linearGradient id="vol-grad" x1="0" y1="0" x2="1" y2="1">
              <stop offset="0%" stop-color="var(--color-brand-purple)" />
              <stop offset="100%" stop-color="var(--color-brand-pink)" />
            </linearGradient>
          </defs>
          <!-- Корпус динамика -->
          <path
            class="vol-ico__body"
            d="M5 9v6h4l5 4V5L9 9H5z"
            fill="currentColor"
          />
          <!-- Три волны: появляются последовательно по уровню громкости -->
          <path
            class="vol-ico__wave vol-ico__wave--1"
            d="M16 9.5a3.5 3.5 0 0 1 0 5"
            fill="none"
            stroke="currentColor"
            stroke-width="1.8"
            stroke-linecap="round"
          />
          <path
            class="vol-ico__wave vol-ico__wave--2"
            d="M18.5 7a7 7 0 0 1 0 10"
            fill="none"
            stroke="currentColor"
            stroke-width="1.8"
            stroke-linecap="round"
          />
          <path
            class="vol-ico__wave vol-ico__wave--3"
            d="M21 4.5a10.5 10.5 0 0 1 0 15"
            fill="none"
            stroke="currentColor"
            stroke-width="1.8"
            stroke-linecap="round"
          />
          <!-- Перечёркивание для мута -->
          <path
            class="vol-ico__mute"
            d="M16 9l8 6M24 9l-8 6"
            stroke="currentColor"
            stroke-width="1.9"
            stroke-linecap="round"
            fill="none"
          />
        </svg>
      </button>
      <input
        class="panel__vol-slider"
        type="range"
        min="0"
        max="100"
        step="1"
        :value="sliderValue"
        :disabled="!canControl"
        :style="{ '--fill': `${sliderValue}%` }"
        aria-label="Громкость"
        @input="onSliderInput"
        @change="onSliderCommit"
      />
    </section>

    <!-- ========================== Transport =========================== -->
    <!-- Transport: prev / play-pause toggle / next. Раньше было 4 кнопки (Play+Pause
         отдельно), но это сбивало — пользователь не понимал, какая «активна». Теперь
         один центральный toggle, иконка которого зеркалит фактический playerState. -->
    <section class="panel__transport">
      <button
        type="button"
        class="panel__t-btn panel__t-btn--prev"
        :disabled="busy || !canControl"
        aria-label="Предыдущий трек"
        title="Предыдущий трек"
        @click="onTransport('prev')"
      >
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path d="M6 6h2v12H6zm3.5 6 8.5-6v12z" fill="currentColor" />
        </svg>
      </button>

      <button
        type="button"
        class="panel__t-btn panel__t-btn--play"
        :class="{ 'panel__t-btn--is-playing': isPlaying }"
        :disabled="busy || !canControl"
        :aria-label="isPlaying ? 'Пауза' : 'Играть'"
        :title="isPlaying ? 'Пауза' : 'Играть'"
        @click="onPlayPause"
      >
        <svg v-if="isPlaying" viewBox="0 0 24 24" aria-hidden="true" key="pause">
          <path d="M6 5h4v14H6zm8 0h4v14h-4z" fill="currentColor" />
        </svg>
        <svg v-else viewBox="0 0 24 24" aria-hidden="true" key="play">
          <path d="M8 5v14l11-7z" fill="currentColor" />
        </svg>
      </button>

      <button
        type="button"
        class="panel__t-btn panel__t-btn--next"
        :disabled="busy || !canControl"
        aria-label="Следующий трек"
        title="Следующий трек"
        @click="onTransport('next')"
      >
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path d="M16 6h2v12h-2zM6 6l8.5 6L6 18z" fill="currentColor" />
        </svg>
      </button>
    </section>

    <!-- Quick TTS-чипы убраны отсюда — те же команды (Привет / Что играет /
         Время / Погода) есть в категории «Инфо» SpeakerControlSurface, два набора
         одного и того же только сбивали с толку. -->

    <!-- ========================== Brief log =========================== -->
    <section class="panel__log">
      <header class="panel__log-head">
        <h4 class="panel__log-title">Последние команды</h4>
        <button
          v-if="commandLog.length"
          type="button"
          class="panel__log-clear"
          @click="onClear"
        >
          Очистить
        </button>
      </header>
      <ol v-if="commandLog.length" class="panel__log-list">
        <li
          v-for="entry in commandLog"
          :key="entry.id"
          class="panel__log-row"
          :data-status="entry.statusKind"
        >
          <BaseIcon
            class="panel__log-arrow"
            :name="entry.outgoing ? 'arrow-right' : 'arrow-left'"
            :size="11"
          />
          <time class="panel__log-time">{{ formatTime(entry.at) }}</time>
          <span class="panel__log-text">{{ entry.summary }}</span>
          <span v-if="entry.statusBadge" class="panel__log-badge" :data-kind="entry.statusKind">
            {{ entry.statusBadge }}
          </span>
        </li>
      </ol>
      <p v-else class="panel__log-empty">
        Команд ещё не было. Двигайте слайдер громкости или нажмите быструю команду.
      </p>

      <details class="panel__raw">
        <summary>Подробный журнал (raw glagol-events)</summary>
        <AliceStationMonitor />
      </details>
    </section>
  </article>
</template>

<script setup lang="ts">
// Панель управления колонкой: now-playing, громкость, transport, лог команд.
// Alice-state и Quick-TTS chips перенесены в speaker-hero / category-карточки —
// см. SpeakerControlSurface.vue.

import { computed, onBeforeUnmount, ref, watch } from 'vue';
import type { YandexStationCommand, YandexStationEvent } from '@smarthome/shared';
import { BaseIcon } from '@/components/base';
import { useYandexStationStore } from '@/stores/yandexStation';
import AliceStationMonitor from './AliceStationMonitor.vue';

const station = useYandexStationStore();

const events = computed<YandexStationEvent[]>(() => station.events);
const isConnected = computed(() => station.status?.connection === 'connected');
const canControl = computed(() => isConnected.value);

const latest = computed(() => {
  const out: {
    aliceState?: string;
    aliceText?: string;
    userText?: string;
    trackTitle?: string;
    volume?: number;
  } = {};
  for (const e of [...events.value].reverse()) {
    if (!out.aliceState && e.aliceState) out.aliceState = e.aliceState;
    if (!out.aliceText && e.aliceText) out.aliceText = e.aliceText;
    if (!out.userText && e.userText) out.userText = e.userText;
    if (!out.trackTitle && e.trackTitle) out.trackTitle = e.trackTitle;
    if (out.volume === undefined && typeof e.volume === 'number') out.volume = e.volume;
    if (out.aliceState && out.aliceText && out.userText && out.trackTitle && out.volume !== undefined) break;
  }
  return out;
});

const aliceState = computed(() => latest.value.aliceState ?? 'IDLE');

const aliceText = computed(() => latest.value.aliceText);
const userText = computed(() => latest.value.userText);
const trackTitle = computed(() => latest.value.trackTitle);

const volumeKnown = computed(() => typeof latest.value.volume === 'number');
const volumePercent = computed(() =>
  typeof latest.value.volume === 'number' ? Math.round(latest.value.volume * 100) : 0,
);

/**
 * Локальное значение слайдера. Держится пока колонка не подтвердит её state-push'ом
 * с тем же значением (в пределах VOLUME_MATCH_TOLERANCE). Без этого слайдер дёргался
 * между интентом пользователя и устаревшим echo-state'ом колонки.
 */
const localValue = ref<number | null>(null);
const sliderValue = computed(() => localValue.value ?? volumePercent.value);
const isMuted = computed(() => sliderValue.value === 0);
/** Громкость до mute — для восстановления при unmute. */
const preMuteVolume = ref<number | null>(null);

/** Уровень для иконки: mute / low / med / high. */
const volumeLevel = computed<'mute' | 'low' | 'med' | 'high'>(() => {
  const v = sliderValue.value;
  if (v === 0) return 'mute';
  if (v <= 33) return 'low';
  if (v <= 66) return 'med';
  return 'high';
});
const isSpeaking = computed(() => aliceState.value === 'SPEAKING');

/** Кратковременная анимация bump при изменении громкости. */
const bump = ref(false);
let bumpTimer: ReturnType<typeof setTimeout> | null = null;
function triggerBump(): void {
  bump.value = true;
  if (bumpTimer) clearTimeout(bumpTimer);
  bumpTimer = setTimeout(() => {
    bump.value = false;
  }, 320);
}

const busy = ref(false);

async function send(cmd: YandexStationCommand): Promise<void> {
  if (busy.value) return;
  busy.value = true;
  try {
    await station.sendCommand(cmd);
  } finally {
    busy.value = false;
  }
}

const VOLUME_MATCH_TOLERANCE = 2;
const SEND_DEBOUNCE_MS = 120;
const SEND_FALLBACK_MS = 4000;

let sendTimer: ReturnType<typeof setTimeout> | null = null;
let fallbackTimer: ReturnType<typeof setTimeout> | null = null;

/** Отправка `setVolume` с debounce — клавиатурные стрелки не спамят IPC. */
function scheduleVolumeSend(percent: number): void {
  if (sendTimer) clearTimeout(sendTimer);
  if (fallbackTimer) clearTimeout(fallbackTimer);
  sendTimer = setTimeout(() => {
    sendTimer = null;
    void send({ kind: 'setVolume', volume: percent / 100 });
  }, SEND_DEBOUNCE_MS);
  // Safety: если колонка не подтвердит state-push'ом — отпускаем lock.
  fallbackTimer = setTimeout(() => {
    fallbackTimer = null;
    localValue.value = null;
  }, SEND_FALLBACK_MS);
}

/** Echo от колонки совпал с интентом → отпускаем lock, слайдер «приземляется» на правду. */
watch(volumePercent, (next) => {
  if (localValue.value === null) return;
  if (Math.abs(localValue.value - next) <= VOLUME_MATCH_TOLERANCE) {
    if (fallbackTimer) {
      clearTimeout(fallbackTimer);
      fallbackTimer = null;
    }
    localValue.value = null;
  }
});

function onSliderInput(e: Event): void {
  const v = Number((e.target as HTMLInputElement).value);
  localValue.value = v;
  scheduleVolumeSend(v);
}

function onSliderCommit(e: Event): void {
  const v = Number((e.target as HTMLInputElement).value);
  localValue.value = v;
  triggerBump();
  // На release сразу шлём — debounce съест дубль если уже было запланировано.
  if (sendTimer) clearTimeout(sendTimer);
  sendTimer = null;
  void send({ kind: 'setVolume', volume: v / 100 });
  if (fallbackTimer) clearTimeout(fallbackTimer);
  fallbackTimer = setTimeout(() => {
    fallbackTimer = null;
    localValue.value = null;
  }, SEND_FALLBACK_MS);
}

async function onToggleMute(): Promise<void> {
  triggerBump();
  let target: number;
  if (isMuted.value && preMuteVolume.value !== null) {
    target = preMuteVolume.value;
    preMuteVolume.value = null;
  } else {
    preMuteVolume.value = sliderValue.value;
    target = 0;
  }
  localValue.value = target;
  if (sendTimer) clearTimeout(sendTimer);
  sendTimer = null;
  await send({ kind: 'setVolume', volume: target / 100 });
  if (fallbackTimer) clearTimeout(fallbackTimer);
  fallbackTimer = setTimeout(() => {
    fallbackTimer = null;
    localValue.value = null;
  }, SEND_FALLBACK_MS);
}

onBeforeUnmount(() => {
  if (sendTimer) clearTimeout(sendTimer);
  if (fallbackTimer) clearTimeout(fallbackTimer);
  if (bumpTimer) clearTimeout(bumpTimer);
});

interface TransportButton {
  kind: 'prev' | 'play' | 'stop' | 'next';
  label: string;
}

const transportButtons: TransportButton[] = [
  {
    kind: 'prev',
    label: 'Предыдущий трек',
  },
  {
    kind: 'next',
    label: 'Следующий трек',
  },
];

async function onTransport(kind: TransportButton['kind']): Promise<void> {
  await send({ kind });
}

/**
 * Эвристика «играет ли сейчас»: SPEAKING (Алиса говорит) или есть текущий трек,
 * пока state не пришёл с явным флагом — оптимистично показываем pause-иконку.
 * После каждого toggle переписывается локально (см. `localPlayingOverride`),
 * чтобы UI реагировал мгновенно, а не ждал push'а от станции.
 */
const localPlayingOverride = ref<boolean | null>(null);
const isPlaying = computed<boolean>(() => {
  if (localPlayingOverride.value !== null) return localPlayingOverride.value;
  if (aliceState.value === 'SPEAKING' || aliceState.value === 'LISTENING') return true;
  return Boolean(trackTitle.value);
});

async function onPlayPause(): Promise<void> {
  const next = !isPlaying.value;
  // Optimistic: переключаем UI сразу, отменяем override через 4s — за это время
  // станция успевает прислать актуальный state и computed возьмёт его.
  localPlayingOverride.value = next;
  await send({ kind: next ? 'play' : 'stop' });
  setTimeout(() => {
    localPlayingOverride.value = null;
  }, 4000);
}

interface CommandLogEntry {
  id: string;
  at: string;
  summary: string;
  outgoing: boolean;
  statusBadge: string | null;
  statusKind: 'ok' | 'err' | 'warn' | 'info' | null;
}

/** Outgoing-команды + lifecycle. State-push'и идут в подробный журнал. */
const commandLog = computed<CommandLogEntry[]>(() => {
  const out: CommandLogEntry[] = [];
  const responsesByReq = new Map<string, YandexStationEvent>();
  for (const e of events.value) {
    if (e.kind === 'response' && e.requestId) responsesByReq.set(e.requestId, e);
  }

  for (const e of events.value) {
    if (e.kind === 'state') continue;
    if (e.kind === 'response') continue;
    let statusBadge: string | null = null;
    let statusKind: CommandLogEntry['statusKind'] = null;

    if (e.kind === 'outgoing' && e.requestId) {
      const r = responsesByReq.get(e.requestId);
      if (r?.status) {
        statusBadge = r.status;
        statusKind = badgeKindFor(r.status);
      }
    }

    if (e.kind === 'closed' || e.kind === 'error') {
      statusBadge = e.closeCode ? String(e.closeCode) : 'error';
      statusKind = 'err';
    } else if (e.kind === 'connected') {
      statusBadge = 'ok';
      statusKind = 'ok';
    } else if (e.kind === 'connecting' || e.kind === 'note') {
      statusKind = 'info';
    }

    out.push({
      id: e.id,
      at: e.at,
      summary: e.summary,
      outgoing: e.kind === 'outgoing',
      statusBadge,
      statusKind,
    });
  }
  return out.reverse().slice(0, 10);
});

function badgeKindFor(status: string): CommandLogEntry['statusKind'] {
  if (status === 'SUCCESS') return 'ok';
  if (status === 'REFUSED' || status === 'ERROR' || status === 'UNSUPPORTED') return 'err';
  if (status === 'TIMEOUT') return 'warn';
  return 'info';
}

async function onClear(): Promise<void> {
  await station.clearEvents();
}

function formatTime(iso: string): string {
  const d = new Date(iso);
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  const ss = String(d.getSeconds()).padStart(2, '0');
  return `${hh}:${mm}:${ss}`;
}

function truncate(s: string, n: number): string {
  return s.length > n ? s.slice(0, n - 1) + '…' : s;
}
</script>

<style scoped lang="scss">
@use '@/styles/abstracts/mixins' as *;

.panel {
  container-type: inline-size;
  position: relative;
  border-radius: var(--radius-lg);
  background:
    linear-gradient(
      130deg,
      color-mix(in srgb, var(--color-brand-purple) 8%, transparent),
      color-mix(in srgb, var(--color-brand-pink) 6%, transparent)
    ),
    rgba(255, 255, 255, 0.022);
  border: 1px solid rgba(255, 255, 255, 0.06);
  padding: clamp(20px, 2vw, 28px) clamp(20px, 2vw, 32px);
  display: flex;
  flex-direction: column;
  gap: clamp(16px, 1.6vw, 22px);
  overflow: hidden;

  // ---- Header --------------------------------------------------------
  // Один title слева, % громкости справа. Раньше был ещё `__chip` с aliceState —
  // вынесен в speaker-hero, остатки `&__chip` стилей удалены вместе с шаблоном.
  &__head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 16px;
  }

  &__title {
    font-family: var(--font-family-display);
    font-size: clamp(18px, 0.6vw + 14px, 22px);
    font-weight: 600;
    letter-spacing: var(--tracking-h1);
    color: var(--color-text-primary);
    margin: 0;
    min-width: 0;
  }

  &__vol-pct {
    font-family: var(--font-family-mono);
    font-size: 13px;
    color: var(--color-text-secondary);
    font-variant-numeric: tabular-nums;
  }

  // ---- Now playing ---------------------------------------------------
  &__now {
    display: grid;
    grid-template-columns: 44px minmax(0, 1fr);
    gap: 14px;
    align-items: center;
    padding: 14px 16px;
    border-radius: var(--radius-md);
    background: rgba(0, 0, 0, 0.18);
    border: 1px solid rgba(255, 255, 255, 0.04);
    min-height: 70px;

    &--idle .panel__now-icon {
      opacity: 0.4;
    }
  }

  &__now-icon {
    width: 44px;
    height: 44px;
    border-radius: 12px;
    display: grid;
    place-items: center;
    background: rgba(var(--color-brand-purple-rgb), 0.18);
    color: var(--color-brand-purple);
  }

  &__now-copy {
    display: flex;
    flex-direction: column;
    gap: 3px;
    min-width: 0;
  }

  &__now-title {
    font-size: 14.5px;
    font-weight: 600;
    color: var(--color-text-primary);
    letter-spacing: -0.005em;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  &__now-sub {
    font-size: 12.5px;
    color: var(--color-text-secondary);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;

    &--alice {
      color: var(--color-brand-pink);
    }
    &--muted {
      color: var(--color-text-muted);
    }
  }

  // ---- Volume slider -------------------------------------------------
  &__vol {
    display: grid;
    grid-template-columns: auto minmax(0, 1fr);
    gap: 12px;
    align-items: center;
  }

  &__vol-mute {
    all: unset;
    position: relative;
    width: 38px;
    height: 38px;
    border-radius: 12px;
    display: grid;
    place-items: center;
    background: rgba(255, 255, 255, 0.045);
    color: var(--color-text-secondary);
    cursor: pointer;
    transition:
      background-color 200ms var(--ease-out),
      color 200ms var(--ease-out),
      transform 220ms cubic-bezier(0.34, 1.56, 0.64, 1);

    &::after {
      content: '';
      position: absolute;
      inset: -2px;
      border-radius: inherit;
      background: radial-gradient(
        circle,
        color-mix(in srgb, var(--color-brand-purple) 32%, transparent),
        transparent 70%
      );
      opacity: 0;
      transition: opacity 240ms var(--ease-out);
      pointer-events: none;
      z-index: -1;
    }

    .vol-ico {
      width: 22px;
      height: 22px;
      overflow: visible;

      &__body {
        transition:
          fill 220ms var(--ease-out),
          transform 220ms var(--ease-out);
        transform-origin: 9px 12px;
      }

      &__wave {
        opacity: 0;
        transform-origin: 11px 12px;
        transform: scale(0.6);
        transition:
          opacity 280ms var(--ease-out),
          transform 320ms cubic-bezier(0.34, 1.56, 0.64, 1),
          stroke 220ms var(--ease-out);
      }

      &__mute {
        opacity: 0;
        stroke-dasharray: 22;
        stroke-dashoffset: 22;
        transition:
          opacity 200ms var(--ease-out),
          stroke-dashoffset 280ms var(--ease-out);
      }
    }

    // ---- Состояния по уровню ---------------------------------------------
    &--low .vol-ico__wave--1,
    &--med .vol-ico__wave--1,
    &--med .vol-ico__wave--2,
    &--high .vol-ico__wave--1,
    &--high .vol-ico__wave--2,
    &--high .vol-ico__wave--3 {
      opacity: 1;
      transform: scale(1);
      stroke: url(#vol-grad);
    }

    &--low,
    &--med,
    &--high {
      color: var(--color-text-primary);
      .vol-ico__body {
        fill: url(#vol-grad);
      }
    }

    &--mute {
      color: color-mix(in srgb, var(--color-text-muted) 88%, transparent);
      .vol-ico__mute {
        opacity: 1;
        stroke-dashoffset: 0;
      }
      .vol-ico__body {
        fill: currentColor;
        transform: scale(0.92);
      }
    }

    // ---- Hover / focus ---------------------------------------------------
    &:hover:not(:disabled) {
      background: rgba(255, 255, 255, 0.08);
      transform: translateY(-1px);

      &::after {
        opacity: 1;
      }
      .vol-ico__wave {
        animation: volWaveBreath 1.6s ease-in-out infinite;
      }
      .vol-ico__wave--2 {
        animation-delay: 80ms;
      }
      .vol-ico__wave--3 {
        animation-delay: 160ms;
      }
    }

    &:disabled {
      opacity: 0.4;
      cursor: not-allowed;
    }

    &:focus-visible {
      outline: 2px solid color-mix(in srgb, var(--color-brand-purple) 60%, transparent);
      outline-offset: 2px;
    }

    // ---- Bump (на изменение громкости) -----------------------------------
    &--bump .vol-ico {
      animation: volBump 320ms cubic-bezier(0.34, 1.56, 0.64, 1);
    }

    // ---- Speaking (Алиса говорит) — постоянная пульсация волн ----------
    &--speaking:not(.panel__vol-mute--mute) {
      .vol-ico__wave {
        animation: volSpeak 1.2s ease-in-out infinite;
      }
      .vol-ico__wave--2 {
        animation-delay: 120ms;
      }
      .vol-ico__wave--3 {
        animation-delay: 240ms;
      }
      &::after {
        opacity: 0.8;
        animation: volPulseGlow 1.6s ease-out infinite;
      }
    }
  }

  &__vol-slider {
    appearance: none;
    width: 100%;
    height: 6px;
    border-radius: 3px;
    background:
      linear-gradient(
        to right,
        var(--color-brand-purple) 0%,
        var(--color-brand-pink) var(--fill, 0%),
        rgba(255, 255, 255, 0.08) var(--fill, 0%)
      );
    outline: none;
    cursor: pointer;

    &:disabled {
      opacity: 0.4;
      cursor: not-allowed;
    }

    &::-webkit-slider-thumb {
      appearance: none;
      width: 18px;
      height: 18px;
      border-radius: 50%;
      background: #fff;
      border: 2px solid var(--color-brand-purple);
      box-shadow: 0 2px 8px rgba(0, 0, 0, 0.4);
      cursor: pointer;
      transition: transform 160ms var(--ease-out);
    }
    &::-webkit-slider-thumb:hover {
      transform: scale(1.15);
    }
    &:focus-visible::-webkit-slider-thumb {
      box-shadow:
        0 2px 8px rgba(0, 0, 0, 0.4),
        0 0 0 4px rgba(var(--color-brand-purple-rgb), 0.32);
    }
  }

  // ---- Transport -----------------------------------------------------
  &__transport {
    display: flex;
    gap: 10px;
    justify-content: center;
  }

  &__t-btn {
    all: unset;
    width: 48px;
    height: 48px;
    border-radius: 50%;
    display: grid;
    place-items: center;
    background: rgba(255, 255, 255, 0.05);
    color: var(--color-text-primary);
    cursor: pointer;
    transition:
      background-color 200ms var(--ease-out),
      transform 200ms var(--ease-out);

    svg {
      width: 22px;
      height: 22px;
    }

    &:hover:not(:disabled) {
      background: rgba(255, 255, 255, 0.1);
      transform: translateY(-1px);
    }
    &:active:not(:disabled) {
      transform: translateY(0);
    }
    &:disabled {
      opacity: 0.35;
      cursor: not-allowed;
    }

    &--play {
      width: 56px;
      height: 56px;
      background: linear-gradient(135deg, var(--color-brand-purple), var(--color-brand-pink));
      color: #fff;
      box-shadow: 0 6px 20px rgba(var(--color-brand-purple-rgb), 0.3);

      &:hover:not(:disabled) {
        background: linear-gradient(135deg, var(--color-brand-purple), var(--color-brand-pink));
        filter: brightness(1.08);
      }

      svg {
        width: 26px;
        height: 26px;
      }
    }

    // Активное «играет» состояние — пульсирующий glow + чуть больший shadow,
    // чтобы пользователь сразу понимал «эта кнопка сейчас ставит на паузу».
    &--is-playing {
      box-shadow:
        0 6px 24px rgba(var(--color-brand-pink-rgb), 0.45),
        0 0 0 2px rgba(255, 255, 255, 0.1) inset;
      animation: tBtnPlayingPulse 2.4s ease-out infinite;
    }
  }

  // ---- Log -----------------------------------------------------------
  &__log {
    display: flex;
    flex-direction: column;
    gap: 10px;
    padding-top: 14px;
    border-top: 1px solid rgba(255, 255, 255, 0.05);
  }

  &__log-head {
    display: flex;
    justify-content: space-between;
    align-items: baseline;
    gap: 8px;
  }

  &__log-title {
    font-size: 12px;
    font-weight: 600;
    color: var(--color-text-secondary);
    letter-spacing: 0.04em;
    text-transform: uppercase;
    margin: 0;
  }

  &__log-clear {
    all: unset;
    cursor: pointer;
    font-size: 11.5px;
    color: var(--color-text-muted);
    border-bottom: 1px dashed currentColor;

    &:hover {
      color: var(--color-text-primary);
    }
  }

  &__log-list {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
  }

  &__log-row {
    display: grid;
    grid-template-columns: 14px 60px minmax(0, 1fr) auto;
    gap: 10px;
    align-items: center;
    padding: 6px 4px;
    border-top: 1px dashed rgba(255, 255, 255, 0.04);
    font-size: 12.5px;
    color: var(--color-text-primary);

    &:first-child {
      border-top: 0;
    }
  }

  &__log-arrow {
    color: var(--color-text-muted);
  }

  &__log-time {
    font-family: var(--font-family-mono);
    font-size: 11px;
    color: var(--color-text-muted);
    font-variant-numeric: tabular-nums;
  }

  &__log-text {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  &__log-badge {
    font-family: var(--font-family-mono);
    font-size: 10px;
    padding: 2px 6px;
    border-radius: 4px;
    background: rgba(255, 255, 255, 0.05);
    color: var(--color-text-muted);
    text-transform: uppercase;
    letter-spacing: 0.04em;

    &[data-kind='ok'] {
      color: var(--color-success);
      background: rgba(var(--color-success-rgb), 0.14);
    }
    &[data-kind='err'] {
      color: var(--color-danger);
      background: rgba(var(--color-danger-rgb), 0.14);
    }
    &[data-kind='warn'] {
      color: var(--color-warning);
      background: rgba(var(--color-warning-rgb), 0.14);
    }
  }

  &__log-empty {
    margin: 0;
    padding: 10px 0;
    font-size: 12.5px;
    color: var(--color-text-muted);
    text-align: center;
  }

  &__raw {
    margin-top: 6px;

    > summary {
      list-style: none;
      cursor: pointer;
      padding: 8px 0;
      font-size: 11.5px;
      color: var(--color-text-muted);
      letter-spacing: 0.02em;
      user-select: none;

      &::-webkit-details-marker {
        display: none;
      }
      &::before {
        content: '▸';
        margin-right: 6px;
        display: inline-block;
        transition: transform 180ms var(--ease-out);
      }
      &:hover {
        color: var(--color-text-primary);
      }
    }

    &[open] > summary::before {
      transform: rotate(90deg);
    }
  }
}

@keyframes tBtnPlayingPulse {
  0% {
    box-shadow:
      0 6px 24px rgba(var(--color-brand-pink-rgb), 0.45),
      0 0 0 2px rgba(255, 255, 255, 0.1) inset;
  }
  50% {
    box-shadow:
      0 6px 32px rgba(var(--color-brand-pink-rgb), 0.65),
      0 0 0 2px rgba(255, 255, 255, 0.18) inset;
  }
  100% {
    box-shadow:
      0 6px 24px rgba(var(--color-brand-pink-rgb), 0.45),
      0 0 0 2px rgba(255, 255, 255, 0.1) inset;
  }
}

@keyframes volBump {
  0% {
    transform: scale(1);
  }
  40% {
    transform: scale(1.18);
  }
  70% {
    transform: scale(0.96);
  }
  100% {
    transform: scale(1);
  }
}

@keyframes volSpeak {
  0%,
  100% {
    transform: scale(1);
    opacity: 1;
  }
  50% {
    transform: scale(1.18);
    opacity: 0.7;
  }
}

@keyframes volWaveBreath {
  0%,
  100% {
    transform: scale(1);
    opacity: 1;
  }
  50% {
    transform: scale(1.08);
    opacity: 0.85;
  }
}

@keyframes volPulseGlow {
  0% {
    opacity: 0.8;
    transform: scale(0.96);
  }
  70% {
    opacity: 0;
    transform: scale(1.18);
  }
  100% {
    opacity: 0;
    transform: scale(1.18);
  }
}

@media (prefers-reduced-motion: reduce) {
  .panel__vol-mute .vol-ico,
  .panel__vol-mute .vol-ico__wave,
  .panel__vol-mute::after {
    animation: none !important;
  }
  .panel__t-btn,
  .panel__vol-slider::-webkit-slider-thumb {
    transition: none;
  }
}

@media (max-width: 720px) {
  .panel {
    padding: 16px;

    &__head {
      grid-template-columns: minmax(0, 1fr);
    }
    &__vol-pct {
      justify-self: end;
    }
    &__log-row {
      grid-template-columns: 14px 50px minmax(0, 1fr) auto;
      font-size: 12px;
    }
  }
}
</style>
