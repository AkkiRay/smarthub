/**
 * @fileoverview `v-safe-html` — XSS-безопасная замена `v-html` через DOMPurify.
 * Конфиг — narrow allow-list под inline-SVG-иконки и базовый текст.
 */

import DOMPurify, { type Config } from 'dompurify';
import type { Directive, DirectiveBinding } from 'vue';

const SAFE_HTML_CONFIG: Config = {
  ALLOWED_TAGS: [
    'svg',
    'g',
    'path',
    'circle',
    'rect',
    'line',
    'polyline',
    'polygon',
    'ellipse',
    'defs',
    'linearGradient',
    'radialGradient',
    'stop',
    'mask',
    'clipPath',
    'use',
    'title',
    'desc',
    // Текстовое форматирование — `<b>`, `<i>`, `<span>` для inline-подсветок
    'span',
    'b',
    'i',
    'em',
    'strong',
    'br',
  ],
  ALLOWED_ATTR: [
    'viewBox',
    'xmlns',
    'fill',
    'stroke',
    'stroke-width',
    'stroke-linecap',
    'stroke-linejoin',
    'stroke-dasharray',
    'stroke-miterlimit',
    'stroke-opacity',
    'fill-opacity',
    'fill-rule',
    'clip-rule',
    'd',
    'cx',
    'cy',
    'r',
    'rx',
    'ry',
    'x',
    'y',
    'x1',
    'x2',
    'y1',
    'y2',
    'width',
    'height',
    'points',
    'transform',
    'opacity',
    'class',
    'id',
    'href',
    'gradientUnits',
    'gradientTransform',
    'offset',
    'stop-color',
    'stop-opacity',
    'mask',
    'clip-path',
  ],
  FORBID_ATTR: ['onerror', 'onload', 'onmouseover', 'onclick', 'onfocus'],
  ALLOW_DATA_ATTR: false,
};

function applySafe(el: HTMLElement, value: unknown): void {
  if (typeof value !== 'string' || value.length === 0) {
    el.innerHTML = '';
    return;
  }
  el.innerHTML = DOMPurify.sanitize(value, SAFE_HTML_CONFIG) as unknown as string;
}

export const vSafeHtml: Directive<HTMLElement, unknown> = {
  mounted(el, binding: DirectiveBinding<unknown>) {
    applySafe(el, binding.value);
  },
  updated(el, binding: DirectiveBinding<unknown>) {
    if (binding.value === binding.oldValue) return;
    applySafe(el, binding.value);
  },
};
