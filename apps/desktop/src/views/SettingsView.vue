<template>
  <section class="settings" ref="root">
    <BasePageHeader title="Настройки" description="Конфигурация хаба, драйверов и интеграций." />

    <div class="settings__stack">
      <!-- ============ Внешний вид ============ -->
      <article class="settings__group" data-anim="block">
        <header class="settings__group-head">
          <span class="settings__group-num">01</span>
          <div>
            <h2 class="settings__group-title">Внешний вид</h2>
            <p class="settings__group-desc">Тема, движение, повторные туры.</p>
          </div>
        </header>

        <div class="settings__rows">
          <div class="settings__row">
            <div class="settings__row-copy">
              <span class="settings__row-title">Тема оформления</span>
              <span class="settings__row-hint"
                >Глубокий тёмный или ночной с большим контрастом.</span
              >
            </div>
            <BaseSelect
              :model-value="ui?.theme ?? 'alice-dark'"
              :options="themeOptions"
              size="md"
              @update:model-value="ui?.setTheme?.($event as 'alice-dark' | 'alice-midnight')"
            />
          </div>

          <div class="settings__row">
            <div class="settings__row-copy">
              <span class="settings__row-title">Уменьшить анимации</span>
              <span class="settings__row-hint"
                >Бережёт глаза и батарею. Уважает системный prefers-reduced-motion.</span
              >
            </div>
            <BaseSwitch
              :model-value="ui.reduceMotion"
              @update:model-value="ui.setReduceMotion($event)"
            />
          </div>

          <div class="settings__row">
            <div class="settings__row-copy">
              <span class="settings__row-title">Тур по интерфейсу</span>
              <span class="settings__row-hint">Покажем основные разделы и подсказки заново.</span>
            </div>
            <BaseButton variant="ghost" size="sm" icon-left="refresh" @click="restartTour">
              Пройти заново
            </BaseButton>
          </div>
        </div>
      </article>

      <!-- ============ О приложении ============ -->
      <article class="settings__group" data-anim="block">
        <header class="settings__group-head">
          <span class="settings__group-num">02</span>
          <div>
            <h2 class="settings__group-title">О приложении</h2>
            <p class="settings__group-desc">Идентификация хаба и текущая версия.</p>
          </div>
        </header>

        <dl class="settings__dl">
          <div>
            <dt>Версия</dt>
            <dd>v{{ ui.version || '—' }}</dd>
          </div>
          <div>
            <dt>Платформа</dt>
            <dd>{{ ui.platform }}</dd>
          </div>
          <div>
            <dt>Hub ID</dt>
            <dd>
              <span class="settings__hub-id">{{ hubInfo?.hubId ?? '—' }}</span>
              <button
                v-if="hubInfo?.hubId"
                class="settings__copy"
                type="button"
                aria-label="Скопировать Hub ID"
                @click="copyHubId"
              >
                <BaseIcon v-if="copied" name="check" size="13" />
                <svg v-else viewBox="0 0 16 16" fill="none">
                  <rect
                    x="4"
                    y="4"
                    width="9"
                    height="9"
                    rx="2"
                    stroke="currentColor"
                    stroke-width="1.4"
                  />
                  <path
                    d="M4 11H3.5A1.5 1.5 0 012 9.5V3.5A1.5 1.5 0 013.5 2h6A1.5 1.5 0 0111 3.5V4"
                    stroke="currentColor"
                    stroke-width="1.4"
                    stroke-linejoin="round"
                  />
                </svg>
              </button>
            </dd>
          </div>
          <div>
            <dt>Устройств</dt>
            <dd>{{ hubInfo?.pairedDevices ?? 0 }}</dd>
          </div>
          <div>
            <dt>Колонка Алисы</dt>
            <dd>
              <span
                class="chip"
                :class="hubInfo?.yandexStationConnected ? 'chip--online' : 'chip--offline'"
              >
                <span class="chip__dot" />
                {{ hubInfo?.yandexStationConnected ? 'Подключена' : 'Не подключена' }}
              </span>
            </dd>
          </div>
        </dl>
      </article>

      <!-- ============ Интеграции ============ -->
      <article class="settings__group" data-anim="block" data-tour="settings-integrations">
        <header class="settings__group-head">
          <span class="settings__group-num">03</span>
          <div>
            <h2 class="settings__group-title">Интеграции</h2>
            <p class="settings__group-desc">
              Хаб говорит с устройствами через несколько протоколов одновременно. Локальные —
              работают сразу, облачные — после ввода учётных данных.
            </p>
          </div>
        </header>

        <DriversMarketplace />
      </article>
    </div>
  </section>
