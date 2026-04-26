<template>
  <article class="auto-pair" data-tour="alice-auto-pair">
    <header class="auto-pair__head">
      <span class="auto-pair__num">01</span>
      <div class="auto-pair__copy">
        <h3 class="auto-pair__title">Подключение через Яндекс ID</h3>
        <p class="auto-pair__desc">
          Авторизуйтесь — хаб сам получит список ваших колонок и подключится по локальной сети.
          Токен и логин остаются на этом компьютере, ничего не уходит на сервер хаба.
        </p>
      </div>
      <BaseButton
        v-if="!auth.authorized"
        variant="primary"
        :loading="signingIn"
        icon-left="alice"
        class="auto-pair__action"
        data-tour="alice-auto-pair-signin"
        @click="onSignIn"
      >
        {{ signingIn ? 'Открываю окно входа…' : 'Войти через Яндекс' }}
      </BaseButton>
      <BaseButton
        v-else
        variant="ghost"
        size="sm"
        icon-left="close"
        class="auto-pair__action"
        data-tour="alice-auto-pair-signin"
        @click="onSignOut"
      >
        Выйти
      </BaseButton>
    </header>

    <div v-if="auth.authorized" class="auto-pair__body">
      <div class="auto-pair__toolbar">
        <span class="auto-pair__status">
          <span class="auto-pair__dot" />
          Авторизован
          <span v-if="auth.expiresAt" class="auto-pair__expires"
            >· до {{ formatExpiry(auth.expiresAt) }}</span
          >
        </span>
        <BaseButton
          variant="ghost"
          size="sm"
          icon-left="refresh"
          :loading="loading"
          @click="loadStations"
        >
          {{ loading ? 'Загружаю…' : stations.length ? 'Обновить' : 'Найти мои колонки' }}
        </BaseButton>
      </div>

      <p v-if="error" class="auto-pair__error">{{ error }}</p>

      <ul v-if="stations.length" class="auto-pair__list">
        <li
          v-for="s in stations"
          :key="s.deviceId"
          class="auto-pair__item"
          :class="{ 'is-lan': s.reachableLan }"
        >
          <div class="auto-pair__item-icon">
            <BaseIcon name="alice" size="20" />
          </div>
          <div class="auto-pair__item-copy">
            <strong class="auto-pair__item-name">{{ s.name }}</strong>
            <span class="auto-pair__item-meta">
              {{ s.platform }}
              <template v-if="s.reachableLan && s.host"
                >· {{ s.host }}:{{ s.port ?? YANDEX_STATION_PORT }}</template
              >
              <template v-else>· не найдена в LAN</template>
            </span>
          </div>
          <BaseButton
            variant="primary"
            size="sm"
            icon-right="arrow-right"
            :disabled="!s.reachableLan"
            :loading="connectingId === s.deviceId"
            @click="onConnect(s)"
          >
            {{ connectingId === s.deviceId ? 'Подключаю…' : 'Подключить' }}
          </BaseButton>
        </li>
      </ul>
      <p v-else-if="!loading" class="auto-pair__empty">
        Нажмите «Найти мои колонки» — мы покажем список из вашего аккаунта Яндекс.
      </p>
    </div>
    <p v-else class="auto-pair__hint">
      Откроется окно входа с
      <code>oauth.yandex.ru</code>. Хаб использует public client_id Яндекс.Музыки — единственное
      приложение, которому Яндекс выдаёт scope для Glagol API.
    </p>
  </article>
</template>

<script setup lang="ts">
import { onMounted, ref } from 'vue';
import type { YandexAuthStatus, YandexStationOnAccount } from '@smarthome/shared';
import { YANDEX_STATION_PORT } from '@smarthome/shared';
import { BaseButton, BaseIcon } from '@/components/base';
import { useToasterStore } from '@/stores/toaster';

const toaster = useToasterStore();

const auth = ref<YandexAuthStatus>({ authorized: false });
const stations = ref<YandexStationOnAccount[]>([]);
const signingIn = ref(false);
const loading = ref(false);
const connectingId = ref<string | null>(null);
const error = ref<string | null>(null);

async function refreshAuth(): Promise<void> {
  auth.value = await window.smarthome.yandexStation.getAuthStatus();
}

async function onSignIn(): Promise<void> {
  signingIn.value = true;
  error.value = null;
  try {
    const r = await window.smarthome.yandexStation.signIn();
    if (!r.ok) {
      error.value = r.error ?? 'Не удалось войти';
      return;
    }
    await refreshAuth();
    await loadStations();
  } catch (e) {
    error.value = (e as Error).message;
  } finally {
    signingIn.value = false;
  }
}

async function onSignOut(): Promise<void> {
  await window.smarthome.yandexStation.signOut();
  await refreshAuth();
  stations.value = [];
}

async function loadStations(): Promise<void> {
  loading.value = true;
  error.value = null;
  try {
    stations.value = await window.smarthome.yandexStation.fetchStations();
  } catch (e) {
    error.value = (e as Error).message;
  } finally {
    loading.value = false;
  }
}

