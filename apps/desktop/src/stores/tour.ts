/**
 * @fileoverview
 * Coachmark-тур. Шаги привязаны к DOM через `data-tour="<id>"`. Запускается
 * `?tour=1` из WelcomeView или ручкой из Settings. Шаги сгруппированы в главы.
 */

import { defineStore } from 'pinia';
import { computed, ref } from 'vue';
import { useUiStore } from './ui';

export interface TourChapter {
  id: string;
  /** Имя для chapter-chip в tooltip-е. */
  label: string;
}

export interface TourStep {
  /** Значение `data-tour` на target-элементе. */
  target: string | null;
  /** Запасные `data-tour` — пробуются по порядку, если primary не найден. */
  fallbackTargets?: string[];
  title: string;
  body: string;
  bullets?: string[];
  /** Курсивный hint в нижней части tooltip-а. */
  tip?: string;
  placement?: 'top' | 'bottom' | 'left' | 'right' | 'auto';
  /** Route-path (с query). Перед показом overlay переходит сюда и ждёт mount target-а. */
  route?: string;
  /** false → центр экрана + blur backdrop, без halo. По дефолту true. */
  highlight?: boolean;
  /** ID главы из CHAPTERS. */
  chapter: string;
}

const CHAPTERS: TourChapter[] = [
  { id: 'welcome', label: 'Знакомство' },
  { id: 'layout', label: 'Интерфейс' },
  { id: 'devices', label: 'Устройства' },
  { id: 'integrations', label: 'Интеграции' },
  { id: 'organize', label: 'Комнаты и сценарии' },
  { id: 'alice', label: 'Алиса' },
  { id: 'skill', label: 'Skill-мост' },
  { id: 'exposure', label: 'Что видит Алиса' },
  { id: 'finish', label: 'Готово' },
];