</template>

<script setup lang="ts">
import { onMounted, ref, useTemplateRef } from 'vue';
import { useRouter } from 'vue-router';
import type { HubInfo } from '@smarthome/shared';
import { useUiStore } from '@/stores/ui';
import { useViewMount } from '@/composables/useViewMount';
import {
  BaseButton,
  BaseIcon,
  BaseSelect,
  BaseSwitch,
  BasePageHeader,
  type SelectOption,
} from '@/components/base';
import DriversMarketplace from '@/components/drivers/DriversMarketplace.vue';

const ui = useUiStore();
const router = useRouter();
const root = useTemplateRef<HTMLElement>('root');

const hubInfo = ref<HubInfo | null>(null);
const copied = ref(false);

const themeOptions: SelectOption[] = [
  { value: 'alice-dark', label: 'Alice Dark' },
  { value: 'alice-midnight', label: 'Alice Midnight' },
];

function restartTour(): void {
  ui.resetOnboarding();
  void router.push({ path: '/welcome' });
}

async function copyHubId(): Promise<void> {
  if (!hubInfo.value?.hubId) return;
  try {
    await navigator.clipboard.writeText(hubInfo.value.hubId);
    copied.value = true;
    setTimeout(() => (copied.value = false), 1400);
  } catch {
    /* нет clipboard permission — silent */
  }
}

onMounted(async () => {
  hubInfo.value = await window.smarthome.app.getHubInfo();
});

useViewMount({ scope: root.value });
</script>

<style scoped lang="scss">
@use '@/styles/abstracts/mixins' as *;

// Flat minimalist: surface + hairline rows; анимация только на hover/press.
.settings {
  display: flex;
  flex-direction: column;
  gap: var(--content-gap);
  width: 100%;

  &__stack {
    display: flex;
    flex-direction: column;
    gap: clamp(14px, 1.4vw, 22px);
  }

  // Container query — row внутри переключается в stack < 480px.
  &__group {
    container-type: inline-size;
    position: relative;
    border-radius: var(--radius-lg);
    background: rgba(255, 255, 255, 0.022);
    border: 1px solid rgba(255, 255, 255, 0.05);
    padding: clamp(20px, 2vw, 30px) clamp(20px, 2vw, 32px);
    display: flex;
    flex-direction: column;
    gap: clamp(16px, 1.4vw, 22px);
    min-width: 0;
    transition:
      background-color 280ms var(--ease-out),
      border-color 280ms var(--ease-out);

    &:hover {
      background: rgba(255, 255, 255, 0.032);
      border-color: rgba(255, 255, 255, 0.07);
    }

    &-head {
      display: grid;
      grid-template-columns: auto minmax(0, 1fr);
      gap: clamp(14px, 1.4vw, 22px);
      align-items: baseline;
    }

    &-num {
      font-family: var(--font-family-mono);
      font-size: 12px;
      font-weight: 600;
      letter-spacing: 0.08em;
      color: transparent;
      background: var(--gradient-brand);
      -webkit-background-clip: text;
      background-clip: text;
      padding-top: 4px;
    }

    &-title {
      font-family: var(--font-family-display);
      font-size: clamp(18px, 1vw + 14px, 22px);
      font-weight: 600;
      letter-spacing: var(--tracking-h1);
      color: var(--color-text-primary);
      margin: 0 0 4px;
    }

    &-desc {
      font-size: var(--font-size-small);
      color: var(--color-text-secondary);
      line-height: 1.5;
      margin: 0;
      max-width: 64ch;
      text-wrap: pretty;
    }
  }

  &__rows {
    display: flex;
    flex-direction: column;
  }

  &__row {
    display: grid;
    grid-template-columns: minmax(0, 1fr) auto;
    align-items: center;
    gap: 16px;
    padding: 14px 0;
    border-top: 1px solid rgba(255, 255, 255, 0.045);
    transition: padding-left 240ms var(--ease-out);

    &:first-child {
      border-top: 0;
    }

    > :nth-child(2) {
      justify-self: end;
    }

    &:hover .settings__row-title {
      color: var(--color-text-primary);
    }
    &:hover .settings__row-hint {
      color: var(--color-text-secondary);
    }

    &-copy {
      display: flex;
      flex-direction: column;
      gap: 3px;
      min-width: 0;
    }

    &-title {
      font-size: 14px;
      font-weight: 600;
      color: var(--color-text-primary);
      letter-spacing: -0.005em;
      text-wrap: balance;
      transition: color 200ms var(--ease-out);
    }

    &-hint {
      font-size: 12.5px;
      color: var(--color-text-muted);
      line-height: 1.45;
      text-wrap: pretty;
      transition: color 200ms var(--ease-out);
    }

    @container (max-width: 480px) {
      grid-template-columns: minmax(0, 1fr);
      gap: 10px;

      > :nth-child(2) {
        justify-self: start;
      }
    }
  }

  &__dl {
    display: flex;
    flex-direction: column;
    margin: 0;

    > div {
      display: grid;
      grid-template-columns: 130px minmax(0, 1fr);
      align-items: center;
      gap: 16px;
      padding: 12px 0;
      border-top: 1px solid rgba(255, 255, 255, 0.045);
      font-size: 13px;

      &:first-child {
        border-top: 0;
      }
    }
    dt {
      color: var(--color-text-muted);
      font-size: 12.5px;
      letter-spacing: 0.01em;
    }
    dd {
      margin: 0;
      color: var(--color-text-primary);
      font-family: var(--font-family-mono);
      word-break: break-all;
      min-width: 0;
      display: flex;
      align-items: center;
      gap: 8px;
    }
  }

  &__hub-id {
    font-family: var(--font-family-mono);
  }

  &__copy {
    flex-shrink: 0;
    width: 26px;
    height: 26px;
    border: 0;
    border-radius: 50%;
    background: rgba(255, 255, 255, 0.04);
    color: var(--color-text-secondary);
    cursor: pointer;
    display: grid;
    place-items: center;
    transition:
      background-color 180ms var(--ease-out),
      color 180ms var(--ease-out);

    svg {
      width: 13px;
      height: 13px;
    }
    &:hover {
      background: rgba(255, 255, 255, 0.1);
      color: var(--color-text-primary);
    }
    &:active {
      background: rgba(255, 255, 255, 0.16);
      transition-duration: 0ms;
    }
    &:focus-visible {
      outline: 2px solid color-mix(in srgb, var(--color-brand-purple) 70%, transparent);
      outline-offset: 2px;
    }
  }
}

