<template>
  <form class="creds-form" @submit.prevent="onSubmit">
    <div class="creds-form__grid">
      <div
        v-for="field in schema"
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
    <div class="creds-form__actions">
      <a v-if="docsUrl" class="creds-form__doc" @click.prevent="$emit('open-docs')">
        Где взять данные?
      </a>
      <BaseButton type="submit" variant="primary" size="sm" icon-left="check" :disabled="busy">
        {{ busy ? 'Сохранение…' : 'Сохранить' }}
      </BaseButton>
    </div>
  </form>
</template>

<script setup lang="ts">
import { reactive, watch } from 'vue';
import type { DriverCredentialField } from '@smarthome/shared';
import { BaseButton, BaseInput, BaseSelect, type SelectOption } from '@/components/base';

interface Props {
  schema: readonly DriverCredentialField[];
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

// Локальные значения формы — не мутируем initialValues, чтобы родитель сам решал когда commit'ить.
const values = reactive<Record<string, string>>({});

watch(
  () => props.initialValues,
  (next) => {
    for (const f of props.schema) {
      values[f.key] = next[f.key] ?? f.defaultValue ?? '';
    }
  },
  { immediate: true, deep: true },
);

function onUpdate(key: string, v: string | number): void {
  // BaseSelect emit может быть number; в creds храним только строки.
  values[key] = String(v);
}

function onSubmit(): void {
  emit('submit', { ...values });
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

  &__grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
    gap: 12px;
  }

  &__field--wide {
    grid-column: 1 / -1;
  }

  &__actions {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    flex-wrap: wrap;
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
</style>
