<template>
  <div
    ref="root"
    class="select"
    :class="[`select--${size}`, { 'is-open': isOpen, 'is-disabled': disabled }]"
  >
    <span v-if="label" class="select__label">{{ label }}</span>

    <button
      ref="triggerEl"
      type="button"
      class="select__trigger"
      :disabled="disabled"
      :aria-expanded="isOpen"
      aria-haspopup="listbox"
      @click="toggle"
      @keydown="onKeydown"
    >
      <span class="select__value" :class="{ 'select__value--placeholder': !selectedOption }">
        {{ selectedOption?.label ?? placeholder ?? '—' }}
      </span>
      <span class="select__chevron" :class="{ 'is-flipped': isOpen }" aria-hidden="true">
        <svg viewBox="0 0 16 16" width="14" height="14" fill="none">
          <path
            d="M4 6l4 4 4-4"
            stroke="currentColor"
            stroke-width="1.6"
            stroke-linecap="round"
            stroke-linejoin="round"
          />
        </svg>
      </span>
    </button>

    <Teleport to="body">
      <Transition name="select-pop">
        <ul
          v-if="isOpen"
          ref="popupEl"
          class="select-popup"
          role="listbox"
          tabindex="-1"
          :style="popupStyle"
          @keydown.stop="onKeydown"
        >
          <li
            v-for="(opt, idx) in options"
            :key="String(opt.value)"
            class="select-popup__item"
            :class="{
              'is-selected': opt.value === modelValue,
              'is-active': idx === activeIndex,
              'is-disabled': opt.disabled,
            }"
            role="option"
            :aria-selected="opt.value === modelValue"
            :aria-disabled="opt.disabled"
            @mouseenter="activeIndex = idx"
            @click="onSelect(opt)"
          >
            <span class="select-popup__label">{{ opt.label }}</span>
            <span v-if="opt.value === modelValue" class="select-popup__check" aria-hidden="true">
              <svg viewBox="0 0 16 16" width="14" height="14" fill="none">
                <path
                  d="M3 8.5l3.5 3.5L13 5"
                  stroke="currentColor"
                  stroke-width="2"
                  stroke-linecap="round"
                  stroke-linejoin="round"
                />
              </svg>
            </span>
          </li>
        </ul>
      </Transition>
    </Teleport>

    <span v-if="hint" class="select__hint">{{ hint }}</span>
  </div>
</template>

<script setup lang="ts">

import { computed, nextTick, onBeforeUnmount, ref, useTemplateRef, watch } from 'vue';

export interface SelectOption {
  value: string | number;
  label: string;
  disabled?: boolean;
}

const props = withDefaults(
  defineProps<{
    modelValue: string | number | null | undefined;
    options: SelectOption[];
    label?: string;
    placeholder?: string;
    hint?: string;
    size?: 'sm' | 'md' | 'lg';
    disabled?: boolean;
  }>(),
  { size: 'md', disabled: false },
);

const emit = defineEmits<{
  'update:modelValue': [value: string | number];
  change: [value: string | number];
}>();

const root = useTemplateRef<HTMLElement>('root');
const triggerEl = useTemplateRef<HTMLButtonElement>('triggerEl');
const popupEl = useTemplateRef<HTMLUListElement>('popupEl');

const isOpen = ref(false);
const activeIndex = ref(-1);
const popupStyle = ref<Record<string, string>>({});

const selectedOption = computed<SelectOption | undefined>(() =>
  props.options.find((o) => o.value === props.modelValue),
);

// ---- Open / Close ----------------------------------------------------------

async function open(): Promise<void> {
  if (props.disabled || isOpen.value) return;
  isOpen.value = true;
  // active = текущий выбранный либо первый non-disabled.
  const idx = props.options.findIndex((o) => o.value === props.modelValue);
  activeIndex.value = idx >= 0 ? idx : nextActive(-1, 1);
  await nextTick();
  positionPopup();
  popupEl.value?.focus();
  // Click-outside listener — только пока open.
  setTimeout(() => document.addEventListener('mousedown', onClickOutside), 0);
}

function close(): void {
  if (!isOpen.value) return;
  isOpen.value = false;
  activeIndex.value = -1;
  document.removeEventListener('mousedown', onClickOutside);
  triggerEl.value?.focus();
}

function toggle(): void {
  isOpen.value ? close() : void open();
}

// ---- Smart positioning ----------------------------------------------------

