<template>
  <section class="skill-bridge">
    <!-- Hero: 5 stage'й + честный сигнал по достижимости. -->
    <article class="skill-bridge__hero" :class="`skill-bridge__hero--${stage}`">
      <div class="skill-bridge__hero-icon" aria-hidden="true">
        <BaseIcon :name="stageIcon" :size="22" />
      </div>
      <div class="skill-bridge__hero-copy">
        <strong class="skill-bridge__hero-title">{{ stageTitle }}</strong>
        <p class="skill-bridge__hero-sub">{{ stageSubtitle }}</p>
      </div>
      <div class="skill-bridge__hero-meta">
        <span
          class="skill-bridge__hero-step"
          :class="{ 'is-done': isStepDone(1), 'is-active': stage === 'idle' }"
        >
          1 · Skill
        </span>
        <span
          class="skill-bridge__hero-step"
          :class="{ 'is-done': isStepDone(2), 'is-active': stage === 'configured' }"
        >
          2 · Туннель
        </span>
        <span
          class="skill-bridge__hero-step"
          :class="{
            'is-done': isStepDone(3),
            'is-active': stage === 'tunnel-up',
            'is-warn': stage === 'tunnel-up' && reachabilityChecked && !alice.isReachable,
          }"
        >
          3 · Достижимость
        </span>
        <span
          class="skill-bridge__hero-step"
          :class="{
            'is-done': isStepDone(4),
            'is-active': stage === 'awaiting-link',
            'is-warn': stage === 'linked-stale',
          }"
        >
          4 · Привязка
        </span>
      </div>
    </article>

    <!-- One-click автомат: открывает консоль навыка + кладёт endpoint+OAuth URL'ы в clipboard. -->
    <button
      v-if="alice.publicUrl && alice.isConfigured"
      class="skill-bridge__quick-action"
      type="button"
      @click="alice.copyConsoleConfig()"
    >
      <BaseIcon name="arrow-right" :size="14" />
      <div class="skill-bridge__quick-copy">
        <strong>Открыть консоль навыка с готовой конфигурацией</strong>
        <span>4 URL'а + client_id/secret скопируются в буфер — вставьте по одному кликом</span>
      </div>
    </button>

    <!-- Dev-гайд: для тех, кто хочет понять «что под капотом». -->
    <button
      class="skill-bridge__guide-link"
      type="button"
      @click="
        openExternal(
          'https://github.com/AkkiRay/smarthub/blob/main/docs/ALICE-SKILL-SETUP.md',
        )
      "
    >
      <BaseIcon name="alice" :size="12" />
      <span>Полный гайд: как создать навык в `dialogs.yandex.ru` за 5 минут</span>
    </button>

    <!-- Шаг 1: креды skill-а из dialogs.yandex.ru. -->
    <article class="skill-bridge__card" data-tour="alice-skill-config">
      <header class="skill-bridge__card-head">
        <span class="skill-bridge__card-num">01</span>
        <div class="skill-bridge__card-copy">
          <h3 class="skill-bridge__card-title">Создайте skill в dialogs.yandex.ru</h3>
          <p class="skill-bridge__card-desc">
            Зайдите в
            <a href="#" @click.prevent="openExternal('https://dialogs.yandex.ru/developer/')">
              dialogs.yandex.ru/developer
            </a>
            → создать диалог → «Умный дом». В разделе «Привязка аккаунтов» скопируйте 3 поля ниже.
            Endpoint и URL'ы туннеля заполнятся автоматически после шага 2.
          </p>
        </div>
        <BaseButton
          v-if="alice.isConfigured"
          variant="ghost"
          size="sm"
          icon-left="trash"
          @click="onClear"
        >
          Отвязать
        </BaseButton>
      </header>

      <div class="skill-bridge__form">
        <label class="skill-bridge__field">
          <span class="skill-bridge__field-label">Skill ID</span>
          <BaseInput
            v-model="form.skillId"
            placeholder="UUID из раздела «Привязка аккаунтов»"
            :spellcheck="false"
          />
        </label>

        <!-- OAuth credentials: auto-generate с copy-кнопкой, ручной ввод спрятан в advanced. -->
        <div class="skill-bridge__field skill-bridge__field--full">
          <div class="skill-bridge__field-header">
            <span class="skill-bridge__field-label">
              OAuth client_id / client_secret
              <span class="skill-bridge__field-hint">
                {{
                  hasGenerated
                    ? 'Скопируйте в раздел «Привязка аккаунтов»'
                    : 'Хаб создаст случайные значения'
                }}
              </span>
            </span>
            <BaseButton
              v-if="!hasGenerated"
              variant="ghost"
              size="sm"
              icon-left="refresh"
              @click="onGenerateCreds"
            >
              Сгенерировать
            </BaseButton>
            <BaseButton
              v-else
              variant="ghost"
              size="sm"
              icon-left="refresh"
              @click="onGenerateCreds"
            >
              Перегенерировать
            </BaseButton>
          </div>
          <div v-if="hasGenerated" class="skill-bridge__creds">
            <button type="button" class="skill-bridge__creds-row" @click="copy(form.oauthClientId)">
              <span class="skill-bridge__creds-label">client_id</span>
              <code class="skill-bridge__creds-value">{{ form.oauthClientId }}</code>
              <BaseIcon name="check" :size="12" />
            </button>
            <button
              type="button"
              class="skill-bridge__creds-row"
              @click="copy(form.oauthClientSecret)"
            >
              <span class="skill-bridge__creds-label">client_secret</span>
              <code class="skill-bridge__creds-value">
                {{ revealSecret ? form.oauthClientSecret : maskSecret(form.oauthClientSecret) }}
              </code>
              <BaseIcon name="check" :size="12" />
            </button>
            <button
              type="button"
              class="skill-bridge__creds-toggle"
              @click="revealSecret = !revealSecret"
            >
              {{ revealSecret ? 'Скрыть secret' : 'Показать secret' }}
            </button>
          </div>
          <details v-else class="skill-bridge__advanced">
            <summary>Ввести вручную (если уже есть креды)</summary>
            <div class="skill-bridge__advanced-form">
              <BaseInput v-model="form.oauthClientId" placeholder="client_id" :spellcheck="false" />
              <BaseInput
                v-model="form.oauthClientSecret"
                type="password"
                placeholder="client_secret"
                :spellcheck="false"
              />
            </div>
          </details>
        </div>

        <!-- Callback-токен: одна кнопка вместо ручного квеста. -->
        <div
          class="skill-bridge__field skill-bridge__field--full"
          data-tour="alice-skill-dialogs-token"
        >
          <div class="skill-bridge__field-header">
            <span class="skill-bridge__field-label">
              Push-обновления через Я.Диалоги
              <span class="skill-bridge__field-hint">
                {{ dialogsTokenHint }}
              </span>
            </span>
            <BaseButton
              variant="ghost"
              size="sm"
              icon-left="alice"
              :loading="dialogsTokenFetching"
              @click="onFetchDialogsToken"
            >
              {{ form.dialogsOauthToken ? 'Сменить токен' : 'Получить через Яндекс ID' }}
            </BaseButton>
          </div>
          <!-- Owner-info: защита от типичной ошибки «вошёл не тем аккаунтом». -->
          <div
            v-if="form.dialogsOauthToken && (alice.dialogsTokenOwner || dialogsOwnerError)"
            class="skill-bridge__owner"
            :class="ownerClass"
          >
            <BaseIcon :name="ownerIcon" :size="14" />
            <div class="skill-bridge__owner-copy">
              <strong>{{ ownerTitle }}</strong>
              <span>{{ ownerSub }}</span>
            </div>
            <BaseButton variant="ghost" size="sm" icon-left="refresh" @click="onVerifyToken">
              Проверить
            </BaseButton>
          </div>
        </div>

        <label class="skill-bridge__field skill-bridge__field--full">
          <span class="skill-bridge__field-label">
            Свой домен cloudflared
            <span class="skill-bridge__field-hint">опционально, иначе quick-tunnel</span>
          </span>
          <BaseInput
            v-model="form.customDomain"
            placeholder="hub.example.com (named tunnel)"
            :spellcheck="false"
          />
        </label>
      </div>
      <div class="skill-bridge__form-actions">
        <BaseButton variant="primary" :disabled="!canSave" :loading="saving" @click="onSave">
          {{ alice.isConfigured ? 'Обновить креды' : 'Сохранить креды' }}
        </BaseButton>
      </div>
    </article>

    <!-- Шаг 2: туннель. -->
    <article
      class="skill-bridge__card"
      :class="{ 'is-disabled': !alice.isConfigured }"
      data-tour="alice-skill-tunnel"
    >
      <header class="skill-bridge__card-head">
        <span class="skill-bridge__card-num">02</span>
        <div class="skill-bridge__card-copy">
          <h3 class="skill-bridge__card-title">Запустите публичный туннель</h3>
          <p class="skill-bridge__card-desc">
            Хаб поднимает <code>cloudflared tunnel</code> и получает HTTPS-URL, доступный из
            интернета. Если бинарника нет — скачается автоматически (~25 МБ).
          </p>
        </div>
        <BaseButton
          v-if="!alice.tunnelRunning"
          variant="primary"
          icon-left="alice"
          :disabled="!alice.isConfigured || isInstalling"
          :loading="alice.tunnelStarting || isInstalling"
          @click="onStartTunnel"
        >
          {{ tunnelButtonLabel }}
        </BaseButton>
        <BaseButton v-else variant="ghost" size="sm" icon-left="close" @click="onStopTunnel">
          Остановить
        </BaseButton>
      </header>

      <!-- Inline-прогресс установки cloudflared — единственный сигнал, без отдельных кнопок. -->
      <div v-if="isInstalling" class="skill-bridge__install">
        <div class="skill-bridge__install-head">
          <strong>Скачиваю cloudflared…</strong>
          <span>{{ installProgressLabel }}</span>
        </div>
        <div
          class="skill-bridge__install-bar"
          role="progressbar"
          :aria-valuemin="0"
          :aria-valuemax="100"
          :aria-valuenow="installRatio !== null ? Math.round(installRatio * 100) : undefined"
        >
          <span
            class="skill-bridge__install-bar-fill"
            :class="{ 'is-indeterminate': installRatio === null }"
            :style="installRatio !== null ? { '--w': `${installRatio * 100}%` } : undefined"
          />
        </div>
      </div>

      <!-- Public URL: copy + endpoint suggestions для вставки в консоль навыка. -->
      <div v-if="alice.publicUrl" class="skill-bridge__urls">
        <div class="skill-bridge__url">
          <span class="skill-bridge__url-label">Endpoint webhook'а</span>
          <button class="skill-bridge__url-value" @click="copy(`${alice.publicUrl}/v1.0`)">
            <code>{{ alice.publicUrl }}/v1.0</code>
            <BaseIcon name="check" :size="12" />
          </button>
          <span class="skill-bridge__url-hint"> Вставьте в раздел «Backend» консоли навыка </span>
        </div>
        <div class="skill-bridge__url">
          <span class="skill-bridge__url-label">URL авторизации</span>
          <button
            class="skill-bridge__url-value"
            @click="copy(`${alice.publicUrl}/oauth/authorize`)"
          >
            <code>{{ alice.publicUrl }}/oauth/authorize</code>
            <BaseIcon name="check" :size="12" />
          </button>
        </div>
        <div class="skill-bridge__url">
          <span class="skill-bridge__url-label">URL получения токена</span>
          <button class="skill-bridge__url-value" @click="copy(`${alice.publicUrl}/oauth/token`)">
            <code>{{ alice.publicUrl }}/oauth/token</code>
            <BaseIcon name="check" :size="12" />
          </button>
        </div>
      </div>

      <!-- Honest reachability — авто-проба после tunnel-up + раз в 90с. -->
      <div
        v-if="alice.publicUrl"
        class="skill-bridge__reach"
        :class="reachabilityClass"
      >
        <BaseIcon :name="reachabilityIcon" :size="14" />
        <div class="skill-bridge__reach-copy">
          <strong>{{ reachabilityTitle }}</strong>
          <span>{{ reachabilitySub }}</span>
        </div>
      </div>

      <p v-else-if="alice.status?.tunnel.lastError" class="skill-bridge__error">
        ⚠ {{ alice.status.tunnel.lastError }}
      </p>
    </article>

    <!-- Шаг 3: подсказка как привязать в Я.приложении. -->
    <article
      class="skill-bridge__card"
      :class="{ 'is-disabled': !alice.tunnelRunning }"
      data-tour="alice-skill-link"
    >
      <header class="skill-bridge__card-head">
        <span class="skill-bridge__card-num">03</span>
        <div class="skill-bridge__card-copy">
          <h3 class="skill-bridge__card-title">Привяжите в «Дом с Алисой»</h3>
          <p class="skill-bridge__card-desc">
            В приложении Яндекса:
            <strong>Устройства → Добавить → По производителю → ваш skill → Привязать аккаунт</strong
            >. Алиса откроет страницу подтверждения, нажмите «Привязать» — устройства появятся в
            доме мгновенно.
          </p>
        </div>
        <span class="skill-bridge__chip" :class="linkChipClass">
          <span class="skill-bridge__chip-dot" />
          {{ linkChipLabel }}
        </span>
      </header>

      <!-- Прямая ссылка на страницу привязки конкретного скилла — экономит юзеру 4 клика. -->
      <BaseButton
        v-if="form.skillId.trim()"
        variant="primary"
        icon-right="arrow-right"
        :disabled="!alice.tunnelRunning || (reachabilityChecked && !alice.isReachable)"
        @click="openSkillBindPage"
      >
        Открыть страницу привязки в «Дом с Алисой»
      </BaseButton>

      <div v-if="activity" class="skill-bridge__activity">
        <div class="skill-bridge__activity-row">
          <span class="skill-bridge__activity-label">Последний запрос Алисы</span>
          <strong>{{ activity.lastRequestAt ? relativeTime(activity.lastRequestAt) : '—' }}</strong>
        </div>
        <div class="skill-bridge__activity-row">
          <span class="skill-bridge__activity-label">Запросов за 24ч</span>
          <strong>{{ activity.requestsLast24h }}</strong>
        </div>
        <div
          class="skill-bridge__activity-row"
          :class="{ 'has-errors': activity.errorsLast24h > 0 }"
        >
          <span class="skill-bridge__activity-label">Ошибок за 24ч</span>
          <strong>{{ activity.errorsLast24h }}</strong>
        </div>
      </div>
    </article>
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, reactive, ref, watch } from 'vue';
import type { AliceSkillConfig } from '@smarthome/shared';
import { useAliceStore } from '@/stores/alice';
import { BaseButton, BaseIcon, BaseInput, type IconName } from '@/components/base';
import { useToasterStore } from '@/stores/toaster';

