<template>
  <BaseModal
    :model-value="open"
    :title="title"
    :kicker="kicker"
    :size="size"
    :closable="closable"
    :close-on-backdrop="dismissOnBackdrop"
    :close-on-esc="dismissOnEsc"
    @close="emit('close')"
    @update:model-value="onUpdate"
  >
    <template v-if="$slots.title" #header>
      <slot name="title" />
    </template>
    <slot />
    <template v-if="$slots.footer" #footer>
      <slot name="footer" />
    </template>
  </BaseModal>
</template>

<script setup lang="ts">
/**
 * Legacy alias к base/BaseModal с открытым `:open` API. Сохранён для PairDeviceFlow / ManualDeviceFlow.
 * Новые модалки — напрямую через base/BaseModal с v-model.
 */

import BaseModal from '@/components/base/BaseModal.vue';

interface Props {
  open: boolean;
  title?: string;
  kicker?: string;
  size?: 'sm' | 'md' | 'lg' | 'xl';
  closable?: boolean;
  dismissOnBackdrop?: boolean;
  dismissOnEsc?: boolean;
}

withDefaults(defineProps<Props>(), {
  title: '',
  kicker: '',
  size: 'md',
  closable: true,
  dismissOnBackdrop: true,
  dismissOnEsc: true,
});

const emit = defineEmits<{ close: [] }>();

function onUpdate(v: boolean): void {
  if (!v) emit('close');
}
</script>
