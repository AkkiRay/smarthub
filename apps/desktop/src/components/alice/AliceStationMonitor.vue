<template>
  <article class="monitor" data-tour="alice-station-monitor">
    <header class="monitor__head">
      <div class="monitor__copy">
        <h3 class="monitor__title">Журнал glagol-сессии</h3>
        <p class="monitor__desc">
          Lifecycle, команды, ответы Алисы и state-push'и колонки.
        </p>
      </div>
      <BaseButton
        variant="ghost"
        size="sm"
        icon-left="trash"
        :disabled="!events.length"
        @click="onClear"
      >
        Очистить
      </BaseButton>
    </header>

    <div v-if="latest.aliceState || latest.aliceText || latest.userText" class="monitor__strip">
      <span v-if="latest.aliceState" class="monitor__chip" :data-state="latest.aliceState">
        <span class="monitor__chip-dot" /> Alice · {{ latest.aliceState }}
      </span>
      <span v-if="latest.userText" class="monitor__chip monitor__chip--user">
        Услышала: «{{ truncate(latest.userText, 64) }}»
      </span>
      <span v-if="latest.aliceText" class="monitor__chip monitor__chip--alice">
        Ответила: «{{ truncate(latest.aliceText, 64) }}»
      </span>
      <span v-if="typeof latest.volume === 'number'" class="monitor__chip monitor__chip--vol">
        🔊 {{ Math.round(latest.volume * 100) }}%
      </span>
    </div>

    <ol v-if="events.length" class="monitor__list" :aria-live="'polite'">
      <li
        v-for="evt in displayed"
        :key="evt.id"
        class="monitor__row"
        :data-kind="evt.kind"
        :class="{ 'monitor__row--open': expanded.has(evt.id) }"
      >
        <button class="monitor__row-head" type="button" @click="toggle(evt)">
          <span class="monitor__pip" :data-kind="evt.kind">
            <BaseIcon :name="iconFor(evt.kind)" :size="11" />
          </span>
          <time class="monitor__time">{{ formatTime(evt.at) }}</time>
          <span class="monitor__summary">{{ evt.summary }}</span>
          <span v-if="evt.closeCode" class="monitor__badge">code {{ evt.closeCode }}</span>
          <span v-if="evt.status === 'REFUSED'" class="monitor__badge monitor__badge--err">
            REFUSED
          </span>
          <BaseIcon
            v-if="evt.details"
            class="monitor__chev"
            :class="{ 'monitor__chev--open': expanded.has(evt.id) }"
            name="arrow-right"
            :size="11"
          />
        </button>
        <pre v-if="expanded.has(evt.id) && evt.details" class="monitor__details">{{ evt.details }}</pre>
      </li>
    </ol>

    <p v-else class="monitor__empty">Журнал пуст.</p>
  </article>
</template>

<script setup lang="ts">
// Подробный raw-журнал glagol-событий (lifecycle / outgoing / response / state).

import { computed, reactive } from 'vue';
import type { YandexStationEvent } from '@smarthome/shared';
import type { IconName } from '@/components/base';
import { BaseButton, BaseIcon } from '@/components/base';
import { useYandexStationStore } from '@/stores/yandexStation';

const station = useYandexStationStore();

const events = computed<YandexStationEvent[]>(() => station.events);
const displayed = computed(() => [...events.value].reverse());

const expanded = reactive(new Set<string>());

function toggle(evt: YandexStationEvent): void {
  if (!evt.details) return;
  if (expanded.has(evt.id)) expanded.delete(evt.id);
  else expanded.add(evt.id);
}

async function onClear(): Promise<void> {
  await station.clearEvents();
  expanded.clear();
}

/** Свежие значения полей из последних state-event'ов для header-стрипы. */
const latest = computed(() => {
  const out: {
    aliceState?: string;
    aliceText?: string;
    userText?: string;
    volume?: number;
  } = {};
  for (const e of [...events.value].reverse()) {
    if (!out.aliceState && e.aliceState) out.aliceState = e.aliceState;
    if (!out.aliceText && e.aliceText) out.aliceText = e.aliceText;
    if (!out.userText && e.userText) out.userText = e.userText;
    if (out.volume === undefined && typeof e.volume === 'number') out.volume = e.volume;
    if (out.aliceState && out.aliceText && out.userText && out.volume !== undefined) break;
  }
  return out;
});

