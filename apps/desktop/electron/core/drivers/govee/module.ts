import type { DriverModule } from '../driver-module.js';
import { GoveeDriver } from './govee-driver.js';
import { probeViaDiscover } from '../_shared/probe-via-discover.js';

export const goveeModule: DriverModule = {
  descriptor: {
    id: 'govee',
    displayName: 'Govee',
    description: 'Govee Public API. RGB-ленты, лампы, датчики. Требует API key из приложения.',
    category: 'cloud-global',
    region: 'global',
    brandColor: '#7B4DFF',
    requiresCredentials: true,
    supportedTypes: ['light'],
    maturity: 'stable',
    docsUrl: 'https://developer.govee.com/',
    credentialsSchema: [
      {
        key: '__register',
        kind: 'register-link',
        label: 'Получить Govee API Key',
        hint: 'Govee app → Profile → About Us → Apply for API Key. Заполните форму, ключ придёт на email за пару минут.',
        url: 'https://developer.govee.com/reference/apply-you-govee-api-key',
      },
      {
        key: 'apiKey',
        label: 'API Key',
        kind: 'password',
        required: true,
        hint: 'UUID из email после Apply for API Key.',
      },
      { key: '__test', kind: 'test-button', label: 'Проверить' },
    ],
  },
  async create({ settings }) {
    const c = settings.getDriverCredentials('govee') as { apiKey?: string };
    if (!c.apiKey) return null;
    return new GoveeDriver(c.apiKey);
  },
  async probe(values) {
    if (!values['apiKey']) return { ok: false, message: 'Введите API Key' };
    return probeViaDiscover(async () => new GoveeDriver(values['apiKey']!));
  },
};
