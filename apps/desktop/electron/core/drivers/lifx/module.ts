import type { DriverModule } from '../driver-module.js';
import { LifxDriver } from './lifx-driver.js';

export const lifxModule: DriverModule = {
  descriptor: {
    id: 'lifx',
    displayName: 'LIFX',
    description: 'LIFX LAN-протокол (UDP 56700, бинарный). Без облака.',
    category: 'lan-global',
    region: 'global',
    brandColor: '#FF5500',
    requiresCredentials: false,
    supportedTypes: ['light'],
    maturity: 'stable',
    docsUrl: 'https://lan.developer.lifx.com/',
  },
  async create() {
    return new LifxDriver();
  },
};
