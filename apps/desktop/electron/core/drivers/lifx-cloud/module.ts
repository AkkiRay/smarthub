import type { DriverModule } from '../driver-module.js';
import { LifxCloudDriver } from './lifx-cloud-driver.js';
import { probeViaDiscover } from '../_shared/probe-via-discover.js';

export const lifxCloudModule: DriverModule = {
  descriptor: {
    id: 'lifx-cloud',
    displayName: 'LIFX Cloud',
    description: 'LIFX HTTP API. Альтернатива местному LAN-протоколу — работает за NAT.',
    category: 'cloud-global',
    region: 'global',
    brandColor: '#FF5500',
    requiresCredentials: true,
    supportedTypes: ['light'],
    maturity: 'stable',
    docsUrl: 'https://api.developer.lifx.com/',
    credentialsSchema: [
      {
        key: '__register',
        kind: 'register-link',
        label: 'Сгенерировать LIFX токен',
        hint: 'cloud.lifx.com → Settings → Generate New Token. Один токен покрывает все ваши устройства.',
        url: 'https://cloud.lifx.com/settings',
      },
      {
        key: 'token',
        label: 'Personal Access Token',
        kind: 'password',
        hint: 'Длинная строка из cloud.lifx.com → Settings.',
        required: true,
      },
      { key: '__test', kind: 'test-button', label: 'Проверить' },
    ],
  },
  async create({ settings }) {
    const c = settings.getDriverCredentials('lifx-cloud') as { token?: string };
    if (!c.token) return null;
    return new LifxCloudDriver(c.token);
  },
  async probe(values) {
    if (!values['token']) return { ok: false, message: 'Введите Personal Access Token' };
    return probeViaDiscover(async () => new LifxCloudDriver(values['token']!));
  },
};