// Active-driver маркируется тонкой левой gradient-полосой вместо рамки.
.drivers {
  list-style: none;
  margin: 0;
  padding: 0;
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(min(100%, 380px), 1fr));
  gap: 8px;

  &__item {
    position: relative;
    border-radius: var(--radius-md);
    background: rgba(255, 255, 255, 0.022);
    border: 1px solid rgba(255, 255, 255, 0.05);
    overflow: hidden;
    transition:
      background-color 200ms var(--ease-out),
      border-color 200ms var(--ease-out);

    &::before {
      content: '';
      position: absolute;
      inset: 0 auto 0 0;
      width: 2px;
      background: var(--gradient-brand);
      opacity: 0;
      transition: opacity 240ms var(--ease-out);
      pointer-events: none;
    }

    &:has(.drivers__row:hover) {
      background: rgba(255, 255, 255, 0.04);
      border-color: rgba(255, 255, 255, 0.08);
    }

    &.is-active::before {
      opacity: 0.7;
    }

    &.is-expanded {
      grid-column: 1 / -1;
      background: rgba(255, 255, 255, 0.035);
      border-color: rgba(var(--color-brand-purple-rgb), 0.22);

      &::before {
        opacity: 1;
      }

      .drivers__chevron {
        transform: rotate(180deg);
        color: var(--color-text-primary);
      }
    }
  }

  &__row {
    display: grid;
    grid-template-columns: auto 1fr auto auto;
    align-items: center;
    gap: 14px;
    padding: 14px 18px;
    cursor: pointer;
    transition: background-color 160ms var(--ease-out);

    &:active {
      background: rgba(255, 255, 255, 0.07);
      transition-duration: 0ms;
    }
  }

  &__copy {
    display: flex;
    flex-direction: column;
    gap: 2px;
    min-width: 0;
  }

  &__name {
    font-size: 14.5px;
    font-weight: 600;
    color: var(--color-text-primary);
    letter-spacing: -0.005em;
  }

  &__desc {
    font-size: 12.5px;
    color: var(--color-text-muted);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  &__status {
    flex-shrink: 0;
  }

  &__chevron {
    flex-shrink: 0;
    width: 28px;
    height: 28px;
    border: 0;
    border-radius: 50%;
    background: transparent;
    color: var(--color-text-muted);
    cursor: pointer;
    display: grid;
    place-items: center;
    transition:
      background-color 160ms var(--ease-out),
      color 160ms var(--ease-out),
      transform 320ms var(--ease-out);

    svg {
      width: 14px;
      height: 14px;
    }
    &:hover {
      background: rgba(255, 255, 255, 0.07);
      color: var(--color-text-primary);
    }
    &:active {
      background: rgba(255, 255, 255, 0.12);
      transition-duration: 0ms;
    }
    &:focus-visible {
      outline: 2px solid color-mix(in srgb, var(--color-brand-purple) 70%, transparent);
      outline-offset: 2px;
    }
  }

  &__creds {
    padding: 4px 18px 18px;
    display: flex;
    flex-direction: column;
    gap: 14px;
    border-top: 1px solid rgba(255, 255, 255, 0.05);
  }

  &__form {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
    gap: 12px;
    padding-top: 14px;
  }

  &__form-wide {
    grid-column: 1 / -1;
  }

  &__actions {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    flex-wrap: wrap;
  }

  &__hint {
    font-size: 12px;
    color: var(--color-text-muted);
    line-height: 1.45;
    flex: 1 1 240px;
    min-width: 0;

    code {
      font-family: var(--font-family-mono);
      background: rgba(255, 255, 255, 0.05);
      padding: 1px 5px;
      border-radius: 4px;
    }
  }

  &__doc {
    font-size: 12.5px;
    color: var(--color-brand-purple);
    cursor: pointer;
    text-decoration: none;
    border-bottom: 1px dashed currentColor;
    transition:
      color 160ms var(--ease-out),
      border-bottom-color 160ms var(--ease-out),
      border-bottom-style 160ms var(--ease-out);

    &:hover {
      color: var(--color-brand-pink);
      border-bottom-style: solid;
    }
    &:active {
      color: #ff7ae0;
      transition-duration: 0ms;
    }
    &:focus-visible {
      outline: 2px solid color-mix(in srgb, var(--color-brand-purple) 70%, transparent);
      outline-offset: 3px;
      border-radius: 2px;
    }
  }
}

