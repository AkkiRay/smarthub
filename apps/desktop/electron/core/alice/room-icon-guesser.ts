/**
 * Угадывает SVG-иконку для комнаты по её русскому названию.
 *
 * Используется при импорте «Дома с Алисой» — Yandex отдаёт name, но не icon. Мы
 * подбираем визуально подходящую иконку из того же набора, что использует RoomsView,
 * чтобы импортированные комнаты выглядели единообразно с локальными.
 *
 * Не словарь по точному совпадению, а keyword-pattern'ы: «Большая гостиная»,
 * «Спальня детская», «Гостевая ванная» — все должны получать правильную иконку
 * без ручной правки.
 */

interface IconRule {
  pattern: RegExp;
  svg: string;
}

const RULES: ReadonlyArray<IconRule> = [
  {
    pattern: /(гостин|зал)/i,
    svg: '<svg viewBox="0 0 24 24" fill="none"><path d="M3 11V8a2 2 0 012-2h14a2 2 0 012 2v3M2 17a2 2 0 012-2h16a2 2 0 012 2v3h-2v-1H4v1H2v-3z" stroke="currentColor" stroke-width="1.6"/></svg>',
  },
  {
    pattern: /спальн/i,
    svg: '<svg viewBox="0 0 24 24" fill="none"><path d="M2 18V8h4v3h12V8h4v10M2 14h20" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>',
  },
  {
    pattern: /(кухн|столов)/i,
    svg: '<svg viewBox="0 0 24 24" fill="none"><rect x="4" y="3" width="16" height="18" rx="2" stroke="currentColor" stroke-width="1.6"/><path d="M4 9h16M9 6h.01" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>',
  },
  {
    pattern: /(ванн|туалет|санузел|душ)/i,
    svg: '<svg viewBox="0 0 24 24" fill="none"><path d="M3 12V5a2 2 0 014 0v1M3 12h18M5 12v6a3 3 0 003 3h8a3 3 0 003-3v-6" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>',
  },
  {
    pattern: /(кабинет|офис|рабоч)/i,
    svg: '<svg viewBox="0 0 24 24" fill="none"><rect x="3" y="6" width="18" height="11" rx="2" stroke="currentColor" stroke-width="1.6"/><path d="M3 17l3 4M21 17l-3 4" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>',
  },
  {
    pattern: /(коридор|прихож|холл)/i,
    svg: '<svg viewBox="0 0 24 24" fill="none"><path d="M5 21V5a2 2 0 012-2h10a2 2 0 012 2v16M9 21V11h6v10" stroke="currentColor" stroke-width="1.6"/></svg>',
  },
  {
    pattern: /(улиц|сад|двор|балкон|терраса)/i,
    svg: '<svg viewBox="0 0 24 24" fill="none"><circle cx="12" cy="8" r="4" stroke="currentColor" stroke-width="1.6"/><path d="M3 21l9-13 9 13" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>',
  },
  {
    pattern: /(гараж|парковк)/i,
    svg: '<svg viewBox="0 0 24 24" fill="none"><path d="M3 21V9l9-6 9 6v12M3 21h18M7 13h10v8H7z" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/></svg>',
  },
];

/** Дефолтная иконка — та же, что и для «Гостиной» (нейтрально-комфортная). */
const DEFAULT_ICON = RULES[0]!.svg;

/** Возвращает SVG-строку иконки по русскому названию комнаты. */
export function guessRoomIcon(roomName: string): string {
  for (const { pattern, svg } of RULES) {
    if (pattern.test(roomName)) return svg;
  }
  return DEFAULT_ICON;
}