const alice = useAliceStore();
const toaster = useToasterStore();

const isInstalling = computed(() => alice.cloudflaredInstall.kind === 'downloading');
const installRatio = computed(() => {
  const s = alice.cloudflaredInstall;
  return s.kind === 'downloading' ? s.ratio : null;
});
const tunnelButtonLabel = computed(() => {
  if (isInstalling.value) {
    return installRatio.value !== null
      ? `Скачиваю · ${Math.round(installRatio.value * 100)}%`
      : 'Скачиваю cloudflared…';
  }
  if (alice.cloudflaredInstall.kind === 'managed') return 'Запустить туннель';
  // 'missing' | 'error' — кликом запустим скачивание + старт.
  return 'Подключить (скачать cloudflared)';
});

const installProgressLabel = computed(() => {
  const s = alice.cloudflaredInstall;
  if (s.kind !== 'downloading') return '';
  const mb = (b: number): string => `${(b / (1024 * 1024)).toFixed(1)} МБ`;
  if (s.bytesTotal && s.ratio !== null) {
    return `${mb(s.bytesDone)} из ${mb(s.bytesTotal)} · ${Math.round(s.ratio * 100)}%`;
  }
  return `${mb(s.bytesDone)} скачано`;
});

// Локальная form-копия. Store пишем только по save'у — иначе race с alice:status push'ами.
const form = reactive<AliceSkillConfig>({
  skillId: '',
  oauthClientId: '',
  oauthClientSecret: '',
  dialogsOauthToken: '',
  customDomain: '',
});
const saving = ref(false);
const dialogsTokenFetching = ref(false);
const revealSecret = ref(false);

