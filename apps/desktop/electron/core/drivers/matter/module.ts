import type { DriverModule } from '../driver-module.js';
import { MatterDriver } from './matter-driver.js';

export const matterModule: DriverModule = {
  descriptor: {
    id: 'matter',
    displayName: 'Matter / CHIP',
    description:
      'Универсальный стандарт Matter-over-IP. Сейчас работает discovery (mDNS); полный controller — после установки @project-chip/matter.js.',
    category: 'protocol',
    region: 'global',
    brandColor: '#34A853',
    requiresCredentials: false,
    supportedTypes: ['light', 'socket', 'switch', 'sensor', 'thermostat', 'fan'],
    maturity: 'planned',
    docsUrl: 'https://github.com/project-chip/matter.js',
  },
  async create() {
    return new MatterDriver();
  },
};
