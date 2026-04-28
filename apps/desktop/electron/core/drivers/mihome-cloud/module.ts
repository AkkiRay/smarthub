import type { DriverModule } from '../driver-module.js';
import { MiHomeCloudDriver } from './mihome-cloud-driver.js';
import { probeViaDiscover } from '../_shared/probe-via-discover.js';
import { defaultRegion } from '../_shared/region-detect.js';
import type { MiSession } from './mihome-utils.js';

interface StoredMihomeCreds {
  username?: string;
  password?: string;
  session?: MiSession;
  region?: 'cn' | 'de' | 'i2' | 'ru' | 'sg' | 'us';
}

export const mihomeCloudModule: DriverModule = {
  descriptor: {
    id: 'mihome-cloud',
    displayName: 'Mi Home (Cloud)',
    description:
      'Облачный API Xiaomi для устройств без локального токена: Aqara, Yeelight, Roborock, Mi sensors.',
    category: 'cloud-global',
    region: 'global',
    brandColor: '#FF6700',
    requiresCredentials: true,
    supportedTypes: [
      'light',
      'socket',
      'sensor',
      'humidifier',
      'purifier',
      'vacuum_cleaner',
      'fan',
    ],
    maturity: 'beta',
    docsUrl: 'https://github.com/Maxmudjon/com.mihome',
    credentialsSchema: [
      {
        key: 'region',
        label: 'Регион сервера',
        kind: 'select',
        defaultValue: defaultRegion('mihome'),
        hint: 'Тот же, что в Mi Home → Settings → Region. Сменили регион — войдите заново.',
        options: [
          { value: 'cn', label: 'China (cn)' },
          { value: 'de', label: 'Europe (de)' },
          { value: 'i2', label: 'India (i2)' },
          { value: 'ru', label: 'Russia (ru)' },
          { value: 'sg', label: 'Singapore (sg)' },
          { value: 'us', label: 'United States (us)' },
        ],
      },
      {
        key: '__oauth',
        kind: 'oauth',
        label: 'Войти через Xiaomi',
        hint: 'Откроется окно account.xiaomi.com — пройдите логин и подтверждение по email/SMS, как обычно. Хаб сохранит сессию автоматически.',
      },
      {
        key: 'username',
        label: 'Mi ID (только если без 2FA)',
        kind: 'text',
        hint: 'Можно оставить пустым — используйте «Войти через Xiaomi» выше. Password-flow работает только для аккаунтов БЕЗ двухфакторной авторизации.',
      },
      { key: 'password', label: 'Пароль', kind: 'password' },
      { key: '__test', kind: 'test-button', label: 'Проверить' },
    ],
  },
  async create({ settings }) {
    const c = settings.getDriverCredentials('mihome-cloud') as StoredMihomeCreds;
    // Activate если есть либо session (OAuth-flow), либо username+password (legacy).
    if (!c.session && (!c.username || !c.password)) return null;
    return new MiHomeCloudDriver({
      ...(c.username ? { username: c.username } : {}),
      ...(c.password ? { password: c.password } : {}),
      ...(c.session ? { session: c.session } : {}),
      region: c.region ?? 'cn',
    });
  },
  async probe(values) {
    if (!values['username'] || !values['password']) {
      return {
        ok: false,
        message:
          'Для проверки нужен password-flow (Mi ID + пароль). При 2FA используйте «Войти через Xiaomi» — статус подключения отобразится после успешного входа.',
      };
    }
    return probeViaDiscover(
      async () =>
        new MiHomeCloudDriver({
          username: values['username']!,
          password: values['password']!,
          region: (values['region'] as 'cn' | 'de' | 'i2' | 'ru' | 'sg' | 'us' | undefined) ?? 'cn',
        }),
      {
        successMessageFor: (n) =>
          n === 0
            ? 'Вход выполнен. Устройств в этом регионе пока нет — попробуйте сменить регион сервера.'
            : `Подключение работает. Найдено устройств: ${n}.`,
      },
    );
  },
};
