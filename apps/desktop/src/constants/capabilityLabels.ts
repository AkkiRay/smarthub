/**
 * @fileoverview
 * Human-readable labels для Yandex IoT capability types и instance'ов.
 *
 * Single source of truth — все UI-компоненты (CapabilityControl, SceneEditor,
 * DeviceCard, DeviceDetailView) импортируют отсюда. Покрытие соответствует
 * Yandex Smart Home spec (yandex.ru/dev/dialogs/smart-home/doc/concepts).
 *
 * Структура:
 *   - CAPABILITY_TYPE_LABELS  — короткое имя capability (для column headers).
 *   - INSTANCE_LABELS_*       — instance-specific тексты per type.
 *   - capabilityLabel(type, i) — composite label для UI dropdown'ов / селектов.
 *   - capabilityActionLabel() — императивная форма (для Scene actions).
 */

export type CapabilityType =
  | 'devices.capabilities.on_off'
  | 'devices.capabilities.color_setting'
  | 'devices.capabilities.video_stream'
  | 'devices.capabilities.mode'
  | 'devices.capabilities.range'
  | 'devices.capabilities.toggle'
  | 'devices.capabilities.quasar.server_action'
  | 'devices.capabilities.quasar';

// =====================================================================
// Capability types — короткое имя «возможности».
// =====================================================================
export const CAPABILITY_TYPE_LABELS: Record<string, string> = {
  'devices.capabilities.on_off': 'Питание',
  'devices.capabilities.color_setting': 'Цвет',
  'devices.capabilities.video_stream': 'Видеопоток',
  'devices.capabilities.mode': 'Режим',
  'devices.capabilities.range': 'Уровень',
  'devices.capabilities.toggle': 'Переключатель',
  'devices.capabilities.quasar.server_action': 'Команда Алисы',
  'devices.capabilities.quasar': 'Возможность колонки',
};

// =====================================================================
// `range` instances — числовые шкалы (slider, % / °C / Hz).
// =====================================================================
export const RANGE_INSTANCE_LABELS: Record<string, string> = {
  brightness: 'Яркость',
  volume: 'Громкость',
  channel: 'Канал',
  temperature: 'Температура',
  humidity: 'Влажность',
  open: 'Открытие',
};

// =====================================================================
// `mode` instances — дискретные режимы работы (выбор из списка).
// =====================================================================
export const MODE_INSTANCE_LABELS: Record<string, string> = {
  thermostat: 'Режим работы',
  fan_speed: 'Скорость вентилятора',
  swing: 'Качание',
  program: 'Программа',
  input_source: 'Источник сигнала',
  dishwashing: 'Режим мойки',
  work_speed: 'Скорость работы',
  coffee_mode: 'Тип кофе',
  tea_mode: 'Тип чая',
  cleanup_mode: 'Режим уборки',
  water_level: 'Уровень воды',
  scene: 'Сцена освещения',
  heat: 'Подогрев',
  ventilation: 'Вентиляция',
};

// =====================================================================
// `toggle` instances — двупозиционные переключатели.
// =====================================================================
export const TOGGLE_INSTANCE_LABELS: Record<string, string> = {
  mute: 'Беззвучный режим',
  pause: 'Пауза',
  backlight: 'Подсветка',
  controls_locked: 'Блокировка от детей',
  ionization: 'Ионизация',
  keep_warm: 'Подогрев',
  oscillation: 'Качание',
};

// =====================================================================
// `color_setting` instances — управление цветом.
// =====================================================================
export const COLOR_INSTANCE_LABELS: Record<string, string> = {
  base: 'Цвет (RGB)',
  rgb: 'Цвет (RGB)',
  hsv: 'Цвет (HSV)',
  temperature_k: 'Цветовая температура',
  scene: 'Цветовая сцена',
};

