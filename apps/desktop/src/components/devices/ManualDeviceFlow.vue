<template>
  <BaseModal
    :open="open"
    :closable="!isPairing"
    :dismiss-on-backdrop="!isPairing"
    :dismiss-on-esc="!isPairing"
    size="md"
    :kicker="kicker"
    :title="titleByStep"
    @close="onClose"
  >
    <Transition :name="reduceMotion ? 'mf-fade' : 'mf-step'" mode="out-in">
      <!-- Шаг 1: форма -->
      <div v-if="step === 'form'" key="form" class="mf">
        <p class="mf__intro">
          Подключите любое устройство, у которого есть простой HTTP-эндпоинт включения и выключения
          (ESP-плата, реле с REST-API, сторонний бот). Хаб будет ходить по этим URL вместо вас и
          держать оптимистичное состояние.
        </p>

        <div class="mf__fields">
          <BaseInput
            v-model="form.name"
            label="Имя устройства"
            placeholder="Например, Лампа в коридоре"
            icon-left="edit"
            autocomplete="off"
            class="mf__field-wide"
          />

          <BaseSelect v-model="form.type" label="Тип" :options="typeOptions" />

          <BaseInput
            v-model="form.address"
            label="Адрес"
            placeholder="192.168.1.42"
            hint="Произвольная строка, отображается в карточке."
            autocomplete="off"
          />

          <BaseInput
            v-model="form.onUrl"
            label="URL включения"
            placeholder="http://192.168.1.42/cm?cmnd=Power%20On"
            autocomplete="off"
            class="mf__field-wide"
          />

          <BaseInput
            v-model="form.offUrl"
            label="URL выключения"
            placeholder="http://192.168.1.42/cm?cmnd=Power%20Off"
            autocomplete="off"
            class="mf__field-wide"
          />

          <BaseInput
            v-model="form.statusUrl"
            label="URL статуса (необязательно)"
            placeholder="http://192.168.1.42/cm?cmnd=Power"
            hint="Должен возвращать boolean / 'on'/'off' / { on: true }."
            autocomplete="off"
            class="mf__field-wide"
          />

          <BaseSelect v-model="form.method" label="HTTP-метод" :options="methodOptions" />

          <BaseInput
            v-model="form.bearer"
            label="Bearer-токен (необязательно)"
            type="password"
            placeholder="••••••••••••"
            autocomplete="off"
          />
        </div>

        <p v-if="formError" class="mf__error">{{ formError }}</p>
      </div>

      <!-- Шаг 2: pairing -->
      <div v-else-if="step === 'pairing'" key="pairing" class="mf mf--center">
        <div class="mf__pulse">
          <span class="mf__pulse-ring" />
          <span class="mf__pulse-ring mf__pulse-ring--late" />
          <span class="mf__pulse-core">
            <svg viewBox="0 0 24 24">
              <path
                d="M4 12h16M4 6h16M4 18h10"
                stroke="currentColor"
                stroke-width="1.8"
                stroke-linecap="round"
                fill="none"
              />
            </svg>
          </span>
        </div>
        <p class="mf__intro mf__intro--centered">Сохраняем устройство в хабе…</p>
      </div>

      <!-- Шаг 3: done -->
      <div v-else-if="step === 'done'" key="done" class="mf mf--center">
        <div class="mf__success">
          <svg viewBox="0 0 32 32">
            <path
              d="M8 16.5l5 5L24 11"
              stroke="currentColor"
              stroke-width="2.6"
              fill="none"
              stroke-linecap="round"
              stroke-linejoin="round"
            />
          </svg>
        </div>
        <p class="mf__done-name">{{ pairedDevice?.name ?? form.name }}</p>
        <p class="mf__done-text">Устройство добавлено и готово к работе.</p>
      </div>

      <!-- Шаг 4: error -->
      <div v-else key="error" class="mf mf--center">
        <div class="mf__error-icon">
          <svg viewBox="0 0 32 32">
            <circle cx="16" cy="16" r="12" stroke="currentColor" stroke-width="2.2" fill="none" />
            <path
              d="M16 9v8M16 21.5v.01"
              stroke="currentColor"
              stroke-width="2.4"
              stroke-linecap="round"
            />
          </svg>
        </div>
        <p class="mf__done-name">Не удалось добавить</p>
        <p class="mf__done-text">{{ errorMessage }}</p>
      </div>
    </Transition>

    <template #footer>
      <template v-if="step === 'form'">
        <BaseButton variant="ghost" @click="onClose">Отмена</BaseButton>
        <BaseButton variant="primary" icon-left="plus" :disabled="!canSubmit" @click="submit">
          Добавить
        </BaseButton>
      </template>

      <template v-else-if="step === 'done'">
        <BaseButton variant="ghost" @click="onClose">Закрыть</BaseButton>
        <BaseButton variant="primary" icon-right="arrow-right" @click="openDevice">
          Открыть устройство
        </BaseButton>
      </template>

      <template v-else-if="step === 'error'">
        <BaseButton variant="ghost" @click="onClose">Отмена</BaseButton>
        <BaseButton variant="primary" icon-left="refresh" @click="step = 'form'">
          Попробовать снова
        </BaseButton>
      </template>
    </template>
  </BaseModal>