function iconFor(kind: YandexStationEvent['kind']): IconName {
  switch (kind) {
    case 'connecting':
      return 'refresh';
    case 'connected':
      return 'check';
    case 'closed':
      return 'close';
    case 'error':
      return 'close';
    case 'outgoing':
      return 'arrow-right';
    case 'response':
      return 'arrow-left';
    case 'state':
      return 'alice';
    default:
      return 'sensor';
  }
}

function formatTime(iso: string): string {
  const d = new Date(iso);
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  const ss = String(d.getSeconds()).padStart(2, '0');
  const ms = String(d.getMilliseconds()).padStart(3, '0');
  return `${hh}:${mm}:${ss}.${ms.slice(0, 2)}`;
}

function truncate(s: string, n: number): string {
  return s.length > n ? s.slice(0, n - 1) + '…' : s;
}
</script>

<style scoped lang="scss">
.monitor {
  container-type: inline-size;
  position: relative;
  border-radius: var(--radius-lg);
  background: rgba(255, 255, 255, 0.022);
  border: 1px solid rgba(255, 255, 255, 0.05);
  padding: clamp(18px, 1.6vw, 26px) clamp(18px, 1.6vw, 28px);
  display: flex;
  flex-direction: column;
  gap: 14px;

  &__head {
    display: grid;
    grid-template-columns: minmax(0, 1fr) auto;
    gap: 16px;
    align-items: start;
  }

  &__copy {
    display: flex;
    flex-direction: column;
    gap: 6px;
    min-width: 0;
  }

  &__title {
    font-family: var(--font-family-display);
    font-size: var(--font-size-h2);
    font-weight: 600;
    letter-spacing: var(--tracking-h1);
    color: var(--color-text-primary);
    margin: 0;
  }

  &__desc {
    font-size: var(--font-size-small);
    color: var(--color-text-secondary);
    line-height: 1.55;
    margin: 0;
    max-width: 72ch;
    text-wrap: pretty;
  }

  // ---- header strip: state + voice + volume snapshot ----------------------
  &__strip {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
  }

  &__chip {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    padding: 5px 10px;
    border-radius: 999px;
    background: rgba(255, 255, 255, 0.04);
    border: 1px solid rgba(255, 255, 255, 0.07);
    color: var(--color-text-secondary);
    font-size: 12px;
    font-weight: 500;
    letter-spacing: -0.005em;
    font-variant-numeric: tabular-nums;

    &-dot {
      width: 7px;
      height: 7px;
      border-radius: 50%;
      background: var(--color-text-muted);
    }

    &[data-state='SPEAKING'] .monitor__chip-dot {
      background: var(--color-brand-pink);
      box-shadow: 0 0 0 0 rgba(var(--color-brand-pink-rgb), 0.5);
      animation: monitorChipPulse 1.4s ease-out infinite;
    }
    &[data-state='LISTENING'] .monitor__chip-dot {
      background: var(--color-brand-purple);
      animation: monitorChipPulse 1.6s ease-out infinite;
    }
    &[data-state='BUSY'] .monitor__chip-dot {
      background: var(--color-warning);
    }
    &[data-state='IDLE'] .monitor__chip-dot {
      background: var(--color-success);
    }

    &--user {
      color: var(--color-text-primary);
      border-color: rgba(var(--color-brand-purple-rgb), 0.32);
      background: rgba(var(--color-brand-purple-rgb), 0.06);
    }
    &--alice {
      color: var(--color-text-primary);
      border-color: rgba(var(--color-brand-pink-rgb), 0.32);
      background: rgba(var(--color-brand-pink-rgb), 0.06);
    }
  }

  // ---- list -------------------------------------------------------------
  &__list {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    border: 1px solid rgba(255, 255, 255, 0.05);
    border-radius: var(--radius-md);
    background: rgba(0, 0, 0, 0.18);
    max-height: 360px;
    overflow-y: auto;

    // тонкий scroll
    &::-webkit-scrollbar {
      width: 6px;
    }
    &::-webkit-scrollbar-thumb {
      background: rgba(255, 255, 255, 0.1);
      border-radius: 3px;
    }
  }

  &__row {
    display: flex;
    flex-direction: column;
    border-top: 1px solid rgba(255, 255, 255, 0.04);

    &:first-child {
      border-top: 0;
    }

    &-head {
      all: unset;
      cursor: pointer;
      display: grid;
      grid-template-columns: 24px auto minmax(0, 1fr) auto auto;
      gap: 10px;
      align-items: center;
      padding: 8px 12px;
      transition: background-color 160ms var(--ease-out);

      &:hover,
      &:focus-visible {
        background: rgba(255, 255, 255, 0.03);
      }
      &:focus-visible {
        outline: 1px solid rgba(var(--color-brand-purple-rgb), 0.45);
        outline-offset: -1px;
      }
    }
  }

  &__pip {
    width: 22px;
    height: 22px;
    border-radius: 50%;
    display: grid;
    place-items: center;
    background: rgba(255, 255, 255, 0.06);
    color: var(--color-text-muted);
    flex-shrink: 0;

    &[data-kind='connecting'] {
      background: rgba(var(--color-brand-purple-rgb), 0.18);
      color: var(--color-brand-purple);
    }
    &[data-kind='connected'] {
      background: rgba(var(--color-success-rgb), 0.22);
      color: var(--color-success);
    }
    &[data-kind='closed'],
    &[data-kind='error'] {
      background: rgba(var(--color-danger-rgb), 0.22);
      color: var(--color-danger);
    }
    &[data-kind='outgoing'] {
      background: rgba(var(--color-brand-purple-rgb), 0.18);
      color: var(--color-brand-purple);
    }
    &[data-kind='response'],
    &[data-kind='state'] {
      background: rgba(var(--color-brand-pink-rgb), 0.18);
      color: var(--color-brand-pink);
    }
  }

  &__time {
    font-family: var(--font-family-mono);
    font-size: 11px;
    color: var(--color-text-muted);
    font-variant-numeric: tabular-nums;
    flex-shrink: 0;
  }

  &__summary {
    font-size: 13px;
    color: var(--color-text-primary);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  &__badge {
    font-family: var(--font-family-mono);
    font-size: 10.5px;
    color: var(--color-text-muted);
    background: rgba(255, 255, 255, 0.05);
    padding: 2px 6px;
    border-radius: 4px;
    flex-shrink: 0;

    &--err {
      color: var(--color-danger);
      background: rgba(var(--color-danger-rgb), 0.12);
    }
  }

  &__chev {
    color: var(--color-text-muted);
    transform: rotate(90deg);
    transition: transform 200ms var(--ease-out);
    flex-shrink: 0;

    &--open {
      transform: rotate(-90deg);
      color: var(--color-text-primary);
    }
  }

  &__details {
    margin: 0;
    padding: 10px 14px 14px 46px;
    background: rgba(0, 0, 0, 0.25);
    color: var(--color-text-secondary);
    font-family: var(--font-family-mono);
    font-size: 11.5px;
    line-height: 1.5;
    white-space: pre-wrap;
    word-break: break-word;
    border-top: 1px dashed rgba(255, 255, 255, 0.05);
  }

  &__empty {
    margin: 0;
    padding: 14px;
    text-align: center;
    font-size: 13px;
    color: var(--color-text-muted);
    border: 1px dashed rgba(255, 255, 255, 0.07);
    border-radius: var(--radius-md);
  }
}

@keyframes monitorChipPulse {
  0% {
    box-shadow: 0 0 0 0 rgba(var(--color-brand-purple-rgb), 0.45);
  }
  70% {
    box-shadow: 0 0 0 6px rgba(var(--color-brand-purple-rgb), 0);
  }
  100% {
    box-shadow: 0 0 0 0 rgba(var(--color-brand-purple-rgb), 0);
  }
}

@media (prefers-reduced-motion: reduce) {
  .monitor__chip-dot,
  .monitor__chev {
    animation: none;
    transition: none;
  }
}

@media (max-width: 720px) {
  .monitor {
    padding: 16px;

    &__head {
      grid-template-columns: minmax(0, 1fr);
      :deep(.btn) {
        justify-self: stretch;
      }
    }

    &__row-head {
      grid-template-columns: 22px auto minmax(0, 1fr);
      grid-template-rows: auto auto;
      gap: 8px;
    }
  }
}
</style>
