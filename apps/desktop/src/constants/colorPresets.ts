/**
 * @fileoverview
 * Пресеты RGB и CCT для color_setting capability. value (0xRRGGBB) и bg должны быть синхронны.
 */

export interface ColorPreset {
  label: string;
  /** RGB int (0xRRGGBB) или температура в Кельвинах, если задано `temperature`. */
  value: number;
  /** CSS-цвет для preview-чипа в UI. Должен совпадать с value (для RGB-пресетов). */
  bg: string;
  /** Если задано — это пресет цветовой температуры, а не RGB. */
  temperature?: number;
}

// Хексы пересекаются с brand-токенами (см. styles/abstracts/_tokens.scss).
export const RGB_PRESETS: ColorPreset[] = [
  { label: 'Тёплый', value: 0xffb866, bg: '#FFB866' },
  { label: 'Закат', value: 0xff5b9e, bg: '#FF5B9E' },
  { label: 'Лаванда', value: 0xb85dff, bg: '#B85DFF' },
  { label: 'Индиго', value: 0x7c5bff, bg: '#7C5BFF' },
  { label: 'Лагуна', value: 0x5bd8ff, bg: '#5BD8FF' },
  { label: 'Мята', value: 0x5be3ad, bg: '#5BE3AD' },
];

// CCT в Кельвинах; bg — приближённое визуальное представление для preview.
export const TEMPERATURE_PRESETS: ColorPreset[] = [
  { label: 'Тёплый белый', value: 2700, bg: '#FFD7A8', temperature: 2700 },
  { label: 'Дневной', value: 4500, bg: '#FFF1D6', temperature: 4500 },
  { label: 'Холодный', value: 6500, bg: '#E0EBFF', temperature: 6500 },
];