</template>

<script setup lang="ts">
import { computed, reactive, ref, watch } from 'vue';
import { useRouter } from 'vue-router';
import { storeToRefs } from 'pinia';
import type { Device, DeviceType, DiscoveredDevice } from '@smarthome/shared';
import BaseModal from '@/components/chrome/BaseModal.vue';
import { BaseButton, BaseInput, BaseSelect, type SelectOption } from '@/components/base';
import { useDevicesStore } from '@/stores/devices';
import { useToasterStore } from '@/stores/toaster';
import { useUiStore } from '@/stores/ui';

const props = defineProps<{ open: boolean }>();
const emit = defineEmits<{ close: [] }>();

const devices = useDevicesStore();
const toaster = useToasterStore();
const router = useRouter();
const { reduceMotion } = storeToRefs(useUiStore());

type Step = 'form' | 'pairing' | 'done' | 'error';
const step = ref<Step>('form');
const pairedDevice = ref<Device | null>(null);
const errorMessage = ref('');
const formError = ref('');

const form = reactive({
  name: '',
  type: 'devices.types.switch' as string,
  address: '',
  onUrl: '',
  offUrl: '',
  statusUrl: '',
  method: 'GET' as string,
  bearer: '',
});

watch(
  () => props.open,
  (open) => {
    if (open) {
      step.value = 'form';
      pairedDevice.value = null;
      errorMessage.value = '';
      formError.value = '';
      Object.assign(form, {
        name: '',
        type: 'devices.types.switch',
        address: '',
        onUrl: '',
        offUrl: '',
        statusUrl: '',
        method: 'GET',
        bearer: '',
      });
    }
  },
);

const isPairing = computed(() => step.value === 'pairing');

const kicker = computed(() => {
  if (step.value === 'pairing') return 'Подключение';
  if (step.value === 'done') return 'Готово';
  if (step.value === 'error') return 'Ошибка';
  return 'Вручную';
});

const titleByStep = computed(() => {
  switch (step.value) {
    case 'pairing':
      return 'Сохраняем устройство';
    case 'done':
      return 'Устройство добавлено';
    case 'error':
      return 'Что-то пошло не так';
    default:
      return 'Добавить HTTP-устройство';
  }
});

const typeOptions: SelectOption[] = [
  { value: 'devices.types.switch', label: 'Выключатель' },
  { value: 'devices.types.socket', label: 'Розетка' },
  { value: 'devices.types.light', label: 'Лампа' },
  { value: 'devices.types.other', label: 'Другое' },
];
const methodOptions: SelectOption[] = [
  { value: 'GET', label: 'GET' },
  { value: 'POST', label: 'POST' },
];

const canSubmit = computed(
  () =>
    form.name.trim().length > 0 && form.onUrl.trim().length > 0 && form.offUrl.trim().length > 0,
);

function onClose(): void {
  if (isPairing.value) return;
  emit('close');
}

async function submit(): Promise<void> {
  formError.value = '';
  if (!canSubmit.value) {
    formError.value = 'Заполните имя, URL включения и URL выключения.';
    return;
  }
  if (!isHttpUrl(form.onUrl) || !isHttpUrl(form.offUrl)) {
    formError.value = 'URL должен начинаться с http:// или https://';
    return;
  }
  if (form.statusUrl && !isHttpUrl(form.statusUrl)) {
    formError.value = 'URL статуса должен начинаться с http:// или https://';
    return;
  }

  step.value = 'pairing';

  // generic-http не имеет autodiscovery: собираем DiscoveredDevice вручную.
  // externalId = uuid, потому что у user-устройства нет стабильного native-id.
  const externalId = `manual:${cryptoRandomId()}`;
  const candidate: DiscoveredDevice = {
    driver: 'generic-http',
    externalId,
    type: form.type as DeviceType,
    name: form.name.trim(),
    address: form.address.trim() || form.onUrl,
    meta: {
      onUrl: form.onUrl.trim(),
      offUrl: form.offUrl.trim(),
      statusUrl: form.statusUrl.trim() || undefined,
      method: form.method as 'GET' | 'POST',
      bearer: form.bearer.trim() || undefined,
    },
  };

  try {
    const device = await devices.pairSilent(candidate);
    pairedDevice.value = device;
    step.value = 'done';
    toaster.push({
      kind: 'success',
      message: `${device.name} подключён`,
      detail: 'Generic HTTP',
    });
  } catch (e) {
    errorMessage.value = (e as Error).message ?? 'Неизвестная ошибка';
    step.value = 'error';
  }
}

