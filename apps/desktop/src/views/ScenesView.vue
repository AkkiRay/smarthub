<template>
  <section class="scenes" ref="root">
    <BasePageHeader
      eyebrow="Автоматизации"
      title="Сценарии"
      description="Объединяйте действия нескольких устройств в один тап. Сценарии с опцией «Доступно через Алису» можно запустить голосом."
    >
      <template #actions>
        <BaseButton variant="primary" icon-left="plus" @click="openCreate">
          Новый сценарий
        </BaseButton>
      </template>
    </BasePageHeader>

    <div v-if="scenes.scenes.length" class="scenes__grid bento-grid">
      <article
        v-for="s in scenes.scenes"
        :key="s.id"
        class="card card--interactive scene"
        :style="{ '--accent': s.accent }"
      >
        <div class="scene__head">
          <span class="scene__icon" v-safe-html="s.icon" />
          <BaseButton
            variant="ghost"
            size="icon-sm"
            icon-left="edit"
            aria-label="Редактировать"
            @click.stop="openEdit(s)"
          />
        </div>
        <h3 class="scene__name">{{ s.name }}</h3>
        <p class="text--small scene__meta">
          {{ s.actions.length }}
          {{ pluralize(s.actions.length, ['действие', 'действия', 'действий']) }}
        </p>
        <div class="scene__chips">
          <span v-if="s.exposeToStation" class="scene__chip">
            <BaseIcon name="alice" :size="12" />
            Алиса
          </span>
        </div>
        <div class="scene__actions">
          <BaseButton
            variant="primary"
            size="sm"
            icon-left="arrow-right"
            :disabled="!s.actions.length"
            @click.stop="run(s.id)"
          >
            Запустить
          </BaseButton>
          <BaseButton
            variant="danger"
            size="icon-sm"
            icon-left="trash"
            aria-label="Удалить"
            @click.stop="remove(s.id, s.name)"
          />
        </div>
      </article>

      <button class="card scene__create" @click="openCreate">
        <BaseIcon name="plus" :size="32" />
        <span class="text--body">Создать сценарий</span>
      </button>
    </div>

    <BaseEmpty
      v-else
      title="Сценарии не созданы"
      text="Создайте «Доброе утро», «Кино», «Сон» — и запускайте всё одним тапом."
    >
      <template #glyph>
        <BaseIcon name="scenes" :size="64" />
      </template>
      <template #actions>
        <BaseButton variant="primary" icon-left="plus" @click="openCreate">
          Создать первый сценарий
        </BaseButton>
      </template>
    </BaseEmpty>

    <!-- ===================== Сценарии Алисы ===================== -->
    <section v-if="alicesScenarios.length" class="scenes__alice">
      <header class="scenes__alice-head">
        <h3 class="scenes__alice-title">Сценарии Алисы</h3>
        <p class="text--small scenes__alice-sub">
          Импорт из «Дома с Алисой». Запускайте, переименовывайте, включайте/выключайте.
        </p>
      </header>
      <div class="scenes__alice-grid">
        <article
          v-for="s in alicesScenarios"
          :key="s.id"
          class="card scene scene--alice"
          :class="{
            'is-running': runningId === s.id,
            'is-inactive': s.isActive === false,
          }"
        >
          <header class="scene__head">
            <span class="scene__icon scene__icon--alice">
              <BaseIcon :name="iconForScenario(s)" :size="22" />
            </span>
            <BaseButton
              v-if="s.isActive !== undefined"
              variant="ghost"
              size="icon-sm"
              :icon-left="s.isActive ? 'check' : 'close'"
              :aria-label="s.isActive ? 'Выключить сценарий' : 'Включить сценарий'"
              :title="s.isActive ? 'Активен — нажмите чтобы отключить' : 'Отключён — нажмите чтобы включить'"
              :loading="togglingId === s.id"
              @click.stop="toggleActive(s)"
            />
          </header>

          <h3 class="scene__name">{{ s.name }}</h3>

          <p class="scene__meta text--small">
            <span v-if="s.triggers.length" class="scene__trigger">
              <BaseIcon :name="iconForTrigger(s.triggers[0]!.type)" :size="11" />
              {{ s.triggers[0]!.summary }}
              <span v-if="s.triggers.length > 1" class="scene__trigger-more">+{{ s.triggers.length - 1 }}</span>
            </span>
            <span v-else class="scene__trigger scene__trigger--manual">
              <BaseIcon name="arrow-right" :size="11" />
              Только запуск вручную
            </span>
          </p>

          <p v-if="s.stepCount || s.devices.length" class="scene__meta-secondary text--small">
            <span v-if="s.stepCount > 0">
              {{ s.stepCount }} {{ pluralizeStep(s.stepCount) }}
            </span>
            <span v-if="s.devices.length > 0">
              · {{ s.devices.length }} {{ pluralizeDevice(s.devices.length) }}
            </span>
          </p>

          <div class="scene__actions">
            <BaseButton
              variant="primary"
              size="sm"
              icon-left="arrow-right"
              :loading="runningId === s.id"
              :disabled="runningId !== null && runningId !== s.id"
              @click.stop="runYandexScenario(s.id, s.name)"
            >
              Запустить
            </BaseButton>
            <BaseButton
              variant="ghost"
              size="icon-sm"
              icon-left="edit"
              aria-label="Переименовать"
              @click.stop="openYandexEditor(s.id)"
            />
            <BaseButton
              variant="danger"
              size="icon-sm"
              icon-left="trash"
              aria-label="Удалить"
              @click.stop="confirmYandexDelete(s.id, s.name)"
            />
          </div>
        </article>
      </div>
    </section>

    <!-- ===================== Edit modal ===================== -->
    <BaseModal
      :model-value="yandexEditor.open"
      :title="yandexEditor.draft?.name ? `«${yandexEditor.draft.name}»` : 'Сценарий Алисы'"
      size="lg"
      @update:model-value="(v) => v || closeYandexEditor()"
    >
      <div v-if="yandexEditor.loading" class="scenes__editor-loading">
        <BaseIcon name="refresh" :size="20" spin />
        Загрузка деталей…
      </div>
      <div v-else-if="yandexEditor.draft" class="scenes__editor">
        <BaseInput v-model="yandexEditor.draft.name" label="Название" placeholder="Доброе утро" />

        <section v-if="yandexEditor.draft.triggers.length" class="scenes__editor-section">
          <h4>Триггеры</h4>
          <ul class="scenes__editor-triggers">
            <li v-for="(t, i) in yandexEditor.draft.triggers" :key="i" :data-type="t.type">
              <BaseIcon :name="iconForTrigger(t.type)" :size="12" />
              <span>{{ t.summary }}</span>
              <span class="scenes__editor-trigger-type">{{ labelForTriggerType(t.type) }}</span>
            </li>
          </ul>
        </section>

        <section v-if="yandexEditor.draft.devices.length" class="scenes__editor-section">
          <h4>Затронутые устройства</h4>
          <p class="text--small">
            {{ yandexEditor.draft.devices.length }}
            {{ pluralizeDevice(yandexEditor.draft.devices.length) }} —
            редактирование шагов скоро появится. Пока меняйте конфигурацию в приложении Алисы.
          </p>
        </section>

        <section v-if="yandexEditor.draft.stepCount > 0" class="scenes__editor-section">
          <h4>Шаги</h4>
          <p class="text--small">{{ yandexEditor.draft.stepCount }} {{ pluralizeStep(yandexEditor.draft.stepCount) }}</p>
        </section>
      </div>
      <p v-else class="text--small">Не удалось загрузить сценарий.</p>

      <template #footer>
        <BaseButton variant="ghost" @click="closeYandexEditor">Отмена</BaseButton>
        <BaseButton
          variant="primary"
          icon-left="check"
          :disabled="!canSaveYandex"
          :loading="yandexEditor.saving"
          @click="saveYandexEditor"
        >
          Сохранить название
        </BaseButton>
      </template>
    </BaseModal>

    <ConfirmDialog
      v-model="yandexRemoveTarget.open"
      title="Удалить сценарий Алисы?"
      :message="`Сценарий «${yandexRemoveTarget.name}» будет удалён из вашего «Дома с Алисой».`"
      confirm-label="Удалить"
      confirm-icon="trash"
      tone="danger"
      @confirm="performYandexDelete"
    />

    <SceneEditor
      v-if="editor.open"
      :mode="editor.mode"
      :initial="editor.initial"
      @save="onSave"
      @cancel="closeEditor"
    />

    <ConfirmDialog
      v-model="removeTarget.open"
      title="Удалить сценарий?"
      :message="`Сценарий «${removeTarget.name}» будет удалён. Устройства останутся как есть.`"
      confirm-label="Удалить"
      confirm-icon="trash"
      tone="danger"
      @confirm="performRemove"
    />
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, reactive, ref, useTemplateRef } from 'vue';
import type {
  Scene,
  YandexHomeScenario,
  YandexHomeScenarioDetails,
  YandexHomeTriggerType,
} from '@smarthome/shared';
import { useScenesStore } from '@/stores/scenes';
import { useDevicesStore } from '@/stores/devices';
import { useYandexStationStore } from '@/stores/yandexStation';
import { useToasterStore } from '@/stores/toaster';
import { useViewMount } from '@/composables/useViewMount';
import SceneEditor from '@/components/scenes/SceneEditor.vue';
import {
  BaseButton,
  BaseIcon,
  BaseInput,
  BaseModal,
  BasePageHeader,
  BaseEmpty,
  ConfirmDialog,
  type IconName,
} from '@/components/base';

