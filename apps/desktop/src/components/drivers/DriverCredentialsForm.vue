<template>
  <form class="creds-form" @submit.prevent="onSubmit">
    <!-- register-link tile сверху формы (если задан): one-click deep-link
         в портал разработчика провайдера (Tuya IoT / Sber Developer / etc). -->
    <template v-for="field in registerLinks" :key="field.key">
      <button type="button" class="creds-form__register" @click="onOpenLink(field.url)">
        <span class="creds-form__register-icon">
          <BaseIcon name="arrow-right" :size="16" />
        </span>
        <span class="creds-form__register-body">
          <span class="creds-form__register-title">{{ field.label }}</span>
          <span v-if="field.hint" class="creds-form__register-hint">{{ field.hint }}</span>
        </span>
        <span class="creds-form__register-arrow">
          <BaseIcon name="arrow-right" :size="14" />
        </span>
      </button>
    </template>

    <!-- OAuth-кнопка (embedded BrowserWindow): для драйверов, у которых password-flow
         не работает из-за 2FA / captcha (Mi Home Cloud и т.п.). -->
    <template v-for="field in oauthFields" :key="field.key">
      <button
        type="button"
        class="creds-form__oauth"
        :disabled="oauthBusy || busy"
        @click="onOauth"
      >
        <span class="creds-form__oauth-icon">
          <BaseIcon :name="oauthBusy ? 'refresh' : 'arrow-right'" :size="16" />
        </span>
        <span class="creds-form__oauth-body">
          <span class="creds-form__oauth-title">
            {{ oauthBusy ? 'Открываю окно входа…' : field.label }}
          </span>
          <span v-if="field.hint" class="creds-form__oauth-hint">{{ field.hint }}</span>
        </span>
      </button>
    </template>

    <div class="creds-form__grid">
      <div
        v-for="field in inputFields"
        :key="field.key"
        class="creds-form__field"
        :class="{
          'creds-form__field--wide': field.kind === 'text' && isLongPlaceholder(field.placeholder),
        }"
      >
        <BaseSelect
          v-if="field.kind === 'select'"
          :model-value="values[field.key] ?? field.defaultValue ?? ''"
          :options="(field.options ?? []) as SelectOption[]"
          :label="field.label"
          size="md"
          @update:model-value="onUpdate(field.key, $event)"
        />
        <BaseInput
          v-else
          :model-value="values[field.key] ?? ''"
          :type="field.kind === 'password' ? 'password' : 'text'"
          :label="field.label"
          :placeholder="field.placeholder"
          :hint="field.hint"
          autocomplete="off"
          @update:model-value="onUpdate(field.key, $event)"
        />
      </div>
    </div>

    <!-- Test result inline-banner: появляется после клика «Проверить». -->
    <Transition name="creds-form-fade">
      <div
        v-if="testResult"
        class="creds-form__test-result"
        :class="`creds-form__test-result--${testResult.ok ? 'ok' : 'fail'}`"
      >
        <BaseIcon :name="testResult.ok ? 'check' : 'close'" :size="14" />
        <span>{{
          testResult.message ?? (testResult.ok ? 'Подключение работает' : 'Не удалось')
        }}</span>
      </div>
    </Transition>

    <div class="creds-form__actions">
      <a v-if="docsUrl" class="creds-form__doc" @click.prevent="$emit('open-docs')">
        Где взять данные?
      </a>
      <div class="creds-form__buttons">
        <BaseButton
          v-if="hasTestButton"
          type="button"
          variant="ghost"
          size="sm"
          :icon-left="testing ? 'refresh' : 'check'"
          :disabled="testing || busy"
          @click="onTest"
        >
          {{ testing ? 'Проверяю…' : 'Проверить' }}
        </BaseButton>
        <BaseButton
          type="submit"
          variant="primary"
          size="sm"
          icon-left="check"
          :disabled="busy || testing"
        >
          {{ busy ? 'Сохранение…' : 'Сохранить' }}
        </BaseButton>
      </div>
    </div>
  </form>
</template>

<script setup lang="ts">
import { computed, reactive, ref, watch } from 'vue';
import type { DriverCredentialField, DriverProbeResult } from '@smarthome/shared';
import { BaseButton, BaseIcon, BaseInput, BaseSelect, type SelectOption } from '@/components/base';