.drivers-expand-enter-active,
.drivers-expand-leave-active {
  overflow: hidden;
  transition:
    max-height 360ms var(--ease-out),
    opacity 240ms var(--ease-out),
    padding 280ms var(--ease-out);
}
.drivers-expand-enter-from,
.drivers-expand-leave-to {
  max-height: 0 !important;
  opacity: 0;
  padding-top: 0 !important;
  padding-bottom: 0 !important;
}
.drivers-expand-enter-to,
.drivers-expand-leave-from {
  max-height: 600px;
  opacity: 1;
}

@media (prefers-reduced-motion: reduce) {
  .settings__group,
  .settings__row,
  .settings__row-title,
  .settings__row-hint,
  .drivers__item,
  .drivers__row,
  .drivers__chevron,
  .drivers__doc,
  .settings__copy {
    transition: none;
  }
}

// ---- Mobile: компактные карточки и однокол. dl ----
@media (max-width: 720px) {
  .settings {
    &__group {
      padding: 16px;
    }

    &__group-head {
      grid-template-columns: auto minmax(0, 1fr);
      gap: 12px;
    }

    &__dl > div {
      // 130px label + value: на узком — стек.
      grid-template-columns: minmax(0, 1fr);
      gap: 4px;
      padding: 10px 0;

      dt {
        font-size: 11.5px;
        text-transform: uppercase;
        letter-spacing: 0.04em;
      }
    }

    &__row {
      // Action под текстом, не справа — иначе chip обрезает hint.
      flex-wrap: wrap;
      gap: 10px;

      &-copy {
        flex: 1 1 100%;
      }
    }
  }
}
</style>

<!-- Global override (без scoped) — перебивает scope-cache HMR для ghost-кнопки в settings__row. -->
<style lang="scss">
.settings__row .base-button.base-button--ghost {
  cursor: pointer;
  transition:
    background-color 220ms cubic-bezier(0.22, 1, 0.36, 1),
    border-color 220ms cubic-bezier(0.22, 1, 0.36, 1),
    color 220ms cubic-bezier(0.22, 1, 0.36, 1),
    transform 220ms cubic-bezier(0.22, 1, 0.36, 1);

  &:hover:not(:disabled) {
    background: rgba(255, 255, 255, 0.08);
    color: #fff;
    border: 1px solid rgba(255, 255, 255, 0.14);
    transform: translateY(-1px);
  }

  &:active:not(:disabled) {
    transform: translateY(0);
    background: rgba(255, 255, 255, 0.14);
    transition-duration: 0ms;
  }
}
</style>
