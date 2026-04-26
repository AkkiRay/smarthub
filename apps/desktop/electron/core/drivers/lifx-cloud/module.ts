import type { DriverModule } from '../driver-module.js';
import { LifxCloudDriver } from './lifx-cloud-driver.js';

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
        key: 'token',
        label: 'Personal Access Token',
        kind: 'password',
        hint: 'Сгенерируйте на cloud.lifx.com → Settings → Generate New Token.',
        required: true,
      },
    ],
  },
  async create({ settings }) {
    const c = settings.getDriverCredentials('lifx-cloud') as { token?: string };
    if (!c.token) return null;
    return new LifxCloudDriver(c.token);
  },
};
