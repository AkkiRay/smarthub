// Алиас для legacy-импортов: BRAND_HEX (числовые 0xRRGGBB для Three.js/Canvas/gl) и
// BRAND_HEX_STR (строковые '#RRGGBB' для inline-styles). Источник истины — @smarthome/shared.

import { BRAND, BRAND_HEX as BRAND_HEX_STRING } from '@smarthome/shared';

/** 0xRRGGBB int'ы для Three.js / Canvas / gl. */
export const BRAND_HEX = BRAND;

/** '#RRGGBB' строки для inline-styles. */
export const BRAND_HEX_STR = BRAND_HEX_STRING;