const scenes = useScenesStore();
const devices = useDevicesStore();
const station = useYandexStationStore();
const toaster = useToasterStore();
const root = useTemplateRef<HTMLElement>('root');

// Используем homeFiltered, не home: при нескольких household'ах home содержит
// сценарии всех домов, кнопка «Запустить» из одного household'а на сценарий
// другого вернёт 404 от quasar.
const alicesScenarios = computed(() => station.homeFiltered?.scenarios ?? []);
const runningId = ref<string | null>(null);
const togglingId = ref<string | null>(null);

async function runYandexScenario(id: string, name: string): Promise<void> {
  if (runningId.value) return;
  runningId.value = id;
  try {
    const r = await window.smarthome.yandexStation.runHomeScenario(id);
    if (r.ok) {
      toaster.push({ kind: 'success', message: `Сценарий «${name}» запущен` });
    } else {
      toaster.push({ kind: 'error', message: r.error ?? `Не удалось запустить «${name}»` });
    }
  } catch (e) {
    toaster.push({ kind: 'error', message: (e as Error).message });
  } finally {
    runningId.value = null;
  }
}

async function toggleActive(s: YandexHomeScenario): Promise<void> {
  if (togglingId.value || s.isActive === undefined) return;
  togglingId.value = s.id;
  const next = !s.isActive;
  try {
    const r = await window.smarthome.yandexStation.setHomeScenarioActive(s.id, next);
    if (r.ok) {
      toaster.push({
        kind: 'success',
        message: next ? `«${s.name}» включён` : `«${s.name}» отключён`,
      });
      void station.fetchHome();
    } else {
      toaster.push({ kind: 'error', message: r.error ?? 'Не удалось изменить состояние' });
    }
  } catch (e) {
    toaster.push({ kind: 'error', message: (e as Error).message });
  } finally {
    togglingId.value = null;
  }
}