const STEPS: TourStep[] = [
  // ---------------- 1 · Знакомство ----------------
  {
    chapter: 'welcome',
    target: null,
    title: 'Привет! Покажу хаб за 3 минуты',
    body: 'Вы научитесь: подключать устройства, организовывать их по комнатам, собирать сценарии и связывать всё это с Алисой — голосом или через приложение «Дом с Алисой».',
    bullets: [
      'Esc — закрыть тур в любой момент',
      '← / → — листать шаги',
      'В Настройках → «Тур по интерфейсу» можно пройти заново',
    ],
    highlight: false,
  },

  // ---------------- 2 · Интерфейс ----------------
  {
    chapter: 'layout',
    target: 'titlebar-status',
    title: 'Шапка — индикатор живого хаба',
    body: 'Здесь видно: онлайн ли хаб, сколько устройств в сети, идёт ли синхронизация. Эта пилюля видна на каждом экране — если что-то «не работает», смотрите сюда первым делом.',
    placement: 'bottom',
    route: '/home',
  },
  {
    chapter: 'layout',
    target: 'home-onboarding',
    // Banner скрыт когда всё подключено — падаем на sidebar-discovery.
    fallbackTargets: ['sidebar-discovery'],
    title: 'Главная — три быстрых старта',
    body: 'Первый запуск показывает 3 пронумерованных tile с самыми важными действиями. Каждый исчезает по мере выполнения, и в итоге остаётся только список ваших устройств и сценариев.',
    bullets: [
      '«Найти устройства» — сразу запускает scan локальной сети',
      '«Подключить колонку Алисы» — открывает раздел с OAuth',
      '«Подключить интеграции» — ведёт в маркетплейс настроек',
    ],
    placement: 'bottom',
    route: '/home',
    tip: 'Когда всё подключено, баннер скрывается — главная превращается в дашборд.',
  },
  {
    chapter: 'layout',
    target: 'sidebar-hub-card',
    title: 'Карточка Алисы внизу сайдбара',
    body: 'Сжатый статус Алисы. «В сети» — колонка подключена локально. «Skill активен» — приложение «Дом с Алисой» видит ваш хаб и устройства. Клик ведёт в раздел Алисы.',
    placement: 'right',
    tip: 'Зелёная точка означает skill-мост работает; жёлтая — настроен, но ещё не привязан в Я.приложении.',
  },

  // ---------------- 3 · Устройства ----------------
  {
    chapter: 'devices',
    target: 'sidebar-discovery',
    title: 'Поиск устройств в локальной сети',
    body: 'Хаб опрашивает 25+ протоколов параллельно — Yeelight, Shelly, Hue, Tuya, MQTT, HomeKit, Matter и другие. Включите устройство в режим сопряжения, нажмите «Сканировать», карточки появятся за 5–10 секунд.',
    bullets: [
      'Локальные устройства (Wi-Fi/LAN) — без облака, мгновенно',
      'Облачные (Tuya, Govee, Sber) — нужны API-ключи в Настройках → Драйверы',
      'Mock-симулятор — для тестов UI без железа (`HUB_ENABLE_MOCK=true`)',
    ],
    placement: 'right',
  },
  {
    chapter: 'devices',
    target: 'sidebar-devices',
    title: 'Все устройства — единый список',
    body: 'Каждое устройство — карточка с capabilities (вкл/выкл, яркость, цвет, температура и т.д.). Управление прямо из карточки, без перехода в детали. Даблклик откроет историю и расширенные настройки.',
    placement: 'right',
    tip: 'Если устройство стало «offline» — посмотрите его страницу: там видна последняя ошибка драйвера и причина.',
  },

  // ---------------- 4 · Интеграции ----------------
  {
    chapter: 'integrations',
    target: 'sidebar-settings',
    title: 'Маркетплейс интеграций — 28 платформ',
    body: 'Кроме локальных Yeelight/Shelly/Hue хаб умеет в облака: Сбер Дом, SaluteHome, Tuya, Mi Home, Aqara, eWeLink (Sonoff), Govee, SwitchBot, TP-Link, LIFX. Плюс мосты: Home Assistant, Z-Wave-JS. Открывается в Настройках.',
    placement: 'right',
    route: '/settings',
  },
  {
    chapter: 'integrations',
    target: 'settings-integrations',
    title: 'Группировка по категориям',
    body: 'Интеграции сгруппированы: «Российские облака» (Сбер/Salute/Rubetek), «Локальный LAN» (без облака), «Универсальные протоколы» (MQTT/Matter/HomeKit), «Зарубежные облака», «Мосты к чужим хабам». У каждой карточки бейдж региона (РФ/Global) и стадии (stable/beta/planned).',
    bullets: [
      'Локальные включаются сразу — не требуют credentials',
      'Облачные раскрываются — внутри форма с нужными полями',
      'Поля рендерятся динамически из descriptor.credentialsSchema',
    ],
    placement: 'top',
    route: '/settings',
    tip: 'Tuya/Smart Life покрывает кучу no-name-устройств в РФ — даже Sber-лампочки старого поколения подключаются именно через Tuya.',
  },

  // ---------------- 5 · Комнаты + Сценарии ----------------
  {
    chapter: 'organize',
    target: 'sidebar-rooms',
    title: 'Комнаты — это группировка',
    body: 'Назначьте устройству комнату — появится фильтр в списке устройств, и Алиса сможет понимать «включи свет в спальне». Комнаты не обязательны, но сильно упрощают голос.',
    placement: 'right',
  },
  {
    chapter: 'organize',
    target: 'sidebar-scenes',
    title: 'Сценарии — много действий за один клик',
    body: 'Соберите «Доброе утро»: свет 30%, шторы открыть, чайник на 95°. Каждое действие может иметь задержку. Сценарий запускается из UI или голосом, если включена опция «Доступно через Алису».',
    bullets: [
      'Шаги выполняются параллельно (`delayMs` контролирует порядок)',
      'Любой driver, любой capability — свет, климат, бытовая техника',
      'С включённой экспозицией Алиса видит сценарий как кнопку «вкл»',
    ],
    placement: 'right',
  },

  // ---------------- 5 · Алиса intro ----------------
  {
    chapter: 'alice',
    target: 'sidebar-alice',
    title: 'Раздел Алисы — две независимые дорожки',
    body: 'Хаб умеет работать с Алисой двумя способами одновременно. Не путайте их: они решают разные задачи и не зависят друг от друга.',
    bullets: [
      '«Колонка» — управление Яндекс.Станцией по локальной сети (TTS, voice, музыка)',
      '«Связка с Алисой» — наши устройства появляются в приложении «Дом с Алисой», голос «включи лампу» работает на любой колонке',
    ],
    placement: 'right',
    route: '/alice',
  },
  {
    chapter: 'alice',
    target: 'alice-section-nav',
    title: 'Переключатель дорожек',
    body: 'Колонка и Skill-мост настраиваются отдельно. Можно использовать одну, обе или ни одной — устройства всё равно работают в локальном UI.',
    placement: 'bottom',
    route: '/alice?section=station',
  },
  {
    chapter: 'alice',
    // Подсвечиваем именно кнопку Яндекс ID. Когда колонка уже подключена,
    // AutoPair-карточки в DOM нет — падаем на success-баннер.
    target: 'alice-auto-pair-signin',
    fallbackTargets: ['alice-station-connected', 'alice-auto-pair'],
    title: 'Один клик через Яндекс ID',
    body: 'Кнопка «Войти через Яндекс» открывает окно Я.Паспорта. После логина хаб сам получит список ваших колонок и подключится к выбранной по локальной сети.',
    bullets: [
      'Хаб использует public client_id Яндекс.Музыки — единственный, кому Яндекс даёт scope для Glagol API',
      'Логин и токен остаются на этом компьютере — на сервер хаба ничего не уходит',
      'Если колонка уже подключена — здесь будет зелёный success-баннер с её именем',
    ],
    placement: 'bottom',
    route: '/alice?section=station',
  },
  {
    chapter: 'alice',
    // Карточка авто-пейринга целиком (или success-баннер, если уже подключено).
    target: 'alice-auto-pair',
    fallbackTargets: ['alice-station-connected'],
    title: 'Что происходит дальше',
    body: 'После логина хаб делает device_list, выбирает per-device JWT и поднимает WSS:1961 к выбранной колонке. Подключение полностью локальное — голос не уходит наружу.',
    bullets: [
      'Колонка должна быть в той же Wi-Fi-сети — хаб ищет её через mDNS',
      'JWT живёт ~1 час и обновляется автоматически при истечении',
      'После connect появятся быстрые чипы команд: «Привет», «Включи свет», «Погода»',
    ],
    placement: 'top',
    route: '/alice?section=station',
    tip: 'Не сработал auto-pair? Откройте «Ручное подключение по device-token» внизу страницы.',
  },

  // ---------------- 6 · Skill-мост ----------------
  {
    chapter: 'skill',
    target: 'alice-section-nav',
    title: 'Skill-мост: ваши устройства в «Доме с Алисой»',
    body: 'Хаб поднимает свой собственный «навык» в Я.Диалогах. Алиса видит ваши лампы, розетки и сценарии — и слушает команды «включи свет», «запусти Утро» на любой колонке (даже не вашей собственной).',
    bullets: [
      'Работает поверх HTTPS-туннеля cloudflared (бесплатно, без регистрации)',
      'Алиса не знает про драйверы — ей виден только финальный yandex schema (devices.types.light, capabilities.on_off, ...)',
      'Можно подключить даже устройства, которые Алиса напрямую не поддерживает (Shelly, MQTT и т.д.)',
    ],
    placement: 'bottom',
    route: '/alice?section=skill',
  },
  {
    chapter: 'skill',
    target: 'alice-skill-config',
    title: 'Шаг 1 — креды skill-а',
    body: 'Создайте пустой skill в dialogs.yandex.ru → «Умный дом». Скопируйте оттуда Skill ID (одно поле). Кнопка «Сгенерировать» создаст за вас пару OAuth client_id/client_secret — их нужно вставить обратно в консоль навыка.',
    placement: 'right',
    route: '/alice?section=skill',
    tip: 'Все секреты хранятся локально в зашифрованном electron-store. На наш сервер ничего не уходит.',
  },
  {
    chapter: 'skill',
    // Отдельный шаг под кнопку «Получить через Яндекс ID» — иначе теряется
    // среди соседних полей формы.
    target: 'alice-skill-dialogs-token',
    fallbackTargets: ['alice-skill-config'],
    title: 'Push-обновления через Яндекс ID',
    body: 'Кнопка «Получить через Яндекс ID» получает callback-токен у Я.Диалогов: с ним state-обновления уходят в Алису мгновенно (вы переключили лампу — приложение «Дом с Алисой» сразу отрисовало новое состояние).',
    bullets: [
      'Без токена связка тоже работает — Алиса просто узнаёт об изменениях при следующем опросе',
      'Перед получением: введите Skill ID и сгенерируйте OAuth-креды — иначе нечего «pushить»',
      'Окно входа открывается прямо в Electron, токен сохраняется локально',
    ],
    placement: 'left',
    route: '/alice?section=skill',
  },
  {
    chapter: 'skill',
    target: 'alice-skill-tunnel',
    title: 'Шаг 2 — публичный туннель',
    body: 'Алиса должна достучаться до вашего хаба через интернет. Хаб запускает cloudflared tunnel и получает HTTPS-URL. Локальный webhook остаётся на 127.0.0.1 — туннель только проксирует.',
    bullets: [
      'cloudflared должен быть в PATH — UI сам проверяет и даёт ссылку на скачивание',
      'Quick-tunnel меняет URL при каждом запуске',
      'Named-tunnel со своим доменом — стабильный URL (опционально, для продакшна)',
    ],
    placement: 'right',
    route: '/alice?section=skill',
  },
  {
    chapter: 'skill',
    target: 'alice-skill-link',
    title: 'Шаг 3 — привязка в Я.приложении',
    body: 'Откройте «Дом с Алисой» → «Добавить устройство» → «По производителю» → выберите свой skill. Алиса откроет страницу подтверждения вашего хаба, нажмите «Привязать». Готово — в этой карточке появится «Привязано», ниже — счётчик webhook-запросов от Алисы.',
    placement: 'right',
    route: '/alice?section=skill',
    tip: 'Если ваш skill не виден в списке — он private, доступен только вам. Это нормально для домашнего использования.',
  },

  // ---------------- 7 · Exposure ----------------
  {
    chapter: 'exposure',
    target: 'alice-exposure',
    title: 'Что видит Алиса — точная настройка',
    body: 'По умолчанию хаб выдаёт Алисе все устройства (кроме pairing-state). Сценарии — только те, у которых явно стоит «Доступно через Алису». Здесь можно переопределить любой тумблер.',
    bullets: [
      'Тумблер слева — выдать/скрыть',
      'Изменения уходят в Алису через debounced state-callback за ~1 секунду',
      'Кнопка «Обновить у Алисы» — принудительный re-discovery, если что-то рассинхронилось',
    ],
    placement: 'top',
    route: '/alice?section=exposure',
  },
  {
    chapter: 'exposure',
    target: 'alice-exposure',
    title: 'Имена для голоса — короткие',
    body: 'Алиса распознаёт устройство по имени. «Yeelight Color Bulb 1S» она не распознает; «лампа» или «свет на кухне» — да. Имя в списке = техническое; для Алисы можно задать alias (через карточку устройства). Та же логика для комнат.',
    placement: 'top',
    tip: 'Голосовая команда сценария — буквально его имя в нижнем регистре. «Доброе утро» → «Алиса, включи доброе утро».',
  },

  // ---------------- 8 · Finish ----------------
  {
    chapter: 'finish',
    target: 'sidebar-settings',
    title: 'Настройки и драйверы',
    body: 'Тут включаются Tuya/MQTT/облачные драйверы (нужны API-ключи), меняется тема, можно пройти тур заново. Сюда же приземляются будущие интеграции и продвинутые опции.',
    placement: 'right',
  },
  {
    chapter: 'finish',
    target: null,
    title: 'Всё, теперь вы знаете хаб',
    body: 'Краткая шпаргалка на каждый день:',
    bullets: [
      'Поиск → Сканировать → подключить устройство',
      'Устройства → клик по карточке → управлять',
      'Сценарии → создать → включить «Доступно через Алису»',
      'Алиса → одна вкладка — колонка, другая — skill-мост в «Дом с Алисой»',
      '«Что видит Алиса» — финальный фильтр, что выдавать наружу',
    ],
    tip: 'Тур всегда можно пройти заново — Настройки → «Тур по интерфейсу».',
    highlight: false,
  },
];

