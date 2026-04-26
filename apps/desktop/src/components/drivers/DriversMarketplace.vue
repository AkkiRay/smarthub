<template>
  <div ref="rootEl" class="marketplace">
    <div
      v-for="group in groups"
      :key="group.category"
      class="marketplace__group"
      data-anim="block"
    >
      <header class="marketplace__group-head">
        <h3 class="marketplace__group-title">{{ group.title }}</h3>
        <span class="marketplace__group-count">{{ group.drivers.length }}</span>
      </header>
      <ul class="marketplace__list">
        <li
          v-for="d in group.drivers"
          :key="d.id"
          class="marketplace__item"
          :class="{
            'is-active': d.active,
            'is-expanded': expanded === d.id,
            [`maturity--${d.maturity}`]: true,
          }"
          data-anim="item"
        >
          <div class="marketplace__row" @click="toggleExpand(d)">
            <DriverIcon :driver="d.id as DriverId" size="md" :active="d.active" />

            <div class="marketplace__copy">
              <strong class="marketplace__name">
                {{ d.displayName }}
                <span class="marketplace__region" :class="`region--${d.region}`">{{
                  regionLabel(d.region)
                }}</span>
              </strong>
              <span class="marketplace__desc">{{ d.description }}</span>
            </div>

            <span class="chip marketplace__status" :class="statusChip(d)">
              <span class="chip__dot" />
              {{ statusLabel(d) }}
            </span>

            <button
              v-if="d.requiresCredentials || d.maturity === 'planned'"
              class="marketplace__chevron"
              type="button"
              :aria-expanded="expanded === d.id"
              aria-label="Развернуть настройки драйвера"
              @click.stop="toggleExpand(d)"
            >
              <svg viewBox="0 0 16 16" fill="none">
                <path
                  d="M4 6l4 4 4-4"
                  stroke="currentColor"
                  stroke-width="1.6"
                  stroke-linecap="round"
                  stroke-linejoin="round"
                />
              </svg>
            </button>
          </div>

          <Transition name="marketplace-expand">
            <div v-if="expanded === d.id" class="marketplace__panel">
              <DriverCredentialsForm
                v-if="d.requiresCredentials && d.credentialsSchema"
                :schema="d.credentialsSchema"
                :initial-values="(savedCreds[d.id] ?? {}) as Record<string, string>"
                :busy="busyId === d.id"
                :docs-url="d.docsUrl"
                @submit="saveCreds(d, $event)"
                @open-docs="d.docsUrl && openDoc(d.docsUrl)"
              />
              <p v-else-if="d.maturity === 'planned'" class="marketplace__note">
                Discovery работает. Полное управление требует доустановить controller — см.
                <a @click.prevent="d.docsUrl && openDoc(d.docsUrl)">{{
                  d.docsUrl ?? 'документацию'
                }}</a
                >.
              </p>
            </div>
          </Transition>
        </li>
      </ul>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, nextTick, onMounted, ref, useTemplateRef, watch } from 'vue';
import type { DriverCategory, DriverDescriptor, DriverId } from '@smarthome/shared';
import { useToasterStore } from '@/stores/toaster';
import { useViewMount } from '@/composables/useViewMount';
import { useGsap } from '@/composables/useGsap';
import DriverIcon from '@/components/visuals/DriverIcon.vue';
import DriverCredentialsForm from './DriverCredentialsForm.vue';

const toaster = useToasterStore();

const rootEl = useTemplateRef<HTMLElement>('rootEl');
const drivers = ref<DriverDescriptor[]>([]);
const expanded = ref<string | null>(null);
const busyId = ref<string | null>(null);
const savedCreds = ref<Record<string, Record<string, unknown>>>({});

const CATEGORY_TITLES: Record<DriverCategory, string> = {
  'lan-russian': 'Российские (локально)',
  'lan-global': 'Локальный LAN',
  'cloud-russian': 'Российские облака',
  'cloud-global': 'Зарубежные облака',
  protocol: 'Универсальные протоколы',
  bridge: 'Мосты к чужим хабам',
  misc: 'Прочее',
};

const CATEGORY_ORDER: readonly DriverCategory[] = [
  'lan-russian',
  'cloud-russian',
  'lan-global',
  'protocol',
  'cloud-global',
  'bridge',
  'misc',
];

const groups = computed(() => {
  const buckets = new Map<DriverCategory, DriverDescriptor[]>();
  for (const cat of CATEGORY_ORDER) buckets.set(cat, []);
  for (const d of drivers.value) {
    const cat = d.category ?? 'misc';
    if (!buckets.has(cat)) buckets.set(cat, []);
    buckets.get(cat)!.push(d);
  }
  return Array.from(buckets.entries())
    .filter(([, list]) => list.length > 0)
    .map(([category, list]) => ({
      category,
      title: CATEGORY_TITLES[category],
      drivers: list,
    }));
});

async function load(): Promise<void> {
  drivers.value = await window.smarthome.drivers.list();
  // Параллельно подгружаем сохранённые creds для драйверов с credentialsSchema.
  const entries = await Promise.all(
    drivers.value
      .filter((d) => d.requiresCredentials)
      .map(async (d) => [d.id, await window.smarthome.drivers.getCredentials(d.id)] as const),
  );
  // Driver-specific credential типы narrower чем Record<string, unknown> — приводим к общему виду.
  savedCreds.value = Object.fromEntries(entries) as Record<string, Record<string, unknown>>;
}

