<template>
  <BaseModal
    :model-value="modelValue"
    :title="title"
    size="sm"
    :close-on-backdrop="!busy"
    :closable="!busy"
    @update:model-value="(v) => v || onCancel()"
  >
    <p v-if="message" class="confirm__text">{{ message }}</p>
    <slot />

    <template #footer>
      <BaseButton variant="ghost" :disabled="busy" @click="onCancel">
        {{ cancelLabel }}
      </BaseButton>
      <BaseButton
        :variant="tone === 'danger' ? 'danger' : 'primary'"
        :icon-left="confirmIcon"
        :loading="busy"
        @click="onConfirm"
      >
        {{ confirmLabel }}
      </BaseButton>
    </template>
  </BaseModal>
</template>

<script setup lang="ts">
/**
 * ConfirmDialog
 *
 * Stateless confirm-обёртка над BaseModal. Поддерживает primary/danger tone'ы,
 * loading-state от parent'а (для async-операций) и icon на confirm-кнопке.
 *
 * Parent контролирует видимость через v-model, busy-state — через `loading` prop.
 *
 * @example
 * <ConfirmDialog
 *   v-model="open"
 *   title="Удалить устройство?"
 *   confirm-label="Удалить"
 *   confirm-icon="trash"
 *   tone="danger"
 *   :loading="removing"
 *   @confirm="performRemove"
 * />
 */

import { computed } from 'vue';
import BaseModal from './BaseModal.vue';
import BaseButton from './BaseButton.vue';
import type { IconName } from './BaseIcon.vue';

interface Props {
  /** v-model: открыт ли диалог. */
  modelValue: boolean;
  /** Заголовок диалога. */
  title: string;
  /** Текст в body (опционально, можно передать через slot). */
  message?: string;
  /** Подпись confirm-кнопки. */
  confirmLabel?: string;
  /** Подпись cancel-кнопки. */
  cancelLabel?: string;
  /** Иконка слева на confirm-кнопке. */
  confirmIcon?: IconName;
  /** Brand-tone для confirm-кнопки. */
  tone?: 'danger' | 'primary';
  /** Busy-state от parent'а для async @confirm-handler'а. */
  loading?: boolean;
}

const props = withDefaults(defineProps<Props>(), {
  confirmLabel: 'Подтвердить',
  cancelLabel: 'Отмена',
  tone: 'primary',
  loading: false,
});

const emit = defineEmits<{
  'update:modelValue': [value: boolean];
  confirm: [];
  cancel: [];
}>();

const busy = computed(() => props.loading);

/** Эмитит `confirm`. Parent отвечает за async-обработку и закрытие модалки. */
function onConfirm(): void {
  if (busy.value) return;
  emit('confirm');
}

/** Эмитит `cancel` и закрывает модалку. */
function onCancel(): void {
  if (busy.value) return;
  emit('cancel');
  emit('update:modelValue', false);
}
</script>

<style scoped lang="scss">
.confirm__text {
  margin: 0;
  font-size: 14.5px;
  line-height: 1.55;
  color: var(--color-text-secondary);
}
</style>