/** «Креды есть», если оба поля заполнены — неважно как (save / manual / generate). */
const hasGenerated = computed(() => !!form.oauthClientId.trim() && !!form.oauthClientSecret.trim());

onMounted(() => {
  // Авто-проба cloudflared в PATH — install-state из bootstrap уже показывает
  // managed-бинарник, если он скачан раньше.
  void alice.probeCloudflared();
});

watch(
  () => alice.skillConfig,
  (config) => {
    if (!config) return;
    form.skillId = config.skillId;
    form.oauthClientId = config.oauthClientId;
    form.oauthClientSecret = config.oauthClientSecret;
    form.dialogsOauthToken = config.dialogsOauthToken ?? '';
    form.customDomain = config.customDomain ?? '';
  },
  { immediate: true },
);

// Yandex skill_id — UUID v4. Если юзер вбил случайную строку, save заблокируется
// и хаб не отправит мусор в `/callback/state` (где skillId идёт в URL-path).
const SKILL_ID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const skillIdLooksValid = computed(() => SKILL_ID_REGEX.test(form.skillId.trim()));

const canSave = computed(
  () => skillIdLooksValid.value && !!form.oauthClientId.trim() && !!form.oauthClientSecret.trim(),
);

const stage = computed(() => alice.stage);
const stageIcon = computed<IconName>(() => {
  switch (stage.value) {
    case 'linked':
      return 'check';
    case 'awaiting-link':
    case 'tunnel-up':
      return 'arrow-right';
    case 'configured':
      return 'edit';
    case 'error':
    case 'linked-stale':
      return 'close';
    default:
      return 'alice';
  }
});
const stageTitle = computed(() => {
  switch (stage.value) {
    case 'linked':
      return 'Алиса видит ваш хаб';
    case 'linked-stale':
      return 'Привязка подвисла — Алиса не дёргала хаб > 7 дней';
    case 'awaiting-link':
      return 'Туннель достижим — осталось привязать в «Дом с Алисой»';
    case 'tunnel-up':
      return 'Туннель поднят — проверьте достижимость снаружи';
    case 'configured':
      return 'Креды сохранены — запустите туннель';
    case 'error':
      return 'Что-то пошло не так';
    default:
      return 'Связка ещё не настроена';
  }
});
const stageSubtitle = computed(() => alice.nextActionHint);

