import type { DriverModule } from '../driver-module.js';
import { MiHomeCloudDriver } from './mihome-cloud-driver.js';
import { probeViaDiscover } from '../_shared/probe-via-discover.js';
import { defaultRegion } from '../_shared/region-detect.js';

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
        key: '__register',
        kind: 'register-link',
        label: 'Открыть Mi Account',
        hint: 'Логин/пароль — те же, что в приложении Mi Home. Регион выберите тот же, что и в Mi Home (Settings → Region).',
        url: 'https://account.xiaomi.com/',
      },
      { key: 'username', label: 'Mi ID (email или phone)', kind: 'text', required: true },
      { key: 'password', label: 'Пароль', kind: 'password', required: true },
      {
        key: 'region',
        label: 'Регион сервера',
        kind: 'select',
        defaultValue: defaultRegion('mihome'),
        options: [
          { value: 'cn', label: 'China (cn)' },
          { value: 'de', label: 'Europe (de)' },
          { value: 'i2', label: 'India (i2)' },
          { value: 'ru', label: 'Russia (ru)' },
          { value: 'sg', label: 'Singapore (sg)' },
          { value: 'us', label: 'United States (us)' },
        ],
      },
      { key: '__test', kind: 'test-button', label: 'Проверить' },
    ],
  },
  async create({ settings }) {
    const c = settings.getDriverCredentials('mihome-cloud') as {
      username?: string;
      password?: string;
      region?: 'cn' | 'de' | 'i2' | 'ru' | 'sg' | 'us';
    };
    if (!c.username || !c.password) return null;
    return new MiHomeCloudDriver({
      username: c.username,
      password: c.password,
      region: c.region ?? 'cn',
    });
  },
  async probe(values) {
    if (!values['username'] || !values['password']) {
      return { ok: false, message: 'Введите Mi ID и пароль' };
    }
    return probeViaDiscover(
      async () =>
        new MiHomeCloudDriver({
          username: values['username']!,
          password: values['password']!,
          region: (values['region'] as 'cn' | 'de' | 'i2' | 'ru' | 'sg' | 'us' | undefined) ?? 'cn',
        }),
    );
  },
};