// =====================================================================
// `quasar.server_action` + `quasar` instances — команды и состояния колонки
// Алисы. Список из реальных capability'ов yandex-iot driver'а:
// phrase_action / text_action / volume / news / weather / music_play /
// sound_play / stop_everything / tts / alice_show.
// =====================================================================
export const QUASAR_INSTANCE_LABELS: Record<string, string> = {
  // Server actions (TTS / голос).
  phrase_action: 'Произнести фразу',
  text_action: 'Голосовая команда',
  voice_action: 'Голосовая команда',
  tts: 'Озвучить текст',
  sound_command: 'Воспроизвести звук',

  // Quasar-only возможности (read-only state или native action колонки).
  volume: 'Громкость колонки',
  news: 'Новости',
  weather: 'Погода',
  music_play: 'Музыка',
  sound_play: 'Звук',
  stop_everything: 'Остановить всё',
  alice_show: 'Шоу Алисы',
};

// =====================================================================
// `video_stream` instances.
// =====================================================================
export const VIDEO_STREAM_INSTANCE_LABELS: Record<string, string> = {
  get_stream: 'Получить видеопоток',
};

// =====================================================================
// Главный resolver. Возвращает человекочитаемое имя capability.
//
// Формат вывода: «Категория: instance» (например «Уровень: Яркость»),
// либо одиночное короткое имя для capability'ов с одним instance'ом.
// Для unknown type/instance — fallback на технический ID без префикса.
// =====================================================================
export function capabilityLabel(type: string, instance: string): string {
  switch (type) {
    case 'devices.capabilities.on_off':
      return 'Включить / выключить';

    case 'devices.capabilities.color_setting':
      return COLOR_INSTANCE_LABELS[instance] ?? 'Цвет';

    case 'devices.capabilities.video_stream':
      return VIDEO_STREAM_INSTANCE_LABELS[instance] ?? 'Видеопоток';

    case 'devices.capabilities.range':
      return RANGE_INSTANCE_LABELS[instance] ?? humanize(instance) ?? 'Уровень';

    case 'devices.capabilities.mode':
      return MODE_INSTANCE_LABELS[instance] ?? humanize(instance) ?? 'Режим';

    case 'devices.capabilities.toggle':
      return TOGGLE_INSTANCE_LABELS[instance] ?? humanize(instance) ?? 'Переключатель';

    case 'devices.capabilities.quasar.server_action':
    case 'devices.capabilities.quasar':
      return (
        QUASAR_INSTANCE_LABELS[instance] ??
        (instance ? `Алиса · ${humanize(instance) ?? instance}` : 'Команда Алисы')
      );

    default: {
      const short = type.replace(/^devices\.capabilities\./, '');
      return instance ? `${short} · ${instance}` : short;
    }
  }
}

// =====================================================================
// Императивная форма для Scene actions: «Установить яркость», «Включить
// подсветку», «Озвучить текст». Используется в селектах действий сцен.
// =====================================================================
export function capabilityActionLabel(type: string, instance: string): string {
  switch (type) {
    case 'devices.capabilities.on_off':
      return 'Включить / выключить';

    case 'devices.capabilities.color_setting': {
      const label = COLOR_INSTANCE_LABELS[instance];
      return label ? `Установить ${label.toLowerCase()}` : 'Установить цвет';
    }

    case 'devices.capabilities.range': {
      const label = RANGE_INSTANCE_LABELS[instance] ?? humanize(instance);
      return label ? `Установить ${label.toLowerCase()}` : 'Установить уровень';
    }

    case 'devices.capabilities.mode': {
      const label = MODE_INSTANCE_LABELS[instance] ?? humanize(instance);
      return label ? `Выбрать ${label.toLowerCase()}` : 'Выбрать режим';
    }

    case 'devices.capabilities.toggle': {
      const label = TOGGLE_INSTANCE_LABELS[instance] ?? humanize(instance);
      return label ? `Переключить «${label}»` : 'Переключить';
    }

    case 'devices.capabilities.quasar.server_action':
    case 'devices.capabilities.quasar':
      return QUASAR_INSTANCE_LABELS[instance] ?? 'Команда Алисы';

    case 'devices.capabilities.video_stream':
      return 'Получить видеопоток';

    default:
      return capabilityLabel(type, instance);
  }
}

// =====================================================================
// Helpers
// =====================================================================
function humanize(snake: string): string | null {
  if (!snake) return null;
  // snake_case → «Snake case» (первая буква заглавная, остальные lower).
  const words = snake.replace(/_/g, ' ').trim();
  if (!words) return null;
  return words.charAt(0).toUpperCase() + words.slice(1).toLowerCase();
}
