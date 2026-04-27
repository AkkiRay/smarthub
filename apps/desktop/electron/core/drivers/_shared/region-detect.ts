/**
 * @fileoverview Region auto-detect для cloud-провайдеров — `defaultRegion(provider)`.
 *
 * Определяется через `Intl.DateTimeFormat().resolvedOptions().timeZone` (Europe/Moscow,
 * America/New_York, Asia/Shanghai). Маппится на ближайший регион конкретного API,
 * fallback — первый в списке.
 *
 * Цель: убрать у юзера один лишний клик в дропдауне региона при первом сетапе.
 * Юзер всегда может сменить вручную — если timezone не точный матч.
 */

type ProviderRegions = Record<string, string>;

const TZ_REGIONS: Record<string, ProviderRegions> = {
  // Tuya: eu | us | cn | in
  tuya: {
    'Europe/': 'eu',
    'America/': 'us',
    'Asia/Shanghai': 'cn',
    'Asia/Hong_Kong': 'cn',
    'Asia/Macau': 'cn',
    'Asia/Kolkata': 'in',
    'Asia/Calcutta': 'in',
  },
  // eWeLink: eu | us | cn | as
  ewelink: {
    'Europe/': 'eu',
    'America/': 'us',
    'Asia/Shanghai': 'cn',
    'Asia/Hong_Kong': 'cn',
    'Asia/': 'as',
  },
  // Mi Home: cn | de | i2 | ru | sg | us
  mihome: {
    'Europe/Moscow': 'ru',
    'Europe/Kaliningrad': 'ru',
    'Asia/Yekaterinburg': 'ru',
    'Europe/': 'de',
    'America/': 'us',
    'Asia/Shanghai': 'cn',
    'Asia/Hong_Kong': 'cn',
    'Asia/Singapore': 'sg',
    'Asia/Kolkata': 'i2',
  },
  // Aqara: cn | usa | eu | sg | kr | ru
  aqara: {
    'Europe/Moscow': 'ru',
    'Europe/Kaliningrad': 'ru',
    'Asia/Yekaterinburg': 'ru',
    'Europe/': 'eu',
    'America/': 'usa',
    'Asia/Seoul': 'kr',
    'Asia/Shanghai': 'cn',
    'Asia/Hong_Kong': 'cn',
    'Asia/Singapore': 'sg',
  },
};

const PROVIDER_FALLBACK: Record<string, string> = {
  tuya: 'eu',
  ewelink: 'eu',
  mihome: 'de',
  aqara: 'eu',
};

/**
 * Подбирает дефолтный регион API-провайдера по системной timezone.
 * Возвращает fallback для провайдера если матча нет.
 */
export function defaultRegion(provider: 'tuya' | 'ewelink' | 'mihome' | 'aqara'): string {
  const tz = safeTimezone();
  const map = TZ_REGIONS[provider];
  if (map) {
    if (map[tz]) return map[tz]!;
    for (const prefix of Object.keys(map)) {
      if (tz.startsWith(prefix)) return map[prefix]!;
    }
  }
  return PROVIDER_FALLBACK[provider] ?? 'eu';
}

function safeTimezone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || '';
  } catch {
    return '';
  }
}