// ---- Yandex scenario editor ------------------------------------------------

interface YandexEditorState {
  open: boolean;
  loading: boolean;
  saving: boolean;
  scenarioId: string | null;
  draft: YandexHomeScenarioDetails | null;
}

const yandexEditor = reactive<YandexEditorState>({
  open: false,
  loading: false,
  saving: false,
  scenarioId: null,
  draft: null,
});

async function openYandexEditor(id: string): Promise<void> {
  yandexEditor.open = true;
  yandexEditor.loading = true;
  yandexEditor.scenarioId = id;
  yandexEditor.draft = null;
  try {
    const details = await window.smarthome.yandexStation.fetchScenarioDetails(id);
    yandexEditor.draft = details;
  } catch (e) {
    toaster.push({ kind: 'error', message: (e as Error).message });
  } finally {
    yandexEditor.loading = false;
  }
}

function closeYandexEditor(): void {
  yandexEditor.open = false;
  yandexEditor.scenarioId = null;
  yandexEditor.draft = null;
  yandexEditor.saving = false;
}

const canSaveYandex = computed(() => {
  const d = yandexEditor.draft;
  if (!d || yandexEditor.saving) return false;
  return d.name.trim().length > 0;
});

async function saveYandexEditor(): Promise<void> {
  const d = yandexEditor.draft;
  const id = yandexEditor.scenarioId;
  if (!d || !id) return;
  const name = d.name.trim();
  if (!name) return;
  yandexEditor.saving = true;
  try {
    const r = await window.smarthome.yandexStation.renameHomeScenario(id, name);
    if (r.ok) {
      toaster.push({ kind: 'success', message: `Сценарий переименован в «${name}»` });
      void station.fetchHome();
      closeYandexEditor();
    } else {
      toaster.push({ kind: 'error', message: r.error ?? 'Не удалось сохранить' });
    }
  } catch (e) {
    toaster.push({ kind: 'error', message: (e as Error).message });
  } finally {
    yandexEditor.saving = false;
  }
}