interface Props {
  schema: readonly DriverCredentialField[];
  /** Driver ID — нужен для testCredentials IPC. */
  driverId?: string;
  /** Текущие сохранённые значения. Reactive: внешние изменения отразятся в форме. */
  initialValues: Record<string, string>;
  busy?: boolean;
  docsUrl?: string;
}

const props = defineProps<Props>();
const emit = defineEmits<{
  submit: [values: Record<string, string>];
  'open-docs': [];
}>();

const values = reactive<Record<string, string>>({});

watch(
  () => props.initialValues,
  (next) => {
    for (const f of props.schema) {
      if (f.kind === 'register-link' || f.kind === 'test-button') continue;
      values[f.key] = next[f.key] ?? f.defaultValue ?? '';
    }
  },
  { immediate: true, deep: true },
);

/** Поля для рендера input'ов — без register-link, test-button, oauth. */
const inputFields = computed(() =>
  props.schema.filter(
    (f) => f.kind !== 'register-link' && f.kind !== 'test-button' && f.kind !== 'oauth',
  ),
);

/** Карточки-deep-links сверху формы. */
const registerLinks = computed(() =>
  props.schema.filter(
    (f): f is DriverCredentialField & { url: string } =>
      f.kind === 'register-link' && typeof f.url === 'string',
  ),
);

/** OAuth-кнопки (embedded BrowserWindow auth flow, например Xiaomi 2FA). */
const oauthFields = computed(() =>
  props.schema.filter((f) => f.kind === 'oauth' && Boolean(props.driverId)),
);

const hasTestButton = computed(
  () => props.schema.some((f) => f.kind === 'test-button') && Boolean(props.driverId),
);

const testing = ref(false);
const oauthBusy = ref(false);
const testResult = ref<DriverProbeResult | null>(null);

function onUpdate(key: string, v: string | number): void {
  values[key] = String(v);
  testResult.value = null;
}

function onSubmit(): void {
  emit('submit', { ...values });
}

async function onTest(): Promise<void> {
  if (!props.driverId || testing.value) return;
  testing.value = true;
  testResult.value = null;
  try {
    const result = await window.smarthome.drivers.testCredentials(props.driverId, { ...values });
    testResult.value = result;
  } catch (e) {
    testResult.value = { ok: false, message: (e as Error).message ?? 'Ошибка проверки' };
  } finally {
    testing.value = false;
  }
}

async function onOauth(): Promise<void> {
  if (!props.driverId || oauthBusy.value) return;
  oauthBusy.value = true;
  testResult.value = null;
  try {
    // Пробрасываем неконфиденциальные поля (region и т.п.) — пароль не нужен для embedded flow.
    const params: Record<string, string> = {};
    for (const f of props.schema) {
      if (f.kind === 'select' && values[f.key]) params[f.key] = values[f.key]!;
    }
    const result = await window.smarthome.drivers.signInOauth(props.driverId, params);
    testResult.value = {
      ok: result.ok,
      message: result.ok
        ? 'Вход выполнен. Сессия сохранена, драйвер активирован.'
        : (result.message ?? 'Не удалось войти'),
    };
  } catch (e) {
    testResult.value = { ok: false, message: (e as Error).message ?? 'Ошибка авторизации' };
  } finally {
    oauthBusy.value = false;
  }
}

async function onOpenLink(url: string | undefined): Promise<void> {
  if (!url) return;
  try {
    await window.smarthome.drivers.openExternal(url);
  } catch {
    /* ignore — main process logs */
  }
}

function isLongPlaceholder(p?: string): boolean {
  return !!p && p.length > 28;
}
</script>