const reachabilityChecked = computed(() => !!alice.reachability);

const reachabilityClass = computed(() => {
  if (!alice.reachability) return 'skill-bridge__reach--idle';
  return alice.reachability.ok ? 'skill-bridge__reach--ok' : 'skill-bridge__reach--bad';
});
const reachabilityIcon = computed<IconName>(() => {
  if (!alice.reachability) return 'refresh';
  return alice.reachability.ok ? 'check' : 'close';
});
const reachabilityTitle = computed(() => {
  const r = alice.reachability;
  if (!r) return 'Достижимость не проверена';
  if (r.ok) return `HEAD /v1.0 → ${r.status} · ${r.latencyMs} мс`;
  return r.error ?? `HEAD /v1.0 → ${r.status}`;
});
const reachabilitySub = computed(() => {
  const r = alice.reachability;
  if (!r) {
    return 'Нажмите «Проверить» — хаб дёрнет публичный URL снаружи и убедится, что Алиса достучится.';
  }
  return `Проверено ${relativeTime(r.at)}. Авто-перепроверка раз в 90с пока туннель up.`;
});

const linkChipLabel = computed(() => {
  switch (stage.value) {
    case 'linked':
      return 'Привязано';
    case 'linked-stale':
      return 'Привязка подвисла';
    case 'awaiting-link':
      return 'Достижимы — ждём вас';
    default:
      return 'Ожидает привязки';
  }
});

const linkChipClass = computed(() => ({
  'is-success': stage.value === 'linked',
  'is-warn': stage.value === 'linked-stale',
  'is-info': stage.value === 'awaiting-link',
}));

const dialogsTokenHint = computed(() => {
  if (!form.dialogsOauthToken) {
    return 'Без токена Алиса узнаёт об изменениях только при следующем запросе';
  }
  if (alice.dialogsTokenOwner?.rejected) {
    return 'Токен отклонён — Я.Диалоги вернули 401. Получите заново под аккаунтом владельца скилла';
  }
  if (alice.dialogsTokenOwner?.displayName) {
    return `Push-токен · ${alice.dialogsTokenOwner.displayName}`;
  }
  return 'Токен сохранён — нажмите «Проверить», чтобы узнать владельца';
});

const ownerClass = computed(() => {
  const owner = alice.dialogsTokenOwner;
  if (owner?.rejected) return 'skill-bridge__owner--bad';
  if (owner?.displayName) return 'skill-bridge__owner--ok';
  return 'skill-bridge__owner--idle';
});
const ownerIcon = computed<IconName>(() => {
  const owner = alice.dialogsTokenOwner;
  if (owner?.rejected) return 'close';
  if (owner?.displayName) return 'check';
  return 'refresh';
});
const ownerTitle = computed(() => {
  const owner = alice.dialogsTokenOwner;
  if (owner?.rejected) return 'Токен отклонён Я.Диалогами';
  if (owner?.displayName) return `Владелец токена · ${owner.displayName}`;
  return 'Владелец токена не подтверждён';
});
const ownerSub = computed(() => {
  const owner = alice.dialogsTokenOwner;
  if (owner?.rejected) {
    return 'Получите токен заново и убедитесь, что входите тем же аккаунтом, что создал скилл';
  }
  if (owner?.login) return `Логин: ${owner.login}`;
  return 'Нажмите «Проверить» — мы дёрнем login.yandex.ru/info';
});

function relativeTime(iso: string): string {
  const ms = Date.now() - Date.parse(iso);
  if (ms < 60_000) return 'только что';
  if (ms < 3_600_000) return `${Math.round(ms / 60_000)} мин назад`;
  if (ms < 86_400_000) return `${Math.round(ms / 3_600_000)} ч назад`;
  return `${Math.round(ms / 86_400_000)} дн назад`;
}

async function onVerifyToken(): Promise<void> {
  dialogsOwnerError.value = null;
  await alice.verifyDialogsToken();
}

