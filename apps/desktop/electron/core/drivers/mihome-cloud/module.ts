import type { DriverModule } from '../driver-module.js';
import { MiHomeCloudDriver } from './mihome-cloud-driver.js';

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
      { key: 'username', label: 'Mi ID (email или phone)', kind: 'text', required: true },
      { key: 'password', label: 'Пароль', kind: 'password', required: true },
      {
        key: 'region',
        label: 'Регион сервера',
        kind: 'select',
        defaultValue: 'cn',
        options: [
          { value: 'cn', label: 'China (cn)' },
          { value: 'de', label: 'Europe (de)' },
          { value: 'i2', label: 'India (i2)' },
          { value: 'ru', label: 'Russia (ru)' },
          { value: 'sg', label: 'Singapore (sg)' },
          { value: 'us', label: 'United States (us)' },
        ],
      },
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
};