<style scoped lang="scss">
.creds-form {
  display: flex;
  flex-direction: column;
  gap: 14px;

  &__register {
    display: grid;
    grid-template-columns: auto minmax(0, 1fr) auto;
    align-items: center;
    gap: 14px;
    padding: 12px 16px;
    border-radius: var(--radius-md);
    background: rgba(var(--color-brand-violet-rgb), 0.08);
    border: 1px solid rgba(var(--color-brand-violet-rgb), 0.28);
    color: var(--color-text-primary);
    text-align: left;
    cursor: pointer;
    font-family: inherit;
    transition:
      background var(--dur-fast) var(--ease-out),
      border-color var(--dur-fast) var(--ease-out),
      transform var(--dur-fast) var(--ease-spring);

    &:hover {
      background: rgba(var(--color-brand-violet-rgb), 0.13);
      border-color: rgba(var(--color-brand-violet-rgb), 0.45);
      transform: translateY(-1px);
    }
  }

  // Primary OAuth-кнопка — акцентнее register-link'а (это РЕКОМЕНДОВАННЫЙ способ
  // войти, а не вспомогательная ссылка на портал разработчика).
  &__oauth {
    display: grid;
    grid-template-columns: auto minmax(0, 1fr);
    align-items: center;
    gap: 14px;
    padding: 14px 18px;
    border-radius: var(--radius-md);
    background: rgba(var(--color-brand-violet-rgb), 0.16);
    border: 1px solid rgba(var(--color-brand-violet-rgb), 0.5);
    color: var(--color-text-primary);
    text-align: left;
    cursor: pointer;
    font-family: inherit;
    transition:
      background var(--dur-fast) var(--ease-out),
      border-color var(--dur-fast) var(--ease-out),
      transform var(--dur-fast) var(--ease-spring);

    &:hover:not(:disabled) {
      background: rgba(var(--color-brand-violet-rgb), 0.24);
      border-color: rgba(var(--color-brand-violet-rgb), 0.7);
      transform: translateY(-1px);
    }

    &:disabled {
      opacity: 0.6;
      cursor: progress;
    }
  }

  &__oauth-icon {
    display: inline-grid;
    place-items: center;
    width: 36px;
    height: 36px;
    border-radius: 10px;
    background: var(--gradient-brand);
    color: #fff;
  }

  &__oauth-body {
    display: flex;
    flex-direction: column;
    gap: 4px;
    min-width: 0;
  }

  &__oauth-title {
    font-size: 14px;
    font-weight: 600;
    color: var(--color-text-primary);
  }

  &__oauth-hint {
    font-size: 12.5px;
    color: var(--color-text-secondary);
    line-height: 1.4;
  }

  &__register-icon {
    display: inline-grid;
    place-items: center;
    width: 32px;
    height: 32px;
    border-radius: 10px;
    background: rgba(var(--color-brand-violet-rgb), 0.18);
    color: var(--color-brand-violet);
  }

  &__register-body {
    display: flex;
    flex-direction: column;
    gap: 2px;
    min-width: 0;
  }

  &__register-title {
    font-size: 13.5px;
    font-weight: 600;
    color: var(--color-text-primary);
  }

  &__register-hint {
    font-size: 12px;
    color: var(--color-text-secondary);
    line-height: 1.4;
  }

  &__register-arrow {
    color: var(--color-brand-violet);
  }

  &__grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
    gap: 12px;
  }

  &__field--wide {
    grid-column: 1 / -1;
  }

  &__test-result {
    display: inline-flex;
    align-items: center;
    gap: 8px;
    padding: 8px 12px;
    border-radius: var(--radius-sm);
    font-size: 12.5px;
    font-weight: 500;
    align-self: flex-start;

    &--ok {
      background: rgba(var(--color-success-rgb), 0.12);
      border: 1px solid rgba(var(--color-success-rgb), 0.32);
      color: var(--color-success);
    }

    &--fail {
      background: rgba(var(--color-danger-rgb), 0.1);
      border: 1px solid rgba(var(--color-danger-rgb), 0.32);
      color: var(--color-danger);
    }
  }

  &__actions {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    flex-wrap: wrap;
  }

  &__buttons {
    display: inline-flex;
    align-items: center;
    gap: 8px;
  }

  &__doc {
    font-size: 12.5px;
    color: var(--color-brand-purple);
    cursor: pointer;
    text-decoration: none;
    border-bottom: 1px dashed currentColor;
    transition: color 160ms var(--ease-out);

    &:hover {
      color: var(--color-brand-pink);
      border-bottom-style: solid;
    }
  }
}

.creds-form-fade-enter-active,
.creds-form-fade-leave-active {
  transition:
    opacity 200ms var(--ease-out),
    transform 200ms var(--ease-out);
}
.creds-form-fade-enter-from,
.creds-form-fade-leave-to {
  opacity: 0;
  transform: translateY(-4px);
}
</style>