function openSkillBindPage(): void {
  // Прямая ссылка на навык в «Доме с Алисой» — пропускает 4 клика по меню.
  void window.smarthome.app.openExternal(
    `https://yandex.ru/quasar/skills/${encodeURIComponent(form.skillId.trim())}`,
  );
}

const activity = computed(() => alice.status?.activity ?? null);

function isStepDone(step: 1 | 2 | 3 | 4): boolean {
  if (step === 1) return alice.isConfigured;
  if (step === 2) return alice.tunnelRunning;
  if (step === 3) return alice.isReachable;
  return alice.isLinked;
}

async function onSave(): Promise<void> {
  if (!canSave.value) return;
  saving.value = true;
  try {
    await alice.saveSkillConfig({
      skillId: form.skillId.trim(),
      oauthClientId: form.oauthClientId.trim(),
      oauthClientSecret: form.oauthClientSecret.trim(),
      dialogsOauthToken: form.dialogsOauthToken?.trim() || undefined,
      customDomain: form.customDomain?.trim() || undefined,
    });
  } catch {
    /* toaster уже показал */
  } finally {
    saving.value = false;
  }
}

async function onClear(): Promise<void> {
  await alice.clearSkillConfig();
  form.skillId = '';
  form.oauthClientId = '';
  form.oauthClientSecret = '';
  form.dialogsOauthToken = '';
  form.customDomain = '';
}

async function onStartTunnel(): Promise<void> {
  try {
    await alice.startTunnel();
  } catch {
    /* error уже в toast'е */
  }
}

async function onStopTunnel(): Promise<void> {
  await alice.stopTunnel();
}

async function onGenerateCreds(): Promise<void> {
  const creds = await alice.generateOauthCredentials();
  form.oauthClientId = creds.oauthClientId;
  form.oauthClientSecret = creds.oauthClientSecret;
  revealSecret.value = true;
  toaster.push({
    kind: 'info',
    message: 'Креды созданы — скопируйте в консоль навыка',
    ttlMs: 3500,
  });
}

async function onFetchDialogsToken(): Promise<void> {
  // Callback-токен требует skill_id + OAuth client пары.
  if (!form.skillId.trim()) {
    toaster.push({ kind: 'error', message: 'Сначала введите Skill ID' });
    return;
  }
  if (!hasGenerated.value) {
    toaster.push({ kind: 'error', message: 'Сначала сгенерируйте OAuth-креды' });
    return;
  }
  // fetchDialogsCallbackToken читает уже сохранённый config — синкаем форму перед запросом.
  if (!alice.isConfigured) {
    await onSave();
    if (!alice.isConfigured) return; // save упал, toaster уже показал
  }
  dialogsTokenFetching.value = true;
  try {
    await alice.fetchDialogsCallbackToken();
    if (alice.skillConfig) {
      form.dialogsOauthToken = alice.skillConfig.dialogsOauthToken ?? '';
    }
  } finally {
    dialogsTokenFetching.value = false;
  }
}

function maskSecret(secret: string): string {
  if (secret.length <= 8) return '••••••••';
  return `${secret.slice(0, 4)}${'•'.repeat(secret.length - 8)}${secret.slice(-4)}`;
}

async function copy(text: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(text);
    toaster.push({ kind: 'success', message: 'Скопировано', ttlMs: 1500 });
  } catch {
    toaster.push({ kind: 'error', message: 'Не удалось скопировать' });
  }
}

function openExternal(url: string): void {
  void window.smarthome.app.openExternal(url);
}
</script>

<style scoped lang="scss">
@use '@/styles/abstracts/mixins' as *;