// ---- Yandex scenario delete ------------------------------------------------

const yandexRemoveTarget = reactive<{ open: boolean; id: string; name: string }>({
  open: false,
  id: '',
  name: '',
});

function confirmYandexDelete(id: string, name: string): void {
  yandexRemoveTarget.id = id;
  yandexRemoveTarget.name = name;
  yandexRemoveTarget.open = true;
}

async function performYandexDelete(): Promise<void> {
  const { id, name } = yandexRemoveTarget;
  yandexRemoveTarget.open = false;
  try {
    const r = await window.smarthome.yandexStation.deleteHomeScenario(id);
    if (r.ok) {
      toaster.push({ kind: 'info', message: `Сценарий «${name}» удалён` });
      void station.fetchHome();
    } else {
      toaster.push({ kind: 'error', message: r.error ?? 'Не удалось удалить' });
    }
  } catch (e) {
    toaster.push({ kind: 'error', message: (e as Error).message });
  }
}

// ---- Display helpers --------------------------------------------------------

function iconForScenario(s: YandexHomeScenario): IconName {
  // У Yandex иконки кодируются как `alice.dot.scenario.<slug>`.
  const slug = (s.icon ?? '').toLowerCase();
  if (slug.includes('morning') || slug.includes('day')) return 'check';
  if (slug.includes('night') || slug.includes('sleep')) return 'scene-sleep';
  if (slug.includes('movie') || slug.includes('cinema')) return 'scene-movie';
  if (slug.includes('light')) return 'light';
  if (slug.includes('off')) return 'scene-all-off';
  if (slug.includes('on')) return 'scene-all-on';
  return 'scenes';
}

function iconForTrigger(t: YandexHomeTriggerType): IconName {
  switch (t) {
    case 'voice':
      return 'alice';
    case 'timetable':
      return 'sensor';
    case 'property':
      return 'thermostat';
    case 'button':
      return 'switch';
    default:
      return 'scenes';
  }
}

function labelForTriggerType(t: YandexHomeTriggerType): string {
  switch (t) {
    case 'voice':
      return 'голос';
    case 'timetable':
      return 'расписание';
    case 'property':
      return 'свойство';
    case 'button':
      return 'кнопка';
    default:
      return 'другое';
  }
}

function pluralizeStep(n: number): string {
  return pluralize(n, ['шаг', 'шага', 'шагов']);
}
function pluralizeDevice(n: number): string {
  return pluralize(n, ['устройство', 'устройства', 'устройств']);
}

const editor = reactive<{
  open: boolean;
  mode: 'create' | 'edit';
  initial: Scene | undefined;
}>({
  open: false,
  mode: 'create',
  initial: undefined,
});

function openCreate(): void {
  editor.mode = 'create';
  editor.initial = undefined;
  editor.open = true;
}

function openEdit(scene: Scene): void {
  editor.mode = 'edit';
  editor.initial = scene;
  editor.open = true;
}

function closeEditor(): void {
  editor.open = false;
}

async function onSave(draft: Omit<Scene, 'id' | 'createdAt' | 'updatedAt'>): Promise<void> {
  if (editor.mode === 'edit' && editor.initial) {
    await scenes.update(editor.initial.id, draft);
    toaster.push({ kind: 'success', message: `Сценарий «${draft.name}» обновлён` });
  } else {
    await scenes.create(draft);
    toaster.push({ kind: 'success', message: `Сценарий «${draft.name}» создан` });
  }
  closeEditor();
}

async function run(id: string): Promise<void> {
  await scenes.run(id);
}

const removeTarget = reactive<{ open: boolean; id: string; name: string }>({
  open: false,
  id: '',
  name: '',
});