function openDevice(): void {
  const id = pairedDevice.value?.id;
  emit('close');
  if (id) void router.push(`/devices/${id}`);
}

function isHttpUrl(s: string): boolean {
  return /^https?:\/\//i.test(s.trim());
}

// Web Crypto доступен и в renderer-е (Electron 28+).
function cryptoRandomId(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return crypto.randomUUID();
  }
  return Math.random().toString(36).slice(2) + Date.now().toString(36);
}
</script>

<style scoped lang="scss">
@use '@/styles/abstracts/mixins' as *;

.mf {
  display: flex;
  flex-direction: column;
  gap: 16px;

  &--center {
    align-items: center;
    text-align: center;
    padding: 8px 0;
  }

  &__intro {
    margin: 0;
    color: var(--color-text-secondary);
    font-size: 13.5px;
    line-height: 1.5;

    &--centered {
      text-align: center;
      max-width: 320px;
    }
  }

  &__fields {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 12px;

    @media (max-width: 560px) {
      grid-template-columns: minmax(0, 1fr);
    }
  }

  &__field-wide {
    grid-column: 1 / -1;
  }

  &__error {
    margin: 0;
    padding: 10px 12px;
    border-radius: var(--radius-md);
    background: rgba(255, 85, 119, 0.08);
    border: 1px solid rgba(255, 85, 119, 0.32);
    color: var(--color-danger);
    font-size: 13px;
  }

  &__pulse {
    position: relative;
    width: 110px;
    height: 110px;
    display: grid;
    place-items: center;

    &-ring {
      position: absolute;
      inset: 0;
      border-radius: 50%;
      border: 1.5px solid var(--color-brand-purple);
      animation: mfPulse 2s ease-out infinite;

      &--late {
        animation-delay: 1s;
      }
    }

    &-core {
      width: 68px;
      height: 68px;
      border-radius: 50%;
      display: grid;
      place-items: center;
      background: var(--gradient-brand);
      color: var(--color-text-primary);
      box-shadow: 0 14px 36px rgba(var(--color-brand-purple-rgb), 0.55);
      svg {
        width: 32px;
        height: 32px;
      }
    }
  }

  &__success {
    width: 92px;
    height: 92px;
    color: #fff;
    background: var(--gradient-brand);
    border-radius: 50%;
    display: grid;
    place-items: center;
    box-shadow: 0 14px 36px rgba(var(--color-brand-purple-rgb), 0.55);
    padding: 14px;
    svg {
      width: 100%;
      height: 100%;
    }
  }

  &__error-icon {
    width: 92px;
    height: 92px;
    color: var(--color-danger);
    background: rgba(255, 85, 119, 0.08);
    border-radius: 50%;
    display: grid;
    place-items: center;
    border: 1px solid rgba(255, 85, 119, 0.32);
    svg {
      width: 44px;
      height: 44px;
    }
  }

  &__done-name {
    font-family: var(--font-family-display);
    font-size: 20px;
    font-weight: 700;
    margin: 8px 0 0;
  }
  &__done-text {
    margin: 4px 0 0;
    color: var(--color-text-secondary);
    font-size: 14px;
  }
}

.mf-step-enter-active,
.mf-step-leave-active {
  transition:
    opacity 280ms var(--ease-out),
    transform 360ms var(--ease-spring);
}
.mf-step-enter-from {
  opacity: 0;
  transform: translateY(14px) scale(0.98);
}
.mf-step-leave-to {
  opacity: 0;
  transform: translateY(-10px) scale(0.99);
}

.mf-fade-enter-active,
.mf-fade-leave-active {
  transition: opacity 160ms ease;
}
.mf-fade-enter-from,
.mf-fade-leave-to {
  opacity: 0;
}

@keyframes mfPulse {
  0% {
    transform: scale(0.55);
    opacity: 0.65;
  }
  100% {
    transform: scale(1.4);
    opacity: 0;
  }
}
</style>
