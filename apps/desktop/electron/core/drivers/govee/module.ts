import type { DriverModule } from '../driver-module.js';
import { GoveeDriver } from './govee-driver.js';

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
    credentialsSchema: [{ key: 'apiKey', label: 'API Key', kind: 'password', required: true }],
  },
  async create({ settings }) {
    const c = settings.getDriverCredentials('govee') as { apiKey?: string };
    if (!c.apiKey) return null;
    return new GoveeDriver(c.apiKey);
  },
};