function remove(id: string, name: string): void {
  removeTarget.id = id;
  removeTarget.name = name;
  removeTarget.open = true;
}

async function performRemove(): Promise<void> {
  const { id, name } = removeTarget;
  await scenes.remove(id);
  removeTarget.open = false;
  toaster.push({ kind: 'info', message: `Сценарий «${name}» удалён` });
}

function pluralize(n: number, forms: [string, string, string]): string {
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod100 >= 11 && mod100 <= 19) return forms[2];
  if (mod10 === 1) return forms[0];
  if (mod10 >= 2 && mod10 <= 4) return forms[1];
  return forms[2];
}

onMounted(async () => {
  await Promise.all([
    !scenes.scenes.length ? scenes.bootstrap() : Promise.resolve(),
    !devices.devices.length ? devices.bootstrap() : Promise.resolve(),
  ]);
  // Подтягиваем snapshot «Дома с Алисой» — нужен для блока «Сценарии Алисы».
  if (!station.home && !station.isLoadingHome) {
    try {
      const auth = await window.smarthome.yandexStation.getAuthStatus();
      if (auth.authorized) void station.fetchHome().catch(() => null);
    } catch {
      /* не залогинен — пропускаем */
    }
  }
});

useViewMount({ scope: root, itemsSelector: '.scenes__grid > .scene' });
</script>

<style scoped lang="scss">
@use '@/styles/abstracts/mixins' as *;

.scenes {
  display: flex;
  flex-direction: column;
  gap: var(--content-gap);
  width: 100%;
  align-self: start;

  &__grid {
    --bento-tile-min: 220px;

    @media (max-width: 720px) {
      --bento-tile-min: 100%;
    }
  }

  // Mobile: всё стэкается, padding'и сжаты, alice-секция тоже single-column.
  @media (max-width: 720px) {
    gap: 12px;

    &__alice {
      padding-top: 12px;
    }
    &__alice-title {
      font-size: var(--font-size-h2);
    }
  }

  // ---- Yandex scenarios block ------------------------------------------
  &__alice {
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
    padding-top: var(--content-gap);
    border-top: var(--border-thin) solid var(--color-border-subtle);
  }
  &__alice-head {
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
  }
  &__alice-title {
    font-family: var(--font-family-display);
    font-size: var(--font-size-h1);
    font-weight: 600;
    margin: 0;
    color: var(--color-text-primary);
  }
  &__alice-sub {
    margin: 0;
    color: var(--color-text-muted);
  }
  &__alice-grid {
    @include auto-grid(220px, var(--space-3));
  }
}

.scene--alice {
  --accent: #ffcc00;
  display: flex;
  flex-direction: column;
  gap: 8px;
  position: relative;
  overflow: hidden;
  text-align: left;
  // Защита от mount-animation residue: yandex-сценарии появляются ПОСЛЕ async-fetchHome,
  // могут попасть в GSAP-from'у пустого набора и унаследовать stale inline opacity:0.
  // Явный opacity:1 + важность через `.is-inactive` ниже фиксирует ожидаемое значение.
  opacity: 1;
  transition:
    transform 200ms var(--ease-out),
    border-color 200ms var(--ease-out),
    opacity 200ms var(--ease-out);

  &::after {
    content: '';
    position: absolute;
    inset: -1px auto auto -1px;
    width: 140px;
    height: 140px;
    border-radius: 50%;
    background: radial-gradient(circle, rgba(255, 204, 0, 0.5), transparent 65%);
    opacity: 0.32;
    filter: blur(20px);
    pointer-events: none;
  }

  &:hover {
    transform: translateY(-2px);
    border-color: rgba(255, 204, 0, 0.4);
  }
  &.is-running {
    border-color: rgba(255, 204, 0, 0.7);
    box-shadow: 0 0 0 1px rgba(255, 204, 0, 0.4);
  }
  &.is-inactive {
    opacity: 0.55;
    .scene__icon--alice {
      filter: grayscale(0.5);
    }
  }

  .scene__icon--alice {
    background: rgba(255, 204, 0, 0.18);
    color: #ffcc00;
    width: 44px;
    height: 44px;
    border-radius: var(--radius-md);
    display: grid;
    place-items: center;
  }

  .scene__trigger {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    color: var(--color-text-secondary);

    &--manual {
      color: var(--color-text-muted);
      font-style: italic;
    }
  }

  .scene__trigger-more {
    margin-left: 6px;
    font-family: var(--font-family-mono);
    font-size: 11px;
    color: var(--color-text-muted);
    background: rgba(255, 255, 255, 0.05);
    padding: 1px 6px;
    border-radius: 4px;
  }

  .scene__meta-secondary {
    color: var(--color-text-muted);
    margin: 0;
  }

  .scene__actions {
    display: flex;
    gap: 6px;
    margin-top: auto;
    align-items: center;

    > :first-child {
      margin-right: auto;
    }
  }
}