export const useTourStore = defineStore('tour', () => {
  const ui = useUiStore();
  const stepIndex = ref(-1);
  const isActive = computed(() => stepIndex.value >= 0 && stepIndex.value < STEPS.length);
  const current = computed<TourStep | null>(() =>
    isActive.value ? (STEPS[stepIndex.value] ?? null) : null,
  );
  const total = STEPS.length;

  /** Chapter-meta для chip-а вида «Глава 3 · Алиса». */
  const currentChapter = computed<{
    chapter: TourChapter;
    chapterIndex: number;
    chapterTotal: number;
  } | null>(() => {
    const step = current.value;
    if (!step) return null;
    const chapter = CHAPTERS.find((c) => c.id === step.chapter);
    if (!chapter) return null;
    return {
      chapter,
      chapterIndex: CHAPTERS.findIndex((c) => c.id === chapter.id) + 1,
      chapterTotal: CHAPTERS.length,
    };
  });

  /** Индекс первого шага следующей главы — для кнопки «Пропустить главу». */
  const nextChapterIndex = computed<number>(() => {
    const step = current.value;
    if (!step) return -1;
    const chapterId = step.chapter;
    for (let i = stepIndex.value + 1; i < STEPS.length; i++) {
      const next = STEPS[i];
      if (next && next.chapter !== chapterId) return i;
    }
    return STEPS.length;
  });

  function start(): void {
    stepIndex.value = 0;
  }
  function next(): void {
    if (stepIndex.value < STEPS.length - 1) {
      stepIndex.value += 1;
    } else {
      finish();
    }
  }
  function back(): void {
    if (stepIndex.value > 0) stepIndex.value -= 1;
  }
  function jumpTo(index: number): void {
    if (index >= STEPS.length) {
      finish();
      return;
    }
    if (index >= 0) stepIndex.value = index;
  }
  function skipChapter(): void {
    jumpTo(nextChapterIndex.value);
  }
  function finish(): void {
    stepIndex.value = -1;
    ui.completeTour();
  }
  function skip(): void {
    finish();
  }

  return {
    stepIndex,
    isActive,
    current,
    currentChapter,
    nextChapterIndex,
    total,
    start,
    next,
    back,
    jumpTo,
    skipChapter,
    finish,
    skip,
  };
});