function positionPopup(): void {
  if (!triggerEl.value) return;
  const rect = triggerEl.value.getBoundingClientRect();
  const vh = window.innerHeight;
  const popupH = popupEl.value?.offsetHeight ?? 240;
  const GAP = 6;

  // По умолчанию вниз; если не влезает — вверх.
  const spaceBelow = vh - rect.bottom;
  const spaceAbove = rect.top;
  const openUp = spaceBelow < popupH + GAP && spaceAbove > spaceBelow;

  popupStyle.value = {
    position: 'fixed',
    left: `${rect.left}px`,
    width: `${rect.width}px`,
    ...(openUp ? { bottom: `${vh - rect.top + GAP}px` } : { top: `${rect.bottom + GAP}px` }),
    'max-height': `${Math.min(280, openUp ? spaceAbove - 16 : spaceBelow - 16)}px`,
  };
}

function onClickOutside(e: MouseEvent): void {
  const target = e.target as Node | null;
  if (!target) return;
  if (triggerEl.value?.contains(target)) return;
  if (popupEl.value?.contains(target)) return;
  close();
}

function onResize(): void {
  if (isOpen.value) positionPopup();
}

// ---- Keyboard navigation --------------------------------------------------

function onKeydown(e: KeyboardEvent): void {
  if (props.disabled) return;
  if (!isOpen.value) {
    if (e.key === 'Enter' || e.key === ' ' || e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      void open();
    }
    return;
  }
  switch (e.key) {
    case 'Escape':
      e.preventDefault();
      close();
      break;
    case 'Enter':
    case ' ': {
      e.preventDefault();
      const opt = props.options[activeIndex.value];
      if (opt && !opt.disabled) onSelect(opt);
      break;
    }
    case 'ArrowDown':
      e.preventDefault();
      activeIndex.value = nextActive(activeIndex.value, 1);
      scrollActiveIntoView();
      break;
    case 'ArrowUp':
      e.preventDefault();
      activeIndex.value = nextActive(activeIndex.value, -1);
      scrollActiveIntoView();
      break;
    case 'Home':
      e.preventDefault();
      activeIndex.value = nextActive(-1, 1);
      scrollActiveIntoView();
      break;
    case 'End':
      e.preventDefault();
      activeIndex.value = nextActive(props.options.length, -1);
      scrollActiveIntoView();
      break;
  }
}

function nextActive(from: number, step: 1 | -1): number {
  const opts = props.options;
  if (!opts.length) return -1;
  let i = from;
  for (let n = 0; n < opts.length; n++) {
    i = (i + step + opts.length) % opts.length;
    if (!opts[i]?.disabled) return i;
  }
  return from;
}

function scrollActiveIntoView(): void {
  const list = popupEl.value;
  if (!list) return;
  const el = list.children[activeIndex.value] as HTMLElement | undefined;
  el?.scrollIntoView({ block: 'nearest' });
}

// ---- Select ---------------------------------------------------------------

function onSelect(opt: SelectOption): void {
  if (opt.disabled) return;
  emit('update:modelValue', opt.value);
  emit('change', opt.value);
  close();
}

// ---- Lifecycle ------------------------------------------------------------

watch(isOpen, (v) => {
  if (v) {
    window.addEventListener('resize', onResize);
    window.addEventListener('scroll', onResize, true);
  } else {
    window.removeEventListener('resize', onResize);
    window.removeEventListener('scroll', onResize, true);
  }
});

onBeforeUnmount(() => {
  document.removeEventListener('mousedown', onClickOutside);
  window.removeEventListener('resize', onResize);
  window.removeEventListener('scroll', onResize, true);
});

void root;
</script>

