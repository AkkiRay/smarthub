<template>
  <div class="speaker-surface">
    <!-- ================================================================== -->
    <!-- Hero: speaker-only визуал, заменяет generic device-hero. Большой   -->
    <!-- бейдж колонки, имя/комната, IP/платформа, эквалайзер-визуализация -->
    <!-- состояния Алисы (IDLE / LISTENING / SPEAKING / BUSY).             -->
    <!-- ================================================================== -->
    <article class="speaker-hero" :data-state="aliceState" data-anim="block">
      <!-- Hero-orb: размер lg + spectral analyzer вокруг — голос Алисы виден
           как радиальная волна, а не маленький бейдж. Sidebar/AliceView/Welcome
           переиспользуют тот же компонент. -->
      <div class="speaker-hero__orb" aria-hidden="true">
        <JarvisOrb size="lg" voice-mode spectrum :voice-state="station.voiceState" :detail="3" />
      </div>

      <div class="speaker-hero__copy">
        <span class="speaker-hero__eyebrow text--micro">{{ stationModel }}</span>
        <h2 class="speaker-hero__title">{{ device.name }}</h2>
        <div class="speaker-hero__meta">
          <span class="speaker-hero__chip" :data-tone="connectionTone">
            <span class="speaker-hero__chip-dot" />
            {{ connectionLabel }}
          </span>
          <span v-if="device.room" class="speaker-hero__meta-item">
            <BaseIcon name="rooms" :size="12" />
            {{ device.room }}
          </span>
          <span v-if="hostLabel" class="speaker-hero__meta-item speaker-hero__meta-item--mono">
            {{ hostLabel }}
          </span>
        </div>
        <p class="speaker-hero__alice">{{ aliceStateLabel }}</p>
      </div>
    </article>

    <!-- ================================================================== -->
    <!-- Banner: локальный glagol-канал не подключён.                       -->
    <!-- Большая часть кнопок ниже использует sendText() через WS — без    -->
    <!-- сессии всё упадёт в toast «Колонка не подключена». Лучше показать -->
    <!-- явный CTA, чем 8 фейловых тостов подряд.                          -->
    <!-- ================================================================== -->
    <article v-if="!isOnline" class="speaker-offline" :data-state="offlineState" data-anim="block">
      <span class="speaker-offline__icon" aria-hidden="true">
        <BaseIcon name="bluetooth" :size="22" />
      </span>
      <div class="speaker-offline__copy">
        <strong>{{ offlineHeadline }}</strong>
        <span>{{ offlineHint }}</span>
      </div>
      <BaseButton
        variant="primary"
        size="sm"
        icon-right="arrow-right"
        @click="$router.push('/alice')"
      >
        {{ offlineCta }}
      </BaseButton>
    </article>

    <!-- ================================================================== -->
    <!-- Now playing + volume + transport + log — переиспользуем            -->
    <!-- AliceStationPanel; внутри уже есть всё.                            -->
    <!-- ================================================================== -->
    <div data-anim="block">
      <AliceStationPanel />
    </div>

    <!-- ================================================================== -->
    <!-- Категории — переключаются как разделы, каждый раздел — карточка.   -->
    <!-- ================================================================== -->
    <BaseSegmented
      v-model="activeCategory"
      :options="categoryOptions"
      class="speaker-surface__nav"
      data-anim="block"
    />

    <!-- Tab-stage: relative-якорь + cross-fade при свапе категорий. Старая
         категория позиционируется absolute, новая занимает flow — никакого
         «прыжка» между announce/music/sounds/info/.../stream. -->
    <div class="speaker-tab-stage">
      <Transition :name="motion ? 'tab-fade' : 'tab-fade-instant'">
        <div :key="activeCategory" class="speaker-tab-stage__inner">
          <!-- ============================ Announce ============================ -->
          <article v-if="activeCategory === 'announce'" class="speaker-card" data-anim="block">
            <header class="speaker-card__head">
              <span class="speaker-card__icon" aria-hidden="true">
                <BaseIcon name="alice" :size="18" />
              </span>
              <div class="speaker-card__copy">
                <h3 class="speaker-card__title">Произвольная команда</h3>
                <p class="speaker-card__desc">
                  Колонка озвучит текст и одновременно обработает его как голосовой запрос Алисы.
                  Можно использовать для семейных объявлений или триггеров навыков.
                </p>
              </div>
            </header>

            <div class="speaker-card__sender">
              <BaseInput
                v-model="commandText"
                placeholder="Например: «ужин готов» или «включи свет на кухне»"
                class="speaker-card__sender-input"
                @keyup.enter="onSend"
              />
              <BaseButton
                variant="primary"
                icon-right="arrow-right"
                :disabled="cannotSend || !commandText.trim()"
                :loading="busy"
                @click="onSend"
              >
                Отправить
              </BaseButton>
            </div>
          </article>

          <!-- ============================ Music =============================== -->
          <article v-if="activeCategory === 'music'" class="speaker-card" data-anim="block">
            <header class="speaker-card__head">
              <span class="speaker-card__icon" aria-hidden="true">
                <BaseIcon name="music" :size="18" />
              </span>
              <div class="speaker-card__copy">
                <h3 class="speaker-card__title">Музыка и подкасты</h3>
                <p class="speaker-card__desc">
                  Команды Я.Музыки. Колонка поднимет источник, который доступен в подписке аккаунта.
                </p>
              </div>
            </header>

            <div class="speaker-card__chips">
              <button
                v-for="q in musicCommands"
                :key="q.text"
                type="button"
                class="speaker-card__chip"
                :disabled="cannotSend"
                @click="runQuick(q.text)"
              >
                <BaseIcon :name="q.icon" :size="13" />
                <span>{{ q.label }}</span>
              </button>
            </div>

            <div class="speaker-card__row">
              <BaseInput
                v-model="customMusicQuery"
                placeholder="Поставь группу Кино"
                class="speaker-card__row-input"
                @keyup.enter="onRunCustomMusic"
              />
              <BaseButton
                variant="ghost"
                icon-right="arrow-right"
                :disabled="cannotSend || !customMusicQuery.trim()"
                @click="onRunCustomMusic"
              >
                Поставить
              </BaseButton>
            </div>
          </article>

          <!-- ============================ Sounds ============================== -->
          <article v-if="activeCategory === 'sounds'" class="speaker-card" data-anim="block">
            <header class="speaker-card__head">
              <span class="speaker-card__icon" aria-hidden="true">
                <BaseIcon name="scene-sleep" :size="18" />
              </span>
              <div class="speaker-card__copy">
                <h3 class="speaker-card__title">Звуки и сон</h3>
                <p class="speaker-card__desc">
                  Встроенные эмбиентные сцены, сказки на ночь и колыбельные.
                </p>
              </div>
            </header>
            <div class="speaker-card__chips">
              <button
                v-for="q in soundsCommands"
                :key="q.text"
                type="button"
                class="speaker-card__chip"
                :disabled="cannotSend"
                @click="runQuick(q.text)"
              >
                <BaseIcon :name="q.icon" :size="13" />
                <span>{{ q.label }}</span>
              </button>
            </div>
          </article>

          <!-- ============================ Info ================================ -->
          <article v-if="activeCategory === 'info'" class="speaker-card" data-anim="block">
            <header class="speaker-card__head">
              <span class="speaker-card__icon" aria-hidden="true">
                <BaseIcon name="info" :size="18" />
              </span>
              <div class="speaker-card__copy">
                <h3 class="speaker-card__title">Информация</h3>
                <p class="speaker-card__desc">
                  Быстрые запросы — Алиса отвечает голосом. Полезно, когда руки заняты.
                </p>
              </div>
            </header>
            <div class="speaker-card__chips">
              <button
                v-for="q in infoCommands"
                :key="q.text"
                type="button"
                class="speaker-card__chip"
                :disabled="cannotSend"
                @click="runQuick(q.text)"
              >
                <BaseIcon :name="q.icon" :size="13" />
                <span>{{ q.label }}</span>
              </button>
            </div>
          </article>

          <!-- ============================ Smart home ========================== -->
          <article v-if="activeCategory === 'home'" class="speaker-card" data-anim="block">
            <header class="speaker-card__head">
              <span class="speaker-card__icon" aria-hidden="true">
                <BaseIcon name="devices" :size="18" />
              </span>
              <div class="speaker-card__copy">
                <h3 class="speaker-card__title">Умный дом</h3>
                <p class="speaker-card__desc">
                  Команды для устройств, которые видит Алиса (привязанные через Я.Дом или
                  экспонированные нашим skill'ом).
                </p>
              </div>
            </header>
            <div class="speaker-card__chips">
              <button
                v-for="q in homeCommands"
                :key="q.text"
                type="button"
                class="speaker-card__chip"
                :disabled="cannotSend"
                @click="runQuick(q.text)"
              >
                <BaseIcon :name="q.icon" :size="13" />
                <span>{{ q.label }}</span>
              </button>
            </div>
          </article>

          <!-- ============================ Timer/Alarm ========================= -->
          <article v-if="activeCategory === 'timer'" class="speaker-card" data-anim="block">
            <header class="speaker-card__head">
              <span class="speaker-card__icon" aria-hidden="true">
                <BaseIcon name="timer" :size="18" />
              </span>
              <div class="speaker-card__copy">
                <h3 class="speaker-card__title">Таймер и будильник</h3>
                <p class="speaker-card__desc">
                  Алиса поставит таймер сразу — будильник попросит подтвердить время голосом.
                </p>
              </div>
            </header>

            <div class="speaker-card__timer">
              <span class="speaker-card__timer-label">Поставить таймер</span>
              <div class="speaker-card__timer-row">
                <BaseInput
                  v-model.number="timerMinutes"
                  type="number"
                  placeholder="15"
                  class="speaker-card__timer-field"
                />
                <span class="speaker-card__timer-unit">минут</span>
                <BaseButton
                  variant="primary"
                  icon-right="arrow-right"
                  :disabled="cannotSend || !timerMinutes || timerMinutes < 1"
                  @click="onSetTimer"
                >
                  Поставить
                </BaseButton>
              </div>
            </div>

            <div class="speaker-card__chips">
              <button
                v-for="q in timerCommands"
                :key="q.text"
                type="button"
                class="speaker-card__chip"
                :disabled="cannotSend"
                @click="runQuick(q.text)"
              >
                <BaseIcon :name="q.icon" :size="13" />
                <span>{{ q.label }}</span>
              </button>
            </div>
          </article>

          <!-- ============================ Equalizer =========================== -->
          <article v-if="activeCategory === 'eq'" class="speaker-card" data-anim="block">
            <header class="speaker-card__head">
              <span class="speaker-card__icon" aria-hidden="true">
                <BaseIcon name="equalizer" :size="18" />
              </span>
              <div class="speaker-card__copy">
                <h3 class="speaker-card__title">Эквалайзер</h3>
                <p class="speaker-card__desc">
                  Готовые пресеты звука. На разных платформах список немного отличается — если
                  пресет не знаком, станция ответит голосом.
                </p>
              </div>
            </header>
            <div class="speaker-card__chips">
              <button
                v-for="q in eqCommands"
                :key="q.text"
                type="button"
                class="speaker-card__chip"
                :disabled="cannotSend"
                @click="runQuick(q.text)"
              >
                <BaseIcon :name="q.icon" :size="13" />
                <span>{{ q.label }}</span>
              </button>
            </div>
          </article>

          <!-- ============================ Stream from PC ====================== -->
          <article
            v-if="activeCategory === 'stream'"
            class="speaker-card speaker-card--stream"
            data-anim="block"
          >
            <header class="speaker-card__head">
              <span class="speaker-card__icon speaker-card__icon--accent" aria-hidden="true">
                <BaseIcon name="speaker" :size="18" />
              </span>
              <div class="speaker-card__copy">
                <h3 class="speaker-card__title">Стрим звука с ПК (Spotify, YouTube, игры)</h3>
                <p class="speaker-card__desc">
                  Я.Станция — закрытая экосистема:
                  <strong>нет ни DLNA, ни Spotify Connect, ни Chromecast Audio</strong>. Официально
                  работают только Bluetooth A2DP (все модели) и AirPlay 2 (только Станция Макс).
                  Третий путь — голосовая Я.Музыка по подписке.
                </p>
              </div>
            </header>

            <section class="speaker-path speaker-path--primary">
              <header class="speaker-path__head">
                <span class="speaker-path__badge">Рекомендуем · работает всегда</span>
                <h4 class="speaker-path__title">Bluetooth A2DP — любой звук с ПК</h4>
                <p class="speaker-path__desc">
                  <strong
                    >Единственный универсальный путь для Spotify, YouTube, Discord, игр</strong
                  >
                  на любую модель Я.Станции. На ПК без Bluetooth подойдёт USB-донгл за 300 ₽.
                </p>
              </header>
              <ol class="speaker-steps">
                <li class="speaker-step">
                  <span class="speaker-step__num">1</span>
                  <div class="speaker-step__copy">
                    <strong>Включите Bluetooth у колонки</strong>
                    <span>Скажите «Алиса, включи блютуз» или нажмите кнопку.</span>
                  </div>
                  <BaseButton
                    variant="primary"
                    size="sm"
                    icon-left="alice"
                    :disabled="cannotSend"
                    @click="onEnableBluetooth"
                  >
                    Включить BT
                  </BaseButton>
                </li>
                <li class="speaker-step">
                  <span class="speaker-step__num">2</span>
                  <div class="speaker-step__copy">
                    <strong>Спарьте ПК со станцией</strong>
                    <span>«Bluetooth и устройства» → «Добавить устройство» → станция.</span>
                  </div>
                  <BaseButton
                    variant="ghost"
                    size="sm"
                    icon-right="arrow-right"
                    @click="onOpenBluetoothSettings"
                  >
                    Открыть BT
                  </BaseButton>
                </li>
                <li class="speaker-step">
                  <span class="speaker-step__num">3</span>
                  <div class="speaker-step__copy">
                    <strong>Сделайте станцию устройством по умолчанию</strong>
                    <span>Звук → Output → выберите станцию. Открывайте Spotify — готово.</span>
                  </div>
                  <BaseButton
                    variant="ghost"
                    size="sm"
                    icon-right="arrow-right"
                    @click="onOpenSoundSettings"
                  >
                    Звук Windows
                  </BaseButton>
                </li>
                <li class="speaker-step">
                  <span class="speaker-step__num">4</span>
                  <div class="speaker-step__copy">
                    <strong>После работы — выключите Bluetooth у колонки</strong>
                    <span>Иначе соседнее устройство может перехватить станцию.</span>
                  </div>
                  <BaseButton
                    variant="ghost"
                    size="sm"
                    icon-left="close"
                    :disabled="cannotSend"
                    @click="onDisableBluetooth"
                  >
                    Выключить BT
                  </BaseButton>
                </li>
              </ol>
            </section>

            <section class="speaker-path">
              <header class="speaker-path__head">
                <span class="speaker-path__badge speaker-path__badge--alt"
                  >Только Станция Макс</span
                >
                <h4 class="speaker-path__title">AirPlay 2 — Wi-Fi без Bluetooth</h4>
                <p class="speaker-path__desc">
                  На <strong>Я.Станции Макс</strong> AirPlay 2 добавлен в обновлении прошивки. На
                  macOS работает нативно; на Windows нужен <strong>TuneBlade</strong> (≈ $10, free
                  trial) — он транслирует системный звук на любой AirPlay-приёмник, включая Spotify
                  и игры.
                </p>
              </header>
              <ol class="speaker-steps">
                <li class="speaker-step">
                  <span class="speaker-step__num">1</span>
                  <div class="speaker-step__copy">
                    <strong>macOS: AirPlay-иконка в строке меню → станция</strong>
                    <span>Любой звук системы пойдёт на колонку.</span>
                  </div>
                </li>
                <li class="speaker-step">
                  <span class="speaker-step__num">2</span>
                  <div class="speaker-step__copy">
                    <strong>Windows: установите TuneBlade</strong>
                    <span>В трее выберите станцию из AirPlay-списка.</span>
                  </div>
                  <BaseButton
                    variant="ghost"
                    size="sm"
                    icon-right="arrow-right"
                    @click="onOpenTuneBlade"
                  >
                    TuneBlade
                  </BaseButton>
                </li>
              </ol>
            </section>

            <section class="speaker-path">
              <header class="speaker-path__head">
                <span class="speaker-path__badge speaker-path__badge--alt">Только Я.Музыка</span>
                <h4 class="speaker-path__title">Я.Музыка → передать на колонку</h4>
                <p class="speaker-path__desc">
                  Технически это <strong>не стрим с ПК</strong>, а удалённое управление: ПК говорит
                  станции «играй трек X», звук идёт из облака Яндекса. Spotify/YouTube/системный
                  звук <strong>не пойдут</strong>.
                </p>
              </header>
              <ol class="speaker-steps">
                <li class="speaker-step">
                  <span class="speaker-step__num">1</span>
                  <div class="speaker-step__copy">
                    <strong>Откройте music.yandex.ru с тем же аккаунтом</strong>
                    <span>В плеере появится иконка «Передать» — выберите свою станцию.</span>
                  </div>
                  <BaseButton
                    variant="ghost"
                    size="sm"
                    icon-right="arrow-right"
                    @click="onOpenYandexMusic"
                  >
                    Я.Музыка
                  </BaseButton>
                </li>
                <li class="speaker-step">
                  <span class="speaker-step__num">2</span>
                  <div class="speaker-step__copy">
                    <strong>Или скажите голосом</strong>
                    <span>«Алиса, включи Яндекс Музыку» — без участия ПК.</span>
                  </div>
                  <BaseButton
                    variant="ghost"
                    size="sm"
                    icon-left="alice"
                    :disabled="cannotSend"
                    @click="onYandexMusicVoice"
                  >
                    Сказать
                  </BaseButton>
                </li>
              </ol>
            </section>
          </article>
        </div>
      </Transition>
    </div>
  </div>
</template>

<script setup lang="ts">
// Полный пульт Я.Станции для DeviceDetailView. Glagol-протокол
// (sendText / setVolume / play|stop|next|prev — внутри AliceStationPanel) +
// три honest-канала PC-аудио. Кастомный hero отображается вместо generic device-hero.

import { computed, ref } from 'vue';
import { storeToRefs } from 'pinia';
import type { Device } from '@smarthome/shared';
import { useYandexStationStore } from '@/stores/yandexStation';
import { useUiStore } from '@/stores/ui';
import AliceStationPanel from '@/components/alice/AliceStationPanel.vue';
import JarvisOrb from '@/components/visuals/JarvisOrb.vue';
import {
  BaseButton,
  BaseIcon,
  BaseInput,
  BaseSegmented,
  type IconName,
  type SegmentedOption,
} from '@/components/base';

defineProps<{ device: Device }>();

const station = useYandexStationStore();
const ui = useUiStore();
const { reduceMotion } = storeToRefs(ui);
const motion = computed(() => !reduceMotion.value);

// ---- Hero state ------------------------------------------------------------

const stationModel = computed(() => station.status?.station?.platform ?? 'Яндекс.Станция');

const connection = computed(() => station.status?.connection ?? 'disconnected');
const connectionLabel = computed(() => {
  switch (connection.value) {
    case 'connected':
      return 'В сети';
    case 'connecting':
      return 'Подключение…';
    case 'authenticating':
      return 'Аутентификация…';
    case 'error':
      return 'Ошибка соединения';
    default:
      return 'Не подключена';
  }
});
const connectionTone = computed<'success' | 'warn' | 'danger' | 'idle'>(() => {
  switch (connection.value) {
    case 'connected':
      return 'success';
    case 'connecting':
    case 'authenticating':
      return 'warn';
    case 'error':
      return 'danger';
    default:
      return 'idle';
  }
});

const hostLabel = computed(() => {
  const s = station.status?.station;
  if (!s?.host) return null;
  return `${s.host}:${s.port}`;
});

// Source of truth — `station.voiceState`, там корректный response-fallback
// (glagol часто пропускает явный SPEAKING → орб залипал на «думает» во время
// реальной речи Алисы). Здесь только маппим в локальный uppercase-enum +
// добавляем OFFLINE для disconnected.
const aliceState = computed<'IDLE' | 'BUSY' | 'LISTENING' | 'SPEAKING' | 'OFFLINE'>(() => {
  if (connection.value !== 'connected') return 'OFFLINE';
  switch (station.voiceState) {
    case 'listening':
      return 'LISTENING';
    case 'speaking':
      return 'SPEAKING';
    case 'busy':
      return 'BUSY';
    default:
      return 'IDLE';
  }
});

const aliceStateLabel = computed(() => {
  switch (aliceState.value) {
    case 'OFFLINE':
      return 'Колонка не отвечает — проверьте подключение к LAN';
    case 'LISTENING':
      return 'Алиса слушает…';
    case 'SPEAKING':
      return 'Алиса говорит…';
    case 'BUSY':
      return 'Алиса думает…';
    default:
      return 'Готова к команде. Скажите «Алиса…» или используйте панель ниже.';
  }
});

const isOnline = computed(() => connection.value === 'connected');
const isConfigured = computed(() => !!station.status?.configured);

const offlineState = computed<'unconfigured' | 'reconnecting' | 'error' | 'idle'>(() => {
  if (!isConfigured.value) return 'unconfigured';
  if (connection.value === 'connecting' || connection.value === 'authenticating')
    return 'reconnecting';
  if (connection.value === 'error') return 'error';
  return 'idle';
});

const offlineHeadline = computed(() => {
  switch (offlineState.value) {
    case 'unconfigured':
      return 'Колонка не привязана';
    case 'reconnecting':
      return 'Подключаемся к колонке…';
    case 'error':
      return 'Сессия с колонкой потеряна';
    default:
      return 'Локальный канал отключён';
  }
});

const offlineHint = computed(() => {
  switch (offlineState.value) {
    case 'unconfigured':
      return 'Привяжите станцию через mDNS или Quasar — после этого все команды ниже начнут работать через локальный glagol-канал.';
    case 'reconnecting':
      return 'Хаб открывает WS-сессию. Команды станут доступны после подтверждения handshake.';
    case 'error':
      return (
        station.status?.lastError ??
        'WS-сессия не открылась — возможно, колонка ушла из LAN или истёк device-token.'
      );
    default:
      return 'Команды ниже идут через локальный glagol-сервер колонки. Сейчас сессии нет — переподключитесь, чтобы пультом можно было пользоваться.';
  }
});

const offlineCta = computed(() =>
  offlineState.value === 'unconfigured' ? 'Привязать колонку' : 'Открыть подключение',
);

/** Единый guard для template-disabled — busy ИЛИ нет WS-сессии. */
const cannotSend = computed(() => busy.value || !isOnline.value);

// ---- Categories ------------------------------------------------------------

type Category = 'announce' | 'music' | 'sounds' | 'info' | 'home' | 'timer' | 'eq' | 'stream';
const activeCategory = ref<Category>('announce');

const categoryOptions = computed<SegmentedOption[]>(() => [
  { value: 'announce', label: 'Команды', icon: 'alice' },
  { value: 'music', label: 'Музыка', icon: 'music' },
  { value: 'sounds', label: 'Звуки', icon: 'scene-sleep' },
  { value: 'info', label: 'Инфо', icon: 'info' },
  { value: 'home', label: 'Дом', icon: 'devices' },
  { value: 'timer', label: 'Таймер', icon: 'timer' },
  { value: 'eq', label: 'Эквалайзер', icon: 'equalizer' },
  { value: 'stream', label: 'Стрим с ПК', icon: 'speaker' },
]);

// ---- Quick commands --------------------------------------------------------

interface QuickCommand {
  label: string;
  icon: IconName;
  text: string;
}

const musicCommands: QuickCommand[] = [
  { label: 'Включи музыку', icon: 'play', text: 'включи музыку' },
  { label: 'Поставь джаз', icon: 'music', text: 'поставь джаз' },
  { label: 'Лофи бит', icon: 'music', text: 'включи лофи' },
  { label: 'Подкаст', icon: 'music', text: 'включи подкаст' },
  { label: 'Радио Эрмитаж', icon: 'music', text: 'включи радио эрмитаж' },
  { label: 'Что играет', icon: 'info', text: 'что играет' },
  { label: 'Пауза', icon: 'pause', text: 'пауза' },
  { label: 'Громче', icon: 'volume', text: 'сделай громче' },
];

const soundsCommands: QuickCommand[] = [
  { label: 'Шум дождя', icon: 'scene-sleep', text: 'включи шум дождя' },
  { label: 'Белый шум', icon: 'scene-sleep', text: 'включи белый шум' },
  { label: 'Звуки леса', icon: 'scene-sleep', text: 'включи звуки леса' },
  { label: 'Колыбельная', icon: 'scene-sleep', text: 'включи колыбельную' },
  { label: 'Сказка на ночь', icon: 'scene-sleep', text: 'расскажи сказку' },
  { label: 'Звуки моря', icon: 'scene-sleep', text: 'включи звуки моря' },
];

const infoCommands: QuickCommand[] = [
  { label: 'Время', icon: 'clock', text: 'который час' },
  { label: 'Погода', icon: 'weather', text: 'какая сегодня погода' },
  { label: 'Новости', icon: 'news', text: 'расскажи новости' },
  { label: 'Курс рубля', icon: 'info', text: 'курс доллара' },
  { label: 'Пробки', icon: 'info', text: 'какие пробки' },
  { label: 'Что играет', icon: 'music', text: 'что играет' },
];

const homeCommands: QuickCommand[] = [
  { label: 'Включи свет', icon: 'light', text: 'включи свет' },
  { label: 'Выключи свет', icon: 'light', text: 'выключи свет' },
  { label: 'Выключи всё', icon: 'switch', text: 'выключи все устройства' },
  { label: 'Тёплый свет', icon: 'temperature', text: 'тёплый свет' },
  { label: 'Сцена «вечер»', icon: 'scene-movie', text: 'включи сценарий вечер' },
  { label: 'Сцена «сон»', icon: 'scene-sleep', text: 'включи сценарий сон' },
];

const timerCommands: QuickCommand[] = [
  { label: 'Таймер 5 мин', icon: 'timer', text: 'поставь таймер на 5 минут' },
  { label: 'Таймер 25 мин', icon: 'timer', text: 'поставь таймер на 25 минут' },
  { label: 'Таймер 1 час', icon: 'timer', text: 'поставь таймер на час' },
  { label: 'Сколько осталось', icon: 'clock', text: 'сколько осталось' },
  { label: 'Отмени таймер', icon: 'close', text: 'отмени таймер' },
  { label: 'Будильник на 7', icon: 'clock', text: 'поставь будильник на 7 утра' },
];

// Yandex station eq presets через voice request: префикс «включи эквалайзер»
// требуется для распознавания, иначе station отвечает «не понимаю».
const eqCommands: QuickCommand[] = [
  { label: 'Бас', icon: 'equalizer', text: 'включи эквалайзер бас' },
  { label: 'Вокал', icon: 'equalizer', text: 'включи эквалайзер вокал' },
  { label: 'Поп', icon: 'equalizer', text: 'включи эквалайзер поп' },
  { label: 'Рок', icon: 'equalizer', text: 'включи эквалайзер рок' },
  { label: 'Ночь', icon: 'equalizer', text: 'включи эквалайзер ночь' },
  { label: 'Сбросить', icon: 'refresh', text: 'выключи эквалайзер' },
];

// ---- State + actions -------------------------------------------------------

const commandText = ref('');
const customMusicQuery = ref('');
const timerMinutes = ref<number | ''>('');
const busy = ref(false);

async function send(payload: string): Promise<void> {
  if (!payload.trim() || busy.value) return;
  // Без WS-сессии каждый sendText вернёт {ok:false} и попадёт в toast как ошибка —
  // вместо этого один раз отдадим пользователя на экран привязки.
  if (!isOnline.value) return;
  busy.value = true;
  try {
    await station.sendCommand({ kind: 'sendText', payload: payload.trim() });
  } finally {
    busy.value = false;
  }
}

async function runQuick(text: string): Promise<void> {
  await send(text);
}

async function onSend(): Promise<void> {
  await send(commandText.value);
  commandText.value = '';
}

async function onRunCustomMusic(): Promise<void> {
  const q = customMusicQuery.value.trim();
  if (!q) return;
  await send(/^(включи|поставь)/i.test(q) ? q : `включи ${q}`);
  customMusicQuery.value = '';
}

async function onSetTimer(): Promise<void> {
  const m = Number(timerMinutes.value);
  if (!m || m < 1) return;
  await send(`поставь таймер на ${m} ${pluralizeMinutes(m)}`);
  timerMinutes.value = '';
}

function pluralizeMinutes(n: number): string {
  const m10 = n % 10;
  const m100 = n % 100;
  if (m100 >= 11 && m100 <= 14) return 'минут';
  if (m10 === 1) return 'минуту';
  if (m10 >= 2 && m10 <= 4) return 'минуты';
  return 'минут';
}

// ---- Stream actions --------------------------------------------------------

async function onEnableBluetooth(): Promise<void> {
  await send('включи блютуз');
}
async function onDisableBluetooth(): Promise<void> {
  await send('выключи блютуз');
}
function onOpenBluetoothSettings(): void {
  void window.smarthome.app.openExternal('ms-settings:bluetooth');
}
function onOpenSoundSettings(): void {
  void window.smarthome.app.openExternal('ms-settings:sound');
}
function onOpenTuneBlade(): void {
  void window.smarthome.app.openExternal('https://tuneblade.com/');
}
function onOpenYandexMusic(): void {
  void window.smarthome.app.openExternal('https://music.yandex.ru');
}
async function onYandexMusicVoice(): Promise<void> {
  await send('включи Яндекс Музыку');
}
</script>

<style scoped lang="scss">
@use '@/styles/abstracts/mixins' as *;

.speaker-surface {
  display: flex;
  flex-direction: column;
  gap: clamp(14px, 1.4vw, 20px);
  width: 100%;
  grid-column: 1 / -1;

  &__nav {
    align-self: flex-start;
  }
}

// Tab-stage: relative-якорь для cross-fade при смене категорий пульта.
// Отключаем `min-height: 0` — категории разной высоты, leave-active абсолютно
// позиционирован, новый контент сразу занимает финальную высоту.
.speaker-tab-stage {
  position: relative;
  width: 100%;

  &__inner {
    display: flex;
    flex-direction: column;
    gap: clamp(14px, 1.4vw, 20px);
    width: 100%;
  }
}

// Tab cross-fade: simultaneous (без mode) + leave-active абсолютно. Делит
// keyframes с AliceView через одинаковые имена `tab-fade-*`.
.tab-fade-enter-active,
.tab-fade-leave-active {
  transition:
    opacity 220ms var(--ease-out),
    transform 280ms var(--ease-out);
  will-change: opacity, transform;
}
.tab-fade-leave-active {
  position: absolute;
  inset: 0;
  width: 100%;
  pointer-events: none;
}
.tab-fade-enter-from {
  opacity: 0;
  transform: translateY(8px);
}
.tab-fade-leave-to {
  opacity: 0;
  transform: translateY(-4px);
}

.tab-fade-instant-leave-active {
  position: absolute;
  inset: 0;
  width: 100%;
  pointer-events: none;
}

// =============================================================================
// Offline banner — показывается, когда glagol-WS не подключён.
// =============================================================================
.speaker-offline {
  display: grid;
  grid-template-columns: 40px minmax(0, 1fr) auto;
  gap: clamp(12px, 1.4vw, 18px);
  align-items: center;
  padding: 14px clamp(14px, 1.6vw, 20px);
  border-radius: var(--radius-md);
  background:
    linear-gradient(
      130deg,
      color-mix(in srgb, var(--color-warning) 16%, transparent),
      color-mix(in srgb, var(--color-warning) 6%, transparent)
    ),
    rgba(255, 255, 255, 0.022);
  border: 1px solid color-mix(in srgb, var(--color-warning) 40%, transparent);

  &[data-state='reconnecting'] {
    background:
      linear-gradient(
        130deg,
        color-mix(in srgb, var(--color-brand-purple) 14%, transparent),
        color-mix(in srgb, var(--color-brand-pink) 8%, transparent)
      ),
      rgba(255, 255, 255, 0.022);
    border-color: color-mix(in srgb, var(--color-brand-purple) 38%, transparent);
  }

  &[data-state='error'] {
    background:
      linear-gradient(
        130deg,
        color-mix(in srgb, var(--color-danger) 18%, transparent),
        color-mix(in srgb, var(--color-danger) 6%, transparent)
      ),
      rgba(255, 255, 255, 0.022);
    border-color: color-mix(in srgb, var(--color-danger) 44%, transparent);
  }

  &__icon {
    width: 40px;
    height: 40px;
    border-radius: 12px;
    display: grid;
    place-items: center;
    background: rgba(255, 255, 255, 0.06);
    color: var(--color-text-primary);
  }

  &__copy {
    display: flex;
    flex-direction: column;
    gap: 3px;
    min-width: 0;

    strong {
      font-size: 14px;
      color: var(--color-text-primary);
      font-weight: 600;
    }
    span {
      font-size: 12.5px;
      color: var(--color-text-secondary);
      line-height: 1.5;
      text-wrap: pretty;
    }
  }

  @media (max-width: 720px) {
    grid-template-columns: 40px minmax(0, 1fr);
    grid-template-rows: auto auto;

    :deep(.btn) {
      grid-column: 1 / -1;
      justify-self: stretch;
    }
  }
}

// =============================================================================
// HERO — кастомный для speaker-устройств
// =============================================================================
.speaker-hero {
  --hero-accent: var(--color-brand-purple);
  position: relative;
  display: grid;
  grid-template-columns: auto minmax(0, 1fr);
  gap: clamp(20px, 2vw, 32px);
  align-items: center;
  padding: clamp(20px, 2vw, 28px) clamp(22px, 2.2vw, 32px);
  border-radius: var(--radius-lg);
  // Плоская поверхность вместо bubble-glass: single-tone background + hairline,
  // объём — через ambient drop-shadow и тонкое внутреннее highlight'а.
  background: rgba(255, 255, 255, 0.022);
  border: 1px solid rgba(255, 255, 255, 0.06);
  box-shadow:
    0 28px 80px -40px rgba(0, 0, 0, 0.7),
    0 12px 28px -22px rgba(var(--color-brand-purple-rgb), 0.28),
    inset 0 1px 0 rgba(255, 255, 255, 0.04);
  isolation: isolate;
  transition:
    background-color 280ms var(--ease-out),
    border-color 280ms var(--ease-out),
    box-shadow 280ms var(--ease-out);

  // Тонкая «сканирующая» линия — горизонтальная подсветка снизу, плывёт от
  // .speaker-hero[data-state]. Объёма не добавляет, но делает блок «живым»,
  // когда орб говорит.
  &::after {
    content: '';
    position: absolute;
    inset: auto 0 0 0;
    height: 1px;
    background: linear-gradient(
      90deg,
      transparent 0%,
      rgba(var(--color-brand-pink-rgb), 0.7) 25%,
      rgba(var(--color-brand-purple-rgb), 0.7) 75%,
      transparent 100%
    );
    transform-origin: 50% 50%;
    opacity: 0;
    transition: opacity 320ms var(--ease-out);
    pointer-events: none;
  }

  &[data-state='LISTENING']::after,
  &[data-state='SPEAKING']::after {
    opacity: 0.55;
    animation: speakerHeroScan 2.8s ease-in-out infinite;
  }

  @media (max-width: 720px) {
    grid-template-columns: minmax(0, 1fr);
    grid-template-rows: auto auto;
    justify-items: center;
    text-align: center;
  }
}

// Hero-orb: достаточно крупный чтобы spectrum-бары читались, но не теснит контент.
// Размер задаём здесь, JarvisOrb пробрасывает через --orb-size CSS-переменную.
.speaker-hero__orb {
  position: relative;
  width: clamp(150px, 14vw, 180px);
  height: clamp(150px, 14vw, 180px);
  flex-shrink: 0;
  display: grid;
  place-items: center;

  :deep(.orb) {
    --orb-size: clamp(150px, 14vw, 180px);
  }
}

@keyframes speakerHeroScan {
  0%,
  100% {
    transform: scaleX(0.4);
    opacity: 0.2;
  }
  50% {
    transform: scaleX(1);
    opacity: 0.55;
  }
}

.speaker-hero__copy {
  display: flex;
  flex-direction: column;
  gap: 8px;
  min-width: 0;
}

.speaker-hero__eyebrow {
  color: var(--color-text-muted);
  font-family: var(--font-family-mono);
  letter-spacing: 0.08em;
}

.speaker-hero__title {
  font-family: var(--font-family-display);
  font-size: var(--font-size-h1);
  font-weight: 700;
  letter-spacing: -0.018em;
  line-height: 1.15;
  color: var(--color-text-primary);
  margin: 0;
  text-wrap: balance;
  overflow-wrap: anywhere;
}

.speaker-hero__meta {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  align-items: center;
}

.speaker-hero__chip {
  display: inline-flex;
  align-items: center;
  gap: 7px;
  padding: 4px 11px;
  border-radius: 999px;
  background: rgba(255, 255, 255, 0.05);
  border: 1px solid rgba(255, 255, 255, 0.08);
  font-size: 12px;
  font-weight: 500;
  color: var(--color-text-secondary);

  &-dot {
    width: 7px;
    height: 7px;
    border-radius: 50%;
    background: var(--color-text-muted);
  }

  &[data-tone='success'] {
    background: rgba(var(--color-success-rgb), 0.12);
    border-color: rgba(var(--color-success-rgb), 0.32);
    color: var(--color-success);

    .speaker-hero__chip-dot {
      background: var(--color-success);
      animation: heroChipPulse 2s ease-out infinite;
    }
  }
  &[data-tone='warn'] {
    background: rgba(var(--color-warning-rgb), 0.12);
    border-color: rgba(var(--color-warning-rgb), 0.32);
    color: var(--color-warning);

    .speaker-hero__chip-dot {
      background: var(--color-warning);
    }
  }
  &[data-tone='danger'] {
    background: rgba(var(--color-danger-rgb), 0.12);
    border-color: rgba(var(--color-danger-rgb), 0.32);
    color: var(--color-danger);

    .speaker-hero__chip-dot {
      background: var(--color-danger);
    }
  }
}

.speaker-hero__meta-item {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  font-size: 12px;
  color: var(--color-text-muted);

  &--mono {
    font-family: var(--font-family-mono);
  }
}

.speaker-hero__alice {
  margin: 0;
  font-size: 13.5px;
  color: var(--color-text-secondary);
  line-height: 1.55;
  text-wrap: pretty;
  max-width: 56ch;
}

// =============================================================================
// CARDS (категории)
// =============================================================================
.speaker-card {
  container-type: inline-size;
  position: relative;
  border-radius: var(--radius-lg);
  background: var(--color-bg-surface);
  border: var(--border-thin) solid var(--color-border-subtle);
  padding: clamp(20px, 2vw, 28px) clamp(20px, 2vw, 30px);
  display: flex;
  flex-direction: column;
  gap: clamp(14px, 1.4vw, 20px);
  overflow: hidden;
  isolation: isolate;
  transition:
    background-color var(--dur-fast) var(--ease-out),
    border-color var(--dur-fast) var(--ease-out);

  // Brand accent hairline сверху — flat plane без bubble-glass.
  &::before {
    content: '';
    position: absolute;
    top: 0;
    left: 0;
    right: 0;
    height: 1px;
    background: linear-gradient(
      90deg,
      transparent 0%,
      rgba(var(--color-brand-violet-rgb), 0.32) 30%,
      rgba(var(--color-brand-pink-rgb), 0.28) 70%,
      transparent 100%
    );
    pointer-events: none;
    opacity: 0.7;
    transition: opacity var(--dur-medium) var(--ease-out);
  }

  &:hover {
    background: var(--color-bg-elevated);
    border-color: var(--color-border-soft);

    &::before {
      opacity: 1;
    }
  }

  &--stream {
    background:
      linear-gradient(
        135deg,
        rgba(var(--color-brand-violet-rgb), 0.06) 0%,
        rgba(var(--color-brand-pink-rgb), 0.04) 100%
      ),
      var(--color-bg-surface);
  }

  &__head {
    display: grid;
    grid-template-columns: 40px minmax(0, 1fr);
    gap: 14px;
    align-items: start;
  }

  &__icon {
    width: 40px;
    height: 40px;
    border-radius: 12px;
    display: grid;
    place-items: center;
    background: rgba(255, 255, 255, 0.05);
    color: var(--color-text-secondary);

    &--accent {
      background: rgba(var(--color-brand-violet-rgb), 0.14);
      color: var(--color-brand-violet);
    }
  }

  &__copy {
    display: flex;
    flex-direction: column;
    gap: 6px;
    min-width: 0;
  }

  &__title {
    font-family: var(--font-family-display);
    font-size: var(--font-size-h2);
    font-weight: 600;
    letter-spacing: var(--tracking-h1);
    color: var(--color-text-primary);
    margin: 0;
  }

  &__desc {
    font-size: var(--font-size-small);
    color: var(--color-text-secondary);
    line-height: 1.55;
    margin: 0;
    max-width: 72ch;
    text-wrap: pretty;
  }

  &__sender {
    display: flex;
    flex-wrap: wrap;
    gap: 10px;
    align-items: center;

    &-input {
      flex: 1 1 240px;
      min-width: 0;
    }
  }

  &__chips {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
  }

  &__chip {
    all: unset;
    display: inline-flex;
    align-items: center;
    gap: 6px;
    padding: 8px 14px;
    border-radius: var(--radius-pill);
    border: var(--border-thin) solid var(--color-border-subtle);
    background: rgba(255, 255, 255, 0.025);
    color: var(--color-text-secondary);
    font-size: 13px;
    font-weight: 500;
    cursor: pointer;
    transition:
      transform var(--dur-fast) var(--ease-out),
      background var(--dur-fast) var(--ease-out),
      border-color var(--dur-fast) var(--ease-out),
      color var(--dur-fast) var(--ease-out);

    :deep(.icon) {
      color: var(--color-text-muted);
      transition: color var(--dur-fast) var(--ease-out);
    }

    &:hover:not(:disabled) {
      background: var(--gradient-brand-soft);
      border-color: rgba(var(--color-brand-violet-rgb), 0.32);
      color: var(--color-text-primary);
      transform: translateY(-1px);

      :deep(.icon) {
        color: var(--color-brand-violet);
      }
    }
    &:active:not(:disabled) {
      transform: translateY(0);
      transition-duration: 0ms;
    }
    &:disabled {
      opacity: 0.5;
      cursor: progress;
    }
  }

  &__row {
    display: flex;
    flex-wrap: wrap;
    gap: 10px;
    align-items: center;
    padding-top: 6px;
    border-top: 1px dashed rgba(255, 255, 255, 0.05);

    &-input {
      flex: 1 1 280px;
      min-width: 0;
    }
  }

  &__timer {
    display: flex;
    flex-direction: column;
    gap: 8px;

    &-label {
      font-size: 12px;
      font-weight: 600;
      letter-spacing: 0.04em;
      text-transform: uppercase;
      color: var(--color-text-secondary);
    }

    &-row {
      display: flex;
      align-items: center;
      gap: 10px;
      flex-wrap: wrap;
    }

    &-field {
      width: 120px;
    }

    &-unit {
      font-size: 13px;
      color: var(--color-text-secondary);
    }
  }
}

// =============================================================================
// PATHS (стрим с ПК)
// =============================================================================
.speaker-path {
  display: flex;
  flex-direction: column;
  gap: 12px;
  padding: 16px 18px;
  border-radius: var(--radius-md);
  background: rgba(255, 255, 255, 0.025);
  border: 1px solid rgba(255, 255, 255, 0.05);

  & + & {
    margin-top: 4px;
  }

  &--primary {
    background:
      linear-gradient(
        130deg,
        color-mix(in srgb, var(--color-brand-purple) 8%, transparent),
        color-mix(in srgb, var(--color-brand-pink) 6%, transparent)
      ),
      rgba(255, 255, 255, 0.025);
    border-color: color-mix(in srgb, var(--color-brand-purple) 24%, transparent);
  }

  &__head {
    display: flex;
    flex-direction: column;
    gap: 6px;
  }

  &__badge {
    display: inline-flex;
    align-items: center;
    align-self: flex-start;
    padding: 2px 9px;
    border-radius: 999px;
    font-size: 10.5px;
    font-weight: 600;
    letter-spacing: 0.04em;
    text-transform: uppercase;
    background: rgba(var(--color-brand-purple-rgb), 0.16);
    color: var(--color-brand-purple);

    &--alt {
      background: rgba(255, 255, 255, 0.06);
      color: var(--color-text-secondary);
    }
  }

  &__title {
    margin: 0;
    font-family: var(--font-family-display);
    font-size: 16px;
    font-weight: 600;
    color: var(--color-text-primary);
    letter-spacing: -0.005em;
  }

  &__desc {
    margin: 0;
    font-size: 12.5px;
    color: var(--color-text-secondary);
    line-height: 1.55;
    max-width: 70ch;
    text-wrap: pretty;
  }
}

.speaker-steps {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.speaker-step {
  display: grid;
  grid-template-columns: 28px minmax(0, 1fr) auto;
  gap: 14px;
  align-items: center;
  padding: 14px 4px;
  border-top: 1px solid rgba(255, 255, 255, 0.045);

  &:first-child {
    border-top: 0;
    padding-top: 4px;
  }

  @container (max-width: 560px) {
    grid-template-columns: 28px minmax(0, 1fr);

    :deep(.btn) {
      grid-column: 1 / -1;
      justify-self: stretch;
    }
  }

  &__num {
    width: 28px;
    height: 28px;
    border-radius: 50%;
    display: grid;
    place-items: center;
    background: color-mix(in srgb, var(--color-brand-purple) 16%, transparent);
    color: var(--color-brand-purple);
    font-family: var(--font-family-mono);
    font-size: 12.5px;
    font-weight: 600;
  }

  &__copy {
    display: flex;
    flex-direction: column;
    gap: 3px;
    min-width: 0;

    strong {
      font-size: 14px;
      color: var(--color-text-primary);
      font-weight: 600;
      letter-spacing: -0.005em;
    }
    span {
      font-size: 12.5px;
      color: var(--color-text-muted);
      line-height: 1.5;
    }
  }
}

// =============================================================================
// ANIMATIONS
// =============================================================================
@keyframes heroBadgePulse {
  0% {
    transform: scale(1);
    opacity: 0.55;
  }
  70% {
    transform: scale(1.18);
    opacity: 0;
  }
  100% {
    transform: scale(1.18);
    opacity: 0;
  }
}

@keyframes heroChipPulse {
  0%,
  100% {
    box-shadow: 0 0 0 0 currentColor;
  }
  60% {
    box-shadow: 0 0 0 6px color-mix(in srgb, currentColor 0%, transparent);
  }
}

@media (prefers-reduced-motion: reduce) {
  .speaker-hero__badge-pulse,
  .speaker-hero__chip-dot,
  .speaker-card__chip {
    animation: none !important;
    transition: none;
  }
  .speaker-hero::after {
    animation: none;
  }
}

@media (max-width: 720px) {
  .speaker-hero {
    padding: 18px;
  }
  .speaker-card {
    padding: 16px;
  }
  .speaker-card__sender :deep(.btn) {
    width: 100%;
  }
}
</style>