function toggleExpand(d: DriverDescriptor): void {
  if (!d.requiresCredentials && d.maturity !== 'planned') return;
  expanded.value = expanded.value === d.id ? null : d.id;
}

function regionLabel(r: DriverDescriptor['region']): string {
  return r === 'ru' ? 'РФ' : r === 'ru-cis' ? 'РФ+СНГ' : 'Global';
}

function statusChip(d: DriverDescriptor): string {
  if (d.active) return 'chip--online';
  if (d.requiresCredentials) return 'chip--warn';
  if (d.maturity === 'planned') return 'chip--warn';
  return 'chip--offline';
}

function statusLabel(d: DriverDescriptor): string {
  if (d.active) return 'Активен';
  if (d.maturity === 'planned') return 'Discovery';
  if (d.requiresCredentials) return 'Нужны креды';
  return 'Отключён';
}

function openDoc(url: string): void {
  void window.smarthome.app.openExternal(url);
}

async function saveCreds(d: DriverDescriptor, values: Record<string, string>): Promise<void> {
  busyId.value = d.id;
  const toastId = toaster.push({
    kind: 'pending',
    message: `Подключаем ${d.displayName}…`,
    detail: 'Перезагружаем драйвер',
  });
  try {
    await window.smarthome.drivers.setCredentials(d.id, values);
    await load();
    toaster.update(toastId, {
      kind: 'success',
      message: `${d.displayName} подключён`,
      ttlMs: 3000,
    });
  } catch (e) {
    toaster.update(toastId, {
      kind: 'error',
      message: `Не удалось сохранить ${d.displayName}`,
      detail: (e as Error).message,
      ttlMs: 5000,
    });
  } finally {
    busyId.value = null;
  }
}

onMounted(load);

// Mount-cascade: group-блоки → driver-ряды одной волной (stagger из useViewMount).
// `load()` асинхронный — драйверы появляются через tick, поэтому повторно
// прогоняем stagger когда массив наполнился (иначе на первом mount'е
// querySelectorAll('[data-anim="item"]') вернёт пусто).
useViewMount({ scope: rootEl });
const { from } = useGsap(rootEl.value);
watch(
  () => drivers.value.length,
  async (next, prev) => {
    if (next === 0 || prev !== 0) return;
    await nextTick();
    from('[data-anim="item"]', {
      opacity: 0,
      y: 8,
      stagger: { each: 0.025, amount: 0.45, from: 'start' },
      duration: 0.34,
      ease: 'power2.out',
      clearProps: 'opacity,transform',
    });
  },
);

defineExpose({ reload: load });
</script>

<style scoped lang="scss">
.marketplace {
  display: flex;
  flex-direction: column;
  gap: clamp(18px, 1.6vw, 26px);

  &__group-head {
    display: flex;
    align-items: baseline;
    gap: 10px;
    margin-bottom: 10px;
  }

  &__group-title {
    font-size: 13px;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.06em;
    color: var(--color-text-secondary);
    margin: 0;
  }

  &__group-count {
    font-family: var(--font-family-mono);
    font-size: 11.5px;
    color: var(--color-text-muted);
    background: rgba(255, 255, 255, 0.04);
    padding: 2px 8px;
    border-radius: 999px;
  }

  &__list {
    list-style: none;
    margin: 0;
    padding: 0;
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(min(100%, 380px), 1fr));
    gap: 8px;
  }

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

    &:has(.marketplace__row:hover) {
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

      .marketplace__chevron {
        transform: rotate(180deg);
        color: var(--color-text-primary);
      }
    }

    &.maturity--planned .marketplace__name::after {
      content: 'beta';
      font-size: 10px;
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 0.05em;
      padding: 1px 6px;
      border-radius: 999px;
      background: rgba(255, 181, 71, 0.12);
      color: #ffb547;
      margin-left: 8px;
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
    display: inline-flex;
    align-items: center;
    gap: 6px;
  }

  &__region {
    font-size: 9.5px;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.07em;
    padding: 1.5px 6px;
    border-radius: 4px;
    background: rgba(255, 255, 255, 0.06);
    color: var(--color-text-secondary);

    &.region--ru {
      background: rgba(33, 160, 56, 0.16);
      color: #4ad072;
    }
    &.region--ru-cis {
      background: rgba(33, 160, 56, 0.12);
      color: #4ad072;
    }
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
  }

  &__panel {
    padding: 14px 18px 18px;
    border-top: 1px solid rgba(255, 255, 255, 0.05);
  }

  &__note {
    font-size: 12.5px;
    color: var(--color-text-muted);
    line-height: 1.55;
    margin: 0;

    a {
      color: var(--color-brand-purple);
      cursor: pointer;
      text-decoration: none;
      border-bottom: 1px dashed currentColor;

      &:hover {
        color: var(--color-brand-pink);
      }
    }
  }
}

.marketplace-expand-enter-active,
.marketplace-expand-leave-active {
  overflow: hidden;
  transition:
    max-height 360ms var(--ease-out),
    opacity 240ms var(--ease-out),
    padding 280ms var(--ease-out);
}
.marketplace-expand-enter-from,
.marketplace-expand-leave-to {
  max-height: 0 !important;
  opacity: 0;
}
.marketplace-expand-enter-to,
.marketplace-expand-leave-from {
  max-height: 600px;
  opacity: 1;
}
</style>