async function onConnect(s: YandexStationOnAccount): Promise<void> {
  connectingId.value = s.deviceId;
  const toastId = toaster.push({
    kind: 'pending',
    message: `Подключаюсь к «${s.name}»…`,
    detail: 'Запрашиваю device JWT и поднимаю WSS',
  });
  try {
    await window.smarthome.yandexStation.connectStation({
      deviceId: s.deviceId,
      platform: s.platform,
      name: s.name,
      // host/port из fetchStations — избегаем повторного mDNS scan в hub.
      ...(s.host ? { host: s.host } : {}),
      ...(s.port ? { port: s.port } : {}),
    });
    // Status update прилетит через push 'yandexStation:status', refetch не нужен.
    toaster.update(toastId, {
      kind: 'success',
      message: `«${s.name}» подключена`,
      ttlMs: 3000,
    });
  } catch (e) {
    toaster.update(toastId, {
      kind: 'error',
      message: 'Не удалось подключить колонку',
      detail: (e as Error).message,
      ttlMs: 5000,
    });
  } finally {
    connectingId.value = null;
  }
}

function formatExpiry(iso: string): string {
  try {
    const d = new Date(iso);
    return d.toLocaleDateString('ru', { day: 'numeric', month: 'short', year: 'numeric' });
  } catch {
    return iso;
  }
}

onMounted(refreshAuth);
</script>

<style scoped lang="scss">
.auto-pair {
  position: relative;
  border-radius: var(--radius-lg);
  background: rgba(255, 255, 255, 0.022);
  border: 1px solid rgba(255, 255, 255, 0.05);
  padding: clamp(20px, 2vw, 30px) clamp(20px, 2vw, 32px);
  display: flex;
  flex-direction: column;
  gap: 18px;
  transition:
    background-color 280ms var(--ease-out),
    border-color 280ms var(--ease-out);

  &__head {
    display: grid;
    grid-template-columns: auto minmax(0, 1fr) auto;
    align-items: center;
    gap: clamp(14px, 1.4vw, 22px);
  }

  &__num {
    font-family: var(--font-family-mono);
    font-size: 12px;
    font-weight: 600;
    letter-spacing: 0.08em;
    color: transparent;
    background: var(--gradient-brand);
    -webkit-background-clip: text;
    background-clip: text;
  }

  &__copy {
    min-width: 0;
  }

  &__title {
    font-family: var(--font-family-display);
    font-size: var(--font-size-h1);
    font-weight: 600;
    letter-spacing: var(--tracking-h1);
    color: var(--color-text-primary);
    margin: 0 0 4px;
  }

  &__desc {
    font-size: 13px;
    color: var(--color-text-secondary);
    line-height: 1.5;
    margin: 0;
    text-wrap: pretty;
    max-width: 64ch;
  }

  &__action {
    flex-shrink: 0;
    align-self: center;
  }

  &__hint {
    font-size: 12.5px;
    color: var(--color-text-muted);
    margin: 0;
    line-height: 1.55;

    code {
      font-family: var(--font-family-mono);
      background: rgba(255, 255, 255, 0.05);
      padding: 1px 5px;
      border-radius: 4px;
    }
  }

  &__body {
    display: flex;
    flex-direction: column;
    gap: 14px;
  }

  &__toolbar {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    flex-wrap: wrap;
  }

  &__status {
    font-size: 12.5px;
    color: var(--color-text-secondary);
    display: inline-flex;
    align-items: center;
    gap: 6px;
  }

  &__dot {
    width: 8px;
    height: 8px;
    border-radius: 50%;
    background: var(--color-success, #2dd89a);
    box-shadow: 0 0 0 3px color-mix(in srgb, var(--color-success, #2dd89a) 25%, transparent);
  }

  &__expires {
    color: var(--color-text-muted);
  }

  &__error {
    font-size: 12.5px;
    color: var(--color-danger, #ff5577);
    margin: 0;
  }

  &__list {
    list-style: none;
    margin: 0;
    padding: 0;
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(min(100%, 320px), 1fr));
    gap: 10px;
  }

  &__item {
    display: grid;
    grid-template-columns: auto minmax(0, 1fr) auto;
    align-items: center;
    gap: 12px;
    padding: 12px 14px;
    border-radius: var(--radius-md);
    background: rgba(255, 255, 255, 0.025);
    border: 1px solid rgba(255, 255, 255, 0.05);
    opacity: 0.65;
    transition:
      background-color 200ms var(--ease-out),
      border-color 200ms var(--ease-out),
      opacity 200ms var(--ease-out);

    &.is-lan {
      opacity: 1;
      border-color: color-mix(in srgb, var(--color-brand-purple) 22%, transparent);
    }

    &:hover {
      background: rgba(255, 255, 255, 0.04);
    }
  }

  &__item-icon {
    width: 36px;
    height: 36px;
    border-radius: var(--radius-sm);
    background: color-mix(in srgb, var(--color-brand-purple) 14%, transparent);
    color: var(--color-brand-purple);
    display: grid;
    place-items: center;
    flex-shrink: 0;
  }

  &__item-copy {
    display: flex;
    flex-direction: column;
    gap: 2px;
    min-width: 0;
  }

  &__item-name {
    font-size: 14.5px;
    font-weight: 600;
    color: var(--color-text-primary);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  &__item-meta {
    font-size: 12px;
    color: var(--color-text-muted);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  &__empty {
    font-size: 12.5px;
    color: var(--color-text-muted);
    margin: 0;
  }
}
</style>