// Editor modal styles (под scoped-стили модалки — `:deep` не нужен,
// модалка teleport'ится в body, но scoped-классы попадают в её контент через
// composable-naming).
.scenes__editor-loading {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 24px 4px;
  color: var(--color-text-muted);
}

.scenes__editor {
  display: flex;
  flex-direction: column;
  gap: 18px;
}

.scenes__editor-section {
  display: flex;
  flex-direction: column;
  gap: 8px;

  h4 {
    margin: 0;
    font-size: 12px;
    font-weight: 600;
    color: var(--color-text-secondary);
    text-transform: uppercase;
    letter-spacing: 0.04em;
  }
}

.scenes__editor-triggers {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 6px;

  li {
    display: grid;
    grid-template-columns: 16px minmax(0, 1fr) auto;
    gap: 10px;
    align-items: center;
    padding: 8px 12px;
    border-radius: var(--radius-md);
    background: rgba(255, 255, 255, 0.04);
    border: 1px solid rgba(255, 255, 255, 0.05);
    font-size: 13px;
    color: var(--color-text-primary);

    &[data-type='voice'] {
      border-color: rgba(255, 204, 0, 0.32);
      background: rgba(255, 204, 0, 0.06);
    }
  }
}

.scenes__editor-trigger-type {
  font-family: var(--font-family-mono);
  font-size: 11px;
  color: var(--color-text-muted);
  text-transform: lowercase;
}

.scene {
  --accent: #a961ff;
  display: flex;
  flex-direction: column;
  gap: 8px;
  position: relative;
  overflow: hidden;

  &::after {
    content: '';
    position: absolute;
    inset: -1px auto auto -1px;
    width: 140px;
    height: 140px;
    border-radius: 50%;
    background: radial-gradient(circle, var(--accent), transparent 65%);
    opacity: 0.32;
    filter: blur(20px);
    pointer-events: none;
  }

  &__head {
    display: flex;
    justify-content: space-between;
    align-items: flex-start;
    position: relative;
    z-index: 1;
  }
  &__icon {
    width: 44px;
    height: 44px;
    border-radius: var(--radius-md);
    background: rgba(255, 255, 255, 0.06);
    color: #fff;
    display: grid;
    place-items: center;
    :deep(svg) {
      width: 22px;
      height: 22px;
    }
  }
  &__edit {
    width: 32px;
    height: 32px;
    border-radius: var(--radius-md);
    background: rgba(255, 255, 255, 0.04);
    border: 0;
    color: var(--color-text-secondary);
    display: grid;
    place-items: center;
    cursor: pointer;
    transition:
      background 200ms var(--ease-out),
      color 200ms var(--ease-out);
    &:hover {
      background: rgba(255, 255, 255, 0.08);
      color: var(--color-text-primary);
    }
  }
  &__name {
    font-size: 16px;
    font-weight: 600;
    position: relative;
    z-index: 1;
  }
  &__meta {
    position: relative;
    z-index: 1;
  }
  &__chips {
    display: flex;
    gap: 6px;
    min-height: 26px;
    position: relative;
    z-index: 1;
  }
  &__actions {
    display: flex;
    gap: 8px;
    margin-top: auto;
    position: relative;
    z-index: 1;
  }

  &__create {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    border: 1px dashed var(--color-border-soft);
    background: transparent;
    color: var(--color-text-secondary);
    cursor: pointer;
    transition:
      border-color 220ms var(--ease-out),
      color 220ms;
    min-height: 200px;

    &:hover {
      border-color: rgba(var(--color-brand-purple-rgb), 0.6);
      color: var(--color-text-primary);
    }
  }
  &__plus {
    font-size: 32px;
    font-weight: 200;
    line-height: 1;
    margin-bottom: 6px;
  }
}
</style>