.skill-bridge {
  display: flex;
  flex-direction: column;
  gap: 18px;

  &__hero {
    display: grid;
    grid-template-columns: auto minmax(0, 1fr) auto;
    gap: 16px;
    align-items: center;
    padding: 18px 22px;
    border-radius: var(--radius-lg);
    background: rgba(var(--color-brand-violet-rgb), 0.06);
    border: 1px solid rgba(var(--color-brand-violet-rgb), 0.18);
    transition:
      background-color 280ms var(--ease-out),
      border-color 280ms var(--ease-out);

    &--linked {
      background: rgba(var(--color-success-rgb), 0.06);
      border-color: rgba(var(--color-success-rgb), 0.28);
    }
    &--linked-stale {
      background: rgba(var(--color-warning-rgb), 0.06);
      border-color: rgba(var(--color-warning-rgb), 0.3);
    }
    &--awaiting-link {
      background: rgba(var(--color-brand-pink-rgb), 0.06);
      border-color: rgba(var(--color-brand-pink-rgb), 0.28);
    }
    &--error {
      background: rgba(var(--color-danger-rgb), 0.06);
      border-color: rgba(var(--color-danger-rgb), 0.3);
    }
  }

  &__hero-icon {
    width: 38px;
    height: 38px;
    border-radius: 50%;
    display: grid;
    place-items: center;
    background: rgba(255, 255, 255, 0.06);
    color: var(--color-brand-violet);

    .skill-bridge__hero--linked & {
      background: rgba(var(--color-success-rgb), 0.16);
      color: var(--color-success);
    }
  }

  &__hero-title {
    display: block;
    font-family: var(--font-family-display);
    font-size: 16px;
    font-weight: 700;
    letter-spacing: -0.005em;
    color: var(--color-text-primary);
  }

  &__hero-sub {
    margin: 4px 0 0;
    font-size: 13px;
    color: var(--color-text-secondary);
  }

  &__hero-meta {
    display: flex;
    align-items: center;
    gap: 6px;
    flex-wrap: wrap;
  }

  &__hero-step {
    font-family: var(--font-family-mono);
    font-size: 11px;
    font-weight: 600;
    letter-spacing: 0.04em;
    color: var(--color-text-muted);
    padding: 4px 10px;
    border-radius: 999px;
    background: rgba(255, 255, 255, 0.03);
    border: 1px solid rgba(255, 255, 255, 0.05);
    transition:
      color 220ms var(--ease-out),
      background-color 220ms var(--ease-out),
      border-color 220ms var(--ease-out);

    &.is-active {
      color: var(--color-brand-violet);
      background: rgba(var(--color-brand-violet-rgb), 0.12);
      border-color: rgba(var(--color-brand-violet-rgb), 0.4);
    }

    &.is-warn {
      color: var(--color-warning);
      background: rgba(var(--color-warning-rgb), 0.1);
      border-color: rgba(var(--color-warning-rgb), 0.32);
    }

    &.is-done {
      color: var(--color-success);
      background: rgba(var(--color-success-rgb), 0.1);
      border-color: rgba(var(--color-success-rgb), 0.28);
    }
  }

  // ---- Cards ----
  &__card {
    display: flex;
    flex-direction: column;
    gap: 16px;
    padding: clamp(20px, 2vw, 28px) clamp(20px, 2vw, 32px);
    border-radius: var(--radius-lg);
    background: rgba(255, 255, 255, 0.022);
    border: 1px solid rgba(255, 255, 255, 0.05);
    transition: opacity 200ms var(--ease-out);

    &.is-disabled {
      opacity: 0.5;
      pointer-events: none;
    }
  }

  &__card-head {
    display: grid;
    grid-template-columns: auto minmax(0, 1fr) auto;
    gap: 18px;
    align-items: start;
  }

  &__card-num {
    font-family: var(--font-family-mono);
    font-size: 12px;
    font-weight: 700;
    color: var(--color-text-muted);
    letter-spacing: 0.08em;
    width: 28px;
    height: 28px;
    border-radius: 8px;
    display: grid;
    place-items: center;
    background: rgba(255, 255, 255, 0.04);
  }

  &__card-title {
    margin: 0 0 4px;
    font-size: 15px;
    font-weight: 700;
    color: var(--color-text-primary);
  }

  &__card-desc {
    margin: 0;
    font-size: 13px;
    line-height: 1.5;
    color: var(--color-text-secondary);

    code {
      padding: 1px 5px;
      border-radius: 4px;
      background: rgba(255, 255, 255, 0.05);
      font-family: var(--font-family-mono);
      font-size: 12px;
    }
    a {
      color: var(--color-brand-cyan);
      text-decoration: none;
      &:hover {
        text-decoration: underline;
      }
    }
  }

  // ---- Form ----
  &__form {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(260px, 1fr));
    gap: 12px 16px;
  }

  &__field {
    display: flex;
    flex-direction: column;
    gap: 6px;

    &--full {
      grid-column: 1 / -1;
    }
  }

  &__field-label {
    font-size: 12px;
    font-weight: 600;
    color: var(--color-text-muted);
    letter-spacing: 0.02em;

    .skill-bridge__field-hint {
      margin-left: 6px;
      font-weight: 400;
      color: rgba(255, 255, 255, 0.35);
    }
  }

  &__field-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    flex-wrap: wrap;
  }

  // ---- Generated credentials ----
  &__creds {
    display: flex;
    flex-direction: column;
    gap: 6px;
    padding: 10px 12px;
    border-radius: var(--radius-md);
    background: rgba(var(--color-brand-violet-rgb), 0.06);
    border: 1px solid rgba(var(--color-brand-violet-rgb), 0.18);
  }

  &__creds-row {
    display: grid;
    grid-template-columns: 110px minmax(0, 1fr) auto;
    gap: 12px;
    align-items: center;
    padding: 6px 10px;
    border-radius: 6px;
    background: rgba(0, 0, 0, 0.18);
    border: 1px solid rgba(255, 255, 255, 0.04);
    cursor: pointer;
    transition: background-color 160ms var(--ease-out);
    text-align: left;

    &:hover {
      background: rgba(0, 0, 0, 0.28);
    }
  }

  &__creds-label {
    font-family: var(--font-family-mono);
    font-size: 11px;
    font-weight: 600;
    color: var(--color-text-muted);
    letter-spacing: 0.04em;
    text-transform: lowercase;
  }

  &__creds-value {
    font-family: var(--font-family-mono);
    font-size: 12px;
    color: var(--color-text-primary);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    min-width: 0;
  }

  &__creds-toggle {
    align-self: flex-start;
    background: none;
    border: none;
    padding: 2px 0;
    color: var(--color-brand-cyan);
    font-size: 11.5px;
    cursor: pointer;
    text-decoration: underline;
    text-decoration-color: rgba(91, 216, 255, 0.4);

    &:hover {
      color: var(--color-text-primary);
    }
  }

  // ---- Advanced manual entry ----
  &__advanced {
    summary {
      cursor: pointer;
      font-size: 12px;
      color: var(--color-text-muted);
      padding: 4px 0;
      list-style: none;

      &::marker {
        display: none;
      }
      &::before {
        content: '▸ ';
        margin-right: 4px;
      }
    }
    &[open] summary::before {
      content: '▾ ';
    }
  }

  &__advanced-form {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 8px;
    margin-top: 8px;

    @container (max-width: 480px) {
      grid-template-columns: 1fr;
    }
  }

  // ---- Cloudflared probe banner ----
  &__probe {
    display: grid;
    grid-template-columns: auto minmax(0, 1fr) auto;
    gap: 12px;
    align-items: center;
    padding: 10px 14px;
    border-radius: var(--radius-md);

    &--ok {
      background: rgba(var(--color-success-rgb), 0.06);
      border: 1px solid rgba(var(--color-success-rgb), 0.2);
      color: var(--color-success);
    }
    &--missing {
      background: rgba(var(--color-warning-rgb), 0.06);
      border: 1px solid rgba(var(--color-warning-rgb), 0.22);
      color: var(--color-warning);
    }
  }

  &__probe-copy {
    display: flex;
    flex-direction: column;
    gap: 2px;
    color: var(--color-text-primary);

    strong {
      font-size: 13px;
      font-weight: 600;
    }
    span {
      font-size: 12px;
      color: var(--color-text-secondary);
    }
  }

  &__probe-actions {
    display: flex;
    gap: 8px;
    flex-wrap: wrap;
  }

  &__form-actions {
    display: flex;
    justify-content: flex-end;
  }

  // ---- URLs ----
  &__urls {
    display: flex;
    flex-direction: column;
    gap: 10px;
    padding: 14px 16px;
    border-radius: var(--radius-md);
    background: rgba(var(--color-success-rgb), 0.04);
    border: 1px solid rgba(var(--color-success-rgb), 0.16);
  }

  &__url {
    display: grid;
    grid-template-columns: 180px minmax(0, 1fr);
    gap: 8px 16px;
    align-items: center;

    @container (max-width: 680px) {
      grid-template-columns: 1fr;
    }
  }

  &__url-label {
    font-size: 12px;
    font-weight: 600;
    color: var(--color-text-muted);
  }

  &__url-value {
    display: inline-flex;
    align-items: center;
    gap: 8px;
    padding: 6px 10px;
    border-radius: 6px;
    background: rgba(255, 255, 255, 0.04);
    border: 1px solid rgba(255, 255, 255, 0.06);
    color: var(--color-text-primary);
    font-family: var(--font-family-mono);
    font-size: 12px;
    cursor: pointer;
    transition: background-color 160ms var(--ease-out);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    justify-self: start;
    max-width: 100%;

    code {
      flex: 1 1 auto;
      min-width: 0;
      overflow: hidden;
      text-overflow: ellipsis;
    }

    &:hover {
      background: rgba(255, 255, 255, 0.08);
    }
  }

  &__url-hint {
    grid-column: 1 / -1;
    font-size: 11.5px;
    color: var(--color-text-muted);
  }

  // ---- Misc ----
  &__error {
    margin: 0;
    padding: 10px 14px;
    border-radius: var(--radius-md);
    background: rgba(var(--color-danger-rgb), 0.08);
    border: 1px solid rgba(var(--color-danger-rgb), 0.22);
    color: var(--color-danger);
    font-size: 13px;
  }

  &__chip {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    padding: 4px 10px;
    border-radius: 999px;
    font-size: 12px;
    font-weight: 600;
    color: var(--color-text-muted);
    background: rgba(255, 255, 255, 0.04);
    border: 1px solid rgba(255, 255, 255, 0.05);

    &.is-success {
      color: var(--color-success);
      background: rgba(var(--color-success-rgb), 0.1);
      border-color: rgba(var(--color-success-rgb), 0.28);
    }
    &.is-warn {
      color: var(--color-warning);
      background: rgba(var(--color-warning-rgb), 0.1);
      border-color: rgba(var(--color-warning-rgb), 0.28);
    }
    &.is-info {
      color: var(--color-brand-pink);
      background: rgba(var(--color-brand-pink-rgb), 0.12);
      border-color: rgba(var(--color-brand-pink-rgb), 0.32);
    }
  }

  &__chip-dot {
    width: 6px;
    height: 6px;
    border-radius: 50%;
    background: currentColor;
  }

  &__activity {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
    gap: 12px;
    padding: 14px 16px;
    border-radius: var(--radius-md);
    background: rgba(255, 255, 255, 0.02);
    border: 1px solid rgba(255, 255, 255, 0.04);
  }

  &__activity-row {
    display: flex;
    flex-direction: column;
    gap: 4px;

    strong {
      font-size: 14px;
      font-family: var(--font-family-display);
      font-variant-numeric: tabular-nums;
      color: var(--color-text-primary);
    }
    &.has-errors strong {
      color: var(--color-danger);
    }
  }

  &__activity-label {
    font-size: 11px;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    color: var(--color-text-muted);
  }

  // ---- Quick-action: один-клик автомат «открыть консоль + скопировать всё» ----
  &__quick-action {
    display: grid;
    grid-template-columns: auto minmax(0, 1fr);
    gap: 14px;
    align-items: center;
    padding: 14px 18px;
    border-radius: var(--radius-lg);
    background: linear-gradient(
      90deg,
      rgba(var(--color-brand-violet-rgb), 0.16),
      rgba(var(--color-brand-pink-rgb), 0.08) 70%,
      transparent
    );
    border: 1px solid rgba(var(--color-brand-violet-rgb), 0.32);
    color: var(--color-text-primary);
    cursor: pointer;
    text-align: left;
    transition:
      transform 220ms var(--ease-out),
      border-color 220ms var(--ease-out),
      background 220ms var(--ease-out);

    &:hover {
      border-color: rgba(var(--color-brand-pink-rgb), 0.5);
      transform: translateX(2px);
    }
  }

  &__quick-copy {
    display: flex;
    flex-direction: column;
    gap: 2px;
    min-width: 0;

    strong {
      font-size: 14px;
      font-weight: 700;
    }
    span {
      font-size: 12.5px;
      color: var(--color-text-secondary);
    }
  }

  // ---- Inline cloudflared install progress ----
  &__install {
    display: flex;
    flex-direction: column;
    gap: 8px;
    padding: 12px 16px;
    border-radius: var(--radius-md);
    background: rgba(var(--color-brand-violet-rgb), 0.06);
    border: 1px solid rgba(var(--color-brand-violet-rgb), 0.22);
  }

  &__install-head {
    display: flex;
    justify-content: space-between;
    align-items: baseline;
    gap: 12px;
    flex-wrap: wrap;

    strong {
      font-size: 13px;
      font-weight: 600;
      color: var(--color-text-primary);
    }
    span {
      font-size: 12px;
      color: var(--color-text-secondary);
      font-variant-numeric: tabular-nums;
    }
  }

  &__install-bar {
    width: 100%;
    height: 4px;
    border-radius: 2px;
    background: rgba(255, 255, 255, 0.06);
    overflow: hidden;
    position: relative;
  }

  &__install-bar-fill {
    position: absolute;
    inset: 0;
    border-radius: inherit;
    width: var(--w, 0%);
    background: linear-gradient(
      90deg,
      var(--color-brand-violet),
      var(--color-brand-pink)
    );
    transition: width 200ms linear;

    &.is-indeterminate {
      width: 35%;
      animation: skillInstallSlide 1.6s linear infinite;
    }
  }

  @keyframes skillInstallSlide {
    0% { transform: translateX(-100%); }
    100% { transform: translateX(285%); }
  }

  &__guide-link {
    display: inline-flex;
    align-items: center;
    gap: 8px;
    padding: 6px 0;
    border: 0;
    background: transparent;
    color: var(--color-text-muted);
    font-size: 12px;
    cursor: pointer;
    text-align: left;
    align-self: flex-start;
    transition: color 160ms var(--ease-out);

    span {
      border-bottom: 1px dashed currentColor;
    }
    &:hover {
      color: var(--color-brand-cyan);
    }
  }

  // ---- Reachability ----
  &__reach {
    display: grid;
    grid-template-columns: auto minmax(0, 1fr) auto;
    gap: 12px;
    align-items: center;
    padding: 10px 14px;
    border-radius: var(--radius-md);
    border: 1px solid rgba(255, 255, 255, 0.07);
    background: rgba(255, 255, 255, 0.02);

    &--ok {
      background: rgba(var(--color-success-rgb), 0.06);
      border-color: rgba(var(--color-success-rgb), 0.28);
      color: var(--color-success);
    }
    &--bad {
      background: rgba(var(--color-warning-rgb), 0.06);
      border-color: rgba(var(--color-warning-rgb), 0.32);
      color: var(--color-warning);
    }
  }

  &__reach-copy {
    display: flex;
    flex-direction: column;
    gap: 2px;
    min-width: 0;

    strong {
      font-size: 13px;
      font-weight: 600;
      color: var(--color-text-primary);
      font-variant-numeric: tabular-nums;
    }
    span {
      font-size: 11.5px;
      color: var(--color-text-secondary);
      line-height: 1.45;
    }
  }

  // ---- Token owner ----
  &__owner {
    display: grid;
    grid-template-columns: auto minmax(0, 1fr) auto;
    gap: 12px;
    align-items: center;
    margin-top: 8px;
    padding: 10px 14px;
    border-radius: var(--radius-md);
    border: 1px solid rgba(255, 255, 255, 0.07);
    background: rgba(255, 255, 255, 0.02);

    &--ok {
      background: rgba(var(--color-success-rgb), 0.06);
      border-color: rgba(var(--color-success-rgb), 0.28);
      color: var(--color-success);
    }
    &--bad {
      background: rgba(var(--color-danger-rgb), 0.06);
      border-color: rgba(var(--color-danger-rgb), 0.32);
      color: var(--color-danger);
    }
  }

  &__owner-copy {
    display: flex;
    flex-direction: column;
    gap: 2px;
    min-width: 0;

    strong {
      font-size: 13px;
      font-weight: 600;
      color: var(--color-text-primary);
    }
    span {
      font-size: 11.5px;
      color: var(--color-text-secondary);
    }
  }
}