<style scoped lang="scss">
.select {
  display: flex;
  flex-direction: column;
  gap: 6px;
  font-size: 13px;
  position: relative;
  min-width: 0;

  &__label {
    font-size: 12px;
    color: var(--color-text-secondary);
  }

  &__trigger {
    width: 100%;
    height: 40px;
    padding: 0 14px;
    border-radius: var(--radius-md);
    border: 1px solid var(--color-border-soft);
    background: rgba(255, 255, 255, 0.04);
    color: var(--color-text-primary);
    font-family: inherit;
    font-size: 14px;
    text-align: left;
    cursor: pointer;
    display: inline-flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
    transition:
      border-color 200ms var(--ease-out),
      background 200ms var(--ease-out),
      box-shadow 220ms var(--ease-out);

    &:hover:not(:disabled) {
      background: rgba(255, 255, 255, 0.06);
      border-color: var(--color-border-strong);
    }
    &:focus-visible {
      outline: none;
      border-color: rgba(var(--color-brand-purple-rgb), 0.6);
      box-shadow: 0 0 0 3px rgba(var(--color-brand-violet-rgb), 0.18);
    }
    &:disabled {
      opacity: 0.5;
      cursor: not-allowed;
    }
  }

  &.is-open .select__trigger {
    border-color: rgba(var(--color-brand-purple-rgb), 0.55);
    background: rgba(255, 255, 255, 0.06);
    box-shadow: 0 0 0 3px rgba(var(--color-brand-violet-rgb), 0.18);
  }

  &__value {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    line-height: 1;

    &--placeholder {
      color: var(--color-text-muted);
    }
  }

  &__chevron {
    flex-shrink: 0;
    color: var(--color-text-muted);
    display: inline-flex;
    transition: transform 280ms cubic-bezier(0.34, 1.56, 0.64, 1);

    &.is-flipped {
      transform: rotate(180deg);
    }
  }

  &__hint {
    font-size: 12px;
    color: var(--color-text-muted);
  }

  &--sm .select__trigger {
    height: 32px;
    padding: 0 12px;
    font-size: 13px;
  }
  &--lg .select__trigger {
    height: 48px;
    padding: 0 16px;
    font-size: 15px;
  }
}
</style>

<style lang="scss">
// Popup НЕ scoped: Teleport в <body> не пробрасывает scoped-классы.
// Уникальные имена .select-popup* + .select-pop-.

.select-popup {
  position: fixed;
  z-index: var(--z-popover);
  margin: 0;
  padding: 6px;
  list-style: none;
  border-radius: 12px;
  border: 1px solid rgba(255, 255, 255, 0.1);
  background: rgba(var(--color-bg-elevated-rgb), 0.96);
  backdrop-filter: blur(28px) saturate(150%);
  -webkit-backdrop-filter: blur(28px) saturate(150%);
  box-shadow:
    0 24px 56px rgba(0, 0, 0, 0.55),
    inset 0 0 0 1px rgba(255, 255, 255, 0.04);
  overflow-y: auto;
  outline: none;

  &::-webkit-scrollbar {
    width: 6px;
  }
  &::-webkit-scrollbar-thumb {
    background: rgba(255, 255, 255, 0.1);
    border-radius: 6px;
  }

  &__item {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
    padding: 9px 12px;
    border-radius: 8px;
    color: var(--color-text-primary);
    font-size: 14px;
    line-height: 1.2;
    cursor: pointer;
    transition:
      background 140ms cubic-bezier(0.22, 1, 0.36, 1),
      color 140ms ease;

    &.is-active:not(.is-disabled) {
      background: rgba(255, 255, 255, 0.06);
    }
    &.is-selected {
      color: var(--color-brand-purple);
      background: rgba(var(--color-brand-purple-rgb), 0.12);
    }
    &.is-disabled {
      opacity: 0.4;
      cursor: not-allowed;
    }
  }

  &__label {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  &__check {
    flex-shrink: 0;
    color: var(--color-brand-purple);
    display: inline-flex;
  }
}

// Popup transitions — также не scoped (Teleport).
.select-pop-enter-active,
.select-pop-leave-active {
  transition:
    opacity 200ms cubic-bezier(0.22, 1, 0.36, 1),
    transform 240ms cubic-bezier(0.22, 1, 0.36, 1);
}
.select-pop-enter-from {
  opacity: 0;
  transform: translateY(-6px) scale(0.97);
}
.select-pop-leave-to {
  opacity: 0;
  transform: translateY(-4px) scale(0.98);
}

// ---- Mobile: popup как bottom-sheet ----
// На узких экранах смарт-позиционирование от trigger'а даёт «карман» <100px шириной;
// перебиваем inline-стили (left/width/top/bottom/max-height) и прижимаем к низу.
@media (max-width: 720px) {
  .select-popup {
    left: 0 !important;
    right: 0 !important;
    top: auto !important;
    bottom: 0 !important;
    width: 100% !important;
    max-height: 60vh !important;
    border-radius: var(--radius-xl) var(--radius-xl) 0 0;
    padding: 8px 0;
    padding-bottom: max(8px, env(safe-area-inset-bottom));
    box-shadow: 0 -16px 48px rgba(0, 0, 0, 0.55);

    &__item {
      padding: 14px 18px;
      font-size: 15px;
    }
  }

  .select-pop-enter-from,
  .select-pop-leave-to {
    transform: translateY(100%) scale(1);
  }
}
</style>
