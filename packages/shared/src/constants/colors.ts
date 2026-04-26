/**
 * @fileoverview Brand-палитра — single source of truth для цветов:
 *   - integer (`0x7c5bff`) — для Three.js, Canvas, GSAP color tweens;
 *   - hex (`#7c5bff`)      — для inline-styles, SCSS interpolation,
 *                            Vue computed-цветов.
 *
 * SCSS-переменные в `styles/abstracts/_tokens.scss` зеркалят эти значения.
 * При изменении палитры — синхронизировать оба файла.
 *
 * NOTE: brand-палитра — публичный design token; статусные цвета (success/warn/
 * error) — отдельный slot, чтобы UI можно было ребрендить, не трогая
 * семантику feedback-состояний.
 */

export const BRAND = {
  violet: 0x7c5bff,
  purple: 0xb85dff,
  pink: 0xff5b9e,
  blue: 0x5b8dff,
  cyan: 0x5bd8ff,
  amber: 0xffb866,
  mint: 0x5be3ad,
  coral: 0xff6e66,
  orange: 0xff8a4d,
  // Status
  success: 0x2dd89a,
  warning: 0xffb547,
  danger: 0xff5577,
  // Mid-tones для визуализаций
  purpleSoft: 0x8870ff,
  purpleHi: 0xc4a0ff,
} as const;

export type BrandColor = keyof typeof BRAND;

/** '#RRGGBB' зеркало BRAND для inline-styles. */
export const BRAND_HEX: Readonly<Record<BrandColor, string>> = Object.freeze(
  Object.fromEntries(
    Object.entries(BRAND).map(([k, v]) => [k, `#${v.toString(16).padStart(6, '0').toUpperCase()}`]),
  ) as Record<BrandColor, string>,
);

export const intToHex = (rgb: number): string =>
  `#${(rgb & 0xffffff).toString(16).padStart(6, '0').toUpperCase()}`;