// ---- Mobile / narrow tablet: 1-колоночные раскладки ----
@media (max-width: 720px) {
  .skill-bridge {
    gap: 14px;

    &__hero {
      grid-template-columns: auto minmax(0, 1fr);
      grid-template-rows: auto auto;
      gap: 10px 14px;
      padding: 14px 16px;
    }

    &__hero-meta {
      grid-column: 1 / -1;
      flex-wrap: wrap;
    }

    &__card {
      padding: 16px;
      gap: 14px;
    }

    &__card-head {
      grid-template-columns: auto minmax(0, 1fr);
      gap: 12px;

      // Action-кнопка под текстом, full-width.
      > :last-child:not(.skill-bridge__card-copy):not(.skill-bridge__card-num) {
        grid-column: 1 / -1;
        justify-self: stretch;
      }
    }

    &__form {
      grid-template-columns: 1fr;
    }

    &__field-header {
      flex-direction: column;
      align-items: stretch;
      gap: 8px;
    }

    &__creds-row {
      // На узком: label над code, не сбоку.
      grid-template-columns: minmax(0, 1fr) auto;
      grid-template-rows: auto auto;
      gap: 4px 8px;
    }

    &__creds-label {
      grid-column: 1 / -1;
      grid-row: 1;
    }

    &__creds-value {
      grid-column: 1;
      grid-row: 2;
    }

    &__url {
      grid-template-columns: 1fr;
      gap: 4px;
    }

    &__probe {
      grid-template-columns: auto minmax(0, 1fr);
      grid-template-rows: auto auto;
      gap: 8px 12px;
    }

    &__probe-actions {
      grid-column: 1 / -1;
    }

    &__form-actions :deep(.btn),
    &__form-actions {
      width: 100%;

      :deep(.btn) {
        width: 100%;
      }
    }
  }
}
</style>
